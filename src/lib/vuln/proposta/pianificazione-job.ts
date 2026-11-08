/**
 * Giro delle pianificazioni «Per device» (Passo 6, 08/11/2026), avviato da `server.ts` come la lettura del trunk.
 * Ogni minuto, cliente per cliente: le pianificazioni accese con l'ora passata partono (o saltano se DA-IPAM
 * era spento da più di 2 ore). La prossima avanza PRIMA del lancio: un lancio lento o in errore non riparte
 * al minuto dopo. Stato su globalThis: rotte e `server.ts` hanno istanze diverse.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { saveEdgeFinestraDevice } from "@/lib/vuln/edge-subnet-bridge";
import { consensoInVigore } from "@/lib/vuln/registro-impianti";
import { firmaGruppi, gruppiFinestra, type GruppoFinestra } from "./finestra-device";
import { lanciaGruppiConfermati, type EsitoLancio } from "./lancio";
import {
  avanzaProssima, decisione, finestreDevice, registraEsito, registraFirma, riassuntoEsito, scadute, type FasciaDevice, type Pianificazione,
} from "./pianificazione";

export const CRON_PIANIFICAZIONI = "* * * * *";

interface StatoGiro { inCorso: boolean; avviato: boolean }
const g = globalThis as typeof globalThis & { __pianificazioniDevice?: StatoGiro };
const stato = (): StatoGiro => (g.__pianificazioniDevice ??= { inCorso: false, avviato: false });

export interface DipendenzeGiro {
  scadute: (adesso: Date) => Pianificazione[];
  lancia: (networkId: number, famiglie: Pianificazione["famiglie"]) => Promise<EsitoLancio>;
  avanza: (p: Pianificazione, adesso: Date) => void;
  registra: (networkId: number, il: Date, testo: string, tono: ReturnType<typeof riassuntoEsito>["tono"]) => void;
  /** Tappa 2: un consenso copre ADESSO gli impianti della rete? Non so = no. */
  consenso: (networkId: number) => Promise<boolean>;
}

const REALI: DipendenzeGiro = {
  scadute,
  lancia: (n, famiglie) => lanciaGruppiConfermati(n, {}, { famiglie, chi: "Pianificazione" }),
  avanza: avanzaProssima,
  registra: registraEsito,
  consenso: consensoInVigore,
};

const oraItaliana = (iso: string) =>
  new Date(iso).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });

/** Le pianificazioni scadute di UN cliente (già dentro `withTenant`). Esportata per le prove. */
export async function eseguiScadute(adesso: Date, deps: Partial<DipendenzeGiro> = {}): Promise<number> {
  const d = { ...REALI, ...deps };
  let partite = 0;
  for (const p of d.scadute(adesso)) {
    const cosa = decisione(p, adesso);
    if (cosa === "aspetta") continue;
    const previsto = p.prossima_il!;
    d.avanza(p, adesso);
    if (cosa === "salta") {
      d.registra(p.network_id, adesso, `Saltata: DA-IPAM spento alle ${oraItaliana(previsto)}`, "spento");
      continue;
    }
    try {
      // Tappa 2 (08/11/2026): gli impianti entrano solo se un consenso copre quest'ora; altrimenti restano fuori e
      // l'esito lo dice. Il consenso lo ricontrolla comunque la sonda al lancio.
      const famiglie = p.famiglie.includes("impianti") && !(await d.consenso(p.network_id))
        ? p.famiglie.filter((f) => f !== "impianti")
        : p.famiglie;
      const esito = await d.lancia(p.network_id, famiglie);
      const r = riassuntoEsito(esito, p.famiglie);
      d.registra(p.network_id, adesso, r.testo, r.tono);
      partite++;
    } catch (e) {
      d.registra(p.network_id, adesso, `Non partita: ${e instanceof Error ? e.message : "errore sconosciuto"}`, "errore");
    }
  }
  return partite;
}

// ── Finestra «Per device» (tappa 3) ─────────────────────────────────────────────────────────────────

