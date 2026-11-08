/**
 * La pagina Scansioni VA (Passo 5, 06/11/2026). Al 72729 nove PLC sono spariti dentro una scansione
 * della loro rete, causa non accertata: qui si prova che la pagina non può far credere lanciabile chi
 * non lo è, e che ogni esito di Edge ha una parola sua. La scelta di un solo device abbassa il gruppo.
 *
 * Run: node --import tsx --test src/lib/vuln/proposta/__tests__/quadro.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test } from "node:test";
import assert from "node:assert/strict";
import { gruppiDaMostrare, statiGruppi } from "@/lib/vuln/proposta/gruppi-aperti";
import { quadroFamiglie } from "@/lib/vuln/proposta/quadro";
import type { Famiglia } from "@/lib/vuln/proposta/regole";
import type { RigaProposta } from "@/lib/vuln/proposta/store";
import { parolaEsito, type EsitoDaDire } from "@/lib/vuln/proposta/testi-esito";

let k = 0;
const riga = (famiglia: Famiglia, x: Partial<RigaProposta> = {}): RigaProposta => ({
  host_id: ++k, ip: `10.0.0.${k}`, nome: null, famiglia, voce: "bilanciato", con_web: 0, confidenza: "alta",
  motivo: "prova", stato: "confermato", da_rivedere: 0, confermata_da: null, confermata_il: null, ...x,
});

// Regole rovesciate da Riccardo l'08/11/2026 (tavola 40-44): conta chi parte, cioè ogni riga non esclusa; i «da
// chiarire» sono un gruppo prudente; gli impianti restano «mai» finché non c'è il consenso (lo decide la pagina).
test("gli impianti non sono lanciabili da qui; i «da chiarire» sì, col profilo prudente", () => {
  const q = quadroFamiglie([riga("impianti"), riga("impianti", { stato: "proposto" }), riga("da_chiarire"), riga("rete")]);
  assert.deepEqual(q.map((f) => [f.famiglia, f.fuori, f.confermati]), [["rete", null, 1], ["impianti", "mai", 0], ["da_chiarire", null, 1]]);
  assert.equal(q.filter((f) => f.famiglia === "da_chiarire").length, 1, "una riga sola");
  assert.equal(q[1].greenbone, "mai");
  assert.deepEqual([q[2].greenbone, q[2].nuclei, q[2].moduli], ["Veloce", "Nessuno", "Nessuno"]);
});

test("i conti: parte chi non è escluso, anche se non rivisto o col tipo cambiato", () => {
  const [f] = quadroFamiglie([
    riga("windows"), riga("windows", { stato: "proposto" }), riga("windows", { stato: "escluso" }),
    riga("windows", { da_rivedere: 1 }),
  ]);
  assert.deepEqual([f.device, f.confermati, f.inAttesa, f.esclusi, f.daRivedere], [4, 3, 1, 1, 1]);
});

test("un device più basso abbassa il gruppo, si vede ▼, e il giro completo scende col profilo", () => {
  const [f] = quadroFamiglie([riga("linux"), riga("linux", { voce: "veloce" })]);
  assert.deepEqual([f.greenbone, f.scesa, f.moduli], ["Veloce", true, "Giro minimo"]);
  const [g] = quadroFamiglie([riga("linux"), riga("linux", { voce: "veloce", stato: "escluso" })]);
  assert.deepEqual([g.greenbone, g.scesa, g.moduli], ["Bilanciato", false, "Giro completo"], "chi è escluso non conta");
});

test("le colonne dicono la tabella approvata", () => {
  const q = quadroFamiglie([riga("rete"), riga("windows"), riga("web"), riga("periferiche", { voce: "veloce" })]);
  assert.deepEqual(q.map((f) => [f.nome, f.greenbone, f.nuclei, f.moduli]), [
    ["Rete", "Bilanciato", "Solo web di gestione", "Giro minimo"],
    ["Windows", "Bilanciato", "Rapido", "Giro minimo"],
    ["Web e applicazioni", "Bilanciato", "Standard", "Nessuno"],
    ["Periferiche", "Veloce", "Solo web di gestione", "Giro minimo"],
  ]);
});

test("ogni esito ha una parola con segno, e «non so» non offre di rilanciare", () => {
  const tutti: EsitoDaDire[] = [
    { stato: "lanciato", scan_id: 1, status: "running", ip_tolti: [] },
    { stato: "lanciato", scan_id: 2, status: "pending", ip_tolti: [] },
    { stato: "non_partito", scan_id: 3, ip_tolti: [], messaggio: "m" },
    { stato: "gia_in_corso", scan_id: 4, messaggio: "m" },
    { stato: "da_aggiornare" },
    { stato: "rete_non_registrata" },
    { stato: "sonda_assente", messaggio: "m" },
    { stato: "allineamento_fallito", messaggio: "m" },
    { stato: "rifiutato", status: 422, messaggio: "m" },
    { stato: "motore_non_disponibile", messaggio: "m" },
    { stato: "non_so", messaggio: "m" },
    { stato: "non_tentato", messaggio: "m" },
  ];
  for (const e of tutti) assert.match(parolaEsito(e).parola, /^[▶●▲✕✓] /, e.stato);
  assert.equal(parolaEsito({ stato: "non_so", messaggio: "m" }).azione, "edge");
  assert.equal(parolaEsito({ stato: "gia_in_corso", scan_id: 4, messaggio: "m" }).azione, null);
  assert.match(parolaEsito({ stato: "lanciato", scan_id: 2, status: "pending", ip_tolti: [] }).parola, /In coda/);
});

test("gruppi aperti: si incrocia per id; il riquadro sparisce solo se sono finiti tutti bene", () => {
  const lanciati = [
    { scan_id: 1, famiglia: "rete" as const, device: 6 },
    { scan_id: 2, famiglia: "windows" as const, device: 21 },
    { scan_id: 3, famiglia: "linux" as const, device: 9 },
    { scan_id: 4, famiglia: "web" as const, device: 4 },
  ];
  const vuota = { inCorso: [], inCoda: [], finite: [], fallite: [] };
  const a = statiGruppi(lanciati, {
    inCorso: [{ scan_id: 2, percento: 42, finiti: 3 }], inCoda: [{ id: 3 }], finite: [{ id: 1 }], fallite: [],
  });
  assert.deepEqual(a.map((g) => [g.nome, g.stato, g.percento]), [
    ["Rete", "finito", null], ["Windows", "in_corso", 42], ["Linux e server", "in_coda", null], ["Web e applicazioni", "sconosciuto", null],
  ]);
  const errore = statiGruppi(lanciati, { ...vuota, finite: [{ id: 1 }, { id: 2 }, { id: 4 }], fallite: [{ id: 3, error_message: "x" }] });
  assert.equal(gruppiDaMostrare(errore).length, 4, "tutti chiusi ma uno in errore: non si nasconde");
  assert.equal(gruppiDaMostrare(errore)[2].messaggio, "x");
  assert.deepEqual(gruppiDaMostrare(statiGruppi(lanciati, { ...vuota, finite: lanciati.map((g) => ({ id: g.scan_id })) })), []);
  const saputo = statiGruppi([{ ...lanciati[0], chiuso: "errore", chiuso_messaggio: "salvato" }], vuota);
  assert.deepEqual([saputo[0].stato, saputo[0].messaggio], ["errore", "salvato"], "un esito saputo non si richiede alla sonda");
});
