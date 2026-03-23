import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSuperAdminTrustedDevices,
  removeSuperAdminTrustedDevice,
  upsertSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";

test("normalizeSuperAdminTrustedDevices keeps latest record per device", () => {
  const devices = normalizeSuperAdminTrustedDevices({
    devices: [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
      },
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-21T10:00:00.000Z",
      },
      {
        deviceId: "device-2",
        deviceLabel: "Mac / Safari",
        addedAt: "2026-03-22T10:00:00.000Z",
        lastVerifiedAt: "2026-03-22T10:00:00.000Z",
      },
    ],
  });

  assert.equal(devices.length, 2);
  assert.equal(devices[0]?.deviceId, "device-2");
  assert.equal(devices[1]?.lastVerifiedAt, "2026-03-21T10:00:00.000Z");
});

test("upsertSuperAdminTrustedDevice preserves original addedAt while refreshing verification time", () => {
  const devices = upsertSuperAdminTrustedDevice(
    [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
      },
    ],
    {
      deviceId: "device-1",
      deviceLabel: "Windows / Edge",
      verifiedAt: "2026-03-23T10:00:00.000Z",
    },
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.deviceLabel, "Windows / Edge");
  assert.equal(devices[0]?.addedAt, "2026-03-20T10:00:00.000Z");
  assert.equal(devices[0]?.lastVerifiedAt, "2026-03-23T10:00:00.000Z");
});

test("removeSuperAdminTrustedDevice removes the requested device only", () => {
  const devices = removeSuperAdminTrustedDevice(
    [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
      },
      {
        deviceId: "device-2",
        deviceLabel: "Mac / Safari",
        addedAt: "2026-03-22T10:00:00.000Z",
        lastVerifiedAt: "2026-03-22T10:00:00.000Z",
      },
    ],
    "device-1",
  );

  assert.deepEqual(
    devices.map((item) => item.deviceId),
    ["device-2"],
  );
});
