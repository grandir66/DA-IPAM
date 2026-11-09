import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  hostkeyDaKexEcdhReply,
  improntaHostkey,
  kexCurve25519,
  leggiKexinit,
  leggiRispostaHttp,
  ntlmChallengeDaWwwAuthenticate,
  ntlmOfferto,
  pacchettoSsh,
  prodottoDaServer,
  prodottoDaSsh,
  testoStampabile,
} from "../sonde";
import { wrapNtlmInSpnego } from "../ntlm-spnego";

test("risposta HTTP: stato, titolo, server, cookie tenuti solo per nome", () => {
  const grezzo = Buffer.from(
    "HTTP/1.1 302 Found\r\nServer: nginx/1.27.5\r\nLocation: /login\r\nSet-Cookie: sessione=SEGRETO; Path=/\r\n\r\n<html><title> Accesso </title></html>",
    "latin1",
  );
  const h = leggiRispostaHttp(grezzo, "https");
  assert.ok(h);
  assert.equal(h.status_code, 302);
  assert.equal(h.title, "Accesso");
  assert.equal(h.server, "nginx/1.27.5");
  assert.equal(h.location, "/login");
  assert.equal(h.headers["Set-Cookie"], "sessione");
  assert.ok(h.body_sha256);
});

test("non HTTP: nessuna risposta inventata", () => {
  assert.equal(leggiRispostaHttp(Buffer.from("220 mail ESMTP\r\n"), "http"), null);
});

test("WWW-Authenticate: NTLM riconosciuto, blob Type 2 estratto, Basic ignorato", () => {
  assert.equal(ntlmOfferto({ "WWW-Authenticate": "Negotiate, NTLM" }), true);
  assert.equal(ntlmOfferto({ "www-authenticate": "NTLM" }), true);
  assert.equal(ntlmOfferto({ "WWW-Authenticate": "Negotiate" }), true);
  assert.equal(ntlmOfferto({ "WWW-Authenticate": "Basic realm=\"x\"" }), false);
  assert.equal(ntlmOfferto({ Server: "IIS" }), false);
  const token = Buffer.from("NTLMSSP\0xxxx").toString("base64");
  const buf = ntlmChallengeDaWwwAuthenticate({ "WWW-Authenticate": `NTLM ${token}` });
  assert.ok(buf);
  assert.equal(buf.subarray(0, 7).toString("latin1"), "NTLMSSP");
  assert.equal(ntlmChallengeDaWwwAuthenticate({ "WWW-Authenticate": "NTLM" }), null);
  const gss = wrapNtlmInSpnego(Buffer.from("NTLMSSP\0yyyy"));
  const daNeg = ntlmChallengeDaWwwAuthenticate({ "WWW-Authenticate": `Negotiate ${gss.toString("base64")}` });
  assert.ok(daNeg);
  assert.equal(daNeg.subarray(0, 7).toString("latin1"), "NTLMSSP");
});

test("prodotto e versione da Server e da SSH", () => {
  assert.deepEqual(prodottoDaServer("Apache/2.4.58 (Ubuntu)"), { prodotto: "Apache", versione: "2.4.58" });
  assert.deepEqual(prodottoDaServer("Werkzeug"), { prodotto: "Werkzeug", versione: null });
  assert.deepEqual(prodottoDaSsh("SSH-2.0-OpenSSH_10.0p2 Debian-7"), { prodotto: "OpenSSH", versione: "10.0p2" });
  assert.deepEqual(prodottoDaSsh("SSH-2.0-dropbear_2022.83"), { prodotto: "dropbear", versione: "2022.83" });
});

test("KEXINIT: le liste di algoritmi lette dal pacchetto", () => {
  const liste = ["curve25519-sha256", "ssh-ed25519,rsa-sha2-512", "aes128-ctr", "aes128-ctr", "hmac-sha2-256", "hmac-sha2-256", "none", "none", "", ""];
  const corpo: Buffer[] = [Buffer.from([20]), Buffer.alloc(16)];
  for (const l of liste) {
    const b = Buffer.from(l, "latin1");
    const n = Buffer.alloc(4);
    n.writeUInt32BE(b.length);
    corpo.push(n, b);
  }
  corpo.push(Buffer.from([0]), Buffer.alloc(4)); // first_kex_packet_follows + reserved
  const payload = Buffer.concat(corpo);
  const pad = 4;
  const pacchetto = Buffer.alloc(4 + 1 + payload.length + pad);
  pacchetto.writeUInt32BE(1 + payload.length + pad, 0);
  pacchetto[4] = pad;
  payload.copy(pacchetto, 5);
  const k = leggiKexinit(pacchetto);
  assert.ok(k);
  assert.deepEqual(k.kex, ["curve25519-sha256"]);
  assert.deepEqual(k.hostkey, ["ssh-ed25519", "rsa-sha2-512"]);
  assert.deepEqual(k.mac, ["hmac-sha2-256"]);
  assert.equal(leggiKexinit(pacchetto.subarray(0, 20)), null);
});

test("banner con byte di controllo resta leggibile", () => {
  assert.equal(testoStampabile(Buffer.from([0x41, 0x0d, 0x0a, 0x00])), "A\\r\\n\\x00");
});

test("KEX_ECDH_REPLY: host key e impronta SHA-256", () => {
  const blob = Buffer.from("ssh-ed25519\0chiave-di-prova");
  const firma = Buffer.from("firma");
  const q = Buffer.alloc(32, 7);
  const payload = Buffer.concat([
    Buffer.from([31]),
    (() => { const n = Buffer.alloc(4); n.writeUInt32BE(blob.length); return Buffer.concat([n, blob]); })(),
    (() => { const n = Buffer.alloc(4); n.writeUInt32BE(q.length); return Buffer.concat([n, q]); })(),
    (() => { const n = Buffer.alloc(4); n.writeUInt32BE(firma.length); return Buffer.concat([n, firma]); })(),
  ]);
  const pkt = pacchettoSsh(payload);
  const letto = hostkeyDaKexEcdhReply(pkt);
  assert.ok(letto);
  assert.equal(letto.equals(blob), true);
  assert.equal(improntaHostkey(blob), createHash("sha256").update(blob).digest("hex"));
  assert.equal(hostkeyDaKexEcdhReply(pkt.subarray(0, 8)), null);
  assert.equal(kexCurve25519(["diffie-hellman-group14-sha256"]), null);
  assert.equal(kexCurve25519(["curve25519-sha256", "diffie-hellman-group14-sha256"]), "curve25519-sha256");
});
