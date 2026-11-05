/**
 * Scansione a finestra, lato DA-IPAM (Task 9, 05/11/2026): i conti della stima, la descrizione della
 * fascia, gli orari in ora italiana, la lettura della risposta della sonda e il bridge contro un
 * finto edge HTTP che risponde come quello vero (rotte del Task 6): salvataggio, 404 «sonda da
 * aggiornare» distinto da «rete non trovata», rifiuti col loro motivo, ritorno all'orario fisso
 * nell'ordine DELETE → salvataggio. Poi i permessi delle rotte nuove.
 *
 * Gira su un tenant temporaneo:
 *   DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/__tests__/finestra.test.ts
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-finestra";
import "./support/dati-isolati"; // per primo: la cartella dati di prova, mai quella di chi lancia

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { encrypt } from "@/lib/crypto";
import { EdgeClientError, edgeApiGet } from "@/lib/vuln/scanner-edge-client";
import { describeFinestra, type FinestraInput } from "@/lib/vuln/cron-builder";
import {
  MINUTI_GRUPPO,
  barraAvanzamento,
  giornoOraItaliano,
  leggiRispostaFinestra,
  leggiRispostaIp,
  oraItaliana,
  oreDellaFascia,
  passaLaMezzanotte,
  righeStato,
  stimaFinestra,
  testoDistanzaRitento,
  type DatiFinestra,
} from "@/lib/vuln/finestra";
import {
  SONDA_DA_AGGIORNARE,
  leggiFinestra,
  leggiFinestraIp,
  removeEdgeSubnetFinestra,
  saveEdgeSubnetFinestra,
  saveEdgeSubnetSchedule,
} from "@/lib/vuln/edge-subnet-bridge";
import { getEdgeSchedule, saveEdgeSchedule } from "@/lib/vuln/edge-schedule-store";
import { elencoSchedulazioni } from "@/lib/schedulazioni/elenco";
import { cancellaFinestraRotta, elencoIpRotta, salvaFinestraRotta } from "@/lib/vuln/finestra-rotte";
import { censisci, consentitiDaAuthConfig, gestoriDellAlbero } from "@/lib/permessi/rotte";

// ── stimaFinestra ───────────────────────────────────────────────────────────────────────────────

test("stimaFinestra: basta, quando i gruppi entrano in una apertura della fascia", () => {
  // 96 IP a gruppi di 10 = 10 gruppi da 60 minuti = 10 ore, in una fascia da 12.
  const s = stimaFinestra({ ip: 96, ipPerGruppo: 10, minutiGruppo: MINUTI_GRUPPO.balanced, oreCiclo: 12 });
  assert.deepEqual(s, { gruppi: 10, ore: 10, cicli: 1, basta: true });
});

test("stimaFinestra: non basta, e dice quante aperture servono", () => {
  // 254 IP in Approfondito: 26 gruppi da 120 minuti = 52 ore, fascia da 12 → 5 aperture.
  const s = stimaFinestra({ ip: 254, ipPerGruppo: 10, minutiGruppo: MINUTI_GRUPPO.deep, oreCiclo: 12 });
  assert.deepEqual(s, { gruppi: 26, ore: 52, cicli: 5, basta: false });
});

test("stimaFinestra: gli IP per gruppo contano (stessi IP, gruppi diversi)", () => {
  const a = stimaFinestra({ ip: 100, ipPerGruppo: 10, minutiGruppo: 60, oreCiclo: 12 });
  const b = stimaFinestra({ ip: 100, ipPerGruppo: 20, minutiGruppo: 60, oreCiclo: 12 });
  assert.equal(a.gruppi, 10);
  assert.equal(b.gruppi, 5);
  assert.equal(a.basta, true);
  assert.equal(b.ore, 5);
  // Un gruppo parziale è un gruppo intero: 21 IP a 20 per gruppo sono 2 gruppi.
  assert.equal(stimaFinestra({ ip: 21, ipPerGruppo: 20, minutiGruppo: 60, oreCiclo: 12 }).gruppi, 2);
});

test("stimaFinestra: al limite (ore uguali alla fascia) basta, un minuto in più no", () => {
  // 120 IP a 10 per gruppo = 12 gruppi da 60 minuti = 12 ore esatte, in una fascia da 12.
  assert.deepEqual(stimaFinestra({ ip: 120, ipPerGruppo: 10, minutiGruppo: 60, oreCiclo: 12 }), { gruppi: 12, ore: 12, cicli: 1, basta: true });
  const oltre = stimaFinestra({ ip: 121, ipPerGruppo: 10, minutiGruppo: 60, oreCiclo: 12 });
  assert.deepEqual([oltre.gruppi, oltre.cicli, oltre.basta], [13, 2, false]);
});

test("stimaFinestra: zero IP non è un errore e non inventa ore", () => {
  assert.deepEqual(stimaFinestra({ ip: 0, ipPerGruppo: 10, minutiGruppo: 60, oreCiclo: 12 }), {
    gruppi: 0,
    ore: 0,
    cicli: 0,
    basta: true,
  });
});

test("stimaFinestra: valori che non permettono il conto sono un errore, non una stima inventata", () => {
  const base = { ip: 10, ipPerGruppo: 10, minutiGruppo: 60, oreCiclo: 12 };
  assert.throws(() => stimaFinestra({ ...base, ip: -1 }), RangeError);
  assert.throws(() => stimaFinestra({ ...base, ipPerGruppo: 0 }), RangeError);
  assert.throws(() => stimaFinestra({ ...base, minutiGruppo: 0 }), RangeError);
  assert.throws(() => stimaFinestra({ ...base, oreCiclo: 0 }), RangeError);
});

test("MINUTI_GRUPPO: gli stessi valori di STIMA_GRUPPO_MIN della sonda", (t) => {
  assert.deepEqual(MINUTI_GRUPPO, { fast: 20, balanced: 60, deep: 120 });
  // Il confronto col sorgente della sonda (repo DA-Vul-can accanto a questo) si fa dove c'è.
  const percorso = join(process.cwd(), "..", "DA-Vul-can", "infra", "scanner-edge", "app", "scanner_edge", "services", "finestra_runner.py");
  if (!existsSync(percorso)) {
    t.skip("sorgente della sonda non presente: confronto con STIMA_GRUPPO_MIN saltato");
    return;
  }
  assert.equal(readFileSync(percorso, "utf8").match(/STIMA_GRUPPO_MIN = \{[^}]*\}/)?.[0], 'STIMA_GRUPPO_MIN = {"fast": 20, "balanced": 60, "deep": 120}');
});

test("testoDistanzaRitento: un terzo della fascia, come distanza_ritento della sonda (anche oltre la mezzanotte e a 24 ore)", () => {
  assert.equal(testoDistanzaRitento("08:00", "20:00"), "circa 4 h");
  assert.equal(testoDistanzaRitento("22:00", "06:00"), "circa 2,7 h");
  assert.equal(testoDistanzaRitento("08:00", "08:00"), "circa 8 h");
  assert.equal(testoDistanzaRitento("09:00", "10:00"), "circa 20 min");
  assert.equal(testoDistanzaRitento("08:00", "boh"), null);
});

test("oreDellaFascia e passaLaMezzanotte: 08-20 dura 12 ore, 22-06 ne dura 8, uguali 24", () => {
  assert.equal(oreDellaFascia("08:00", "20:00"), 12);
  assert.equal(oreDellaFascia("22:00", "06:00"), 8);
  assert.equal(oreDellaFascia("08:00", "08:00"), 24);
  assert.equal(oreDellaFascia("8", "20:00"), null);
  assert.equal(passaLaMezzanotte("22:00", "06:00"), true);
  assert.equal(passaLaMezzanotte("08:00", "20:00"), false);
  assert.equal(passaLaMezzanotte("08:00", "08:00"), true);
});

// ── describeFinestra ────────────────────────────────────────────────────────────────────────────

test("describeFinestra: giorni dal lunedì, fascia, ripetizione", () => {
  assert.equal(
    describeFinestra({ giorni: [3, 1, 2], dalle: "08:00", alle: "20:00", ripeti: "mese" }),
    "lun/mar/mer dalle 08:00 alle 20:00, ogni mese",
  );
  assert.equal(
    describeFinestra({ giorni: [0, 6], dalle: "9:05", alle: "17:30", ripeti: "settimana" }),
    "sab/dom dalle 09:05 alle 17:30, ogni settimana",
  );
});

test("describeFinestra: la fascia che passa la mezzanotte lo dice", () => {
  assert.equal(
    describeFinestra({ giorni: [1, 2, 3], dalle: "22:00", alle: "06:00", ripeti: "mese" }),
    "lun/mar/mer dalle 22:00 alle 06:00 del giorno dopo, ogni mese",
  );
  // «alle» uguale a «dalle»: 24 ore, anche questo passa la mezzanotte.
  assert.match(describeFinestra({ giorni: [1], dalle: "08:00", alle: "08:00", ripeti: "mese" }), /alle 08:00 del giorno dopo/);
});

test("describeFinestra: senza giorni lo dice, un orario illeggibile è un errore", () => {
  assert.match(describeFinestra({ giorni: [], dalle: "08:00", alle: "20:00", ripeti: "mese" }), /^nessun giorno dalle/);
  assert.throws(() => describeFinestra({ giorni: [1], dalle: "25:00", alle: "20:00", ripeti: "mese" }));
});

// ── Orari in ora italiana ───────────────────────────────────────────────────────────────────────

/** Il fuso del processo cambia: un'implementazione che legge l'istante come ora locale sbaglia in uno dei due. */
function conFuso(fuso: string, prova: () => void): void {
  const prima = process.env.TZ;
  process.env.TZ = fuso;
  try {
    prova();
  } finally {
    if (prima === undefined) delete process.env.TZ;
    else process.env.TZ = prima;
  }
}

