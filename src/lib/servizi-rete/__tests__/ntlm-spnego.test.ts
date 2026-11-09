import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNtlmNegotiateMessage, parseNtlmChallenge } from "@/lib/scanner/probes/smb2";
import { protocolloRdpDaConferma, rdpConnectionRequest } from "@/lib/scanner/probes/rdp-ntlm";
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
  assert.ok(cr.includes(Buffer.from("Cookie: mstshash=DA-IPAM\r\n", "ascii")));
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
  assert.equal(protocolloRdpDaConferma(Buffer.from([0x03, 0x00, 0x00, 0x0b, 0x06, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00])), null);
  assert.equal(protocolloRdpDaConferma(Buffer.from("not tpkt")), null);
});
