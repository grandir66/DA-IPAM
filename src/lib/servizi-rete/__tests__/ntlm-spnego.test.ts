import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNtlmNegotiateMessage, parseNtlmChallenge } from "@/lib/scanner/probes/smb2";
import { protocolloRdpDaConferma, rdpConnectionRequest, rdpNlaRichiesta, rdpTlsAbilitato } from "@/lib/scanner/probes/rdp-ntlm";
import { credsspTsRequest, ntlmDaGssORaw, wrapNtlmInSpnego } from "../ntlm-spnego";

test("SPNEGO avvolge NTLM e ntlmDaGssORaw lo ritrova", () => {
  const type1 = buildNtlmNegotiateMessage();
  const gss = wrapNtlmInSpnego(type1);
  assert.equal(gss[0], 0x60);
  const trovato = ntlmDaGssORaw(gss);
  assert.ok(trovato);
  assert.equal(trovato.subarray(0, 7).toString("latin1"), "NTLMSSP");
  assert.equal(trovato.subarray(0, type1.length).equals(type1), true);
});

test("CredSSP TSRequest contiene il token SPNEGO", () => {
  const type1 = buildNtlmNegotiateMessage();
  const ts = credsspTsRequest(wrapNtlmInSpnego(type1));
  assert.equal(ts[0], 0x30);
  const trovato = ntlmDaGssORaw(ts);
  assert.ok(trovato);
  assert.equal(parseNtlmChallenge(trovato), null); // Type 1, non CHALLENGE
});

test("Connection Request RDP: TPKT + negoziazione SSL/HYBRID", () => {
  const cr = rdpConnectionRequest();
  assert.equal(cr[0], 0x03);
  assert.equal(cr.readUInt16BE(2), cr.length);
  assert.ok(cr.includes(Buffer.from("Cookie: mstshash=netcheck\r\n", "ascii")));
  const i = cr.indexOf(Buffer.from([0x01, 0x00, 0x08, 0x00]));
  assert.ok(i >= 0);
  assert.equal(cr.readUInt32LE(i + 4), 0x00000003);
});

test("Connection Confirm: selectedProtocol; senza NEG_RSP resta null", () => {
  const cc = Buffer.concat([
    Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00]),
    Buffer.from([0x02, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00]), // HYBRID
  ]);
  cc.writeUInt16BE(cc.length, 2);
  assert.equal(protocolloRdpDaConferma(cc), 2);
  assert.equal(rdpNlaRichiesta(2), true);
  assert.equal(rdpNlaRichiesta(1), false);
  assert.equal(rdpTlsAbilitato(2), true);
  assert.equal(rdpTlsAbilitato(1), true);
  assert.equal(rdpTlsAbilitato(0), false);
  const std = Buffer.concat([
    Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00]),
    Buffer.from([0x02, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
  ]);
  std.writeUInt16BE(std.length, 2);
  assert.equal(protocolloRdpDaConferma(std), 0);
  assert.equal(protocolloRdpDaConferma(Buffer.from([0x03, 0x00, 0x00, 0x0b, 0x06, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00])), null);
  assert.equal(protocolloRdpDaConferma(Buffer.from("not tpkt")), null);
});

test("RDP_NEG_RSP con flags non zero (Windows Server 2019): TLS e NLA letti, non «in chiaro»", () => {
  // Risposta vera di 192.168.4.4 il 10/11/2026: flags 0x1f, protocollo scelto HYBRID (2).
  const cc = Buffer.from("030000130ed00000123400021f080002000000", "hex");
  assert.equal(protocolloRdpDaConferma(cc), 2);
  assert.equal(rdpNlaRichiesta(2), true);
  assert.equal(rdpTlsAbilitato(2), true);
});
