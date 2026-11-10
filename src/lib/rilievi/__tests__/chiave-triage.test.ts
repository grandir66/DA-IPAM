/**
 * `chiaveTriage` dei rilievi dell'Elenco di Findings (10/11/2026). Per trunk e giri la chiave di
 * triage è l'`id` del rilievo (stabile), così stato e nota restano agganciati al rilievo giusto.
 * Qui si verificano gli adapter puri dei giri (TLS e controlli); le CVE usano `cve_key`.
 *
 * Run: node --import tsx --test src/lib/rilievi/__tests__/chiave-triage.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rilieviDaTls, tlsDaJson, type ContestoServizio } from "@/lib/rilievi/da-servizi";
import { rilieviDaControllo, controlloDaJson } from "@/lib/rilievi/controlli";

const ctx: ContestoServizio = {
  host_id: 7,
  ip: "10.0.0.5",
  hostname: null,
  network_id: 2,
  network_name: "LAN",
  porta: 443,
};

test("TLS: chiaveTriage coincide con l'id e ha il formato giro:<slug>:<host>:<porta>", () => {
  const tls = tlsDaJson(
    JSON.stringify({
      version: "TLSv1.0",
      cipher: "RC4-MD5",
      subject_cn: "pannello",
      issuer: "pannello",
      not_after: "2020-01-01",
      self_signed: true,
      expired: true,
      key_bits: 1024,
    }),
  );
  assert.ok(tls, "tlsDaJson deve tornare un oggetto");
  const righe = rilieviDaTls(tls, ctx);
  assert.ok(righe.length > 0, "cert scaduto/vecchio/debole deve produrre rilievi");
  for (const r of righe) {
    assert.equal(r.chiaveTriage, r.id, "chiaveTriage deve essere l'id del rilievo");
    assert.match(r.chiaveTriage, /^giro:[a-z-]+:7:443$/);
  }
  const scaduto = righe.find((r) => r.id.includes("tls-scaduto"));
  assert.equal(scaduto?.chiaveTriage, "giro:tls-scaduto:7:443");
});

test("Controlli: chiaveTriage coincide con l'id", () => {
  const c = controlloDaJson(JSON.stringify({ ldap_anonimo: true, redis_aperto: true }));
  assert.ok(c);
  const righe = rilieviDaControllo(c, ctx);
  assert.ok(righe.length >= 2);
  for (const r of righe) {
    assert.equal(r.chiaveTriage, r.id);
    assert.match(r.chiaveTriage, /^giro:[a-z0-9-]+:7:443$/);
  }
});
