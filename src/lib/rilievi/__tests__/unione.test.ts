/**
 * Elenco Findings: le tre fonti si uniscono, si filtrano, un tenant non vede l'altro.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/unione.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { elencoRilievi } from "../unione";

const A = "PROVAUNILEA";
const B = "PROVAUNILEB";

after(() => {
  for (const t of [A, B]) {
    closeTenantDb(t);
    deleteTenantDatabase(t);
  }
  closeHubDb();
});

function reteConTls(tenant: string, ip: string, tls: Record<string, unknown>): void {
  withTenant(tenant, () => {
    const d = getTenantDb(tenant);
    const esistente = d.prepare("SELECT id FROM networks WHERE cidr = '10.9.0.0/24'").get() as { id: number } | undefined;
    const n = esistente?.id ?? Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'lan')").run().lastInsertRowid);
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(n, ip).lastInsertRowid);
    d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, tls_json) VALUES (?, 443, 'tcp', 'tls', ?)",
    ).run(h, JSON.stringify(tls));
  });
}

test("un certificato scaduto compare come giro High", () => {
  reteConTls(A, "10.9.0.8", { expired: true, subject_cn: "box.local", version: "TLSv1.3", not_after: "2020-01-01" });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"] });
    assert.equal(e.total, 1);
    assert.equal(e.data[0]!.fonte, "giro");
    assert.equal(e.data[0]!.gravita, "High");
    assert.equal(e.perFonte.giro, 1);
    assert.equal(e.rollup.High, 1);
  });
});

test("il tenant B non vede i rilievi di A", () => {
  reteConTls(B, "10.9.0.9", { expired: true, subject_cn: "altro", version: "TLSv1.3" });
  withTenant(B, () => {
    const e = elencoRilievi({ fonti: ["giro"] });
    assert.equal(e.total, 1);
    assert.equal(e.data[0]!.ip, "10.9.0.9");
  });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"] });
    assert.ok(e.data.every((r) => r.ip !== "10.9.0.9"));
  });
});

test("SMB senza firma compare come giro Medium", () => {
  withTenant(A, () => {
    const d = getTenantDb(A);
    const esistente = d.prepare("SELECT id FROM networks WHERE cidr = '10.9.0.0/24'").get() as { id: number } | undefined;
    const n = esistente?.id ?? Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'lan')").run().lastInsertRowid);
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')").run(n, "10.9.0.12").lastInsertRowid);
    d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)",
    ).run(h, JSON.stringify({ fonte: "smb", smb_signing: false, netbios: "PC" }));
  });
  withTenant(A, () => {
    const e = elencoRilievi({ fonti: ["giro"], q: "SMB" });
    assert.ok(e.data.some((r) => r.gravita === "Medium" && /SMB/.test(r.titolo)));
  });
});

test("filtro gravità: Low non entra se si chiede High", () => {
  reteConTls(A, "10.9.0.10", { self_signed: true, expired: false, version: "TLSv1.3", subject_cn: "x" });
  withTenant(A, () => {
    const high = elencoRilievi({ fonti: ["giro"], gravita: ["High"] });
    assert.ok(high.data.every((r) => r.gravita === "High"));
    const low = elencoRilievi({ fonti: ["giro"], gravita: ["Low"] });
    assert.ok(low.total >= 1);
    assert.ok(low.data.every((r) => r.gravita === "Low"));
  });
});
