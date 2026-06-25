// src/lib/transfer/__tests__/envelope.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveTransportKey, randomSalt,
  encryptFieldWithKey, decryptFieldWithKey,
  encryptBuffer, decryptBuffer,
  writeContainer, readContainer,
} from "../envelope";
import type { BundleManifest } from "../types";

const salt = randomSalt();
const key = deriveTransportKey("passphrase-di-test", salt);

test("field round-trip", () => {
  const ct = encryptFieldWithKey("s3cr3t", key);
  assert.equal(ct.split(":").length, 3);
  assert.equal(decryptFieldWithKey(ct, key), "s3cr3t");
});

test("field con chiave sbagliata lancia", () => {
  const ct = encryptFieldWithKey("s3cr3t", key);
  const wrong = deriveTransportKey("altra", salt);
  assert.throws(() => decryptFieldWithKey(ct, wrong));
});

test("buffer round-trip", () => {
  const data = Buffer.from("payload-binario-àèì".repeat(1000));
  const blob = encryptBuffer(data, key);
  assert.ok(blob.length > data.length);
  assert.deepEqual(decryptBuffer(blob, key), data);
});

test("buffer con chiave sbagliata lancia (GCM tag)", () => {
  const blob = encryptBuffer(Buffer.from("x"), key);
  const wrong = deriveTransportKey("altra", salt);
  assert.throws(() => decryptBuffer(blob, wrong));
});

test("container round-trip preserva manifest e payload", () => {
  const manifest: BundleManifest = {
    format: "da-ipam-tenant-bundle", formatVersion: 1, appVersion: "0.0.0",
    exportedAt: "2026-06-25T00:00:00.000Z", tiers: ["asset"], includeVault: false,
    tables: { networks: 3 }, secretErrors: 0,
    encryption: { scheme: "envelope-aes-256-gcm", saltHex: salt.toString("hex"), sourceKeyFingerprint: "abc" },
  };
  const payload = encryptBuffer(Buffer.from("ndjson-lines"), key);
  const container = writeContainer(manifest, payload);
  const read = readContainer(container);
  assert.deepEqual(read.manifest, manifest);
  assert.deepEqual(read.encryptedPayload, payload);
  assert.deepEqual(decryptBuffer(read.encryptedPayload, key), Buffer.from("ndjson-lines"));
});

test("container con magic errato lancia", () => {
  assert.throws(() => readContainer(Buffer.from("NOTADABK-garbage")));
});
