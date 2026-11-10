/**
 * Parser SMB dei controlli (SMB1 negotiate, Type 3, MS17-010). Niente rete.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/smb-controlli.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ms17DaStatus, ntlmAuthenticate, pacchettoSmb1Negotiate, smbv1Accettato } from "../smb-controlli";

test("NEGOTIATE SMB1 accetta NT LM 0.12, rifiuta dialect 0xffff", () => {
  const pkt = pacchettoSmb1Negotiate();
  assert.equal(pkt[4], 0xff);
  assert.equal(pkt.toString("latin1", 5, 8), "SMB");
  const ok = Buffer.alloc(36, 0);
  ok[0] = 0xff;
  ok.write("SMB", 1);
  ok[4] = 0x72;
  ok.writeUInt16LE(0, 33);
  assert.equal(smbv1Accettato(ok), true);
  const no = Buffer.from(ok);
  no.writeUInt16LE(0xffff, 33);
  assert.equal(smbv1Accettato(no), false);
  const err = Buffer.from(ok);
  err.writeUInt32LE(0xc0000001, 5);
  assert.equal(smbv1Accettato(err), false);
});

test("Type 3 Guest ha utente in UTF-16 e campi lunghi coerenti", () => {
  const msg = ntlmAuthenticate("Guest");
  assert.equal(msg.toString("latin1", 0, 7), "NTLMSSP");
  assert.equal(msg.readUInt32LE(8), 3);
  const userLen = msg.readUInt16LE(36);
  const userOff = msg.readUInt32LE(40);
  assert.equal(userLen, Buffer.from("Guest", "utf16le").length);
  assert.equal(msg.subarray(userOff, userOff + userLen).toString("utf16le"), "Guest");
  assert.equal(ntlmAuthenticate("").length, 64);
});

test("MS17-010 solo su STATUS_INSUFF_SERVER_RESOURCES", () => {
  assert.equal(ms17DaStatus(0xc0000205), true);
  assert.equal(ms17DaStatus(0), false);
  assert.equal(ms17DaStatus(0xc0000022), false);
});