for (const fuso of ["America/Los_Angeles", "Asia/Tokyo", "UTC", "Europe/Rome"]) {
  test(`orari: l'istante UTC della sonda diventa ora italiana, qualunque sia il fuso del processo (${fuso})`, () => {
    conFuso(fuso, () => {
      // Inverno (CET, UTC+1) e estate (CEST, UTC+2).
      assert.equal(oraItaliana("2026-11-05 07:25:38"), "08:25");
      assert.equal(oraItaliana("2026-07-01 11:05:00"), "13:05");
      // Il cambio di ora: 25/10/2026 alle 01:00 UTC le 03:00 estive tornano le 02:00 invernali.
      assert.equal(oraItaliana("2026-10-25 00:30:00"), "02:30");
      assert.equal(oraItaliana("2026-10-25 01:30:00"), "02:30");
      // Con la «Z» o l'offset non si converte due volte.
      assert.equal(oraItaliana("2026-11-05T07:25:38Z"), "08:25");
    });
  });
}

test("orari: il giorno cambia quando in Italia è già mezzanotte passata", () => {
  conFuso("America/Los_Angeles", () => {
    // 22:30 UTC di luglio = 00:30 del giorno dopo in Italia.
    const adesso = new Date("2026-07-01T20:00:00Z"); // 22:00 italiane del 1 luglio
    assert.equal(giornoOraItaliano("2026-07-01 22:30:00", adesso), "domani 00:30");
    assert.equal(giornoOraItaliano("2026-07-01 11:05:00", adesso), "oggi 13:05");
    assert.equal(giornoOraItaliano("2026-06-30 16:02:00", adesso), "ieri 18:02");
    assert.equal(giornoOraItaliano("2026-06-28 07:10:00", adesso), "domenica 28/06 09:10");
    assert.equal(giornoOraItaliano(null, adesso), "—");
    assert.equal(giornoOraItaliano("non una data", adesso), "—");
  });
});

// ── Risposte della sonda ────────────────────────────────────────────────────────────────────────

/** L'esempio della GET del rapporto del Task 6. */
const GET_VERA = {
  ok: true,
  finestra: {
    enabled: 1, giorni: [1, 2, 3], dalle: "22:00", alle: "06:00", ip_per_gruppo: 10, tentativi: 2, ripeti: "mese",
    profile: "balanced", targeting_mode: null, aggiornata_at: "2026-11-05 07:25:38", ultimo_errore: null,
  },
  passaggio: {
    id: 1, stato: "in_corso", iniziato_at: "2026-11-05 07:25:38", finito_at: null, avviso: null, sospeso_fino: null,
    totale: 6, da_fare: 1, in_prova: 1, finiti: 2, non_rispondono: 1, assenti: 1, non_finiti: 0, gruppi_fatti: 0,
    rapporti_inviati: 0, rapporti_in_coda: 0, rapporti_arresi: 0, durata_media_min: null,
  },
  gruppo: { scan_id: 1, ip: "10.50.0.3,10.50.0.4", partito_at: "2026-11-05 07:25:38", percento: null },
  dentro_fascia: false,
  prossima_apertura: "2026-11-02 21:00:00",
  sftp_escluso: false,
};
const GET_SENZA = {
  ok: true, finestra: null, passaggio: null, gruppo: null, dentro_fascia: null, prossima_apertura: null, sftp_escluso: false,
};

test("leggiRispostaFinestra: invio letto dalla sonda; assente o sconosciuto è null, non un valore inventato", () => {
  const con = (invio: unknown) => {
    const r = leggiRispostaFinestra({ ...GET_VERA, finestra: { ...GET_VERA.finestra, invio } });
    assert.ok(r.ok);
    return r.dati.finestra?.invio;
  };
  assert.equal(con("fascia"), "fascia");
  assert.equal(con("passaggio"), "passaggio");
  assert.equal(con("gruppo"), "gruppo");
  assert.equal(con(undefined), null);
  assert.equal(con("domani"), null);
});

