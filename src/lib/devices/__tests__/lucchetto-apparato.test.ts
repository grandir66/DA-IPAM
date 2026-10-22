// Il lucchetto per apparato (piano 2026-10-22 scansione automatica, Task 4, decisione 10b): il giro ARP, il job
// `apparati_scelti` e «Interroga» non leggono mai lo stesso apparato insieme. Occupato → chi arriva secondo passa oltre
// (il giro, il job) o risponde 409 («Interroga»); apparati diversi vanno in parallelo; un errore libera il lucchetto.
// La chiave porta il tenant: lo stesso id in due clienti è due apparati.
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/lucchetto-apparato.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTenant } from "@/lib/db-tenant";
import { apparatoOccupato, avviaConLucchetto, conLucchettoApparato, MESSAGGIO_OCCUPATO } from "../lucchetto-apparato";

/** Una lettura che resta in corso finché la prova non la chiude. */
function inSospeso<T>(valore: T) {
  let chiudi!: () => void;
  const fatto = new Promise<void>((r) => { chiudi = r; });
  let partita = false;
  const fn = async (): Promise<T> => { partita = true; await fatto; return valore; };
  return { fn, chiudi: () => chiudi(), partita: () => partita };
}

test("due letture insieme sullo stesso apparato: la seconda è «occupato» e non parte", async () => {
  const a = inSospeso("prima");
  let seconda = 0;
  const p1 = conLucchettoApparato(7, a.fn);
  assert.equal(apparatoOccupato(7), true, "il lucchetto si prende subito, prima di ogni await");
  const r2 = await conLucchettoApparato(7, async () => { seconda++; return "seconda"; });
  assert.deepEqual(r2, { stato: "occupato" });
  assert.equal(seconda, 0, "la seconda lettura non è partita");
  a.chiudi();
  assert.deepEqual(await p1, { stato: "fatto", valore: "prima" });
  assert.equal(apparatoOccupato(7), false, "finita la lettura il lucchetto è libero");
});

test("apparati diversi: le letture vanno in parallelo", async () => {
  const a = inSospeso(1);
  const b = inSospeso(2);
  const p1 = conLucchettoApparato(10, a.fn);
  const p2 = conLucchettoApparato(11, b.fn);
  await Promise.resolve();
  assert.equal(a.partita() && b.partita(), true, "tutte e due in corso insieme");
  assert.equal(apparatoOccupato(10) && apparatoOccupato(11), true);
  b.chiudi();
  a.chiudi();
  assert.deepEqual(await Promise.all([p1, p2]), [{ stato: "fatto", valore: 1 }, { stato: "fatto", valore: 2 }]);
});

test("una lettura che lancia: l'errore arriva a chi chiama e il lucchetto è libero", async () => {
  await assert.rejects(conLucchettoApparato(20, async () => { throw new Error("guasto"); }), /guasto/);
  assert.equal(apparatoOccupato(20), false);
  assert.deepEqual(await conLucchettoApparato(20, async () => "di nuovo"), { stato: "fatto", valore: "di nuovo" });
});

test("la chiave porta il tenant: lo stesso id in due clienti non si blocca", async () => {
  const a = inSospeso("A");
  const p1 = withTenant("CLIENTEA", () => conLucchettoApparato(30, a.fn));
  assert.equal(withTenant("CLIENTEA", () => apparatoOccupato(30)), true);
  assert.equal(withTenant("CLIENTEB", () => apparatoOccupato(30)), false);
  assert.deepEqual(await withTenant("CLIENTEB", () => conLucchettoApparato(30, async () => "B")), { stato: "fatto", valore: "B" });
  a.chiudi();
  await p1;
});

test("«Interroga» (avviaConLucchetto): con una lettura in corso è «occupato» (la rotta risponde 409), poi riparte", async () => {
  const giro = inSospeso(undefined);
  const inCorso = withTenant("CLIENTEA", () => conLucchettoApparato(40, giro.fn)); // il giro ARP su quell'apparato
  let interroga = 0;
  assert.equal(withTenant("CLIENTEA", () => apparatoOccupato(40)), true, "la rotta lo vede prima di creare il progresso");
  assert.equal(await avviaConLucchetto(40, "CLIENTEA", async () => { interroga++; }), "occupato");
  assert.equal(interroga, 0);
  assert.equal(MESSAGGIO_OCCUPATO, "Lettura già in corso su questo apparato");
  // Lanciata da «Interroga», tiene il lucchetto fino alla fine della lettura in sottofondo: il giro passa oltre.
  giro.chiudi();
  await inCorso;
  const lettura = inSospeso(undefined);
  const avvio = avviaConLucchetto(40, "CLIENTEA", lettura.fn);
  assert.deepEqual(await withTenant("CLIENTEA", () => conLucchettoApparato(40, async () => "giro")), { stato: "occupato" });
  lettura.chiudi();
  assert.equal(await avvio, "fatto");
  assert.equal(withTenant("CLIENTEA", () => apparatoOccupato(40)), false);
});
