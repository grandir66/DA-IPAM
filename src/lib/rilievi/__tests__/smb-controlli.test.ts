/**
 * Parser SMB dei controlli (SMB1 negotiate, Type 3, MS17-010). Niente rete.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/smb-controlli.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  ms17DaStatus,
  ntlmAuthenticate,
  pacchettoSmb1Negotiate,
  peekNamedPipeSmb1,
  provaMs17010,
  smbv1Accettato,
} from "../smb-controlli";

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

test("PeekNamedPipe è TRANSACTION 0x25 su FID 0 con \\PIPE\\", () => {
  const pkt = peekNamedPipeSmb1(1, 2, 4);
  const smb = pkt.subarray(4);
  assert.equal(smb[4], 0x25);
  assert.equal(smb.readUInt16LE(61), 0x0023);
  assert.equal(smb.readUInt16LE(63), 0);
  assert.match(smb.subarray(32).toString("binary"), /PIPE/);
});

test("provaMs17010: SMB1 finto che risponde INSUFF_SERVER_RESOURCES", async () => {
  const nbss = (p: Buffer) => {
    const h = Buffer.alloc(4);
    h.writeUIntBE(p.length, 1, 3);
    return Buffer.concat([h, p]);
  };
  const risp = (cmd: number, status: number) => {
    const h = Buffer.alloc(36, 0);
    h[0] = 0xff;
    h.write("SMB", 1);
    h[4] = cmd;
    h.writeUInt32LE(status, 5);
    return nbss(h);
  };
  const srv = net.createServer((c) => {
    c.on("data", (d) => {
      const smb = d.length >= 8 ? d.subarray(4) : d;
      const cmd = smb[4];
      if (cmd === 0x72) c.write(risp(0x72, 0));
      else if (cmd === 0x73) c.write(risp(0x73, 0));
      else if (cmd === 0x75) c.write(risp(0x75, 0));
      else c.write(risp(0x25, 0xc0000205));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  assert.ok(addr && typeof addr === "object");
  try {
    assert.equal(await provaMs17010("127.0.0.1", addr.port, 800), true);
  } finally {
    srv.close();
  }
});
