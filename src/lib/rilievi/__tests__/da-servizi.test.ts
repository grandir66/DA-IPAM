/**
 * Rilievi TLS dalle sonde: scaduto, proto vecchio, autofirmato.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/da-servizi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eTlsChiaveDebole, eTlsCifrarioDebole, eTlsVecchio, rilieviDaTls, tlsDaJson } from "../da-servizi";
import type { InfoTls } from "@/lib/servizi-rete/sonde";

const CTX = {
  host_id: 1,
  ip: "10.0.0.8",
  hostname: null,
  network_id: 3,
  network_name: "lan",
  porta: 443,
};

function tls(p: Partial<InfoTls>): InfoTls {
  return {
    version: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    alpn: null,
    subject_cn: "box.local",
    subject: "CN=box.local",
    issuer: "CN=box.local",
    sans: [],
    serial: null,
    not_before: "2024-01-01",
    not_after: new Date(Date.now() + 86_400_000).toISOString(),
    self_signed: false,
    expired: false,
    key_bits: 2048,
    sha256: null,
    ...p,
  };
}

test("eTlsVecchio: 1.0 e 1.1 sì, 1.2 e 1.3 no", () => {
  assert.equal(eTlsVecchio("TLSv1"), true);
  assert.equal(eTlsVecchio("TLSv1.0"), true);
  assert.equal(eTlsVecchio("TLS 1.1"), true);
  assert.equal(eTlsVecchio("SSLv3"), true);
  assert.equal(eTlsVecchio("TLSv1.2"), false);
  assert.equal(eTlsVecchio("TLSv1.3"), false);
  assert.equal(eTlsVecchio(null), false);
});

test("certificato scaduto: High, con rimedio", () => {
  const r = rilieviDaTls(tls({ expired: true, not_after: "2020-01-01" }), CTX);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "High");
  assert.match(r[0]!.titolo, /scaduto/);
  assert.match(r[0]!.rimedio, /Rinnova/);
});

test("TLS 1.0: Medium; autofirmato non scaduto: Low; i due insieme se entrambi", () => {
  const vecchio = rilieviDaTls(tls({ version: "TLSv1.0" }), CTX);
  assert.equal(vecchio[0]!.gravita, "Medium");
  const auto = rilieviDaTls(tls({ self_signed: true }), CTX);
  assert.equal(auto[0]!.gravita, "Low");
  const entrambi = rilieviDaTls(tls({ version: "TLSv1.1", self_signed: true }), CTX);
  assert.equal(entrambi.length, 2);
});

test("autofirmato scaduto: solo High (scaduto vince, niente riga Low in più)", () => {
  const r = rilieviDaTls(tls({ expired: true, self_signed: true }), CTX);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "High");
});

test("cifrario RC4/3DES sì, AES-GCM no; chiave 1024 sì, EC 256 no", () => {
  assert.equal(eTlsCifrarioDebole("ECDHE-RSA-DES-CBC3-SHA"), true);
  assert.equal(eTlsCifrarioDebole("RC4-SHA"), true);
  assert.equal(eTlsCifrarioDebole("TLS_AES_256_GCM_SHA384"), false);
  assert.equal(eTlsChiaveDebole(1024), true);
  assert.equal(eTlsChiaveDebole(1536), true);
  assert.equal(eTlsChiaveDebole(256), false);
  assert.equal(eTlsChiaveDebole(2048), false);
  const r = rilieviDaTls(tls({ cipher: "RC4-SHA", key_bits: 1024 }), CTX);
  assert.ok(r.some((x) => /cifrario debole/.test(x.titolo)));
  assert.ok(r.some((x) => /Chiave TLS debole/.test(x.titolo)));
});

test("tlsDaJson: JSON rotto → null, senza throw", () => {
  assert.equal(tlsDaJson("nope"), null);
  assert.equal(tlsDaJson(null), null);
  const ok = tlsDaJson(JSON.stringify({ expired: true, subject_cn: "x", version: "TLSv1.3" }));
  assert.equal(ok?.expired, true);
  assert.equal(ok?.subject_cn, "x");
});
