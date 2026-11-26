/**
 * Il motore dell'archivio degli utenti (ADR 0043). Si lavora su una cartella dati usa e getta, con un archivio KDBX
 * vero; il secondo fattore è finto (una funzione che accetta un codice fisso), perché quello vero vive in `hub.users`.
 *
 * La regola che queste prove tengono ferma (Riccardo, 26/11/2026): sull'archivio comanda chi possiede il codice
 * dell'amministratore dell'archivio; il ruolo nell'installazione, superadmin compreso, non apre e non resetta niente.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daipam-archivio-"));
process.env.DA_INVENT_DATA_DIR = DIR;

import { TENTATIVI_MASSIMI, apriArchivio, cartellaArchivio, chiHaAccesso, chiudiArchivio, creaArchivio, daiAccesso, leggiSerrature, sostituisciCodiceAmministratore, statoArchivio, togliAccesso, type Dipendenze, type Persona } from "../motore";
import { apriSerratura, creaSerratura, difettoPassword } from "../serrature";
import { MASSIMO_MS, SENZA_GESTI_MS, apriSessione, chiaveAperta, chiudiScadute, chiudiTutte } from "../sessioni";
import { leggiTentativi } from "../../protezione/tentativi";

after(() => {
  chiudiTutte();
  fs.rmSync(DIR, { recursive: true, force: true });
});

const SUPER: Persona = { id: 1, nome: "super", ruolo: "superadmin" };
const UTENTE: Persona = { id: 7, nome: "lettore", ruolo: "viewer" };
const PW_PROVV = "Provvisoria-Da-Cambiare-Subito-9";
const PW_UTENTE = "La-Mia-Password-Personale-Vera-3";
const PW_SUPER = "Una-Frase-Lunga-Del-Superadmin-1";
let CODICE = "";
let orologio = Date.UTC(2026, 10, 26, 10, 0, 0);
const dip: Dipendenze = { verificaCodice: (_id, codice) => codice === "123456", ora: () => orologio, indirizzo: "192.0.2.31" };
const avanti = (ms: number) => { orologio += ms; };
const registro = (): Array<{ azione: string; utente: string; su?: string }> => {
  const d = path.join(DIR, "audit");
  return fs.readdirSync(d).filter((f) => f.startsWith("archivio-")).flatMap((f) => fs.readFileSync(path.join(d, f), "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r)));
};

before(async () => {
  assert.equal((await creaArchivio({ chi: UTENTE, codice: "123456" }, dip)).ok, false, "non lo crea chi non è amministratore dell'installazione");
  assert.equal((await creaArchivio({ chi: SUPER, codice: "000000" }, dip)).ok, false, "senza codice a sei cifre giusto non si crea");
  assert.equal(fs.existsSync(path.join(cartellaArchivio(), "utenti.kdbx")), false);
  const r = await creaArchivio({ chi: SUPER, codice: "123456" }, dip);
  assert.equal(r.ok, true);
  if (r.ok) CODICE = r.codiceAmministratore;
  assert.match(CODICE, /^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await creaArchivio({ chi: SUPER, codice: "123456" }, dip)).ok, false, "non si crea due volte");
});

test("sul disco non ci sono la chiave dell'archivio, il codice dell'amministratore né una password", async () => {
  await daiAccesso({ chi: SUPER, codiceAmministratore: CODICE, a: UTENTE, passwordProvvisoria: PW_PROVV }, dip);
  const file = fs.readdirSync(cartellaArchivio()).sort();
  assert.deepEqual(file.filter((f) => !f.endsWith(".lock") && !f.endsWith(".prec")), ["amministratore.json", "recupero.pub", "serrature.json", "utenti.kdbx"]);
  assert.equal(file.some((f) => f.endsWith(".keyx")), false, "il key file non deve stare sul disco");
  const tutto = [...file.map((f) => path.join(cartellaArchivio(), f)), ...fs.readdirSync(path.join(DIR, "audit")).map((f) => path.join(DIR, "audit", f))].map((f) => fs.readFileSync(f).toString("latin1")).join("\n");
  for (const segreto of [CODICE, CODICE.replace(/-/g, ""), PW_PROVV]) assert.equal(tutto.includes(segreto), false);
  assert.equal(fs.statSync(cartellaArchivio()).mode & 0o077, 0, "cartella leggibile solo dal proprietario");
  for (const f of ["serrature.json", "amministratore.json"]) assert.equal(fs.statSync(path.join(cartellaArchivio(), f)).mode & 0o077, 0, f);
});

test("neppure il superadmin dell'installazione entra o dà accessi senza il codice dell'amministratore dell'archivio", async () => {
  // Chi ha creato l'archivio non ha una serratura: non apre.
  assert.equal(statoArchivio(SUPER.id, orologio).autorizzato, false);
  const apre = await apriArchivio({ chi: SUPER, password: PW_SUPER, codice: "123456" }, dip);
  assert.equal(apre.ok === false && apre.stato, 403);
  // Senza il codice, o con uno sbagliato, non dà e non toglie l'accesso a nessuno, nemmeno a se stesso.
  for (const sbagliato of ["", "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", CODICE.slice(0, -1)]) {
    assert.equal((await daiAccesso({ chi: SUPER, codiceAmministratore: sbagliato, a: SUPER, passwordProvvisoria: PW_PROVV }, dip)).ok, false, sbagliato);
  }
  assert.equal((await togliAccesso({ chi: SUPER, codiceAmministratore: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", a: UTENTE }, dip)).ok, false);
  assert.equal(statoArchivio(UTENTE.id, orologio).autorizzato, true);
  assert.ok(registro().some((r) => r.azione === "codice_amministratore_rifiutato" && r.utente === "super"));
  assert.ok(leggiTentativi(1, new Date(orologio)).some((t) => t.fonte === "archivio" && /codice dell'amministratore/.test(t.cosa)));
  avanti(16 * 60_000);
  // Col codice, invece, lo fa chiunque sia collegato: il ruolo non conta. E si scrive come lo scrive una persona.
  assert.deepEqual(await daiAccesso({ chi: UTENTE, codiceAmministratore: ` ${CODICE.toLowerCase()} `, a: SUPER, passwordProvvisoria: PW_PROVV }, dip), { ok: true });
  assert.deepEqual(chiHaAccesso().map((x) => [x.utente, x.provvisoria]), [["lettore", true], ["super", true]]);
});

test("la password provvisoria non apre da sola: va cambiata alla prima apertura, e dopo non vale più", async () => {
  const senza = await apriArchivio({ chi: UTENTE, password: PW_PROVV, codice: "123456" }, dip);
  assert.equal(senza.ok === false && senza.stato, 428);
  assert.equal(statoArchivio(UTENTE.id, orologio).aperto, false);
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_PROVV, codice: "123456", nuovaPassword: PW_PROVV }, dip)).ok, false);
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_PROVV, codice: "123456", nuovaPassword: PW_UTENTE }, dip)).ok, true);
  assert.equal(statoArchivio(UTENTE.id, orologio).provvisoria, false);
  chiudiArchivio(UTENTE, dip);
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_PROVV, codice: "123456" }, dip)).ok, false, "la provvisoria è morta");
  avanti(16 * 60_000);
});

test("si apre solo con password principale personale E codice a sei cifre; sbagliarne uno dà lo stesso messaggio e conta", async () => {
  const pw = await apriArchivio({ chi: UTENTE, password: "Una-Frase-Lunga-Sbagliata-Davvero", codice: "123456" }, dip);
  const cod = await apriArchivio({ chi: UTENTE, password: PW_UTENTE, codice: "999999" }, dip);
  assert.deepEqual([pw.ok, cod.ok], [false, false]);
  assert.equal(pw.ok === false && cod.ok === false && pw.errore === cod.errore, true, "non si deve capire quale dei due era sbagliato");
  assert.equal(statoArchivio(UTENTE.id, orologio).sbagliati, 2);
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_UTENTE, codice: "123456" }, dip)).ok, true);
  assert.equal(statoArchivio(UTENTE.id, orologio).aperto, true);
  assert.equal(statoArchivio(UTENTE.id, orologio).sbagliati, 0, "un'apertura riuscita azzera il conto");
  const t = leggiTentativi(1, new Date(orologio)).filter((x) => x.fonte === "archivio" && x.utente === "lettore");
  assert.deepEqual([t[0].indirizzo, t[0].utente], ["192.0.2.31", "lettore"]);
  assert.equal(JSON.stringify(t).includes("Sbagliata"), false);
  // Ognuno ha la sua serratura: quella di uno non si apre con la password dell'altro, né sotto un altro utente.
  const mia = leggiSerrature().find((s) => s.utenteId === UTENTE.id);
  const sua = leggiSerrature().find((s) => s.utenteId === SUPER.id);
  assert.ok(mia && sua);
  assert.equal(await apriSerratura(sua, PW_UTENTE), null);
  assert.equal(await apriSerratura({ ...mia, utenteId: 99 }, PW_UTENTE), null, "una serratura copiata sotto un altro utente non apre");
});

test("si richiude da solo: dopo 10 minuti senza gesti, e comunque dopo 60; la chiave in memoria viene azzerata", () => {
  const chiave = new Uint8Array(32).fill(7);
  apriSessione(50, chiave, 0);
  assert.ok(chiaveAperta(50, { ora: SENZA_GESTI_MS - 1 }), "un gesto prima della scadenza la rinnova");
  assert.ok(chiaveAperta(50, { ora: 2 * SENZA_GESTI_MS - 2 }));
  assert.equal(chiaveAperta(50, { ora: 3 * SENZA_GESTI_MS }), null, "senza gesti per più di 10 minuti si chiude");
  apriSessione(51, chiave, 0);
  let viva: ReturnType<typeof chiaveAperta> = null;
  for (let t = 5 * 60_000; t < MASSIMO_MS; t += 5 * 60_000) viva = chiaveAperta(51, { ora: t });
  assert.ok(viva, "con un gesto ogni 5 minuti resta aperta fino a 55");
  const interna = viva.chiave;
  assert.equal(chiaveAperta(51, { ora: MASSIMO_MS }), null, "a 60 minuti si chiude anche con gesti continui");
  assert.equal(interna.every((b) => b === 0), true, "la chiave della sessione chiusa è azzerata");
  apriSessione(52, chiave, 0);
  assert.ok(chiaveAperta(52, { ora: SENZA_GESTI_MS - 1, tocca: false }));
  assert.equal(chiaveAperta(52, { ora: SENZA_GESTI_MS + 1, tocca: false }), null, "guardare lo stato non allunga la sessione");
  apriSessione(53, chiave, 0);
  assert.deepEqual(chiudiScadute(SENZA_GESTI_MS + 1), [53]);
});

test("cinque tentativi sbagliati bloccano per un quarto d'ora, anche con la password giusta", async () => {
  chiudiArchivio(UTENTE, dip);
  for (let i = 0; i < TENTATIVI_MASSIMI; i++) assert.equal((await apriArchivio({ chi: UTENTE, password: `Sbagliata-Numero-${i}-Davvero-Lunga`, codice: "123456" }, dip)).ok, false);
  const bloccato = await apriArchivio({ chi: UTENTE, password: PW_UTENTE, codice: "123456" }, dip);
  assert.equal(bloccato.ok === false && bloccato.stato, 429);
  assert.ok(registro().some((r) => r.azione === "bloccato" && r.utente === "lettore"));
  avanti(16 * 60_000);
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_UTENTE, codice: "123456" }, dip)).ok, true);
});

test("col codice si ridà l'accesso a chi ha perso la password e si toglie; il codice si sostituisce e il vecchio muore", async () => {
  assert.equal(statoArchivio(UTENTE.id, orologio).aperto, true);
  assert.deepEqual(await daiAccesso({ chi: SUPER, codiceAmministratore: CODICE, a: UTENTE, passwordProvvisoria: PW_PROVV }, dip), { ok: true });
  assert.equal(statoArchivio(UTENTE.id, orologio).aperto, false, "la sessione aperta con la serratura vecchia cade");
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_UTENTE, codice: "123456" }, dip)).ok, false, "la password vecchia non vale più");
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_PROVV, codice: "123456", nuovaPassword: PW_UTENTE }, dip)).ok, true);

  const nuovo = await sostituisciCodiceAmministratore({ chi: UTENTE, codiceAmministratore: CODICE }, dip);
  assert.equal(nuovo.ok, true);
  const NUOVO = nuovo.ok ? nuovo.codiceAmministratore : "";
  assert.notEqual(NUOVO, CODICE);
  assert.equal((await daiAccesso({ chi: SUPER, codiceAmministratore: CODICE, a: SUPER, passwordProvvisoria: PW_PROVV }, dip)).ok, false, "il codice revocato non vale più");
  assert.equal((await sostituisciCodiceAmministratore({ chi: SUPER, codiceAmministratore: CODICE }, dip)).ok, false);
  // Chi ha già una serratura continua ad aprire: sostituire il codice non butta fuori nessuno.
  assert.equal(statoArchivio(UTENTE.id, orologio).aperto, true);
  assert.deepEqual(await togliAccesso({ chi: SUPER, codiceAmministratore: NUOVO, a: UTENTE }, dip), { ok: true });
  assert.equal(statoArchivio(UTENTE.id, orologio).autorizzato, false);
  assert.equal(statoArchivio(UTENTE.id, orologio).aperto, false, "togliere l'accesso chiude la sessione");
  // Col codice nuovo l'archivio si riapre a chiunque gli si ridia l'accesso: i dati non sono persi.
  assert.deepEqual(await daiAccesso({ chi: SUPER, codiceAmministratore: NUOVO, a: UTENTE, passwordProvvisoria: PW_PROVV }, dip), { ok: true });
  assert.equal((await apriArchivio({ chi: UTENTE, password: PW_PROVV, codice: "123456", nuovaPassword: PW_UTENTE }, dip)).ok, true);

  const azioni = registro().map((r) => r.azione);
  for (const a of ["creato", "aperto", "chiuso", "tentativo_fallito", "accesso_dato", "accesso_tolto", "password_cambiata", "codice_amministratore_sostituito"]) assert.ok(azioni.includes(a), `nel registro manca «${a}»`);
  const scritto = JSON.stringify(registro());
  for (const segreto of [PW_UTENTE, PW_PROVV, CODICE, NUOVO]) assert.equal(scritto.includes(segreto), false, "nessun segreto nel registro");
});

test("cinque codici dell'amministratore sbagliati bloccano il codice per tutti, non per utente", async () => {
  avanti(16 * 60_000);
  for (let i = 0; i < TENTATIVI_MASSIMI; i++) await daiAccesso({ chi: i % 2 ? SUPER : UTENTE, codiceAmministratore: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHH2", a: SUPER, passwordProvvisoria: PW_PROVV }, dip);
  const r = await daiAccesso({ chi: { id: 3, nome: "altro", ruolo: "admin" }, codiceAmministratore: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHH2", a: SUPER, passwordProvvisoria: PW_PROVV }, dip);
  assert.equal(r.ok === false && r.stato, 429);
});

test("serrature: password deboli rifiutate, sale diverso a ogni scrittura, manomissione rifiutata", async () => {
  assert.ok(difettoPassword("troppo-corta"));
  assert.ok(difettoPassword("aaaaaaaaaaaaaaaaaaaa"));
  assert.equal(difettoPassword(PW_UTENTE), null);
  const k = new Uint8Array(32).fill(9);
  const a = await creaSerratura(k, PW_UTENTE, { utenteId: 5, utente: "x", scrittaDa: 1, provvisoria: false });
  const b = await creaSerratura(k, PW_UTENTE, { utenteId: 5, utente: "x", scrittaDa: 1, provvisoria: false });
  assert.notEqual(a.sale, b.sale);
  assert.notEqual(a.cifrato, b.cifrato);
  assert.deepEqual(await apriSerratura(a, PW_UTENTE), k);
  assert.equal(await apriSerratura({ ...a, cifrato: b.cifrato }, PW_UTENTE), null);
});
