/**
 * Parser delle prove extra (LDAP, Redis, Mongo, NFS, VNC) e un Redis finto in ascolto.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/sonde-controlli.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import {
  ipmiCipher0Accettato,
  ipmiPong,
  adcsDaHttp,
  jenkinsScriptDaHttp,
  ldapBindRiuscito,
  memcachedAperto,
  mongoSenzaAuth,
  nfsNullAccettato,
  pacchettoIpmiOpenSessionCipher0,
  pacchettoLogin7Sa,
  pacchettoMongoListDatabases,
  provaIpmi,
  provaMemcached,
  provaMssqlSa,
  provaPercorsiHttp,
  provaRedis,
  redisSenzaAuth,
  rpcCall,
  rpcSuTcp,
  sondaControllo,
  tdsLoginRiuscito,
  vncAuthDeboleDaHandshake,
  vncSenzaAuthDaHandshake,
  x11Accettato,
} from "../sonde-controlli";

test("Redis: PONG sì, NOAUTH no", () => {
  assert.equal(redisSenzaAuth(Buffer.from("+PONG\r\n")), true);
  assert.equal(redisSenzaAuth(Buffer.from("-NOAUTH Authentication required.\r\n")), false);
});

test("LDAP bind success: resultCode 0 dopo BindResponse", () => {
  const ok = Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x01, 0x61, 0x07, 0x0a, 0x01, 0x00, 0x04, 0x00, 0x04, 0x00]);
  assert.equal(ldapBindRiuscito(ok), true);
  const ko = Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x01, 0x61, 0x07, 0x0a, 0x01, 0x31, 0x04, 0x00, 0x04, 0x00]);
  assert.equal(ldapBindRiuscito(ko), false);

});

test("NFS RPC NULL accettato", () => {
  const xid = rpcCall(1, 100003, 3, 0);
  assert.equal(xid.length, 40);
  const reply = Buffer.alloc(28);
  reply.writeUInt32BE(24, 0);
  reply[0] = 0x80;
  reply.writeUInt32BE(1, 4); // xid
  reply.writeUInt32BE(1, 8); // REPLY
  reply.writeUInt32BE(0, 12); // MSG_ACCEPTED
  assert.equal(nfsNullAccettato(reply), true);
  const suTcp = rpcSuTcp(xid);
  assert.equal(suTcp.length, xid.length + 4);
  assert.equal(suTcp[0] & 0x80, 0x80);
});

test("Mongo listDatabases: opcode OP_REPLY e niente unauthorized", () => {
  const pkt = pacchettoMongoListDatabases();
  assert.equal(pkt.readInt32LE(12), 2004);
  const reply = Buffer.alloc(64);
  reply.writeInt32LE(64, 0);
  reply.writeInt32LE(1, 12); // OP_REPLY
  reply.writeInt32LE(1, 32); // nDocs
  Buffer.from("databases").copy(reply, 36);
  assert.equal(mongoSenzaAuth(reply), true);
  const auth = Buffer.from(reply);
  Buffer.from("not authorized").copy(auth, 36);
  assert.equal(mongoSenzaAuth(auth), false);
});

test("VNC: tipo None in 003.008 e in 003.003", () => {
  assert.equal(vncSenzaAuthDaHandshake(Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])), true);
  assert.equal(vncSenzaAuthDaHandshake(Buffer.from("RFB 003.008\n"), Buffer.from([1, 2])), false);
  assert.equal(vncAuthDeboleDaHandshake(Buffer.from("RFB 003.008\n"), Buffer.from([1, 2])), true);
  const t = Buffer.alloc(4);
  t.writeUInt32BE(1, 0);
  assert.equal(vncSenzaAuthDaHandshake(Buffer.from("RFB 003.003\n"), t), true);
});

test("AD CS e Jenkins script da HTTP", () => {
  assert.equal(adcsDaHttp(401, ""), false);
  assert.equal(adcsDaHttp(200, "Active Directory Certificate Services"), true);
  assert.equal(adcsDaHttp(404, ""), false);
  assert.equal(jenkinsScriptDaHttp(200, "Jenkins login"), false);
  assert.equal(jenkinsScriptDaHttp(302, "Script Console <textarea>"), false);
  assert.equal(jenkinsScriptDaHttp(200, "Script Console <textarea>"), true);
  assert.equal(jenkinsScriptDaHttp(403, "Jenkins"), false);
});

test("Memcached stats, IPMI pong, X11 success", () => {
  assert.equal(memcachedAperto(Buffer.from("STAT pid 1\r\nEND\r\n")), true);
  assert.equal(memcachedAperto(Buffer.from("ERROR\r\n")), false);
  const pong = Buffer.from([0x06, 0x00, 0xff, 0x06, 0x00, 0x00, 0x11, 0xbe, 0x40, 0x00, 0x00, 0x00]);
  assert.equal(ipmiPong(pong), true);
  assert.equal(ipmiPong(Buffer.from([0x06, 0x00, 0xff, 0x06, 0x00, 0x00, 0x11, 0xbe, 0x80, 0x00, 0x00, 0x00])), false);
  assert.equal(x11Accettato(Buffer.from([0x01, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00])), true);
  assert.equal(x11Accettato(Buffer.from([0x00, 0x00, 0x0b, 0x00])), false);
});

test("provaMemcached parla con un server finto", async () => {
  const srv = net.createServer((s) => {
    s.on("data", (d) => {
      if (d.toString().includes("stats")) s.end("STAT pid 1\r\nEND\r\n");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  assert.ok(addr && typeof addr === "object");
  try {
    assert.equal(await provaMemcached("127.0.0.1", addr.port, 800), true);
  } finally {
    srv.close();
  }
});

test("IPMI cipher 0: Open Session Response status 0 sì, 0x10 no", () => {
  const pkt = pacchettoIpmiOpenSessionCipher0();
  assert.equal(pkt.length, 48);
  assert.equal(pkt[5], 0x10);
  assert.equal(pkt[16 + 11], 0x08);
  const ok = Buffer.alloc(20);
  ok[0] = 0x06;
  ok[4] = 0x06;
  ok[5] = 0x11;
  ok[17] = 0x00;
  assert.equal(ipmiCipher0Accettato(ok), true);
  const ko = Buffer.from(ok);
  ko[17] = 0x10;
  assert.equal(ipmiCipher0Accettato(ko), false);
});

test("provaIpmi: ping e cipher 0 su UDP finto", async () => {
  const s = dgram.createSocket("udp4");
  s.on("message", (m, rinfo) => {
    if (m[3] === 0x07) {
      const r = Buffer.alloc(20);
      r[0] = 0x06;
      r[4] = 0x06;
      r[5] = 0x11;
      s.send(r, rinfo.port, rinfo.address);
    } else {
      s.send(Buffer.from([0x06, 0x00, 0xff, 0x06, 0x00, 0x00, 0x11, 0xbe, 0x40, 0x00, 0x00, 0x00]), rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((r) => s.bind(0, "127.0.0.1", r));
  const addr = s.address();
  try {
    const esito = await provaIpmi("127.0.0.1", 800, addr.port);
    assert.equal(esito.esposto, true);
    assert.equal(esito.cipher0, true);
  } finally {
    s.close();
  }
});

test("LOGIN7 sa: offset utente e LOGINACK nel flusso TDS", () => {
  const pkt = pacchettoLogin7Sa();
  assert.equal(pkt[0], 0x10);
  const p = pkt.subarray(8);
  const ibUser = p.readUInt16LE(40);
  const cchUser = p.readUInt16LE(42);
  assert.equal(p.subarray(ibUser, ibUser + cchUser * 2).toString("utf16le"), "sa");
  const ack = Buffer.alloc(12);
  ack[8] = 0xad;
  assert.equal(tdsLoginRiuscito(ack), true);
  const err = Buffer.alloc(12);
  err[8] = 0xaa;
  assert.equal(tdsLoginRiuscito(err), false);
});

test("provaMssqlSa parla con un TDS finto che manda LOGINACK", async () => {
  const srv = net.createServer((c) => {
    c.on("data", (d) => {
      const body = d[0] === 0x12 ? Buffer.alloc(0) : Buffer.from([0xad, 0x01, 0x00, 0x01]);
      const r = Buffer.alloc(8 + body.length);
      r[0] = 0x04;
      r[1] = 0x01;
      r.writeUInt16BE(r.length, 2);
      body.copy(r, 8);
      c.write(r);
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  assert.ok(addr && typeof addr === "object");
  try {
    assert.equal(await provaMssqlSa("127.0.0.1", addr.port, 800), true);
  } finally {
    srv.close();
  }
});

test(".git/HEAD su porta HTTP fuori dallo standard", async () => {
  const srv = net.createServer((c) => {
    c.on("data", (d) => {
      const t = d.toString("latin1");
      const corpo = t.includes("GET /.git/HEAD") ? "ref: refs/heads/main\n" : "";
      const code = corpo ? "200 OK" : "404 Not Found";
      c.write(`HTTP/1.1 ${code}\r\nContent-Length: ${corpo.length}\r\n\r\n`);
      setImmediate(() => c.end(corpo));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  assert.ok(addr && typeof addr === "object");
  try {
    assert.equal((await provaPercorsiHttp("127.0.0.1", addr.port, 800)).git_env, ".git/HEAD");
    const esito = await sondaControllo("127.0.0.1", addr.port, { timeoutMs: 800 });
    assert.equal(esito.info?.git_env, ".git/HEAD");
  } finally {
    srv.close();
  }
});

test("provaRedis parla con un server finto che risponde PONG", async () => {
  const srv = net.createServer((s) => {
    s.on("data", (d) => {
      if (d.toString().includes("PING")) s.end("+PONG\r\n");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  assert.ok(addr && typeof addr === "object");
  try {
    assert.equal(await provaRedis("127.0.0.1", addr.port, 800), true);
  } finally {
    srv.close();
  }
});