test("leggiRispostaFinestra: la risposta vera si legge, e «senza finestra» è finestra null", () => {
  const r = leggiRispostaFinestra(GET_VERA);
  assert.ok(r.ok);
  assert.deepEqual(r.dati.finestra?.giorni, [1, 2, 3]);
  assert.equal(r.dati.passaggio?.totale, 6);
  assert.equal(r.dati.gruppo?.ip, "10.50.0.3,10.50.0.4");
  assert.equal(r.dati.prossima_apertura, "2026-11-02 21:00:00");
  const senza = leggiRispostaFinestra(GET_SENZA);
  assert.ok(senza.ok);
  assert.equal(senza.dati.finestra, null);
  assert.equal(senza.dati.passaggio, null);
});

test("leggiRispostaFinestra: una forma diversa è un errore detto, non un pannello vuoto", () => {
  for (const [nome, raw] of [
    ["testo", "ciao"],
    ["senza ok", { finestra: null, passaggio: null }],
    ["finestra senza giorni", { ...GET_VERA, finestra: { ...GET_VERA.finestra, giorni: "1,2" } }],
    ["ripeti sconosciuto", { ...GET_VERA, finestra: { ...GET_VERA.finestra, ripeti: "anno" } }],
    ["passaggio senza da_fare", { ...GET_VERA, passaggio: { ...GET_VERA.passaggio, da_fare: undefined } }],
  ] as const) {
    const r = leggiRispostaFinestra(raw);
    assert.equal(r.ok, false, nome);
    if (!r.ok) assert.match(r.error, /non riconosciuta/, nome);
  }
});

test("leggiRispostaIp: l'elenco vero si legge, uno stato sconosciuto è un errore", () => {
  const ok = leggiRispostaIp({
    ok: true, totale: 2,
    ip: [{ ip: "10.50.0.1", stato: "finito", tentativi: 0, ultimo_tentativo_at: null, prossimo_da: null, scan_id: null }],
  });
  assert.ok(ok.ok);
  assert.equal(ok.totale, 2);
  assert.equal(ok.ip[0].stato, "finito");
  const male = leggiRispostaIp({ ok: true, totale: 1, ip: [{ ip: "10.0.0.1", stato: "boh", tentativi: 0 }] });
  assert.equal(male.ok, false);
});

test("barraAvanzamento: finiti sul totale senza assenti e non finiti («41 di 92»)", () => {
  const b = barraAvanzamento({ totale: 96, finiti: 41, assenti: 3, non_finiti: 1 });
  assert.deepEqual(b, { finiti: 41, su: 92, usciti: 4, percento: 45 });
  // Tutti gli IP usciti: niente divisione per zero, barra a zero.
  assert.deepEqual(barraAvanzamento({ totale: 2, finiti: 0, assenti: 1, non_finiti: 1 }), { finiti: 0, su: 0, usciti: 2, percento: 0 });
});

// ── Riga di stato: i casi della tavola (C2-C9, C11, C12) ─────────────────────────────────────────

function dati(extra: { passaggio?: Partial<NonNullable<DatiFinestra["passaggio"]>>; finestra?: Partial<NonNullable<DatiFinestra["finestra"]>>; alto?: Partial<DatiFinestra> } = {}): DatiFinestra {
  const r = leggiRispostaFinestra(GET_VERA);
  assert.ok(r.ok);
  return {
    ...r.dati,
    dentro_fascia: null,
    prossima_apertura: null,
    passaggio: { ...r.dati.passaggio!, ...extra.passaggio },
    finestra: { ...r.dati.finestra!, ...extra.finestra },
    ...extra.alto,
  };
}
const ADESSO_RIGHE = new Date("2026-11-05T12:00:00Z"); // 13:00 italiane

test("righeStato: fascia aperta e fascia chiusa (C3) dicono la prossima apertura in ora italiana, senza allarme", () => {
  const chiusa = righeStato(dati({ alto: { dentro_fascia: false, prossima_apertura: "2026-11-09 07:00:00" } }), ADESSO_RIGHE);
  assert.deepEqual(chiusa, [{ tono: "neutro", testo: "● Fascia chiusa. Prossima apertura lunedì 09/11 alle 08:00." }]);
  const aperta = righeStato(dati({ finestra: { alle: "20:00" }, alto: { dentro_fascia: true, prossima_apertura: "2026-11-09 07:00:00" } }), ADESSO_RIGHE);
  assert.equal(aperta[0].testo, "● Fascia aperta fino alle 20:00. Prossima apertura lunedì 09/11 alle 08:00.");
});

test("righeStato: passaggio sospeso (C2) con l'ora italiana della ripresa; a pausa finita non è più «sospeso»", () => {
  const avviso = "passaggio in pausa dopo troppi gruppi caduti di fila: motore non raggiungibile";
  const sospeso = righeStato(dati({ passaggio: { avviso, sospeso_fino: "2026-11-05 13:35:00" } }), ADESSO_RIGHE);
  assert.deepEqual(sospeso, [{ tono: "guasto", testo: "✕ Sospeso fino alle 14:35: tre gruppi di fila non sono riusciti. Motore non raggiungibile." }]);
  const finita = righeStato(dati({ passaggio: { avviso, sospeso_fino: "2026-11-05 11:35:00" } }), ADESSO_RIGHE);
  assert.equal(finita[0].tono, "attenzione");
  assert.doesNotMatch(finita[0].testo, /Sospeso fino/);
});

test("righeStato: gli avvisi del motore diventano le frasi della tavola, col segno giusto (C4-C6, C11, C12)", () => {
  const caso = (avviso: string) => righeStato(dati({ passaggio: { avviso } }), ADESSO_RIGHE)[0];
  assert.deepEqual(caso("nessun IP ha risposto: Greenbone non si è acceso"), { tono: "neutro", testo: "● Nessun IP ha risposto: Greenbone non si è acceso. Si riprova più tardi." });
  assert.deepEqual(caso("prova di presenza non riuscita: decide Greenbone"), { tono: "attenzione", testo: "▲ Prova di presenza non riuscita: decide Greenbone." });
  assert.deepEqual(caso("gruppo non fermato a fine fascia: si riprova"), { tono: "guasto", testo: "✕ Il gruppo non si è fermato a fine fascia: si riprova." });
  assert.deepEqual(caso("licenza: niente gruppi: licenza scaduta il 01/11"), { tono: "guasto", testo: "✕ Licenza scaduta: i gruppi sono fermi." });
  assert.deepEqual(caso("uscita di scansione non pronta: vlan 20 assente"), { tono: "guasto", testo: "✕ Interfaccia della rete non disponibile: il gruppo non è partito. Vlan 20 assente." });
});

