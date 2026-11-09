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
import { chiaveIdentitaNtlm, normalizzaImpronta, raccogliECalcola, proposteIdentita, decidiProposta, conteggiIdentita } from "../identita";

const A = "PROVAIDENTA";
const B = "PROVAIDENTB";
const C = "PROVAIDENTC";
const D = "PROVAIDENTD";
const E = "PROVAIDENTE";
const F = "PROVAIDENTF";

after(() => {
  for (const t of [A, B, C, D, E, F]) {
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

test("chiave NTLM: FQDN, altrimenti dominio\\pc; WORKGROUP non conta", () => {
  assert.equal(chiaveIdentitaNtlm({ dns_computer: "DC01.contoso.local", netbios: "DC01", dominio_netbios: "CONTOSO", dominio_dns: "contoso.local" }), "dc01.contoso.local");
  assert.equal(chiaveIdentitaNtlm({ dns_computer: null, netbios: "PC01", dominio_netbios: "CONTOSO", dominio_dns: null }), "contoso\\pc01");
  assert.equal(chiaveIdentitaNtlm({ dns_computer: null, netbios: "PC01", dominio_netbios: "WORKGROUP", dominio_dns: null }), "pc01");
  assert.equal(chiaveIdentitaNtlm({ dns_computer: null, netbios: "WORKGROUP", dominio_netbios: "WORKGROUP", dominio_dns: null }), null);
  assert.equal(chiaveIdentitaNtlm({ dns_computer: "", netbios: null, dominio_netbios: null, dominio_dns: null }), null);
});

test("due IP con lo stesso nome Windows NTLM compaiono come proposta", () => {
  withTenant(E, () => {
    const d = getTenantDb(E);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.4.0.0/24', 'lan')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')");
    const a = Number(ins.run(n, "10.4.0.10").lastInsertRowid);
    const b = Number(ins.run(n, "10.4.0.20").lastInsertRowid);
    const json = JSON.stringify({
      netbios: "DC01",
      dominio_netbios: "CONTOSO",
      dns_computer: "dc01.contoso.local",
      dominio_dns: "contoso.local",
      versione_os: "10.0.20348",
      fonte: "smb",
    });
    d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)").run(a, json);
    d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)").run(b, json);
    const r = raccogliECalcola(d);
    assert.equal(r.prove, 2);
    assert.equal(r.proposte, 1);
    const p = proposteIdentita(d);
    assert.equal(p.length, 1);
    assert.equal(p[0]!.tipo, "ntlm_computer");
    assert.equal(p[0]!.valore, "dc01.contoso.local");
  });
});

test("NTLM solo WORKGROUP non diventa proposta", () => {
  withTenant(F, () => {
    const d = getTenantDb(F);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.5.0.0/24', 'lan')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, ?, 'online')");
    const a = Number(ins.run(n, "10.5.0.10").lastInsertRowid);
    const b = Number(ins.run(n, "10.5.0.20").lastInsertRowid);
    const json = JSON.stringify({
      netbios: "WORKGROUP",
      dominio_netbios: "WORKGROUP",
      dns_computer: null,
      dominio_dns: null,
      versione_os: "6.1.0",
      fonte: "smb",
    });
    d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)").run(a, json);
    d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)").run(b, json);
    const r = raccogliECalcola(d);
    assert.equal(r.prove, 0);
    assert.equal(r.proposte, 0);
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
