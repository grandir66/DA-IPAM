import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { leggiBloccati, motivoNonBloccabile, DURATE_BLOCCO } from "../blocco";
import { ESCHE, NOMI_ESCHE, leggiConfEsche, scriviConfEsche } from "../esche-elenco";
import { leggiEventiEsche } from "../tentativi-job";
import { daAvvisare, tentativoDaEvento } from "../tentativi";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daipam-blocco-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test("l'elenco delle esche dell'applicazione è quello del servizio, e il file si rilegge uguale", async () => {
  const servizio = (await import(path.join(process.cwd(), "scripts/esche/da-ipam-esche.mjs"))) as { ESCHE: Record<string, { porta: number; ascolta: number }> };
  assert.deepEqual(Object.fromEntries(NOMI_ESCHE.map((n) => [n, { porta: ESCHE[n].porta, ascolta: ESCHE[n].ascolta }])), servizio.ESCHE);
  assert.deepEqual(leggiConfEsche(scriviConfEsche({ accese: ["web", "telnet"], lente: true })), { accese: ["telnet", "web"], lente: true });
  // Un nome fuori elenco nel file non diventa un'esca.
  assert.deepEqual(leggiConfEsche("ESCHE=telnet,shell,telnet\n"), { accese: ["telnet"], lente: false });
});

// Forma vera scritta dal servizio sul laboratorio il 26/11/2026 (indirizzo sostituito).
const EVENTO = '{"il":"2026-11-26T00:06:45.869Z","esca":"telnet","porta":23,"indirizzo":"192.0.2.63","tentativi":1,"utente":"admin","password":{"lunga":18,"impronta":"de42d6b63af0099d"}}';

test("un contatto con un'esca diventa un tentativo, senza niente della password; righe rotte o strane si scartano", () => {
  assert.deepEqual(tentativoDaEvento(EVENTO), { il: "2026-11-26T00:06:45.869Z", fonte: "esca", indirizzo: "192.0.2.63", utente: "admin", porta: 23, cosa: "esca telnet" });
  assert.equal(JSON.stringify(tentativoDaEvento(EVENTO)).includes("impronta"), false);
  assert.equal(tentativoDaEvento("non json"), null);
  assert.equal(tentativoDaEvento('{"il":"ieri","esca":"telnet"}'), null);
  assert.equal(tentativoDaEvento('{"il":"2026-11-26T00:00:00Z","esca":"<b>x</b>"}'), null);
  assert.equal(tentativoDaEvento('{"il":"2026-11-26T00:00:00Z","esca":"ftp","indirizzo":"<script>"}')?.indirizzo, null);
});

test("tre contatti con le esche in dieci minuti fanno un avviso che dice porte e nomi", () => {
  const ora = new Date("2026-11-26T00:10:00Z");
  const t = [21, 23, 8081].map((porta, i) => ({ il: new Date(ora.getTime() - (i + 1) * 60_000).toISOString(), fonte: "esca" as const, indirizzo: "192.0.2.63", porta, utente: "admin", cosa: "esca" }));
  const a = daAvvisare(t, ora, {}, new Set());
  assert.equal(a.length, 1);
  assert.match(a[0].testo, /192\.0\.2\.63 ha toccato 3 volte le esche in 10 minuti \(porte .*21.*\), provando i nomi: admin/);
  assert.equal(daAvvisare(t.slice(1), ora, {}, new Set()).length, 0);
});

test("gli eventi delle esche si leggono una volta sola, a righe intere, e si riprende da dove si era arrivati", () => {
  const f = path.join(DIR, "eventi-2026-11-26.jsonl");
  fs.writeFileSync(f, `${EVENTO}\n${EVENTO}\n{"il":"2026-11-26T00:07:00Z","esca":"ftp","ind`);
  const letti: Record<string, number> = {};
  assert.equal(leggiEventiEsche(letti, DIR).get("eventi-2026-11-26.jsonl")?.length, 2, "la riga a metà scrittura non si legge");
  assert.equal(leggiEventiEsche(letti, DIR).size, 0, "al secondo giro niente di nuovo");
  fs.appendFileSync(f, 'irizzo":"192.0.2.9"}\n');
  const dopo = leggiEventiEsche(letti, DIR).get("eventi-2026-11-26.jsonl");
  assert.equal(dopo?.length, 1);
  assert.equal(tentativoDaEvento(dopo?.[0] ?? "")?.indirizzo, "192.0.2.9");
  // Un file sparito (pulizia) si dimentica; una cartella che non c'è non è un errore.
  fs.rmSync(f);
  leggiEventiEsche(letti, DIR);
  assert.deepEqual(letti, {});
  assert.equal(leggiEventiEsche({}, path.join(DIR, "non-esiste")).size, 0);
});

test("bloccati: la forma di nft con la scadenza; chi non si blocca mai e perché", () => {
  const json = JSON.stringify({ nftables: [{ metainfo: {} }, { table: { family: "inet", name: "daipam_blocco" } },
    { set: { name: "bloccati4", type: "ipv4_addr", elem: [{ elem: { val: "192.0.2.63", timeout: 120, expires: 118 } }, { elem: { val: "192.0.2.9", timeout: 600, expires: 599 } }] } },
    { set: { name: "bloccati6", type: "ipv6_addr", elem: [{ elem: { val: "2001:db8::7", timeout: 3600, expires: 10 } }] } },
    { set: { name: "altro", elem: [{ elem: { val: "203.0.113.1" } }] } }, { chain: { name: "blocco" } }] });
  assert.deepEqual(leggiBloccati(json), [{ indirizzo: "192.0.2.9", restano: 599 }, { indirizzo: "192.0.2.63", restano: 118 }, { indirizzo: "2001:db8::7", restano: 10 }]);
  assert.deepEqual(leggiBloccati(""), []);
  const c = { sempre: ["198.51.100.0/27"], mai: ["192.0.2.50", "203.0.113.0/24"], nostri: new Set(["192.0.2.8"]), chiamante: "192.0.2.31" };
  assert.equal(motivoNonBloccabile("192.0.2.63", c), null);
  assert.match(motivoNonBloccabile("100.107.33.1", c) ?? "", /NetBird/);
  assert.match(motivoNonBloccabile("192.0.2.8", c) ?? "", /questa macchina/);
  assert.match(motivoNonBloccabile("192.0.2.31", c) ?? "", /ti chiuderesti fuori/);
  assert.match(motivoNonBloccabile("198.51.100.14", c) ?? "", /sempre ammessi/);
  assert.match(motivoNonBloccabile("192.0.2.50", c) ?? "", /mai bloccati/);
  assert.match(motivoNonBloccabile("203.0.113.77", c) ?? "", /mai bloccati/);
  assert.match(motivoNonBloccabile("192.0.2.0/24", c) ?? "", /non una rete/);
  assert.deepEqual(Object.values(DURATE_BLOCCO).every((s) => s >= 60 && s <= 604800), true);
});
