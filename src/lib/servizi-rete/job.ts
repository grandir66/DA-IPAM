/**
 * Giro automatico dei servizi di rete (Riccardo, 09/11/2026: «vorrei il massimo automatismo»).
 *
 * Avviato da `server.ts`: tre minuti dopo l'avvio (solo se l'ultimo giro ha più di 6 ore) e poi
 * ogni 6 ore, per ogni cliente attivo,
 * prova le porte comuni sugli host senza porte note e rilegge con le sonde tutte le porte,
 * le più vecchie per prime. Si spegne per un cliente dalla levetta in Opzioni
 * (`servizi_rete.automatico = 0`). Il freno su campo e stampa vale sempre (`daSaltare`).
 */
import cron from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant, getTenantSetting, setTenantSetting, getTenantDb } from "@/lib/db-tenant";
import { avviaGiro } from "./giro";

export const CRON_SERVIZI_RETE = "17 */6 * * *";
export const CHIAVE_AUTOMATICO = "servizi_rete.automatico";
const RITARDO_AVVIO_MS = 3 * 60_000;
/**
 * Quando è partito l'ultimo giro automatico del cliente. Serve all'avvio: il 10/11/2026 DA-IPAM è
 * stato riavviato una ventina di volte in un giorno dai rilasci, e ogni volta il giro rifaceva le
 * prove senza credenziali su tutti gli host, DC compresi (196 accessi «Guest» rifiutati nel registro
 * dei DC); la sera i DC hanno smesso di rispondere all'hub. Un riavvio non è un motivo per rifare
 * il giro: all'avvio parte solo se l'ultimo è più vecchio dell'intervallo.
 */
export const CHIAVE_ULTIMO_GIRO = "servizi_rete.ultimo_giro_automatico";
export const INTERVALLO_GIRO_MS = 6 * 60 * 60_000;

/** Vero se l'ultimo giro automatico è abbastanza vecchio (o non c'è mai stato). Date ISO o «AAAA-MM-GG hh:mm:ss» in UTC. */
export function giroDovuto(ultimo: string | null | undefined, adesso: number = Date.now()): boolean {
  const t = ultimo ? Date.parse(ultimo.includes("T") ? ultimo : `${ultimo.replace(" ", "T")}Z`) : NaN;
  return Number.isNaN(t) || adesso - t >= INTERVALLO_GIRO_MS;
}

/**
 * L'ultimo giro del cliente: il segno lasciato dal giro automatico, oppure (prima installazione di
 * questa regola, o giri lanciati a mano) l'ultima volta che una sonda ha visto un servizio.
 */
function ultimoGiro(tenant: string): string | null {
  const segno = getTenantSetting(CHIAVE_ULTIMO_GIRO);
  if (segno) return segno;
  try {
    const r = getTenantDb(tenant).prepare("SELECT MAX(ultimo_visto) AS u FROM servizi_rete").get() as { u: string | null } | undefined;
    return r?.u ?? null;
  } catch {
    return null; // tabella assente: nessun giro mai fatto
  }
}

const g = globalThis as typeof globalThis & { __jobServiziRete?: boolean };

/**
 * Un giro per ogni cliente attivo che non l'ha spento. Ritorna i clienti avviati.
 * `soloSeDovuto` (l'avvio): salta i clienti il cui ultimo giro è recente.
 */
export function giroServiziTutti(soloSeDovuto = false): string[] {
  const avviati: string[] = [];
  for (const t of getActiveTenants()) {
    try {
      const acceso = withTenant(t.codice_cliente, () => (getTenantSetting(CHIAVE_AUTOMATICO) ?? "1").trim() !== "0");
      if (!acceso) continue;
      if (soloSeDovuto && !withTenant(t.codice_cliente, () => giroDovuto(ultimoGiro(t.codice_cliente)))) continue;
      // proveFabbrica resta spento: i login di fabbrica partono solo da /scans.
      if (avviaGiro(t.codice_cliente, null, { porteComuni: "senza-porte" })) {
        avviati.push(t.codice_cliente);
        withTenant(t.codice_cliente, () => setTenantSetting(CHIAVE_ULTIMO_GIRO, new Date().toISOString()));
      }
    } catch (e) {
      console.warn(`[servizi-rete] ${t.codice_cliente}: giro automatico non avviato: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return avviati;
}

export function avviaGiroServiziAutomatico(): void {
  if (g.__jobServiziRete) return;
  g.__jobServiziRete = true;
  setTimeout(() => {
    const a = giroServiziTutti(true);
    console.info(a.length > 0 ? `[servizi-rete] giro all'avvio: ${a.join(", ")}` : "[servizi-rete] nessun giro all'avvio: l'ultimo è recente");
  }, RITARDO_AVVIO_MS).unref?.();
  cron.schedule(CRON_SERVIZI_RETE, () => {
    giroServiziTutti();
  });
}
