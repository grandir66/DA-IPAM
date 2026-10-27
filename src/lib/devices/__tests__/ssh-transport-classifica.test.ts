// Incidente del 22/10 (70151): il router MikroTik chiudeva la connessione prima di presentarsi (servizio SSH ammesso solo
// da altri indirizzi) e la pagina diceva «handshake SSH fallito… algoritmi crittografici legacy». Le credenziali erano
// giuste; si è perso tempo sulla pista sbagliata. Ogni messaggio grezzo deve dare la causa vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapSshError } from "@/lib/devices/ssh-transport";
import { eErroreDiTrasporto } from "@/lib/credentials/trova";

const ctx = { host: "172.20.40.102", port: 22 };
const classifica = (msg: string) => mapSshError(new Error(msg), ctx);

test("chiusa prima di presentarsi → closed_by_remote, con gli indirizzi ammessi come pista", () => {
  for (const msg of ["Connection lost before handshake", "kex_exchange_identification: read: Connection reset by peer", "Connection closed by remote host"]) {
    const e = classifica(msg);
    assert.equal(e.kind, "closed_by_remote", msg);
    assert.equal(e.message, "172.20.40.102:22: il dispositivo chiude la connessione prima di presentarsi.");
    assert.equal(e.hint, "Controlla gli indirizzi ammessi al servizio SSH del dispositivo (MikroTik: IP › Services › ssh › Available From) e il firewall in ingresso.");
    assert.equal(e.raw, msg);
  }
});

test("nessuna risposta durante l'handshake → connect_timeout, porta filtrata o servizio spento", () => {
  const e = classifica("Timed out while waiting for handshake");
  assert.equal(e.kind, "connect_timeout");
  assert.equal(e.message, "172.20.40.102:22: nessuna risposta SSH entro il tempo.");
  assert.equal(e.hint, "Porta 22 filtrata dal firewall, oppure il servizio SSH è spento.");
});

test("algoritmi che non combaciano → resta protocol_error col suggerimento sugli algoritmi", () => {
  const e = classifica("Handshake failed: no matching key exchange algorithm");
  assert.equal(e.kind, "protocol_error");
  assert.match(e.hint ?? "", /algoritmi crittografici legacy/);
});

test("messaggio sconosciuto → unknown col grezzo", () => {
  const e = classifica("qualcosa di mai visto");
  assert.equal(e.kind, "unknown");
  assert.equal(e.raw, "qualcosa di mai visto");
});

test("una chiusura del dispositivo non è un rifiuto della credenziale: errore di trasporto", () => {
  assert.equal(eErroreDiTrasporto("ssh", "x", "closed_by_remote"), true);
});