test("righeStato: un avviso sconosciuto si mostra com'è con ▲ (non si nasconde), quello dell'inventario vuoto pure", () => {
  const r = righeStato(dati({ passaggio: { avviso: "L'inventario della rete è vuoto: si scansiona tutta la rete." } }), ADESSO_RIGHE)[0];
  assert.deepEqual(r, { tono: "attenzione", testo: "▲ L'inventario della rete è vuoto: si scansiona tutta la rete." });
  assert.equal(righeStato(dati({ passaggio: { avviso: "qualcosa di nuovo" } }), ADESSO_RIGHE)[0].testo, "▲ Qualcosa di nuovo.");
});

test("righeStato: rete troppo grande (C7), rapporti non arrivati (C8), SFTP (C9), finestra spenta", () => {
  const c7 = righeStato(dati({ finestra: { ultimo_errore: "La rete supera 4096 IP: nessun passaggio aperto. Scegli «Solo IP che rispondono»" } }), ADESSO_RIGHE);
  assert.deepEqual(c7[0], { tono: "guasto", testo: "✕ La rete supera 4096 IP: nessun passaggio aperto. Scegli «Solo IP che rispondono»." });
  const c8 = righeStato(dati({ passaggio: { rapporti_arresi: 2 } }), ADESSO_RIGHE);
  assert.deepEqual(c8, [{ tono: "attenzione", testo: "▲ 2 rapporti non arrivati a Vulcan: si riprova entro 24 ore." }]);
  assert.equal(righeStato(dati({ passaggio: { rapporti_arresi: 1 } }), ADESSO_RIGHE)[0].testo, "▲ 1 rapporto non arrivato a Vulcan: si riprova entro 24 ore.");
  const c9 = righeStato(dati({ alto: { sftp_escluso: true } }), ADESSO_RIGHE);
  assert.deepEqual(c9, [{ tono: "attenzione", testo: "▲ Niente SFTP per le reti a finestra: i rapporti vanno solo a Vulcan." }]);
  const spenta = righeStato(dati({ finestra: { enabled: 0 } }), ADESSO_RIGHE);
  assert.equal(spenta[0].testo, "● Finestra spenta: «Salva la finestra» la riaccende.");
  assert.deepEqual(righeStato(dati(), ADESSO_RIGHE), [], "niente di strano, niente righe");
});

// ── Il bridge contro un finto edge ──────────────────────────────────────────────────────────────

const T = "TESTFINESTRA";
const TOKEN = "tok-edge-finestra";
const EDGE_ID = 7;
const BASE = `/api/v1/networks/${EDGE_ID}`;

type Reply = { status: number; body: string; type?: string };
let server: Server;
let baseUrl = "";
let routes: Record<string, Reply> = {};
let seen: Array<{ method: string; url: string; body: string }> = [];
let rete = 0;

const json = (o: unknown, status = 200): Reply => ({ status, body: JSON.stringify(o) });
const testo = (t: string, status: number): Reply => ({ status, body: t, type: "text/plain" });
/** Risposta per «METODO /percorso» (senza query), come il finto edge del Task 6. */
function edgeRisponde(r: Record<string, Reply>): void {
  routes = {
    "GET /api/v1/networks/lookup": json({ found: true, network_id: EDGE_ID }),
    "POST /api/v1/networks/ensure": json({ ok: true, network_id: EDGE_ID, host_count: 0 }),
    ...r,
  };
}
const chiamate = () => seen.map((s) => `${s.method} ${s.url.split("?")[0]}`);

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", body });
      const r = routes[`${req.method} ${(req.url ?? "").split("?")[0]}`];
      if (!r) {
        // Come una sonda vecchia: rotta che non esiste.
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"detail":"Not Found"}');
        return;
      }
      res.writeHead(r.status, { "Content-Type": r.type ?? "application/json" });
      res.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  getTenantDb(T)
    .prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('edge di prova', ?, ?, 1)")
    .run(baseUrl, encrypt(TOKEN));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

beforeEach(() => {
  seen = [];
  edgeRisponde({});
  const db = getTenantDb(T);
  db.exec("DELETE FROM edge_scan_schedules; DELETE FROM networks");
  db.prepare("UPDATE vuln_scanners SET enabled = 1").run();
  rete = Number(db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'uffici')").run().lastInsertRowid);
});

const dentro = <R>(f: () => Promise<R>): Promise<R> => withTenant(T, f);

const FINESTRA: FinestraInput = {
  enabled: true,
  giorni: [3, 1, 2],
  dalle: "08:00",
  alle: "20:00",
  ripeti: "mese",
  ipPerGruppo: 10,
  tentativi: 3,
  profile: "balanced",
  targetingMode: "full_subnet",
};

const ORARIO = {
  enabled: true,
  profile: "balanced" as const,
  cronExpr: "0 22 1 * *",
  jobName: "uffici_mensile",
  frequency: "monthly" as const,
  atTime: "22:00",
  dayOfMonth: 1,
};

test("saveEdgeSubnetFinestra: ensure, poi la PUT con i campi della sonda; la finestra si ricorda in IPAM", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json({ ...GET_VERA, avviso: "L'inventario della rete è vuoto: si scansiona tutta la rete." }) });
  const r = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.deepEqual(r, { ok: true, avviso: "L'inventario della rete è vuoto: si scansiona tutta la rete." });
  assert.deepEqual(chiamate(), ["POST /api/v1/networks/ensure", `PUT ${BASE}/finestra`]);
  assert.deepEqual(JSON.parse(seen[1].body), {
    enabled: true, giorni: [3, 1, 2], dalle: "08:00", alle: "20:00", ip_per_gruppo: 10, tentativi: 3,
    ripeti: "mese", profile: "balanced", targeting_mode: "full_subnet",
  });
  // Le credenziali viaggiano come per la pianificazione (la chiave `credentials` esiste solo se ce ne sono: qui il corpo è quello di ensure).
  assert.equal(JSON.parse(seen[0].body).cidr, "10.9.0.0/24");
  const riga = await dentro(async () => getEdgeSchedule(rete));
  assert.equal(riga?.modo, "finestra");
  assert.equal(riga?.fascia_dalle, "08:00");
  assert.equal(riga?.fascia_alle, "20:00");
  assert.equal(riga?.fascia_giorni, "1,2,3");
  assert.equal(riga?.days_of_week, null, "i giorni dell'orario non si toccano");
  assert.equal(riga?.ip_per_gruppo, 10);
  assert.equal(riga?.tentativi, 3);
  assert.equal(riga?.ripeti, "mese");
  assert.equal(riga?.fascia_attiva, true);
  assert.equal(riga?.enabled, false, "enabled è dell'orario: spento, come sulla sonda");
});

test("saveEdgeSubnetFinestra: la scelta dell'invio arriva alla sonda", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json(GET_VERA) });
  await dentro(() => saveEdgeSubnetFinestra(rete, { ...FINESTRA, invio: "fascia" }));
  assert.equal(JSON.parse(seen[1].body).invio, "fascia");
});

