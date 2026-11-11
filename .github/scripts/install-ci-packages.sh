#!/usr/bin/env bash
# Disposable hosted Ubuntu only. No system source/key changes, unsigned packages,
# daemon starts, unbounded retries, or retry of a possibly partial installation.
set -euo pipefail
test "$#" -eq 1
case "$1" in
  ingress) packages=(nftables iproute2 iptables ebtables curl openssl nginx kmod) ;;
  nginx) packages=(nginx) ;;
  *) exit 64 ;;
esac
test "${GITHUB_ACTIONS-}" = true
test "${RUNNER_ENVIRONMENT-}" = github-hosted
test "${RUNNER_OS-}" = Linux
. /etc/os-release
test "$ID:$VERSION_ID" = ubuntu:24.04
test "$(dpkg --print-architecture)" = amd64
test "$(sudo -n id -u)" = 0
keyring=/usr/share/keyrings/ubuntu-archive-keyring.gpg
test -f "$keyring" && test ! -L "$keyring"
runner_temp="$(cd -- "${RUNNER_TEMP:?}" && pwd -P)"
apt_root="$(mktemp -d "$runner_temp/faolla-ci-apt.XXXXXXXX")"
case "$apt_root" in "$runner_temp"/faolla-ci-apt.????????) ;; *) exit 1 ;; esac
test -d "$apt_root" && test ! -L "$apt_root"
# Only public, fixed repository metadata is stored here. _apt may read it.
chmod 755 "$apt_root"
mkdir "$apt_root/sourceparts"
policy=/usr/sbin/policy-rc.d
test ! -e "$policy" && test ! -L "$policy" || exit 1
fixture_policy="$apt_root/policy-rc.d"
printf '#!/bin/sh\nexit 101\n' > "$fixture_policy"
policy_hash="$(sha256sum "$fixture_policy")"
policy_hash="${policy_hash%% *}"
verify_policy() {
  test "$(sudo -n stat -c '%u:%a:%h' "$policy")" = 0:755:1
  local actual
  actual="$(sudo -n sha256sum "$policy")"
  test "${actual%% *}" = "$policy_hash"
}
cleanup_policy() {
  local status=$?
  if ! sudo -n bash -c 'set -euo pipefail; test -f "$1"; test ! -L "$1"; test "$(stat -c "%u:%a:%h" "$1")" = 0:755:1; actual="$(sha256sum "$1")"; test "${actual%% *}" = "$2"; rm -- "$1"' -- "$policy" "$policy_hash"; then
    status=1
  fi
  exit "$status"
}
sudo -n install -o root -g root -m 755 "$fixture_policy" "$policy"
trap cleanup_policy EXIT
verify_policy
attempt=0
downloaded=false
# Both endpoints carry Ubuntu-signed Noble pockets. Avoid the runner image's
# mirror+file resolver and preserve the installed Ubuntu archive keyring.
for mirror in https://archive.ubuntu.com/ubuntu https://us.archive.ubuntu.com/ubuntu; do
  attempt=$((attempt + 1))
  sources="$apt_root/ubuntu-$attempt.sources"
  printf 'Types: deb\nURIs: %s\nSuites: noble noble-updates noble-security\nComponents: main restricted universe multiverse\nSigned-By: %s\n' "$mirror" "$keyring" > "$sources"
  apt_options=(-o "Dir::Etc::sourcelist=$sources" -o "Dir::Etc::sourceparts=$apt_root/sourceparts"
    -o Acquire::Retries=1 -o Acquire::https::Timeout=15 -o Acquire::http::Timeout=15
    -o Acquire::https::Verify-Peer=true -o Acquire::https::Verify-Host=true
    -o Acquire::AllowInsecureRepositories=false -o APT::Get::AllowUnauthenticated=false
    -o Acquire::Check-Valid-Until=true -o Acquire::Check-Date=true
    -o DPkg::Lock::Timeout=15)
  printf 'ci-package-download attempt=%s mirror=%s\n' "$attempt" "$mirror"
  verify_policy
  # Strict update: a transient or signature failure cannot reuse old indexes.
  if sudo -n timeout --signal=TERM --kill-after=10s 90s apt-get "${apt_options[@]}" update --error-on=any; then
    verify_policy
    if sudo -n env DEBIAN_FRONTEND=noninteractive timeout --signal=TERM --kill-after=10s 90s apt-get "${apt_options[@]}" --download-only --no-remove --yes --no-install-recommends install "${packages[@]}"; then
      downloaded=true
      break
    fi
  fi
  printf 'ci-package-download attempt=%s failed; no packages configured\n' "$attempt" >&2
done
test "$downloaded" = true
verify_policy
# Exactly one installation. Failure/timeout is terminal, never replayed.
sudo -n env DEBIAN_FRONTEND=noninteractive timeout --signal=TERM --kill-after=10s 120s apt-get "${apt_options[@]}" --no-download --no-remove --yes --no-install-recommends install "${packages[@]}"
printf 'ci-package-install completed profile=%s attempts=%s\n' "$1" "$attempt"
