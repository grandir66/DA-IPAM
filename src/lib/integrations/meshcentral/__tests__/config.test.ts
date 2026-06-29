process.env.ENCRYPTION_KEY ||= "test-encryption-key-mesh-config";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { getMeshConfig, getMeshCreds, saveMeshConfig } from "@/lib/integrations/meshcentral/config";

const T = "TESTMESHCFG";
after(() => deleteTenantDatabase(T));

const LOGIN_KEY_HEX = "a".repeat(160); // 80-byte LoginCookieEncryptionKey, 160 hex chars

test("save then read public config never leaks secrets", () => {
  withTenant(T, () => {
    saveMeshConfig({
      serverUrl: "https://mesh.cliente.it",
      domain: "",
      meshId: "mesh//ABCDEF",
      serviceUser: "svc-daipam",
      loginTokenKey: LOGIN_KEY_HEX,
      adminUser: "admin",
      adminPass: "s3cr3t",
    });

    const pub = getMeshConfig();
    assert.ok(pub, "public config should be present");
    assert.equal(pub!.present, true);
    assert.equal(pub!.serverUrl, "https://mesh.cliente.it");
    assert.equal(pub!.domain, "");
    assert.equal(pub!.meshId, "mesh//ABCDEF");
    assert.equal(pub!.serviceUser, "svc-daipam");

    // no secret field of any shape may appear on the public object
    const asRec = pub as unknown as Record<string, unknown>;
    assert.equal(asRec.loginTokenKey, undefined);
    assert.equal(asRec.login_token_key_encrypted, undefined);
    assert.equal(asRec.adminPass, undefined);
    assert.equal(asRec.admin_pass_encrypted, undefined);
    assert.equal(asRec.adminUser, undefined);
  });
});

test("getMeshCreds round-trips secrets; loginTokenKey is a hex Buffer", () => {
  withTenant(T, () => {
    const creds = getMeshCreds();
    assert.ok(creds, "creds should decrypt");
    assert.equal(creds!.serverUrl, "https://mesh.cliente.it");
    assert.equal(creds!.meshId, "mesh//ABCDEF");
    assert.equal(creds!.serviceUser, "svc-daipam");
    assert.equal(creds!.adminUser, "admin");
    assert.equal(creds!.adminPass, "s3cr3t");
    assert.ok(Buffer.isBuffer(creds!.loginTokenKey), "loginTokenKey must be a Buffer");
    assert.equal(creds!.loginTokenKey.length, 80); // 160 hex chars -> 80 bytes
    assert.equal(creds!.loginTokenKey.toString("hex"), LOGIN_KEY_HEX);
  });
});

test("values are encrypted at rest (raw row must not equal plaintext)", () => {
  withTenant(T, () => {
    type RawRow = {
      login_token_key_encrypted: string;
      admin_pass_encrypted: string;
    };
    const raw = getTenantDb(T)
      .prepare("SELECT login_token_key_encrypted, admin_pass_encrypted FROM mc_config WHERE id = 1")
      .get() as RawRow | undefined;
    assert.ok(raw, "row must exist");
    assert.notEqual(raw!.login_token_key_encrypted, LOGIN_KEY_HEX, "loginTokenKey must be encrypted at rest");
    assert.notEqual(raw!.admin_pass_encrypted, "s3cr3t", "adminPass must be encrypted at rest");
  });
});

test("getMeshConfig returns null when unconfigured", () => {
  const T2 = "TESTMESHEMPTY";
  withTenant(T2, () => {
    assert.equal(getMeshConfig(), null);
    assert.equal(getMeshCreds(), null);
  });
  deleteTenantDatabase(T2);
});

test("saveMeshConfig rejects non-160-hex loginTokenKey", () => {
  withTenant(T, () => {
    assert.throws(
      () =>
        saveMeshConfig({
          serverUrl: "https://mesh.cliente.it",
          domain: "",
          meshId: "mesh//ABCDEF",
          serviceUser: "svc-daipam",
          loginTokenKey: "tooshort",
          adminUser: "admin",
          adminPass: "s3cr3t",
        }),
      /160 hex/,
    );
    // also reject 161 chars (odd length over 160)
    assert.throws(
      () =>
        saveMeshConfig({
          serverUrl: "https://mesh.cliente.it",
          domain: "",
          meshId: "mesh//ABCDEF",
          serviceUser: "svc-daipam",
          loginTokenKey: "a".repeat(161),
          adminUser: "admin",
          adminPass: "s3cr3t",
        }),
      /160 hex/,
    );
  });
});
