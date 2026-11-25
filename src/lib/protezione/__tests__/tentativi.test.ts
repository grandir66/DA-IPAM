import { test } from "node:test";
import assert from "node:assert/strict";
import { SILENZIO_MS, aggrega, daAvvisare, tentativoDaRigaSsh, type Tentativo } from "../tentativi";
import { indirizzoDaIntestazioni } from "../../accesso/registro-accessi";

// Forme vere lette sull'hub il 25/11/2026 (indirizzi degli intervalli di documentazione).
const P = "2026-11-25T18:13:53+00:00 da-invent ";

test("sshd: conta le righe con un nome provato, non le sonde che guardano se la porta risponde", () => {
  assert.deepEqual(tentativoDaRigaSsh(`${P}sshd[1657]: Invalid user admin from 192.0.2.50 port 51234`), { il: "2026-11-25T18:13:53.000Z", fonte: "ssh", indirizzo: "192.0.2.50", utente: "admin", porta: 22, cosa: "utente inesistente" });
  assert.equal(tentativoDaRigaSsh(`${P}sshd[1657]: Disconnected from authenticating user root 192.0.2.50 port 5 [preauth]`)?.utente, "root");
  assert.equal(tentativoDaRigaSsh(`${P}sshd-session[9]: Failed password for invalid user pi from 2001:db8::7 port 40022 ssh2`)?.indirizzo, "2001:db8::7");
  assert.equal(tentativoDaRigaSsh(`${P}sshd[1]: Failed publickey for root from 192.0.2.9 port 4 ssh2: ED25519 SHA256:abc`)?.cosa, "accesso rifiutato");
  // Nome vuoto: capita davvero («Invalid user  from»).
  assert.equal(tentativoDaRigaSsh(`${P}sshd[1]: Invalid user  from 192.0.2.50 port 1`)?.utente, "");
  // Non contano: la sonda senza utente, la riga doppia dello stesso tentativo, l'accesso riuscito, un altro servizio.
  for (const r of [
    "sshd[1]: Connection closed by 192.0.2.50 port 1 [preauth]",
    "sshd[1]: Disconnected from invalid user admin 192.0.2.50 port 1 [preauth]",
    "sshd[1]: Connection closed by invalid user  192.0.2.50 port 1 [preauth]",
    "sshd[1]: Accepted publickey for root from 192.0.2.50 port 1 ssh2",
    "sshd[1]: Received disconnect from 192.0.2.50 port 1:11: Bye Bye [preauth]",
    "cron[1]: Invalid user admin from 192.0.2.50 port 1",
  ]) assert.equal(tentativoDaRigaSsh(P + r), null, r);
  assert.equal(tentativoDaRigaSsh("riga senza data sshd[1]: Invalid user a from 192.0.2.1 port 1"), null);
});

const ORA = new Date("2026-11-25T12:00:00Z");
const t = (minutiFa: number, fonte: Tentativo["fonte"], indirizzo: string | null, extra: Partial<Tentativo> = {}): Tentativo => ({ il: new Date(ORA.getTime() - minutiFa * 60_000).toISOString(), fonte, indirizzo, cosa: "x", ...extra });

test("aggrega: una riga per strada e indirizzo, con primo, ultimo, nomi e porte", () => {
  const a = aggrega([t(9, "ssh", "192.0.2.5", { utente: "root" }), t(1, "ssh", "192.0.2.5", { utente: "admin" }), t(3, "pagina", "192.0.2.5", { utente: "admin" }), t(2, "filtro", "192.0.2.5", { porta: 22 })]);
  assert.equal(a.length, 3);
  const ssh = a.find((x) => x.fonte === "ssh");
  assert.deepEqual([ssh?.quanti, ssh?.utenti], [2, ["root", "admin"]]);
  assert.equal(a[0].fonte, "ssh"); // la più recente in cima
});

test("avvisi: sopra soglia nella finestra sì; sotto, vecchi, nostri o già avvisati no", () => {
  const cinque = (ip: string, minuti = 1) => [0, 1, 2, 3, 4].map((i) => t(minuti + i * 0.1, "ssh", ip, { utente: "root" }));
  const nostri = new Set(["192.0.2.8"]);
  assert.deepEqual(daAvvisare(cinque("192.0.2.5"), ORA, {}, nostri).map((a) => a.chiave), ["ssh|192.0.2.5"]);
  assert.match(daAvvisare(cinque("192.0.2.5"), ORA, {}, nostri)[0].testo, /5 tentativi falliti su SSH da 192\.0\.2\.5 in 10 minuti \(nomi provati: root\)/);
  assert.equal(daAvvisare(cinque("192.0.2.5").slice(1), ORA, {}, nostri).length, 0, "quattro non bastano");
  assert.equal(daAvvisare(cinque("192.0.2.5", 30), ORA, {}, nostri).length, 0, "fuori dalla finestra");
  assert.equal(daAvvisare(cinque("192.0.2.8"), ORA, {}, nostri).length, 0, "la macchina stessa (Scanner-Edge) non è un intruso");
  const poco = new Date(ORA.getTime() - 10 * 60_000).toISOString();
  const tanto = new Date(ORA.getTime() - SILENZIO_MS - 1000).toISOString();
  assert.equal(daAvvisare(cinque("192.0.2.5"), ORA, { "ssh|192.0.2.5": poco }, nostri).length, 0, "già avvisato da poco");
  assert.equal(daAvvisare(cinque("192.0.2.5"), ORA, { "ssh|192.0.2.5": tanto }, nostri).length, 1, "passata un'ora si riavvisa");
  // Filtro: contano le porte diverse, non i pacchetti.
  const scansione = [22, 443, 7443].map((porta) => t(2, "filtro", "203.0.113.9", { porta }));
  assert.equal(daAvvisare(scansione, ORA, {}, nostri).length, 1);
  assert.equal(daAvvisare([t(2, "filtro", "203.0.113.9", { porta: 22 }), t(2, "filtro", "203.0.113.9", { porta: 22 }), t(1, "filtro", "203.0.113.9", { porta: 22 })], ORA, {}, nostri).length, 0);
  // Login senza indirizzo: si avvisa lo stesso, dicendolo.
  const senza = [0, 1, 2, 3, 4].map((i) => t(1 + i * 0.1, "pagina", null, { utente: "admin" }));
  assert.match(daAvvisare(senza, ORA, {}, nostri)[0].testo, /Pagina web da indirizzo non noto/);
});

test("indirizzo di chi chiama: dalle intestazioni di nginx, e mai un testo qualunque nel registro", () => {
  const h = (v: Record<string, string>) => ({ get: (n: string) => v[n] ?? null });
  assert.equal(indirizzoDaIntestazioni(h({ "x-real-ip": "192.0.2.31" })), "192.0.2.31");
  assert.equal(indirizzoDaIntestazioni(h({ "x-forwarded-for": "::ffff:192.0.2.31, 10.0.0.1" })), "192.0.2.31");
  assert.equal(indirizzoDaIntestazioni(h({ "x-real-ip": "2001:db8::7" })), "2001:db8::7");
  assert.equal(indirizzoDaIntestazioni(h({ "x-real-ip": "<script>alert(1)</script>" })), null);
  assert.equal(indirizzoDaIntestazioni(h({})), null);
  assert.equal(indirizzoDaIntestazioni(null), null);
});
