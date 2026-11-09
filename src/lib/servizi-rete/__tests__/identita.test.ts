/**
 * Prove di identità: due IP con la stessa chiave SSH diventano una proposta;
 * conferma collega, rifiuto no; niente fusioni automatiche; un tenant non vede l'altro.
 * Run: node --import tsx --test src/lib/servizi-rete/__tests__/identita.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { normalizzaImpronta, raccogliECalcola, proposteIdentita, decidiProposta, conteggiIdentita } from "../identita";

const A = "PROVAIDENTA";
const B = "PROVAIDENTB";
const C = "PROVAIDENTC";
const D = "PROVAIDENTD";

after(() => {
  for (const t of [A, B, C, D]) {
    closeTenantDb(t);
    deleteTenantDatabase(t);
  }
  closeHubDb();
});

const FP = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

function dueHostConSsh(tenant: string, ipA = "10.1.0.10", ipB = "10.1.0.20"): { a: number; b: number } {
  return withTenant(tenant, () => {
    const d = getTenantDb(tenant);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.1.0.0/24', 'lan')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')");
    const a = Number(ins.run(n, ipA).lastInsertRowid);
    const b = Number(ins.run(n, ipB).lastInsertRowid);
    const srv = d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ssh_json) VALUES (?, 22, 'tcp', 'ssh', ?)",
    );
    const json = JSON.stringify({ ident: "SSH-2.0-OpenSSH_9.6", kex: [], hostkey: [], cifrari: [], mac: [], fingerprint: FP });
    srv.run(a, json);
    srv.run(b, json);
    return { a, b };
  });
}

test("impronta: due punti e SHA256:base64 diventano lo stesso hex", () => {
  const hex = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  assert.equal(normalizzaImpronta("AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"), hex);
  const b64 = Buffer.from(hex, "hex").toString("base64");
  assert.equal(normalizzaImpronta(`SHA256:${b64}`), hex);
  assert.equal(normalizzaImpronta(""), null);
  assert.equal(normalizzaImpronta("non-un-hash"), null);
});

test("due IP con la stessa chiave SSH compaiono come proposta", () => {
  const { a, b } = dueHostConSsh(A);
  withTenant(A, () => {
    const d = getTenantDb(A);
    const n = raccogliECalcola(d);
    assert.equal(n.prove, 2);
    assert.equal(n.proposte, 1);
    const p = proposteIdentita(d);
    assert.equal(p.length, 1);
    assert.equal(p[0]!.tipo, "ssh_hostkey");
    assert.equal(p[0]!.valore, FP);
    assert.equal(p[0]!.host_a, Math.min(a, b));
    assert.equal(p[0]!.host_b, Math.max(a, b));
    assert.equal(p[0]!.ip_a, "10.1.0.10");
    assert.equal(p[0]!.ip_b, "10.1.0.20");
    assert.equal(p[0]!.stato, "proposto");
  });
});

test("conferma collega, rifiuto no; il ricalcolo non resuscita il rifiuto", () => {
  dueHostConSsh(C, "10.2.0.1", "10.2.0.2");
  withTenant(C, () => {
    const d = getTenantDb(C);
    raccogliECalcola(d);
    const p = proposteIdentita(d)[0]!;
    const ok = decidiProposta(d, p.id, "confermato", "riccardo");
    assert.ok(ok);
    assert.equal(ok.stato, "confermato");
    const ha = d.prepare("SELECT physical_device_id AS p FROM hosts WHERE ip = '10.2.0.1'").get() as { p: number | null };
    const hb = d.prepare("SELECT physical_device_id AS p FROM hosts WHERE ip = '10.2.0.2'").get() as { p: number | null };
    assert.ok(ha.p);
    assert.equal(ha.p, hb.p);
  });

  dueHostConSsh(D, "10.3.0.1", "10.3.0.2");
  withTenant(D, () => {
    const d = getTenantDb(D);
    raccogliECalcola(d);
    const p = proposteIdentita(d)[0]!;
    decidiProposta(d, p.id, "rifiutato", "riccardo");
    raccogliECalcola(d);
    assert.equal(proposteIdentita(d).length, 0);
    assert.equal(proposteIdentita(d, "rifiutato").length, 1);
    const ha = d.prepare("SELECT physical_device_id AS p FROM hosts WHERE ip = '10.3.0.1'").get() as { p: number | null };
    assert.equal(ha.p, null);
    const c = conteggiIdentita(d);
    assert.equal(c.rifiutati, 1);
    assert.equal(c.proposte, 0);
  });
});

test("un tenant non vede le proposte dell'altro", () => {
  dueHostConSsh(B, "10.8.0.1", "10.8.0.2");
  withTenant(B, () => raccogliECalcola(getTenantDb(B)));
  withTenant(A, () => {
    const d = getTenantDb(A);
    const p = proposteIdentita(d);
    assert.ok(p.every((x) => x.ip_a !== "10.8.0.1" && x.ip_b !== "10.8.0.2"));
  });
  withTenant(B, () => {
    assert.equal(proposteIdentita(getTenantDb(B)).length, 1);
  });
});
