/**
 * Confronto con Nety sulla rete 99 (10/11/2026): 14 rilievi TLS da loro, 0 da noi, perché
 * guardavamo solo la versione negoziata. Qui un server finto accetta TLS 1.0 e RC4.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { clientHello, leggiServerHello, provaTlsAttivo } from "../tls-attivo";

function serverHello(versione: number, cifrario: number): Buffer {
  const corpo = Buffer.concat([
    Buffer.from([versione >> 8, versione & 0xff]),
    Buffer.alloc(32, 7),
    Buffer.from([0]),
    Buffer.from([cifrario >> 8, cifrario & 0xff, 0]),
  ]);
  const hs = Buffer.concat([Buffer.from([2, 0, 0, corpo.length]), corpo]);
  return Buffer.concat([Buffer.from([0x16, 3, 1, 0, hs.length]), hs]);
}

test("ServerHello letto, alert e risposta corta rifiutati", () => {
  assert.deepEqual(leggiServerHello(serverHello(0x0301, 0x002f)), { versione: 0x0301, cifrario: 0x002f });
  assert.equal(leggiServerHello(Buffer.from([0x15, 3, 1, 0, 2, 2, 40])), null);
  assert.equal(leggiServerHello(Buffer.from("SSH-2.0-OpenSSH_9\r\n")), null);
});

test("server che accetta TLS 1.0 e RC4, ma non TLS 1.1", async () => {
  const srv = net.createServer((s) => {
    s.once("data", (d: Buffer) => {
      const chiesta = d.readUInt16BE(9);
      if (chiesta === 0x0301) s.end(serverHello(0x0301, 0x002f));
      else if (chiesta === 0x0303) s.end(serverHello(0x0303, 0x0005));
      else s.end(Buffer.from([0x15, 3, 1, 0, 2, 2, 70]));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const porta = (srv.address() as net.AddressInfo).port;
  try {
    const esito = await provaTlsAttivo("127.0.0.1", porta, 1000, Buffer.alloc(32, 1));
    assert.deepEqual(esito, { vecchi: ["TLSv1.0"], deboli: ["RC4-SHA"] });
  } finally {
    srv.close();
  }
  assert.equal(clientHello(0x0303, [0x0005], Buffer.alloc(32))[0], 0x16);
});
