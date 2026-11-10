/**
 * Controlli dei giri: findings da JSON già salvato, senza rete.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/controlli.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  controlloDaJson,
  eSshVecchio,
  nomeConsolaWeb,
  rilieviDaControllo,
  rilieviDaHttp,
  rilieviDaNtlm,
  rilieviDaSsh,
} from "../controlli";
import type { InfoHttp, InfoNtlm } from "@/lib/servizi-rete/sonde";

const CTX = {
  host_id: 4,
  ip: "10.0.0.8",
  hostname: null,
  network_id: 1,
  network_name: "lan",
  porta: 445,
};

test("eSshVecchio: OpenSSH sotto 8 e SSH-1 sì, 9 no", () => {
  assert.equal(eSshVecchio("SSH-2.0-OpenSSH_7.4p1"), true);
  assert.equal(eSshVecchio("SSH-1.99-OpenSSH_3.9"), true);
  assert.equal(eSshVecchio("SSH-2.0-OpenSSH_9.6p1"), false);
  assert.equal(eSshVecchio(null), false);
});

test("SMB senza firma: Medium; con firma obbligatoria niente", () => {
  const n: InfoNtlm = {
    netbios: "PC",
    dominio_netbios: "LAN",
    dns_computer: null,
    dominio_dns: null,
    versione_os: "10.0",
    fonte: "smb",
    smb_signing: false,
  };
  const r = rilieviDaNtlm(n, CTX);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "Medium");
  assert.match(r[0]!.titolo, /SMB/);
  assert.equal(rilieviDaNtlm({ ...n, smb_signing: true }, CTX).length, 0);
});

test("RDP senza NLA: Medium", () => {
  const n: InfoNtlm = {
    netbios: null,
    dominio_netbios: null,
    dns_computer: null,
    dominio_dns: null,
    versione_os: null,
    fonte: "rdp",
    rdp_nla: false,
  };
  const r = rilieviDaNtlm(n, { ...CTX, porta: 3389 });
  assert.equal(r[0]!.gravita, "Medium");
  assert.match(r[0]!.titolo, /NLA/);
});

test("consola web da titolo Jenkins; nginx no", () => {
  const http = (title: string | null, server: string | null): InfoHttp => ({
    scheme: "http",
    status_code: 200,
    status_text: "OK",
    title,
    server,
    location: null,
    content_type: "text/html",
    headers: {},
    body_sha256: null,
  });
  assert.equal(nomeConsolaWeb(http("Dashboard [Jenkins]", null)), "Jenkins");
  assert.equal(nomeConsolaWeb(http("Welcome", "nginx/1.27")), null);
  const r = rilieviDaHttp(http("phpMyAdmin", null), { ...CTX, porta: 80 });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "Low");
});

test("Redis aperto: High; JSON rotto: null", () => {
  const r = rilieviDaControllo({ redis_aperto: true }, { ...CTX, porta: 6379 });
  assert.equal(r[0]!.gravita, "High");
  assert.equal(controlloDaJson("nope"), null);
  assert.equal(controlloDaJson(JSON.stringify({ redis_aperto: true }))?.redis_aperto, true);
});

test("SSH vecchio produce un rilievo; ident nuovo no", () => {
  assert.equal(rilieviDaSsh({ ident: "SSH-2.0-OpenSSH_7.9" }, { ...CTX, porta: 22 }).length, 1);
  assert.equal(rilieviDaSsh({ ident: "SSH-2.0-OpenSSH_9.6" }, { ...CTX, porta: 22 }).length, 0);
});
