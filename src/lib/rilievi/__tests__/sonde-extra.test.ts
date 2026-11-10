/**
 * Parser della terza ondata (DNS, TFTP, NTP, rsync, SMTP, NFS export, Smart Install, SSH password, IPMI RAKP).
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
  smartInstallRisponde,
  smtpVrfyAperto,
  tftpRisponde,
} from "../sonde-extra";

test("AXFR: rcode 0 con answer sì, REFUSED no", () => {
  const msg = Buffer.alloc(12);
  msg.writeUInt16BE(0xda19, 0);
  msg.writeUInt16BE(0x8180, 2);
  msg.writeUInt16BE(1, 4);
  msg.writeUInt16BE(2, 6);
  const ok = Buffer.alloc(14);
  ok.writeUInt16BE(12, 0);
  msg.copy(ok, 2);
  assert.equal(dnsAxfrAccettato(ok), true);
  const no = Buffer.from(ok);
  no.writeUInt16BE(0x8185, 4);
  no.writeUInt16BE(0, 8);
  assert.equal(dnsAxfrAccettato(no), false);
  assert.ok(pacchettoDnsAxfr("example.com").length > 20);
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

test("Smart Install e SMTP VRFY", () => {
  assert.equal(smartInstallRisponde(Buffer.from([0, 0, 0, 1])), true);
  assert.equal(smtpVrfyAperto(Buffer.from("220 mail.local\r\n"), Buffer.from("250 postmaster\r\n")), true);
  assert.equal(smtpVrfyAperto(Buffer.from("220 mail.local\r\n"), Buffer.from("550 not allowed\r\n")), false);
});

test("NFS export `*` e portmap GETPORT", () => {
  const dump = Buffer.alloc(48);
  dump[0] = 0x80;
  dump[20] = 0x2a;
  assert.equal(nfsExportStella(dump), true);
  assert.equal(nfsExportStella(Buffer.from("share\0*\0everyone")), true);
  const mappa = Buffer.alloc(32);
  mappa[0] = 0x80;
  mappa.writeUInt32BE(1, 8);
  mappa.writeUInt32BE(2049, 28);
  assert.equal(portmapPorta(mappa), 2049);
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