test("saveEdgeSubnetFinestra: con un modo che usa gli host manda anche l'inventario, con full_subnet no", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json(GET_VERA) });
  getTenantDb(T)
    .prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.9.0.5', 'online')")
    .run(rete);
  await dentro(() => saveEdgeSubnetFinestra(rete, { ...FINESTRA, targetingMode: "found_ips" }));
  assert.deepEqual(JSON.parse(seen[0].body).hosts.map((h: { ip: string }) => h.ip), ["10.9.0.5"]);
  seen = [];
  await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.equal("hosts" in JSON.parse(seen[0].body), false);
});

test("saveEdgeSubnetFinestra: un rifiuto 400 della sonda arriva col suo motivo intero, e niente si salva in IPAM", async () => {
  const motivo = "La fascia deve durare almeno 1 ora. " + "x".repeat(300); // più lungo del taglio a 200 dei messaggi
  edgeRisponde({ [`PUT ${BASE}/finestra`]: testo(motivo, 400) });
  const r = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.equal(r.ok, false);
  assert.equal(r.error, motivo, "il motivo è tutto il corpo, senza «edge 400:» e senza tagli");
  assert.equal(r.status, 400);
  assert.equal(await dentro(async () => getEdgeSchedule(rete)), null);
});

test("saveEdgeSubnetFinestra: 409 col motivo; 404 «Not Found» = sonda da aggiornare, nessuna riga in IPAM", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: testo("Passaggio in corso su un'altra rete", 409) });
  const c = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.deepEqual([c.ok, c.error, c.status], [false, "Passaggio in corso su un'altra rete", 409]);

  edgeRisponde({}); // nessuna rotta della finestra: 404 {"detail":"Not Found"}
  const v = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.equal(v.ok, false);
  assert.equal(v.error, SONDA_DA_AGGIORNARE);
  assert.equal(v.daAggiornare, true);
  assert.equal(await dentro(async () => getEdgeSchedule(rete)), null);
});

test("saveEdgeSubnetFinestra: ensure rifiutato = la PUT non parte", async () => {
  edgeRisponde({ "POST /api/v1/networks/ensure": testo("token senza scope admin", 403) });
  const r = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /scope admin/);
  assert.deepEqual(chiamate(), ["POST /api/v1/networks/ensure"]);
});

test("leggiFinestra: la risposta vera è «ok», e finestra null è una rete senza finestra", async () => {
  edgeRisponde({ [`GET ${BASE}/finestra`]: json(GET_VERA) });
  const s = await dentro(() => leggiFinestra(rete));
  assert.equal(s.stato, "ok");
  if (s.stato === "ok") assert.equal(s.passaggio?.finiti, 2);
  edgeRisponde({ [`GET ${BASE}/finestra`]: json(GET_SENZA) });
  const senza = await dentro(() => leggiFinestra(rete));
  assert.equal(senza.stato, "ok");
  if (senza.stato === "ok") assert.equal(senza.finestra, null);
});

test("leggiFinestra: 404 «Not Found» (rotta assente) = sonda da aggiornare, in JSON e in testo", async () => {
  edgeRisponde({}); // il finto edge risponde 404 JSON a ciò che non conosce
  assert.deepEqual(await dentro(() => leggiFinestra(rete)), { stato: "da_aggiornare" });
  edgeRisponde({ [`GET ${BASE}/finestra`]: testo("Not Found", 404) });
  assert.deepEqual(await dentro(() => leggiFinestra(rete)), { stato: "da_aggiornare" });
});

test("leggiFinestra: il 404 di una rete sconosciuta alla sonda NON è «sonda da aggiornare»", async () => {
  edgeRisponde({ [`GET ${BASE}/finestra`]: testo("Rete edge non trovata", 404) });
  const s = await dentro(() => leggiFinestra(rete));
  assert.equal(s.stato, "errore");
  if (s.stato === "errore") assert.equal(s.messaggio, "Rete edge non trovata");
});

test("leggiFinestra: errori e forme sbagliate si dicono; rete non registrata e sonda spenta hanno il loro stato", async () => {
  edgeRisponde({ [`GET ${BASE}/finestra`]: testo("database locked", 500) });
  const e = await dentro(() => leggiFinestra(rete));
  assert.equal(e.stato, "errore");
  if (e.stato === "errore") assert.match(e.messaggio, /database locked/);

  edgeRisponde({ [`GET ${BASE}/finestra`]: json({ ok: true, finestra: "boh" }) });
  assert.equal((await dentro(() => leggiFinestra(rete))).stato, "errore");

  edgeRisponde({ [`GET ${BASE}/finestra`]: { status: 200, body: "<html>", type: "text/html" } });
  assert.equal((await dentro(() => leggiFinestra(rete))).stato, "errore");

  edgeRisponde({ "GET /api/v1/networks/lookup": json({ found: false }) });
  assert.deepEqual(await dentro(() => leggiFinestra(rete)), { stato: "rete_non_registrata" });

  getTenantDb(T).prepare("UPDATE vuln_scanners SET enabled = 0").run();
  const spenta = await dentro(() => leggiFinestra(rete));
  assert.equal(spenta.stato, "sonda_assente");
  assert.equal(await dentro(() => leggiFinestra(99999)).then((s) => s.stato), "sonda_assente");
});

test("leggiFinestraIp: stato, limit e offset arrivano alla sonda, la pagina si legge", async () => {
  edgeRisponde({
    [`GET ${BASE}/finestra/ip`]: json({
      ok: true, totale: 41,
      ip: [{ ip: "10.0.0.42", stato: "finito", tentativi: 1, ultimo_tentativo_at: "2026-11-05 10:48:00", prossimo_da: null, scan_id: 3 }],
    }),
  });
  const r = await dentro(() => leggiFinestraIp(rete, { stato: "finito", limit: 50, offset: 100 }));
  assert.equal(r.stato, "ok");
  if (r.stato === "ok") assert.deepEqual([r.totale, r.ip[0].ip], [41, "10.0.0.42"]);
  assert.equal(seen.at(-1)?.url, `${BASE}/finestra/ip?stato=finito&limit=50&offset=100`);
  edgeRisponde({});
  assert.deepEqual(await dentro(() => leggiFinestraIp(rete)), { stato: "da_aggiornare" });
});

/** Salva una finestra come farebbe il pannello, poi svuota il registro delle chiamate. */
async function conFinestraSalvata(): Promise<void> {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json(GET_VERA) });
  await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  seen = [];
}

