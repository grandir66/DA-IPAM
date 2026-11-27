/**
 * Le voci dell'archivio degli utenti (ADR 0043), su un archivio KDBX vero in una cartella usa e getta.
 * I punti che non devono rompersi: ad archivio chiuso non esce niente; l'elenco e il dettaglio non portano mai un
 * segreto; ogni lettura di un segreto lascia una riga nel registro.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daipam-archivio-voci-"));
process.env.DA_INVENT_DATA_DIR = DIR;

import { apriArchivio, chiudiArchivio, creaArchivio, daiAccesso, type Dipendenze, type Persona } from "../motore";
import { chiudiTutte } from "../sessioni";
import { cancellaVoce, dettaglioVoce, elencoVoci, leggiCampo, scriviVoce, segmento } from "../voci";

after(() => {
  chiudiTutte();
  fs.rmSync(DIR, { recursive: true, force: true });
});

const ADMIN: Persona = { id: 1, nome: "admin", ruolo: "admin" };
const ANNA: Persona = { id: 7, nome: "anna", ruolo: "viewer" };
const LUCA: Persona = { id: 8, nome: "luca", ruolo: "viewer" };
const PW = (n: string) => `Password-Personale-Di-${n}-Lunga-1`;
const SEGRETO = "Il-Segreto-Della-Voce-77!";
const dip: Dipendenze = { verificaCodice: (_i, c) => c === "123456", indirizzo: "192.0.2.31" };
const da = { indirizzo: "192.0.2.31" };
const registro = (): Array<{ azione: string; utente: string; su?: string; dettaglio?: string }> =>
  fs.readdirSync(path.join(DIR, "audit")).filter((f) => f.startsWith("archivio-")).flatMap((f) => fs.readFileSync(path.join(DIR, "audit", f), "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r)));

before(async () => {
  const r = await creaArchivio({ chi: ADMIN, codice: "123456" }, dip);
  assert.equal(r.ok, true);
  const codice = r.ok ? r.codiceAmministratore : "";
  for (const p of [ANNA, LUCA]) {
    assert.equal((await daiAccesso({ chi: ADMIN, codiceAmministratore: codice, a: p, passwordProvvisoria: "Provvisoria-Lunga-Abbastanza-9" }, dip)).ok, true);
    assert.equal((await apriArchivio({ chi: p, password: "Provvisoria-Lunga-Abbastanza-9", codice: "123456", nuovaPassword: PW(p.nome) }, dip)).ok, true);
  }
});

let percorso = "";

test("si aggiunge una voce; l'elenco e il dettaglio non portano mai il segreto, solo il nome del campo", async () => {
  const r = await scriviVoce(ANNA, { gruppo: "Fornitori / Operatori e linee", titolo: "Portale fibra sede", utente: "admin.sede", url: "https://portale.example", note: "Contratto 2026", segreti: { password: SEGRETO, pin: "4321" } }, da);
  assert.equal(r.ok, true);
  percorso = r.ok ? r.percorso : "";
  assert.match(percorso, /^fornitori\/operatori-e-linee\/portale-fibra-sede-[0-9a-f]{6}$/);
  const elenco = await elencoVoci(ANNA);
  assert.ok(elenco.ok);
  assert.deepEqual(elenco.voci.map((v) => [v.titolo, v.utente, v.gruppo, v.versione]), [["Portale fibra sede", "admin.sede", "fornitori/operatori-e-linee", 1]]);
  const dett = await dettaglioVoce(ANNA, percorso);
  assert.ok(dett.ok);
  assert.deepEqual(dett.voce.segreti, ["password", "pin"]);
  assert.equal(dett.voce.note, "Contratto 2026");
  for (const cosa of [elenco, dett]) assert.equal(JSON.stringify(cosa).includes(SEGRETO) || JSON.stringify(cosa).includes("4321"), false, "un segreto è uscito senza essere chiesto");
  // Sul disco il segreto è dentro il KDBX cifrato: in chiaro non c'è da nessuna parte.
  const dir = path.join(DIR, "archivio-utenti");
  assert.equal(fs.readdirSync(dir).some((f) => fs.readFileSync(path.join(dir, f)).toString("latin1").includes(SEGRETO)), false);
});

test("un segreto si legge un campo per volta, e ogni lettura finisce nel registro con chi, quale voce e quale campo", async () => {
  const prima = registro().filter((x) => x.azione === "voce_letta").length;
  const r = await leggiCampo(LUCA, { percorso, campo: "password", modo: "mostrato", indirizzo: "192.0.2.40" });
  assert.deepEqual(r, { ok: true, valore: SEGRETO });
  assert.deepEqual(await leggiCampo(ANNA, { percorso, campo: "pin", modo: "copiato" }), { ok: true, valore: "4321" });
  const letture = registro().filter((x) => x.azione === "voce_letta");
  assert.equal(letture.length, prima + 2);
  assert.deepEqual([letture[prima].utente, letture[prima].su, letture[prima].dettaglio], ["luca", percorso, "password · mostrato"]);
  assert.equal(JSON.stringify(registro()).includes(SEGRETO), false, "il valore letto non va nel registro");
  // I campi in vista non passano di qui, un campo che non c'è non inventa un valore, un nome strano è rifiutato.
  assert.equal((await leggiCampo(ANNA, { percorso, campo: "username", modo: "mostrato" })).ok, false);
  assert.equal((await leggiCampo(ANNA, { percorso, campo: "otp", modo: "mostrato" })).ok, false);
  assert.equal((await leggiCampo(ANNA, { percorso, campo: "../x", modo: "mostrato" })).ok, false);
  assert.equal(registro().filter((x) => x.azione === "voce_letta").length, prima + 2, "una lettura rifiutata non è una lettura");
});

test("ad archivio chiuso non esce niente: né elenco, né dettaglio, né un campo, né si scrive", async () => {
  chiudiArchivio(LUCA, dip);
  for (const r of [await elencoVoci(LUCA), await dettaglioVoce(LUCA, percorso), await leggiCampo(LUCA, { percorso, campo: "password", modo: "mostrato" }), await scriviVoce(LUCA, { gruppo: "x", titolo: "y" }), await cancellaVoce(LUCA, percorso)]) {
    assert.equal(r.ok === false && r.stato, 423);
    assert.equal(JSON.stringify(r).includes("Portale"), false);
  }
  // Chi non ha mai avuto una sessione, lo stesso.
  assert.equal((await elencoVoci({ id: 99, nome: "estraneo", ruolo: "superadmin" })).ok, false);
  assert.equal((await apriArchivio({ chi: LUCA, password: PW("luca"), codice: "123456" }, dip)).ok, true);
});

test("modificare senza riscrivere la password la lascia com'è; lo storico cresce; due persone sulla stessa voce non si sovrascrivono", async () => {
  const m = await scriviVoce(ANNA, { percorso, gruppo: "ignorato-in-modifica", titolo: "Portale fibra sede", utente: "nuovo.utente", note: "Aggiornata", versioneAttesa: 1 }, da);
  assert.deepEqual(m.ok && [m.percorso, m.versione], [percorso, 2]);
  assert.deepEqual(await leggiCampo(ANNA, { percorso, campo: "password", modo: "mostrato" }), { ok: true, valore: SEGRETO });
  const d = await dettaglioVoce(ANNA, percorso);
  assert.deepEqual(d.ok && [d.voce.utente, d.voce.versione, d.voce.versioniPrima, d.voce.segreti], ["nuovo.utente", 2, 1, ["password", "pin"]]);
  // Luca aveva davanti la versione 1: il suo salvataggio non passa sopra quello di Anna.
  const vecchio = await scriviVoce(LUCA, { percorso, gruppo: "", titolo: "Sovrascritta", versioneAttesa: 1 }, da);
  assert.equal(vecchio.ok === false && vecchio.stato, 409);
  const dopo = await dettaglioVoce(LUCA, percorso);
  assert.equal(dopo.ok && dopo.voce.titolo, "Portale fibra sede");
  // Un valore vuoto toglie quel segreto e basta.
  assert.equal((await scriviVoce(ANNA, { percorso, gruppo: "", titolo: "Portale fibra sede", segreti: { pin: "" }, versioneAttesa: 2 }, da)).ok, true);
  const senzaPin = await dettaglioVoce(ANNA, percorso);
  assert.deepEqual(senzaPin.ok && senzaPin.voce.segreti, ["password"]);
});

test("cancellare toglie la voce e lo scrive nel registro; titoli strani diventano percorsi puliti", async () => {
  assert.equal((await scriviVoce(ANNA, { gruppo: "", titolo: "" }, da)).ok, false);
  assert.equal((await scriviVoce(ANNA, { gruppo: "g", titolo: "x", segreti: { "Nome Sbagliato": "v" } }, da)).ok, false);
  assert.deepEqual([segmento("Àrea Clienti / Operatore!"), segmento("../../etc"), segmento("")], ["area-clienti-operatore", "etc", "voce"]);
  const nuova = await scriviVoce(LUCA, { gruppo: "../../fuori", titolo: "Da cancellare" }, da);
  assert.ok(nuova.ok);
  assert.match(nuova.percorso, /^fuori\/da-cancellare-[0-9a-f]{6}$/);
  assert.deepEqual(await cancellaVoce(LUCA, nuova.percorso, da), { ok: true, nelCestino: true });
  const colCestino = await elencoVoci(LUCA);
  const buttata = colCestino.ok ? colCestino.voci.find((v) => v.gruppo === "cestino") : undefined;
  assert.ok(buttata);
  assert.deepEqual(await cancellaVoce(LUCA, buttata.percorso, da), { ok: true, nelCestino: false });
  const elenco = await elencoVoci(LUCA);
  assert.deepEqual(elenco.ok && elenco.voci.map((v) => v.percorso), [percorso]);
  for (const a of ["voce_creata", "voce_cambiata", "voce_cancellata", "voce_letta"]) assert.ok(registro().some((r) => r.azione === a), a);
});
