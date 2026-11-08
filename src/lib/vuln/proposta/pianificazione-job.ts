/**
 * Giro delle pianificazioni «Per device» (Passo 6, 08/11/2026), avviato da `server.ts` come la lettura del trunk.
 * Ogni minuto, cliente per cliente: le pianificazioni accese con l'ora passata partono (o saltano se DA-IPAM
 * era spento da più di 2 ore). La prossima avanza PRIMA del lancio: un lancio lento o in errore non riparte
 * al minuto dopo. Stato su globalThis: rotte e `server.ts` hanno istanze diverse.
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant } from "@/lib/db-tenant";
import { lanciaGruppiConfermati, type EsitoLancio } from "./lancio";
import { avanzaProssima, decisione, registraEsito, riassuntoEsito, scadute, type Pianificazione } from "./pianificazione";

export const CRON_PIANIFICAZIONI = "* * * * *";

interface StatoGiro { inCorso: boolean; avviato: boolean }
const g = globalThis as typeof globalThis & { __pianificazioniDevice?: StatoGiro };
const stato = (): StatoGiro => (g.__pianificazioniDevice ??= { inCorso: false, avviato: false });

export interface DipendenzeGiro {
  scadute: (adesso: Date) => Pianificazione[];
  lancia: (networkId: number, famiglie: Pianificazione["famiglie"]) => Promise<EsitoLancio>;
  avanza: (p: Pianificazione, adesso: Date) => void;
  registra: (networkId: number, il: Date, testo: string, tono: ReturnType<typeof riassuntoEsito>["tono"]) => void;
}

const REALI: DipendenzeGiro = {
  scadute,
  lancia: (n, famiglie) => lanciaGruppiConfermati(n, {}, { famiglie }),
  avanza: avanzaProssima,
  registra: registraEsito,
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
      const esito = await d.lancia(p.network_id, p.famiglie);
      const r = riassuntoEsito(esito, p.famiglie);
      d.registra(p.network_id, adesso, r.testo, r.tono);
      partite++;
    } catch (e) {
      d.registra(p.network_id, adesso, `Non partita: ${e instanceof Error ? e.message : "errore sconosciuto"}`, "errore");
    }
  }
  return partite;
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
