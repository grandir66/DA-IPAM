/**
 * Pezzi puri della scheda UPS (09/11/2026): striscia dei numeri (rete elettrica, batteria, autonomia, carico, ultimo
 * test, allarmi), soglie d'attenzione e righe di dettaglio. Legge `device_info.ups_inventory` come lo scrive
 * `ups-acquisition.ts`. Niente DB né React. Senza dato: la casella/riga non si rende.
 */
import type { UpsInventorySnapshot } from "@/lib/devices/device-info";
import type { Casella } from "@/components/scheda/striscia-numeri";

/** Soglie d'attenzione: batteria ≤ 30%, autonomia < 10 minuti, carico ≥ 80%. */
export const SOGLIE_UPS = { caricaMin: 30, autonomiaMin: 10, caricoMax: 80 } as const;

const STATI_BATTERIA_GUASTI = new Set(["bassa", "esaurita", "guasta"]);
const TEST_CATTIVI = new Set(["errore", "avviso", "non valido", "interrotto"]);

/** «1 h 25 min», «12 min», «0 min». */
export function fmtAutonomia(minuti: number): string {
  if (minuti < 60) return `${minuti} min`;
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** La batteria va guardata: stato non normale, carica bassa o sostituzione richiesta. */
export function batteriaInAllarme(snap: UpsInventorySnapshot | null): boolean {
  const b = snap?.battery;
  if (!b) return false;
  if (b.status && STATI_BATTERIA_GUASTI.has(b.status)) return true;
  if (b.replace_needed === true) return true;
  return typeof b.charge_pct === "number" && b.charge_pct <= SOGLIE_UPS.caricaMin;
}

/** Rete elettrica in parole: «presente», «assente — su batteria», o la sorgente d'uscita se non dice di più. */
export function testoRete(snap: UpsInventorySnapshot): string | null {
  if (snap.rete_presente === true) return "presente";
  if (snap.rete_presente === false) return "assente";
  return snap.output_source ?? null;
}

/** La rete va guardata: assente, oppure uscita in bypass o spenta (il carico non è protetto). */
export function reteInAllarme(snap: UpsInventorySnapshot): boolean {
  if (snap.rete_presente === false) return true;
  return !!snap.output_source && /bypass|spento|riavvio/.test(snap.output_source);
}

/** Caselle della striscia: solo quelle con dato, al massimo sei. Ogni casella apre la tab «UPS». */
export function caselleUps(snap: UpsInventorySnapshot | null): Casella[] {
  if (!snap) return [];
  const out: Casella[] = [];

  const rete = testoRete(snap);
  if (rete) {
    out.push({
      etichetta: "Rete elettrica",
      valore: rete,
      sotto: snap.rete_presente === false ? "l'UPS va a batteria" : snap.output_source && snap.output_source !== "rete" ? `uscita: ${snap.output_source}` : undefined,
      attenzione: reteInAllarme(snap),
      tab: "ups",
    });
  }

  const b = snap.battery;
  if (b && (typeof b.charge_pct === "number" || b.status)) {
    out.push({
      etichetta: "Batteria",
      valore: typeof b.charge_pct === "number" ? `${b.charge_pct}%` : b.status ?? "",
      sotto: b.replace_needed ? "da sostituire" : typeof b.charge_pct === "number" && b.status ? b.status : undefined,
      attenzione: batteriaInAllarme(snap),
      tab: "ups",
    });
  }
  if (b && typeof b.runtime_min === "number") {
    out.push({
      etichetta: "Autonomia",
      valore: fmtAutonomia(b.runtime_min),
      sotto: "stimata col carico attuale",
      attenzione: b.runtime_min < SOGLIE_UPS.autonomiaMin,
      tab: "ups",
    });
  }

  const o = snap.output;
  if (o && typeof o.load_pct === "number") {
    out.push({
      etichetta: "Carico",
      valore: `${o.load_pct}%`,
      sotto: typeof o.power_w === "number" ? `${o.power_w.toLocaleString("it-IT")} W` : undefined,
      attenzione: o.load_pct >= SOGLIE_UPS.caricoMax,
      tab: "ups",
    });
  }

  const t = snap.last_test;
  if (t?.result) {
    out.push({ etichetta: "Ultimo test", valore: t.result, sotto: t.date ?? undefined, attenzione: TEST_CATTIVI.has(t.result), tab: "ups" });
  }

  if (typeof snap.alarms === "number" && snap.alarms > 0) {
    out.push({ etichetta: "Allarmi", valore: String(snap.alarms), attenzione: true, tab: "ups" });
  }
  return out;
}

export type RigaUps = { etichetta: string; valore: string; attenzione?: boolean };

const num = (n: number | null | undefined, unita: string, decimali = 0): string | null =>
  typeof n === "number" ? `${n.toLocaleString("it-IT", { maximumFractionDigits: decimali })} ${unita}`.trim() : null;

function righe(coppie: Array<[string, string | null | undefined, boolean?]>): RigaUps[] {
  return coppie
    .filter((c): c is [string, string, boolean?] => typeof c[1] === "string" && c[1] !== "")
    .map(([etichetta, valore, attenzione]) => ({ etichetta, valore, ...(attenzione ? { attenzione: true } : {}) }));
}

/** Riquadri della tab «UPS»: identità, batteria, rete e uscita, ultimo test. Un riquadro senza righe non si rende. */
export function riquadriUps(snap: UpsInventorySnapshot): Array<{ titolo: string; righe: RigaUps[] }> {
  const b = snap.battery ?? {};
  const i = snap.input ?? {};
  const o = snap.output ?? {};
  const t = snap.last_test ?? {};
  return [
    {
      titolo: "UPS",
      righe: righe([
        ["Produttore", snap.manufacturer],
        ["Modello", snap.model],
        ["Seriale", snap.serial],
        ["Firmware", snap.firmware],
      ]),
    },
    {
      titolo: "Batteria",
      righe: righe([
        ["Stato", b.status, !!b.status && STATI_BATTERIA_GUASTI.has(b.status)],
        ["Carica", num(b.charge_pct, "%"), typeof b.charge_pct === "number" && b.charge_pct <= SOGLIE_UPS.caricaMin],
        ["Autonomia stimata", typeof b.runtime_min === "number" ? fmtAutonomia(b.runtime_min) : null, typeof b.runtime_min === "number" && b.runtime_min < SOGLIE_UPS.autonomiaMin],
        ["Sostituzione", b.replace_needed === true ? "richiesta" : b.replace_needed === false ? "non serve" : null, b.replace_needed === true],
        ["Ultima sostituzione", b.last_replaced],
        ["Temperatura", num(b.temperature_c, "°C")],
        ["Tensione", num(b.voltage_v, "V", 1)],
        ["Su batteria da", typeof b.seconds_on_battery === "number" && b.seconds_on_battery > 0 ? fmtAutonomia(Math.round(b.seconds_on_battery / 60)) : null, true],
      ]),
    },
    {
      titolo: "Rete elettrica e uscita",
      righe: righe([
        ["Rete in ingresso", testoRete(snap), reteInAllarme(snap)],
        ["Tensione in ingresso", num(i.voltage_v, "V")],
        ["Frequenza in ingresso", num(i.frequency_hz, "Hz", 1)],
        ["Ultimo passaggio a batteria", i.fail_cause],
        ["Uscita da", snap.output_source],
        ["Carico", num(o.load_pct, "%"), typeof o.load_pct === "number" && o.load_pct >= SOGLIE_UPS.caricoMax],
        ["Potenza in uscita", num(o.power_w, "W")],
        ["Tensione in uscita", num(o.voltage_v, "V")],
        ["Frequenza in uscita", num(o.frequency_hz, "Hz", 1)],
      ]),
    },
    {
      titolo: "Ultimo test",
      righe: righe([
        ["Esito", t.result, !!t.result && TEST_CATTIVI.has(t.result)],
        ["Data", t.date],
        ["Dettaglio", t.detail],
      ]),
    },
  ].filter((r) => r.righe.length > 0);
}
