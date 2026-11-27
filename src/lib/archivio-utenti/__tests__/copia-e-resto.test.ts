/**
 * Le parti dell'archivio degli utenti aggiunte il 26/11/2026 (Riccardo: «procedi con tutti i punti»): copia cifrata
 * verso la chiave di recupero e ripristino su un'altra cartella, copia a mano con una frase, storico con ripristino,
 * spostamento, cestino, segni sulle password, importazione di un file KeePass, registro.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as kdbxweb from "kdbxweb";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daipam-archivio-copia-"));
process.env.DA_INVENT_DATA_DIR = DIR;

import { apriCopia, cartellaCopie, copiaConFrase, difettoFrase, ripristinaCopia, statoCopie } from "../copia";
import { leggiRegistroArchivio } from "../deposito";
import { importaKdbx, leggiKdbx } from "../importa";
import { apriArchivio, cartellaArchivio, creaArchivio, daiAccesso, sostituisciChiaveRecupero, type Dipendenze, type Persona } from "../motore";
import { chiaveAperta, chiudiTutte } from "../sessioni";
import { CESTINO, cancellaVoce, dettaglioVoce, elencoVoci, leggiCampo, ripristinaVersione, scriviVoce, spostaVoce, storicoVoce } from "../voci";
import { collegaArgon2 } from "../../vault/keepass";
import { righeStato } from "../../protezione/stato";

after(() => {
  chiudiTutte();
  fs.rmSync(DIR, { recursive: true, force: true });
});

const ADMIN: Persona = { id: 1, nome: "admin", ruolo: "admin" };
const ANNA: Persona = { id: 7, nome: "anna", ruolo: "viewer" };
const PW = "Password-Personale-Di-Anna-Lunga-1";
const SEGRETO = "Segreto-Della-Voce-Di-Prova-42!";
const dip: Dipendenze = { verificaCodice: (_i, c) => c === "123456", indirizzo: "192.0.2.31" };
let CODICE = "";
let RECUPERO = "";
let percorso = "";
const copie = (): string[] => fs.readdirSync(cartellaCopie()).filter((f) => f.endsWith(".copia.age")).sort();

before(async () => {
  const r = await creaArchivio({ chi: ADMIN, codice: "123456" }, dip);
  assert.ok(r.ok);
  CODICE = r.codiceAmministratore;
  RECUPERO = r.chiaveRecupero;
  assert.match(RECUPERO, /^AGE-SECRET-KEY-1/);
  assert.ok((await daiAccesso({ chi: ADMIN, codiceAmministratore: CODICE, a: ANNA, passwordProvvisoria: "Provvisoria-Lunga-Abbastanza-9" }, dip)).ok);
  assert.ok((await apriArchivio({ chi: ANNA, password: "Provvisoria-Lunga-Abbastanza-9", codice: "123456", nuovaPassword: PW }, dip)).ok);
  const v = await scriviVoce(ANNA, { gruppo: "fornitori", titolo: "Portale", utente: "u1", segreti: { password: SEGRETO, pin: "9911" } });
  assert.ok(v.ok);
  percorso = v.percorso;
});

test("la copia si fa da sola, è cifrata, e la chiave privata di recupero non sta da nessuna parte sul disco", () => {
  assert.ok(copie().length >= 1, "dopo creazione, accesso, apertura e salvataggio deve esserci almeno una copia");
  assert.deepEqual([statoCopie().chiave, statoCopie().quante > 0, statoCopie().ultima !== null], [true, true, true]);
  const tutti = [cartellaArchivio(), cartellaCopie(), path.join(DIR, "audit")].flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)));
  const testo = tutti.map((f) => fs.readFileSync(f).toString("latin1")).join("\n");
  for (const segreto of [RECUPERO, SEGRETO, PW, CODICE]) assert.equal(testo.includes(segreto), false, "un segreto è in chiaro sul disco");
  assert.match(fs.readFileSync(path.join(cartellaCopie(), copie()[0])).toString("latin1"), /^age-encryption\.org\/v1/);
  for (const f of copie()) assert.equal(fs.statSync(path.join(cartellaCopie(), f)).mode & 0o077, 0);
});

test("ripristino provato: con la sola chiave di recupero l'archivio rinasce in un'altra cartella e si riapre con la stessa password", async () => {
  const ultima = fs.readFileSync(path.join(cartellaCopie(), copie()[copie().length - 1]));
  // Chiave sbagliata, file che non è una copia: rifiutati senza scrivere niente.
  const { generateIdentity } = await import("age-encryption");
  await assert.rejects(() => apriCopia(new Uint8Array(ultima), "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"), /non apre|chiave/i);
  await assert.rejects(async () => apriCopia(new Uint8Array(ultima), await generateIdentity()), /non apre/);
  // Non sovrascrive un archivio che c'è.
  await assert.rejects(() => ripristinaCopia(new Uint8Array(ultima), RECUPERO), /già un archivio/);
  const altrove = path.join(DIR, "ripristinato");
  const r = await ripristinaCopia(new Uint8Array(ultima), RECUPERO, altrove);
  assert.deepEqual(r.file.sort(), ["amministratore.json", "serrature.json", "utenti.kdbx"]);
  // Si prova davvero: una seconda «installazione» che parte da quella cartella apre con la password di Anna e legge il segreto.
  const prima = process.env.DA_INVENT_DATA_DIR;
  const nuovaDati = path.join(DIR, "seconda-macchina");
  fs.mkdirSync(nuovaDati);
  fs.renameSync(altrove, path.join(nuovaDati, "archivio-utenti"));
  process.env.DA_INVENT_DATA_DIR = nuovaDati;
  try {
    chiudiTutte();
    assert.ok((await apriArchivio({ chi: ANNA, password: PW, codice: "123456" }, dip)).ok, "la serratura di Anna vale anche sulla copia ripristinata");
    assert.deepEqual(await leggiCampo(ANNA, { percorso, campo: "password", modo: "mostrato" }), { ok: true, valore: SEGRETO });
    chiudiTutte();
  } finally {
    process.env.DA_INVENT_DATA_DIR = prima;
  }
  assert.ok((await apriArchivio({ chi: ANNA, password: PW, codice: "123456" }, dip)).ok);
});

test("sostituire la chiave di recupero vuole il codice dell'amministratore; le copie nuove si aprono solo con quella nuova", async () => {
  assert.equal((await sostituisciChiaveRecupero({ chi: ADMIN, codiceAmministratore: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH" }, dip)).ok, false);
  const r = await sostituisciChiaveRecupero({ chi: ANNA, codiceAmministratore: CODICE }, dip);
  assert.ok(r.ok);
  const nuova = fs.readFileSync(path.join(cartellaCopie(), copie()[copie().length - 1]));
  await assert.rejects(() => apriCopia(new Uint8Array(nuova), RECUPERO), /non apre/);
  assert.equal((await apriCopia(new Uint8Array(nuova), r.chiaveRecupero)).formato, 1);
  RECUPERO = r.chiaveRecupero;
});

test("«Scarica una copia»: un KDBX standard che si apre con la sola frase, senza DA-IPAM; frasi deboli rifiutate", async () => {
  assert.ok(difettoFrase("corta"));
  assert.ok(difettoFrase(" con-uno-spazio-davanti-lunga"));
  assert.equal(difettoFrase("Una-Frase-Per-Il-File-Scaricato"), null);
  const aperta = chiaveAperta(ANNA.id);
  assert.ok(aperta);
  await assert.rejects(() => copiaConFrase(aperta.chiave, "corta"));
  const file = await copiaConFrase(aperta.chiave, "Una-Frase-Per-Il-File-Scaricato");
  collegaArgon2();
  const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const db = await kdbxweb.Kdbx.load(ab(file), new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString("Una-Frase-Per-Il-File-Scaricato")));
  const voci = [...db.getDefaultGroup().allEntries()];
  assert.equal(voci.some((e) => (e.fields.get("Password") as kdbxweb.ProtectedValue).getText() === SEGRETO), true);
  await assert.rejects(() => kdbxweb.Kdbx.load(ab(file), new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString("Una-Frase-Sbagliata-Del-Tutto-0"))));
  // L'archivio vero non è cambiato: si apre ancora con la sua chiave.
  assert.ok((await elencoVoci(ANNA)).ok);
});

test("storico: le versioni di prima senza i valori segreti, e il ripristino rimette anche la password di allora", async () => {
  assert.ok((await scriviVoce(ANNA, { percorso, gruppo: "", titolo: "Portale nuovo", utente: "u2", segreti: { password: "Password-Cambiata-Dopo-88" }, versioneAttesa: 1 })).ok);
  const s = await storicoVoce(ANNA, percorso);
  assert.ok(s.ok);
  assert.deepEqual(s.versioni.map((v) => [v.indietro, v.titolo, v.utente, v.segreti]), [[1, "Portale", "u1", ["password", "pin"]]]);
  assert.equal(JSON.stringify(s).includes(SEGRETO), false, "lo storico non porta i valori");
  const r = await ripristinaVersione(ANNA, { percorso, indietro: 1, versioneAttesa: 2 });
  assert.deepEqual(r.ok && r.versione, 3);
  const d = await dettaglioVoce(ANNA, percorso);
  assert.deepEqual(d.ok && [d.voce.titolo, d.voce.utente, d.voce.versioniPrima], ["Portale", "u1", 2]);
  assert.deepEqual(await leggiCampo(ANNA, { percorso, campo: "password", modo: "mostrato" }), { ok: true, valore: SEGRETO });
  assert.equal((await ripristinaVersione(ANNA, { percorso, indietro: 9 })).ok, false);
  assert.equal((await ripristinaVersione(ANNA, { percorso, indietro: 1, versioneAttesa: 1 })).ok, false, "con una versione vecchia davanti non si ripristina");
});

test("sposta, cestino e ritorno: la voce cancellata finisce nel cestino, ricorda da dove viene, e solo da lì sparisce", async () => {
  const s = await spostaVoce(ANNA, { percorso, gruppo: "Fornitori / Portali" });
  assert.ok(s.ok);
  assert.match(s.percorso, /^fornitori\/portali\//);
  assert.equal((await spostaVoce(ANNA, { percorso: s.percorso, gruppo: "fornitori/portali" })).ok, false, "già lì");
  assert.equal((await spostaVoce(ANNA, { percorso: s.percorso, gruppo: "../.." })).ok, false, "un gruppo che non resta niente");
  const c = await cancellaVoce(ANNA, s.percorso);
  assert.deepEqual(c, { ok: true, nelCestino: true });
  const elenco = await elencoVoci(ANNA);
  assert.ok(elenco.ok);
  const nelCestino = elenco.voci.find((v) => v.gruppo === CESTINO);
  assert.ok(nelCestino);
  const d = await dettaglioVoce(ANNA, nelCestino.percorso);
  assert.equal(d.ok && d.voce.provenienza, "fornitori/portali");
  assert.deepEqual(d.ok && d.voce.segreti, ["password", "pin"], "il gruppo di provenienza non è un segreto e non compare fra i segreti");
  // Dal cestino torna dov'era, con i suoi segreti.
  const torna = await spostaVoce(ANNA, { percorso: nelCestino.percorso, gruppo: "fornitori/portali" });
  assert.ok(torna.ok);
  assert.deepEqual(await leggiCampo(ANNA, { percorso: torna.percorso, campo: "pin", modo: "mostrato" }), { ok: true, valore: "9911" });
  const dopo = await dettaglioVoce(ANNA, torna.percorso);
  assert.equal(dopo.ok && dopo.voce.provenienza, null);
  // Due passi per cancellare davvero.
  assert.deepEqual(await cancellaVoce(ANNA, torna.percorso), { ok: true, nelCestino: true });
  const fine = await elencoVoci(ANNA);
  const ultimo = fine.ok ? fine.voci.find((v) => v.gruppo === CESTINO) : undefined;
  assert.ok(ultimo);
  assert.deepEqual(await cancellaVoce(ANNA, ultimo.percorso), { ok: true, nelCestino: false });
  const vuoto = await elencoVoci(ANNA);
  assert.deepEqual(vuoto.ok && vuoto.voci.length, 0);
});

test("segni: password corta e password uguale a un'altra si segnalano senza dirle; il cestino non conta", async () => {
  for (const [titolo, password] of [["A", "Stessa-Password-Usata-Due-Volte"], ["B", "Stessa-Password-Usata-Due-Volte"], ["C", "corta1"], ["D", "Unica-E-Lunga-Abbastanza-77"]]) assert.ok((await scriviVoce(ANNA, { gruppo: "segni", titolo, segreti: { password } })).ok);
  const e = await elencoVoci(ANNA);
  assert.ok(e.ok);
  assert.deepEqual(Object.fromEntries(e.voci.map((v) => [v.titolo, v.segni])), { A: ["doppia"], B: ["doppia"], C: ["debole"], D: [] });
  assert.equal(JSON.stringify(e).includes("Stessa-Password") || JSON.stringify(e).includes("corta1"), false);
  const b = e.voci.find((v) => v.titolo === "B");
  assert.ok(b && (await cancellaVoce(ANNA, b.percorso)).ok);
  const dopo = await elencoVoci(ANNA);
  assert.deepEqual(dopo.ok && dopo.voci.find((v) => v.titolo === "A")?.segni, [], "l'unica rimasta fuori dal cestino non è più doppia");
});

test("importazione: un file di KeePass con gruppi, campi in più e cestino; password sbagliata e file troppo grande rifiutati", async () => {
  collegaArgon2();
  const db = kdbxweb.Kdbx.create(new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString("Password-Del-File-Da-Importare")), "Prova");
  db.createRecycleBin();
  const g = db.createGroup(db.getDefaultGroup(), "Banche e Posta");
  const e1 = db.createEntry(g);
  e1.fields.set("Title", "Conto corrente");
  e1.fields.set("UserName", "mario");
  e1.fields.set("Password", kdbxweb.ProtectedValue.fromString("Importata-Dal-File-1"));
  e1.fields.set("URL", "https://banca.example");
  e1.fields.set("Codice PIN", kdbxweb.ProtectedValue.fromString("5566"));
  const e2 = db.createEntry(db.getDefaultGroup());
  e2.fields.set("Title", "Senza gruppo");
  const buttata = db.createEntry(db.getDefaultGroup());
  buttata.fields.set("Title", "Nel cestino del file");
  db.remove(buttata);
  const file = new Uint8Array(await db.save());
  await assert.rejects(() => leggiKdbx(file, "Password-Sbagliata-Del-File-00"), /non apre/);
  await assert.rejects(() => leggiKdbx(new Uint8Array([1, 2, 3, 4]), "x"), /non è un archivio/);
  assert.equal((await importaKdbx(ANNA, { dati: new Uint8Array(0), password: "x" })).ok, false);
  const r = await importaKdbx(ANNA, { dati: file, password: "Password-Del-File-Da-Importare" });
  assert.deepEqual(r, { ok: true, scritte: 2, troncato: false });
  const e = await elencoVoci(ANNA);
  assert.ok(e.ok);
  const conto = e.voci.find((v) => v.titolo === "Conto corrente");
  assert.deepEqual(conto && [conto.gruppo, conto.utente, conto.url], ["importati/banche-e-posta", "mario", "https://banca.example"]);
  assert.equal(e.voci.some((v) => v.titolo === "Nel cestino del file"), false);
  assert.ok(conto);
  const d = await dettaglioVoce(ANNA, conto.percorso);
  assert.deepEqual(d.ok && d.voce.segreti, ["codice-pin", "password"]);
  assert.deepEqual(await leggiCampo(ANNA, { percorso: conto.percorso, campo: "codice-pin", modo: "mostrato" }), { ok: true, valore: "5566" });
});

test("il registro si rilegge dalla più recente e non contiene nessun segreto; lo stato della protezione dice delle copie", () => {
  const r = leggiRegistroArchivio();
  assert.ok(r.length > 10);
  assert.ok(r[0].il >= r[r.length - 1].il);
  for (const a of ["voce_spostata", "voce_ripristinata", "voci_importate", "copia_fatta", "chiave_recupero_sostituita", "voce_cancellata"]) assert.ok(r.some((x) => x.azione === a), a);
  const testo = JSON.stringify(r);
  for (const segreto of [SEGRETO, PW, CODICE, RECUPERO, "Importata-Dal-File-1", "5566"]) assert.equal(testo.includes(segreto), false);
  const base = { filtro: "acceso" as const, porteATutti: 0, interneEsposte: [], nonAttribuite: 0, conIpv6: 0, adminTotali: 1, adminSenzaSeconda: 0, sshConPassword: false, vaultLocale: true, permessiChiave: 0o600, credenzialiSnmpVecchio: 0, firma: "blocca" as const, root: false, containerPrivilegiati: [] };
  const riga = (c: { chiave: boolean; ultima: string | null } | null) => righeStato({ ...base, copiaArchivio: c ? { ...c, adesso: "2026-11-26T12:00:00Z" } : null }).find((x) => x.chiave === "copia");
  assert.equal(riga(null), undefined, "senza archivio la riga non c'è");
  assert.deepEqual([riga({ chiave: false, ultima: null })?.esito, riga({ chiave: false, ultima: null })?.gravita], ["da_sistemare", "alta"]);
  assert.equal(riga({ chiave: true, ultima: null })?.esito, "da_sistemare");
  assert.deepEqual([riga({ chiave: true, ultima: "2026-11-24T10:00:00Z" })?.esito, riga({ chiave: true, ultima: "2026-11-24T10:00:00Z" })?.stato], ["a_posto", "fatta 2 giorni fa"]);
});