test("tornare a «Orario fisso»: ensure, poi DELETE /finestra, poi PUT /schedule, nell'ordine", async () => {
  await conFinestraSalvata();
  edgeRisponde({
    [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [1] }),
    [`PUT ${BASE}/schedule`]: json({ ok: true }),
  });
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, true);
  assert.deepEqual(chiamate(), [
    "POST /api/v1/networks/ensure",
    "GET /api/v1/networks/lookup",
    `DELETE ${BASE}/finestra`,
    `PUT ${BASE}/schedule`,
  ]);
  const riga = await dentro(async () => getEdgeSchedule(rete));
  assert.equal(riga?.modo, "orario");
  assert.equal(riga?.cron_expr, "0 22 1 * *");
});

test("tornare a «Orario fisso» con la DELETE a 409: si mostra il motivo e l'orario non si salva", async () => {
  await conFinestraSalvata();
  const motivo = "Il gruppo 12 non si è fermato: la finestra è spenta e non è stata cancellata. Riprova fra poco.";
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: testo(motivo, 409), [`PUT ${BASE}/schedule`]: json({ ok: true }) });
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, false);
  assert.equal(r.error, motivo);
  assert.equal(r.status, 409);
  assert.deepEqual(chiamate(), ["POST /api/v1/networks/ensure", "GET /api/v1/networks/lookup", `DELETE ${BASE}/finestra`], "la PUT /schedule non parte");
  const riga = await dentro(async () => getEdgeSchedule(rete));
  assert.equal(riga?.modo, "finestra", "in IPAM la finestra resta com'era");
  assert.equal(riga?.cron_expr, null, "l'orario non è stato scritto");
});

test("ensure rifiutato: la finestra della sonda non si cancella", async () => {
  await conFinestraSalvata();
  edgeRisponde({ "POST /api/v1/networks/ensure": testo("token senza scope admin", 403), [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [] }) });
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, false);
  assert.deepEqual(chiamate(), ["POST /api/v1/networks/ensure"]);
  assert.equal((await dentro(async () => getEdgeSchedule(rete)))?.modo, "finestra");
});

test("DELETE riuscita e PUT /schedule fallita: IPAM non ricorda più la finestra (la sonda non ce l'ha)", async () => {
  await conFinestraSalvata();
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [1] }), [`PUT ${BASE}/schedule`]: testo("database locked", 500) });
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, false);
  assert.deepEqual(chiamate(), ["POST /api/v1/networks/ensure", "GET /api/v1/networks/lookup", `DELETE ${BASE}/finestra`, `PUT ${BASE}/schedule`]);
  assert.equal(await dentro(async () => getEdgeSchedule(rete)), null, "riga solo-finestra: sparita, non resta «finestra»");
});

test("DELETE «non c'era» (sonda senza finestra): IPAM la dimentica anche se l'orario poi non si salva", async () => {
  await conFinestraSalvata();
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: testo("La rete non ha una finestra", 404), [`PUT ${BASE}/schedule`]: testo("database locked", 500) });
  assert.equal((await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO))).ok, false);
  assert.equal(await dentro(async () => getEdgeSchedule(rete)), null);
});

test("l'orario fisso sopravvive a finestra e ritorno: giorni, cron, frequenza e ora restano quelli di prima", async () => {
  const orario = { network_id: rete, job_name: "j", frequency: "weekly", at_time: "22:00", days_of_week: "0,6", day_of_month: null, cron_expr: "0 22 * * 0,6", profile: "balanced", targeting_mode: null, enabled: true };
  await dentro(async () => saveEdgeSchedule(orario));
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json(GET_VERA) });
  await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA)); // giorni 1,2,3
  const dopoFinestra = (await dentro(async () => getEdgeSchedule(rete)))!;
  assert.equal(dopoFinestra.modo, "finestra");
  assert.equal(dopoFinestra.fascia_giorni, "1,2,3");
  assert.equal(dopoFinestra.fascia_attiva, true);
  assert.equal(dopoFinestra.enabled, false, "salvare la finestra spegne l'orario sulla sonda, e la riga lo dice");
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [] }) });
  assert.equal((await dentro(() => removeEdgeSubnetFinestra(rete))).ok, true);
  const dopoRitorno = (await dentro(async () => getEdgeSchedule(rete)))!;
  assert.equal(dopoRitorno.modo, "orario");
  assert.equal(dopoRitorno.days_of_week, "0,6", "i giorni dell'orario non sono quelli della finestra");
  assert.equal(dopoRitorno.cron_expr, "0 22 * * 0,6");
  assert.equal(dopoRitorno.frequency, "weekly");
  assert.equal(dopoRitorno.at_time, "22:00");
  assert.equal(dopoRitorno.enabled, false, "il DELETE della sonda non riaccende l'orario");
});

test("saveEdgeSubnetFinestra: la sonda accetta ma IPAM non riesce a scrivere → ok con l'avviso, non «fallito»", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json({ ...GET_VERA, avviso: null }) });
  const db = getTenantDb(T);
  db.exec("ALTER TABLE edge_scan_schedules RENAME TO edge_scan_schedules_x");
  try {
    const r = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
    assert.equal(r.ok, true);
    assert.match(r.avviso ?? "", /Finestra salvata sulla sonda, memoria locale non aggiornata/);
  } finally {
    db.exec("ALTER TABLE edge_scan_schedules_x RENAME TO edge_scan_schedules");
  }
});

test("saveEdgeSubnetFinestra: scanner spento 409, rete sconosciuta 404", async () => {
  getTenantDb(T).prepare("UPDATE vuln_scanners SET enabled = 0").run();
  const spento = await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  assert.deepEqual([spento.ok, spento.status], [false, 409]);
  getTenantDb(T).prepare("UPDATE vuln_scanners SET enabled = 1").run();
  const ignota = await dentro(() => saveEdgeSubnetFinestra(99999, FINESTRA));
  assert.deepEqual([ignota.ok, ignota.status], [false, 404]);
});

test("una rete a orario fisso si salva come oggi: nessuna DELETE (sonda vecchia, senza finestra, con riga a orario)", async () => {
  const senzaDelete = () => chiamate().filter((c) => c.startsWith("DELETE"));
  const saltaLaLettura = (c: string[]) => c.filter((x) => !x.startsWith("GET "));
  // Sonda vecchia: la lettura della finestra dà 404 «Not Found», l'orario si salva.
  edgeRisponde({ [`PUT ${BASE}/schedule`]: json({ ok: true }) });
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, true);
  assert.deepEqual(senzaDelete(), []);
  assert.deepEqual(saltaLaLettura(chiamate()), ["POST /api/v1/networks/ensure", `PUT ${BASE}/schedule`]);
  // Sonda nuova, rete senza finestra (finestra null), con una riga a orario già salvata.
  seen = [];
  edgeRisponde({ [`GET ${BASE}/finestra`]: json(GET_SENZA), [`PUT ${BASE}/schedule`]: json({ ok: true }) });
  await dentro(async () => saveEdgeSchedule({
    network_id: rete, job_name: "x", frequency: "weekly", at_time: "22:00", days_of_week: "0", day_of_month: null,
    cron_expr: "0 22 * * 0", profile: "balanced", targeting_mode: null, enabled: true,
  }));
  assert.equal((await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO))).ok, true);
  assert.deepEqual(senzaDelete(), []);
  assert.deepEqual(saltaLaLettura(chiamate()), ["POST /api/v1/networks/ensure", `PUT ${BASE}/schedule`]);
});

