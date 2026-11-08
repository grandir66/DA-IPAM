/**
 * Pianificazione «Per device» (piano profili-per-device, Passo 6, 08/11/2026; tavola oggetti 27-31).
 *
 * Perché: Riccardo ha deciso l'08/11 che all'ora fissata sia DA-IPAM a lanciare i gruppi confermati in quel
 * momento, una pianificazione per rete, una sola per rete. Qui: l'ora italiana (anche al cambio dell'ora
 * legale), DA-IPAM spento da più di 2 ore = giro saltato e detto, la prossima che avanza prima del lancio
 * (un lancio in errore non riparte al minuto dopo), l'esito in una frase, «Un profilo solo» che si spegne.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/proposta/__tests__/pianificazione.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  decisione, istanteRoma, leggiPianificazione, prossimaEsecuzione, riassuntoEsito, salvaPianificazione, scadute, spegniPianificazione,
} from "@/lib/vuln/proposta/pianificazione";
import { eseguiScadute } from "@/lib/vuln/proposta/pianificazione-job";
import { descriviUnProfilo } from "@/lib/vuln/proposta/pianificazione-rete";
import type { EsitoLancio } from "@/lib/vuln/proposta/lancio";
import type { EdgeScheduleConfig } from "@/lib/vuln/edge-schedule-store";

const T = "TESTPIANIF08";
after(() => { deleteTenantDatabase(T); closeHubDb(); });

function rete(id: number): void {
  getTenantDb(T).prepare(`INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (?, ?, ?)`).run(id, `10.80.${id}.0/24`, `rete ${id}`);
}

test("ora italiana: domenica 02:00, anche dopo il ritorno all'ora solare", () => {
  // Sabato 24/10/2026 12:00 UTC (ora legale): la domenica dopo è il 25/10, giorno del cambio, ore 02:00 = 01:00 UTC.
  const p = prossimaEsecuzione({ frequenza: "settimanale", giorno: 0, ora: "02:00" }, new Date("2026-10-24T12:00:00Z"));
  assert.equal(p.toISOString(), "2026-10-25T01:00:00.000Z");
  // In inverno 02:00 italiane = 01:00 UTC, in estate 00:00 UTC.
  assert.equal(istanteRoma(2026, 7, 5, 2, 0).toISOString(), "2026-07-05T00:00:00.000Z");
  assert.equal(istanteRoma(2026, 12, 6, 2, 0).toISOString(), "2026-12-06T01:00:00.000Z");
});

test("giornaliera e mensile: la prossima è sempre dopo adesso", () => {
  const adesso = new Date("2026-11-08T01:30:00Z"); // 02:30 italiane
  assert.equal(prossimaEsecuzione({ frequenza: "giornaliera", giorno: null, ora: "02:00" }, adesso).toISOString(), "2026-11-09T01:00:00.000Z");
  assert.equal(prossimaEsecuzione({ frequenza: "giornaliera", giorno: null, ora: "03:00" }, adesso).toISOString(), "2026-11-08T02:00:00.000Z");
  assert.equal(prossimaEsecuzione({ frequenza: "mensile", giorno: 1, ora: "02:00" }, adesso).toISOString(), "2026-12-01T01:00:00.000Z");
});

test("decisione: aspetta, esegue entro 2 ore, salta oltre", () => {
  const p = { attiva: true, prossima_il: "2026-11-08T01:00:00.000Z" };
  assert.equal(decisione(p, new Date("2026-11-08T00:59:00Z")), "aspetta");
  assert.equal(decisione(p, new Date("2026-11-08T01:00:00Z")), "esegui");
  assert.equal(decisione(p, new Date("2026-11-08T03:00:00Z")), "esegui");
  assert.equal(decisione(p, new Date("2026-11-08T03:00:01Z")), "salta");
  assert.equal(decisione({ ...p, attiva: false }, new Date("2026-11-08T01:30:00Z")), "aspetta");
});

const lanciato = (scan: number) => ({ stato: "lanciato" as const, scan_id: scan, status: "running", ip_tolti: [] });
const gruppo = (famiglia: "rete" | "linux" | "windows", esito: EsitoLancio["gruppi"][number]["esito"]) =>
  ({ famiglia, ips: ["10.0.0.1"], profile: "balanced", nuclei_profilo: null, assessment_profile_id: null, avviso: null, esito }) as unknown as EsitoLancio["gruppi"][number];

test("esito: gruppi partiti, famiglia saltata, giro precedente in corso, impianti tolti", () => {
  const e: EsitoLancio = {
    gruppi: [gruppo("rete", lanciato(10)), gruppo("linux", { stato: "gia_in_corso", scan_id: 9, messaggio: "x" })],
    tolti: [{ host_id: 1, ip: "10.0.0.50", motivo: "è un impianto o un apparato di campo: non si scansiona" }],
    avvisi: [], errore: null, fermato: false,
  };
  const r = riassuntoEsito(e, ["rete", "linux", "windows"]);
  assert.equal(r.testo, "1 gruppo su 3 partiti · Windows saltato: nessun device confermato · Linux e server: giro precedente ancora in corso · 1 impianto tolto");
  assert.equal(r.tono, "avviso");
  assert.deepEqual(riassuntoEsito({ gruppi: [gruppo("rete", lanciato(1))], tolti: [], avvisi: [], errore: null, fermato: false }, ["rete"]), { testo: "1 gruppo su 1 partiti", tono: "ok" });
  assert.equal(riassuntoEsito({ gruppi: [], tolti: [], avvisi: [], errore: "Sonda non configurata", fermato: true }, ["rete"]).tono, "errore");
  const vecchia = riassuntoEsito({ gruppi: [gruppo("rete", { stato: "da_aggiornare" })], tolti: [], avvisi: [], errore: null, fermato: true }, ["rete"]);
  assert.equal(vecchia.tono, "errore");
  assert.match(vecchia.testo, /Sonda da aggiornare/);
});

test("archivio: salva, una per rete, spegne senza cancellare", () => {
  withTenant(T, () => {
    rete(1);
    const p = salvaPianificazione({ network_id: 1, famiglie: ["rete", "linux"], frequenza: "settimanale", giorno: 0, ora: "02:00", chi: "riccardo" }, new Date("2026-11-08T12:00:00Z"));
    assert.equal(p.prossima_il, "2026-11-15T01:00:00.000Z");
    salvaPianificazione({ network_id: 1, famiglie: ["windows"], frequenza: "giornaliera", giorno: null, ora: "01:00", chi: "riccardo" }, new Date("2026-11-08T12:00:00Z"));
    const ora = leggiPianificazione(1)!;
    assert.deepEqual(ora.famiglie, ["windows"]);
    assert.equal((getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM va_pianificazioni_device").get() as { n: number }).n, 1);
    assert.equal(spegniPianificazione(1, "Spenta per prova"), true);
    const spenta = leggiPianificazione(1)!;
    assert.equal(spenta.attiva, false);
    assert.equal(spenta.prossima_il, null);
    assert.equal(spenta.ultimo_tono, "spento");
    assert.equal(spegniPianificazione(1), false, "già spenta: niente da fare");
  });
});

test("giro: lancia le scadute, avanza la prossima prima del lancio, registra l'esito", async () => {
  await withTenant(T, async () => {
    rete(2);
    rete(3);
    salvaPianificazione({ network_id: 2, famiglie: ["rete"], frequenza: "giornaliera", giorno: null, ora: "02:00", chi: "r" }, new Date("2026-11-07T12:00:00Z"));
    salvaPianificazione({ network_id: 3, famiglie: ["linux"], frequenza: "giornaliera", giorno: null, ora: "02:00", chi: "r" }, new Date("2026-11-07T12:00:00Z"));
    const ordine: string[] = [];
    const n = await eseguiScadute(new Date("2026-11-08T01:00:30Z"), {
      lancia: async (id) => {
        ordine.push(`lancia ${id}; prossima ${leggiPianificazione(id)!.prossima_il}`);
        if (id === 3) throw new Error("sonda giù");
        return { gruppi: [gruppo("rete", lanciato(5))], tolti: [], avvisi: [], errore: null, fermato: false };
      },
    });
    assert.equal(n, 1);
    assert.deepEqual(ordine, ["lancia 2; prossima 2026-11-09T01:00:00.000Z", "lancia 3; prossima 2026-11-09T01:00:00.000Z"]);
    assert.equal(leggiPianificazione(2)!.ultimo_esito, "1 gruppo su 1 partiti");
    assert.equal(leggiPianificazione(3)!.ultimo_esito, "Non partita: sonda giù");
    assert.equal(leggiPianificazione(3)!.ultimo_tono, "errore");
    assert.equal(scadute(new Date("2026-11-08T01:01:30Z")).length, 0, "nessuna riparte al minuto dopo");
  });
});

test("giro: DA-IPAM spento oltre 2 ore, la pianificazione salta e lo dice", async () => {
  await withTenant(T, async () => {
    rete(4);
    salvaPianificazione({ network_id: 4, famiglie: ["rete"], frequenza: "giornaliera", giorno: null, ora: "02:00", chi: "r" }, new Date("2026-11-07T12:00:00Z"));
    let lanciata = false;
    await eseguiScadute(new Date("2026-11-08T06:00:00Z"), { lancia: async () => { lanciata = true; throw new Error("no"); } });
    assert.equal(lanciata, false);
    const p = leggiPianificazione(4)!;
    assert.equal(p.ultimo_esito, "Saltata: DA-IPAM spento alle 02:00");
    assert.equal(p.prossima_il, "2026-11-09T01:00:00.000Z");
  });
});

test("«Un profilo solo»: descritta se accesa, nulla se spenta", () => {
  const base: EdgeScheduleConfig = {
    network_id: 1, job_name: null, frequency: "weekly", at_time: "03:00", days_of_week: "6", day_of_month: null, cron_expr: "0 3 * * 6",
    profile: "balanced", targeting_mode: null, enabled: true, modo: "orario", fascia_dalle: null, fascia_alle: null, ip_per_gruppo: null,
    tentativi: null, ripeti: null, fascia_giorni: null, fascia_attiva: null,
  };
  assert.equal(descriviUnProfilo(base), "Bilanciato, ogni sab alle 03:00");
  assert.equal(descriviUnProfilo({ ...base, enabled: false }), null);
  assert.equal(descriviUnProfilo({ ...base, modo: "finestra", enabled: false, fascia_attiva: true, fascia_dalle: "22:00", fascia_alle: "06:00", fascia_giorni: "1,2" }), "a finestra, dalle 22:00 alle 06:00 (lun, mar)");
  assert.equal(descriviUnProfilo({ ...base, modo: "finestra", fascia_attiva: false }), null);
  assert.equal(descriviUnProfilo(null), null);
});

test("pagina Schedulazioni: la pianificazione è una riga «device.<rete>» con esito e prossimo giro", async () => {
  const { elencoSchedulazioni } = await import("@/lib/schedulazioni/elenco");
  await withTenant(T, async () => {
    rete(5);
    salvaPianificazione({ network_id: 5, famiglie: ["rete", "linux"], frequenza: "settimanale", giorno: 0, ora: "02:00", chi: "r" }, new Date("2026-11-08T12:00:00Z"));
    const riga = (await elencoSchedulazioni(new Date("2026-11-08T12:00:00Z"))).find((r) => r.id === "device.5");
    assert.ok(riga, "manca la riga della pianificazione");
    assert.equal(riga.su, "rete 5");
    assert.equal(riga.quando, "ogni domenica alle 02:00");
    assert.equal(riga.prossimo, "2026-11-15 01:00:00");
    assert.equal(riga.stato, "acceso");
    assert.match(riga.cosa, /^Rete, Linux e server · /);
  });
});
