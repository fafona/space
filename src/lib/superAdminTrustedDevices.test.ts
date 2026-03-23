import test from "node:test";
import assert from "node:assert/strict";
import {
  canRegisterAnotherSuperAdminDevice,
  normalizeSuperAdminMaxDevices,
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
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "1.1.1.1",
        lastLoginStatus: "success",
      },
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-21T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "2.2.2.2",
        lastLoginStatus: "success",
      },
      {
        deviceId: "device-2",
        deviceLabel: "Mac / Safari",
        addedAt: "2026-03-22T10:00:00.000Z",
        lastVerifiedAt: "2026-03-22T10:00:00.000Z",
        firstLoginIp: "3.3.3.3",
        lastLoginIp: "3.3.3.3",
        lastLoginStatus: "success",
      },
    ],
  });

  assert.equal(devices.length, 2);
  assert.equal(devices[0]?.deviceId, "device-2");
  assert.equal(devices[1]?.lastLoginIp, "2.2.2.2");
});

test("upsertSuperAdminTrustedDevice preserves original addedAt and first login ip", () => {
  const devices = upsertSuperAdminTrustedDevice(
    [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "1.1.1.1",
        lastLoginStatus: "success",
      },
    ],
    {
      deviceId: "device-1",
      deviceLabel: "Windows / Edge",
      verifiedAt: "2026-03-23T10:00:00.000Z",
      loginIp: "9.9.9.9",
    },
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.deviceLabel, "Windows / Edge");
  assert.equal(devices[0]?.addedAt, "2026-03-20T10:00:00.000Z");
  assert.equal(devices[0]?.firstLoginIp, "1.1.1.1");
  assert.equal(devices[0]?.lastLoginIp, "9.9.9.9");
});

test("removeSuperAdminTrustedDevice removes the requested device only", () => {
  const devices = removeSuperAdminTrustedDevice(
    [
      {
        deviceId: "device-1",
        deviceLabel: "Windows / Chrome",
        addedAt: "2026-03-20T10:00:00.000Z",
        lastVerifiedAt: "2026-03-20T10:00:00.000Z",
        firstLoginIp: "1.1.1.1",
        lastLoginIp: "1.1.1.1",
        lastLoginStatus: "success",
      },
      {
        deviceId: "device-2",
        deviceLabel: "Mac / Safari",
        addedAt: "2026-03-22T10:00:00.000Z",
        lastVerifiedAt: "2026-03-22T10:00:00.000Z",
        firstLoginIp: "3.3.3.3",
        lastLoginIp: "3.3.3.3",
        lastLoginStatus: "success",
      },
    ],
    "device-1",
  );

  assert.deepEqual(
    devices.map((item) => item.deviceId),
    ["device-2"],
  );
});

test("canRegisterAnotherSuperAdminDevice blocks new devices when limit is reached", () => {
  const devices = [
    {
      deviceId: "device-1",
      deviceLabel: "Windows / Chrome",
      addedAt: "2026-03-20T10:00:00.000Z",
      lastVerifiedAt: "2026-03-20T10:00:00.000Z",
      firstLoginIp: "1.1.1.1",
      lastLoginIp: "1.1.1.1",
      lastLoginStatus: "success" as const,
    },
    {
      deviceId: "device-2",
      deviceLabel: "Mac / Safari",
      addedAt: "2026-03-22T10:00:00.000Z",
      lastVerifiedAt: "2026-03-22T10:00:00.000Z",
      firstLoginIp: "3.3.3.3",
      lastLoginIp: "3.3.3.3",
      lastLoginStatus: "success" as const,
    },
  ];

  assert.equal(canRegisterAnotherSuperAdminDevice(devices, 2, "device-3"), false);
  assert.equal(canRegisterAnotherSuperAdminDevice(devices, 2, "device-2"), true);
});

test("normalizeSuperAdminMaxDevices clamps values to a safe range", () => {
  assert.equal(normalizeSuperAdminMaxDevices(0), 1);
  assert.equal(normalizeSuperAdminMaxDevices(99), 20);
  assert.equal(normalizeSuperAdminMaxDevices("4"), 4);
});