test("la sonda ha una finestra ma IPAM non la ricorda (riga persa): prima DELETE, poi l'orario", async () => {
  edgeRisponde({
    [`GET ${BASE}/finestra`]: json(GET_VERA),
    [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [1] }),
    [`PUT ${BASE}/schedule`]: json({ ok: true }),
  });
  assert.equal(await dentro(async () => getEdgeSchedule(rete)), null, "in IPAM nessuna riga");
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, true);
  const seq = chiamate().filter((c) => /^(DELETE|PUT|POST)/.test(c));
  assert.deepEqual(seq, ["POST /api/v1/networks/ensure", `DELETE ${BASE}/finestra`, `PUT ${BASE}/schedule`]);
});

test("la sonda non risponde alla lettura della finestra: l'orario si prova a salvare, il 409 della sonda dice il perché", async () => {
  edgeRisponde({
    [`GET ${BASE}/finestra`]: testo("database locked", 500),
    [`PUT ${BASE}/schedule`]: testo("La rete ha una scansione a finestra: cancellala (DELETE /finestra) prima di pianificare a orario.", 409),
  });
  const r = await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO));
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /cancellala \(DELETE \/finestra\)/);
});

test("DELETE su una sonda senza la rotta o senza finestra: non c'è niente da togliere, l'orario si salva", async () => {
  await conFinestraSalvata();
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: testo("La rete non ha una finestra", 404), [`PUT ${BASE}/schedule`]: json({ ok: true }) });
  assert.equal((await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO))).ok, true);

  await conFinestraSalvata();
  edgeRisponde({ [`PUT ${BASE}/schedule`]: json({ ok: true }) }); // DELETE → 404 «Not Found»: sonda vecchia
  assert.equal((await dentro(() => saveEdgeSubnetSchedule(rete, ORARIO))).ok, true);
});

test("removeEdgeSubnetFinestra: la sonda cancella, in IPAM la riga solo-finestra sparisce", async () => {
  await conFinestraSalvata();
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [1] }) });
  assert.deepEqual(await dentro(() => removeEdgeSubnetFinestra(rete)), { ok: true });
  assert.deepEqual(chiamate(), ["GET /api/v1/networks/lookup", `DELETE ${BASE}/finestra`]);
  assert.equal(await dentro(async () => getEdgeSchedule(rete)), null);
});

test("removeEdgeSubnetFinestra: se c'era anche un orario fisso resta, spento", async () => {
  await dentro(async () => saveEdgeSchedule({
    network_id: rete, job_name: "x", frequency: "weekly", at_time: "22:00", days_of_week: "0", day_of_month: null,
    cron_expr: "0 22 * * 0", profile: "balanced", targeting_mode: null, enabled: true,
  }));
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json(GET_VERA) });
  await dentro(() => saveEdgeSubnetFinestra(rete, FINESTRA));
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [] }) });
  assert.equal((await dentro(() => removeEdgeSubnetFinestra(rete))).ok, true);
  const riga = await dentro(async () => getEdgeSchedule(rete));
  assert.equal(riga?.modo, "orario");
  assert.equal(riga?.enabled, false, "il DELETE della sonda non riaccende la pianificazione");
  assert.equal(riga?.cron_expr, "0 22 * * 0");
});

test("removeEdgeSubnetFinestra: 409 col motivo, la finestra resta in IPAM", async () => {
  await conFinestraSalvata();
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: testo("Nel frattempo è partito un altro gruppo: la finestra è spenta, riprova.", 409) });
  const r = await dentro(() => removeEdgeSubnetFinestra(rete));
  assert.deepEqual([r.ok, r.status], [false, 409]);
  assert.match(r.error ?? "", /Nel frattempo è partito un altro gruppo/);
  assert.equal((await dentro(async () => getEdgeSchedule(rete)))?.modo, "finestra");
});

test("EdgeClientError.detail: il corpo intero, senza prefisso; il messaggio resta quello di sempre", async () => {
  edgeRisponde({ "GET /api/v1/prova": testo("a".repeat(500), 400), "GET /api/v1/prova2": json({ detail: "Profilo sconosciuto: x" }, 422) });
  const scanner = getTenantDb(T).prepare("SELECT base_url, token_encrypted, cert_pin FROM vuln_scanners").get() as {
    base_url: string; token_encrypted: string; cert_pin: string | null;
  };
  const e = await edgeApiGet(scanner, "/api/v1/prova").catch((x: unknown) => x);
  assert.ok(e instanceof EdgeClientError);
  assert.equal(e.detail, "a".repeat(500));
  assert.equal(e.message, `edge 400: ${"a".repeat(200)}`);
  const e2 = await edgeApiGet(scanner, "/api/v1/prova2").catch((x: unknown) => x);
  assert.ok(e2 instanceof EdgeClientError);
  assert.equal(e2.detail, "Profilo sconosciuto: x");
  assert.equal(e2.message, "edge 422: Profilo sconosciuto: x");
});

// ── Le rotte: validazione e stati HTTP (il lavoro sta in finestra-rotte.ts, guardia e tenant nelle rotte) ──

const CORPO = {
  enabled: true, giorni: [1, 2, 3], dalle: "08:00", alle: "20:00", ripeti: "mese", ip_per_gruppo: 10, tentativi: 3,
  profile: "balanced", targeting_mode: "full_subnet",
};
const corpoDi = (r: { body: unknown }) => r.body as Record<string, unknown>;

test("rotta PUT: corpo non valido 400 (JSON illeggibile, giorni vuoti, fascia scritta male), la sonda non è chiamata", async () => {
  for (const corpo of [undefined, { ...CORPO, giorni: [] }, { ...CORPO, dalle: "25:00" }, { ...CORPO, ip_per_gruppo: 21 }]) {
    const r = await dentro(() => salvaFinestraRotta(rete, corpo));
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(typeof corpoDi(r).error, "string");
  }
  assert.deepEqual(chiamate(), []);
});

test("rotta PUT: un modo di invio sconosciuto è 400, uno valido arriva alla sonda", async () => {
  const r = await dentro(() => salvaFinestraRotta(rete, { ...CORPO, invio: "domani" }));
  assert.equal(r.status, 400);
  assert.deepEqual(chiamate(), []);
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json(GET_VERA), [`GET ${BASE}/finestra`]: json(GET_VERA) });
  const ok = await dentro(() => salvaFinestraRotta(rete, { ...CORPO, invio: "passaggio" }));
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(seen[1].body).invio, "passaggio");
});

