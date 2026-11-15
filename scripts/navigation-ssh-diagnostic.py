"""Disposable CI-only observer. Never read environment, command arguments or file contents."""
import json
import os
import pathlib
import re
import sys
import time

assert os.environ.get("GITHUB_ACTIONS") == "true"
assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
assert len(sys.argv) == 3 and sys.argv[1].isdigit()
root = pathlib.Path(sys.argv[2]).resolve(strict=True)
assert root.name == "navigation-ssh-diagnostic" and root.is_dir()
assert not pathlib.Path("/var/lib/faolla-online-release/active.json").exists()
pid = int(sys.argv[1])

def identity(number):
    raw = pathlib.Path(f"/proc/{number}/stat").read_text()
    close = raw.rindex(")")
    fields = raw[close + 2:].split()
    return {"pid": number, "parent": int(fields[1]), "birth": fields[19],
            "state": fields[0], "name": raw[raw.index("(") + 1:close]}

try:
    original = identity(pid)
except FileNotFoundError:
    sys.exit(0)

def sample():
    candidates = {}
    for path in pathlib.Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            value = identity(int(path.name))
            candidates[value["pid"]] = value
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    owned = {pid}
    for _ in range(12):
        added = {number for number, value in candidates.items() if value["parent"] in owned}
        if added.issubset(owned):
            break
        owned.update(added)
    result = []
    for number in sorted(owned):
        value = candidates.get(number)
        if not value:
            continue
        value["name"] = value["name"] if re.fullmatch(r"[A-Za-z0-9_.-]{1,24}", value["name"]) else "other"
        try:
            wait = pathlib.Path(f"/proc/{number}/wchan").read_text().strip()
            value["wait"] = wait if re.fullmatch(r"[A-Za-z0-9_]{1,80}", wait) else "other"
            descriptors = []
            for fd in pathlib.Path(f"/proc/{number}/fd").iterdir():
                target = os.readlink(fd)
                if not re.fullmatch(r"pipe:\[\d+\]", target):
                    suffix = pathlib.Path(target).name
                    target = suffix if suffix in {"stdout.fifo", "stderr.fifo", "stdout.log", "stderr.log", "null"} else "other"
                flags = re.search(r"^flags:\s+([0-7]+)$", pathlib.Path(f"/proc/{number}/fdinfo/{fd.name}").read_text(), re.M)
                descriptors.append({"fd": int(fd.name), "target": target, "flags": flags[1] if flags else None})
            value["descriptors"] = descriptors
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            value["disappeared"] = True
        result.append(value)
    return result

with (root / f"process-{pid}.log").open("x", encoding="utf-8") as output:
    for elapsed in range(45):
        time.sleep(1)
        try:
            current = identity(pid)
            if current["birth"] != original["birth"] or current["state"] == "Z":
                break
        except (FileNotFoundError, ProcessLookupError):
            break
        if elapsed >= 1:
            output.write(json.dumps({"seconds": elapsed + 1, "processes": sample()}) + "\n")
            output.flush()
