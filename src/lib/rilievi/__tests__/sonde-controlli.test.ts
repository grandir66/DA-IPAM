/**
 * Parser delle prove extra (LDAP, Redis, Mongo, NFS, VNC) e un Redis finto in ascolto.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/sonde-controlli.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  ldapBindRiuscito,
  mongoSenzaAuth,
  nfsNullAccettato,
  pacchettoMongoListDatabases,
  provaRedis,
  redisSenzaAuth,
  rpcCall,
  rpcSuTcp,
  vncSenzaAuthDaHandshake,
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
  const t = Buffer.alloc(4);
  t.writeUInt32BE(1, 0);
  assert.equal(vncSenzaAuthDaHandshake(Buffer.from("RFB 003.003\n"), t), true);
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