/** Una sonda che non risponde si riprova dopo questo tempo, non a ogni minuto. */
export const RIPROVA_FINESTRA_MS = 10 * 60_000;
const gf = globalThis as typeof globalThis & { __finestreDeviceTentate?: Map<string, number> };
const tentate = (): Map<string, number> => (gf.__finestreDeviceTentate ??= new Map());

export interface DipendenzeFinestre {
  finestre: () => Pianificazione[];
  gruppi: (networkId: number, famiglie: Pianificazione["famiglie"]) => Promise<GruppoFinestra[]>;
  invia: (networkId: number, fascia: FasciaDevice, gruppi: GruppoFinestra[]) => Promise<{ ok: true } | { ok: false; error: string }>;
  adesso: () => Date;
  /** Chiave del cliente nei tentativi: la stessa rete esiste in clienti diversi. */
  cliente: string;
}

const FINESTRE_REALI: DipendenzeFinestre = {
  finestre: finestreDevice,
  gruppi: async (n, famiglie) => gruppiFinestra(n, famiglie),
  invia: saveEdgeFinestraDevice,
  adesso: () => new Date(),
  cliente: "",
};

/**
 * Le finestre «Per device» accese di UN cliente (già dentro `withTenant`): se i gruppi confermati sono cambiati dall'ultimo
 * invio, si rimandano alla sonda (un device escluso deve smettere di partire, uno incluso deve entrare). Esportata per le prove.
 */
export async function allineaFinestre(deps: Partial<DipendenzeFinestre> = {}): Promise<number> {
  const d = { ...FINESTRE_REALI, ...deps };
  let inviate = 0;
  for (const p of d.finestre()) {
    if (!p.fascia) continue;
    const gruppi = await d.gruppi(p.network_id, p.famiglie);
    const firma = firmaGruppi(gruppi);
    if (firma === p.firma_gruppi) continue;
    const chiave = `${d.cliente}:${p.network_id}`;
    const ultima = tentate().get(chiave);
    const ora = d.adesso().getTime();
    if (ultima !== undefined && ora - ultima < RIPROVA_FINESTRA_MS) continue;
    tentate().set(chiave, ora);
    const r = await d.invia(p.network_id, p.fascia, gruppi);
    if (r.ok) {
      tentate().delete(chiave);
      registraFirma(p.network_id, firma);
      registraEsito(p.network_id, d.adesso(), `Gruppi aggiornati sulla sonda: ${gruppi.reduce((t, g) => t + g.ips.length, 0)} device`, "ok");
      inviate++;
    } else {
      registraEsito(p.network_id, d.adesso(), `Gruppi non aggiornati sulla sonda: ${r.error}. Si riprova fra 10 minuti.`, "errore");
    }
  }
  return inviate;
}

export async function giroPianificazioni(adesso = new Date()): Promise<void> {
  const s = stato();
  if (s.inCorso) return;
  s.inCorso = true;
  try {
    for (const t of getActiveTenants()) {
      try {
        await withTenant(t.codice_cliente, async () => {
          const n = await eseguiScadute(adesso);
          if (n > 0) console.info(`[pianificazioni-device] ${t.codice_cliente}: ${n} ${n === 1 ? "rete lanciata" : "reti lanciate"}`);
          const f = await allineaFinestre({ cliente: t.codice_cliente });
          if (f > 0) console.info(`[pianificazioni-device] ${t.codice_cliente}: gruppi aggiornati su ${f} ${f === 1 ? "finestra" : "finestre"}`);
        });
      } catch (e) {
        console.warn(`[pianificazioni-device] ${t.codice_cliente}: giro non riuscito: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    s.inCorso = false;
  }
}

/** Avvia il cron; un secondo avvio (riavvio a caldo) non crea altri timer. */
export function avviaPianificazioniDevice(): void {
  const s = stato();
  if (s.avviato) return;
  s.avviato = true;
  cron.schedule(CRON_PIANIFICAZIONI, () => void giroPianificazioni());
}