test("rotta PUT: un 400 della sonda resta 400 col motivo, un 409 resta 409, un guasto è 502, sonda vecchia 409 con daAggiornare", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: testo("La fascia deve durare almeno 1 ora.", 400) });
  let r = await dentro(() => salvaFinestraRotta(rete, CORPO));
  assert.deepEqual([r.status, corpoDi(r).error, corpoDi(r).daAggiornare], [400, "La fascia deve durare almeno 1 ora.", false]);
  edgeRisponde({ [`PUT ${BASE}/finestra`]: testo("Un altro passaggio è aperto", 409) });
  r = await dentro(() => salvaFinestraRotta(rete, CORPO));
  assert.deepEqual([r.status, corpoDi(r).error], [409, "Un altro passaggio è aperto"]);
  edgeRisponde({ [`PUT ${BASE}/finestra`]: testo("database locked", 500) });
  r = await dentro(() => salvaFinestraRotta(rete, CORPO));
  assert.equal(r.status, 502);
  edgeRisponde({});
  r = await dentro(() => salvaFinestraRotta(rete, CORPO));
  assert.deepEqual([r.status, corpoDi(r).daAggiornare, corpoDi(r).error], [409, true, SONDA_DA_AGGIORNARE]);
});

test("rotta PUT: salvataggio riuscito 200 con l'avviso e lo stato nuovo letto dalla sonda", async () => {
  edgeRisponde({ [`PUT ${BASE}/finestra`]: json({ ...GET_VERA, avviso: "L'inventario della rete è vuoto: si scansiona tutta la rete." }), [`GET ${BASE}/finestra`]: json(GET_VERA) });
  const r = await dentro(() => salvaFinestraRotta(rete, CORPO));
  assert.equal(r.status, 200);
  assert.equal(corpoDi(r).avviso, "L'inventario della rete è vuoto: si scansiona tutta la rete.");
  assert.equal((corpoDi(r).finestra as { stato: string }).stato, "ok");
});

test("rotta DELETE: 409 della sonda resta 409 col motivo, guasto 502, rete sconosciuta 404, riuscita 200", async () => {
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: testo("Il gruppo 9 non si è fermato", 409) });
  let r = await dentro(() => cancellaFinestraRotta(rete));
  assert.deepEqual([r.status, corpoDi(r).error], [409, "Il gruppo 9 non si è fermato"]);
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: testo("database locked", 500) });
  assert.equal((await dentro(() => cancellaFinestraRotta(rete))).status, 502);
  assert.equal((await dentro(() => cancellaFinestraRotta(99999))).status, 404);
  edgeRisponde({ [`DELETE ${BASE}/finestra`]: json({ ok: true, annullati: [] }), [`GET ${BASE}/finestra`]: json(GET_SENZA) });
  r = await dentro(() => cancellaFinestraRotta(rete));
  assert.equal(r.status, 200);
});

test("rotta /ip: stato, limit e offset sbagliati 400; validi arrivano alla sonda; sonda vecchia 200 col suo stato", async () => {
  for (const q of ["stato=boh", "limit=0", "limit=1001", "limit=abc", "offset=-1"]) {
    assert.equal((await dentro(() => elencoIpRotta(rete, new URLSearchParams(q)))).status, 400, q);
  }
  assert.deepEqual(chiamate(), []);
  edgeRisponde({ [`GET ${BASE}/finestra/ip`]: json({ ok: true, totale: 0, ip: [] }) });
  const ok = await dentro(() => elencoIpRotta(rete, new URLSearchParams("stato=assente&limit=5&offset=10")));
  assert.equal(ok.status, 200);
  assert.equal(seen.at(-1)?.url, `${BASE}/finestra/ip?stato=assente&limit=5&offset=10`);
  edgeRisponde({});
  const vecchia = await dentro(() => elencoIpRotta(rete, new URLSearchParams()));
  assert.deepEqual([vecchia.status, corpoDi(vecchia).stato], [200, "da_aggiornare"]);
});

// ── Schedulazioni, colonne nuove, permessi ──────────────────────────────────────────────────────

test("Schedulazioni: una rete a finestra si legge come fascia, non come un cron vuoto", async () => {
  await conFinestraSalvata();
  const righe = await dentro(() => elencoSchedulazioni(new Date("2026-11-05T08:00:00Z")));
  const riga = righe.find((r) => r.id === `edge.${rete}`);
  assert.ok(riga, "la riga della rete c'è");
  assert.equal(riga.quando, "lun/mar/mer dalle 08:00 alle 20:00, ogni mese");
  assert.equal(riga.stato, "acceso");
});

test("edge_scan_schedules: le righe di prima restano a orario, con le colonne nuove vuote", async () => {
  await dentro(async () => saveEdgeSchedule({
    network_id: rete, job_name: "x", frequency: "daily", at_time: "03:00", days_of_week: null, day_of_month: null,
    cron_expr: "0 3 * * *", profile: "fast", targeting_mode: null, enabled: false,
  }));
  const riga = await dentro(async () => getEdgeSchedule(rete));
  assert.deepEqual(
    [riga?.modo, riga?.fascia_dalle, riga?.fascia_alle, riga?.ip_per_gruppo, riga?.tentativi, riga?.ripeti],
    ["orario", null, null, null, null, null],
  );
  const colonne = (getTenantDb(T).prepare("PRAGMA table_info(edge_scan_schedules)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>);
  const modo = colonne.find((c) => c.name === "modo");
  assert.equal(modo?.dflt_value, "'orario'");
  assert.equal(modo?.notnull, 1);
});

test("permessi: le quattro rotte nuove ci sono, le letture chiedono la sessione, le scritture l'admin", () => {
  const radice = process.cwd();
  const albero = gestoriDellAlbero(radice);
  const consentiti = consentitiDaAuthConfig(readFileSync(join(radice, "src", "lib", "auth.config.ts"), "utf8"));
  const dove = (rotta: string, metodo: string) => albero.gestori.find((g) => g.rotta === rotta && g.metodo === metodo);
  const finestra = "/api/networks/[id]/edge-scan/finestra";
  const attese: Array<[string, string, string]> = [
    [finestra, "GET", "auth"],
    [finestra, "PUT", "admin"],
    [finestra, "DELETE", "admin"],
    [`${finestra}/ip`, "GET", "auth"],
  ];
  for (const [rotta, metodo, guardia] of attese) {
    const g = dove(rotta, metodo);
    assert.ok(g, `${metodo} ${rotta} non esiste`);
    assert.equal(g.guardia, guardia, `${metodo} ${rotta}`);
  }
  const { problemi, valutazioni } = censisci(albero.gestori, consentiti);
  assert.deepEqual(problemi, []);
  for (const [rotta, metodo] of attese) {
    const v = valutazioni.find((x) => x.rotta === rotta && x.metodo === metodo);
    assert.equal(v?.esito, "ok", `${metodo} ${rotta}: ${v?.nota}`);
  }
});
