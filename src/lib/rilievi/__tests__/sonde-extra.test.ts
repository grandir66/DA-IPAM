/**
 * Parser della terza ondata (DNS, TFTP, NTP, rsync, SMTP, NFS export, SSH password, IPMI RAKP).
 * Run: node --import tsx --test src/lib/rilievi/__tests__/sonde-extra.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  dnsAxfrAccettato,
  ipmiRakp2Accettato,
  metodiSshPassword,
  nfsExportStella,
  ntpMonlistRisponde,
  pacchettoDnsAxfr,
  pacchettoIpmiRakp1,
  pacchettoNtpMonlist,
  pacchettoTftpRrq,
  portmapPorta,
  provaSmtpVrfy,
  rsyncModuli,
  smtpVrfyAperto,
  tftpRisponde,
} from "../sonde-extra";

test("AXFR: il primo frame deve corrispondere alla richiesta e iniziare con SOA", () => {
  const domanda = pacchettoDnsAxfr("example.com").subarray(2);
  const soa = Buffer.alloc(34);
  soa.writeUInt16BE(0xc00c, 0);
  soa.writeUInt16BE(6, 2);
  soa.writeUInt16BE(1, 4);
  soa.writeUInt16BE(22, 10);
  const ok = Buffer.concat([Buffer.alloc(2), domanda, soa]);
  ok.writeUInt16BE(ok.length - 2, 0);
  ok.writeUInt16BE(0x8400, 4);
  ok.writeUInt16BE(1, 8);
  assert.equal(dnsAxfrAccettato(ok), true);
  assert.equal(dnsAxfrAccettato(ok.subarray(0, -1)), false);
  const no = Buffer.from(ok);
  no.writeUInt16BE(0x8405, 4);
  assert.equal(dnsAxfrAccettato(no), false);
  no.writeUInt16BE(0x8400, 4);
  no.writeUInt16BE(0x1001, 2);
  assert.equal(dnsAxfrAccettato(no), false);
});

test("TFTP RRQ: DATA e ERROR sì, altro no", () => {
  const data = Buffer.from([0, 3, 0, 1, 0x41]);
  const err = Buffer.from([0, 5, 0, 1, 0]);
  assert.equal(tftpRisponde(data), true);
  assert.equal(tftpRisponde(err), true);
  assert.equal(tftpRisponde(Buffer.from([0, 4, 0, 1])), false);
  assert.equal(pacchettoTftpRrq("a")[1], 1);
});

test("NTP monlist: mode 7 code 42 e payload", () => {
  const pkt = pacchettoNtpMonlist();
  assert.equal(pkt[0] & 0x07, 7);
  assert.equal(pkt[3], 42);
  const ok = Buffer.alloc(64);
  ok[0] = 0x17;
  ok[3] = 42;
  assert.equal(ntpMonlistRisponde(ok), true);
  assert.equal(ntpMonlistRisponde(Buffer.alloc(8)), false);
});

test("rsync: EXIT o modulo sì, ERROR no, solo saluto no", () => {
  assert.equal(rsyncModuli(Buffer.from("@RSYNCD: 31.0\n@RSYNCD: EXIT\n")), true);
  assert.equal(rsyncModuli(Buffer.from("@RSYNCD: 31.0\npub\tPublic files\n")), true);
  assert.equal(rsyncModuli(Buffer.from("@RSYNCD: 31.0\n@ERROR: access denied\n")), false);
  assert.equal(rsyncModuli(Buffer.from("@RSYNCD: 31.0\n")), false);
});

test("SMTP VRFY: 250 conferma, 252 dichiara che non può verificare", () => {
  assert.equal(smtpVrfyAperto(Buffer.from("220 mail.local\r\n"), Buffer.from("250 postmaster\r\n")), true);
  assert.equal(smtpVrfyAperto(Buffer.from("220 mail.local\r\n"), Buffer.from("550 not allowed\r\n")), false);
  assert.equal(smtpVrfyAperto(Buffer.from("220 mail.local\r\n"), Buffer.from("252 cannot verify\r\n")), false);
});

test("NFS export `*` e portmap GETPORT", () => {
  const xdr = (...words: number[]) => {
    const b = Buffer.alloc(words.length * 4);
    words.forEach((v, i) => b.writeUInt32BE(v, i * 4));
    return b;
  };
  const risposta = (xid: number, dati: Buffer) =>
    Buffer.concat([xdr(0x80000000 + 24 + dati.length, xid, 1, 0, 0, 0, 0), dati]);
  const aperto = risposta(0xda190005, xdr(1, 1, 0x2f000000, 1, 1, 0x2a000000, 0, 0));
  const chiuso = risposta(0xda190005, xdr(1, 2, 0x2f2a0000, 1, 3, 0x6c616e00, 0, 0));
  assert.equal(nfsExportStella(aperto), true);
  assert.equal(nfsExportStella(chiuso), false, "l'asterisco nel path non è un gruppo");
  assert.equal(nfsExportStella(aperto.subarray(0, -4)), undefined);
  assert.equal(nfsExportStella(risposta(0xda190005, xdr(1, 1, 0x2f000000, 0, 0))), true);
  assert.equal(portmapPorta(risposta(0xda190004, xdr(2049))), 2049);
});

test("SSH password/keyboard-interactive sì, solo publickey no", () => {
  assert.equal(metodiSshPassword(["publickey", "password"]), true);
  assert.equal(metodiSshPassword(["keyboard-interactive"]), true);
  assert.equal(metodiSshPassword(["publickey"]), false);
});

test("IPMI RAKP2 status 0 sì, 0x12 no", () => {
  const pkt = pacchettoIpmiRakp1();
  assert.equal(pkt[5], 0x12);
  const ok = Buffer.alloc(20);
  ok[0] = 0x06;
  ok[4] = 0x06;
  ok[5] = 0x13;
  ok[17] = 0x00;
  assert.equal(ipmiRakp2Accettato(ok), true);
  const ko = Buffer.from(ok);
  ko[17] = 0x12;
  assert.equal(ipmiRakp2Accettato(ko), false);
});

test("provaSmtpVrfy parla con un server finto", async () => {
  const srv = net.createServer((s) => {
    s.write("220 mail.local ESMTP\r\n");
    s.on("data", (d) => {
      const t = d.toString("latin1");
      if (/^EHLO/i.test(t)) s.write("250-mail.local\r\n250 HELP\r\n");
      else if (/^VRFY/i.test(t)) s.end("250 postmaster\r\n");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  assert.ok(addr && typeof addr === "object");
  try {
    assert.equal(await provaSmtpVrfy("127.0.0.1", addr.port, 800), true);
  } finally {
    srv.close();
  }
});
