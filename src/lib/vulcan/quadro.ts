/**
 * Lo stato dell'invio verso l'hub DA-Vul-can (A-IPAM, Task 8), come lo mostrano la scheda
 * in «Cosa esce» e la riga sotto l'ultima esecuzione nella pagina AD.
 *
 * Letto dal sistema vivo a ogni richiesta: `oggetto.env` (riletto), `vulcan_stato` e
 * `vulcan_coda` del cliente dell'invio. Spento si dice anche quando non parte niente
 * (il lavoro che non si vede nell'interfaccia non esiste). Senza gettone non si apre il DB.
 * Mai il gettone, mai l'URL completo: della destinazione solo il nome dell'host.
 */
import type Database from "better-sqlite3";
import { getTenantDb, schemaVulcanPresente } from "@/lib/db-tenant";
import { conteggiCoda, leggiStatoVulcan, ultimoErrore, ultimoInviato } from "./coda";
import { leggiConfigVulcan, tenantPerVulcan, type ConfigVulcan } from "./config";

type ConfigPronta = Extract<ConfigVulcan, { stato: "pronta" }>;

export interface QuadroVulcan {
  stato: "spento" | "non_valida" | "sospeso" | "attivo";
  /** non_valida/sospeso: frase nostra. */
  motivo: string | null;
  /** Solo l'host dell'hub. */
  destinazione: string | null;
  battito: { il: string | null; esito: string | null };
  coda: { in_attesa: number; falliti: number };
  ultimo_ad: { il: string; report_id: string | null } | null;
  ultimo_inventario: { il: string; oggetti: number | null } | null;
  ultimo_errore: { il: string; tipo: string; errore: string } | null;
}

export interface DipendenzeQuadroVulcan {
  config: () => ConfigVulcan;
  /** Il DB del cliente dell'invio, o null se il cliente non è su questa istanza (o manca la coda). */
  db: (cfg: ConfigPronta) => Database.Database | null;
}

function dbReale(cfg: ConfigPronta): Database.Database | null {
  const tenant = tenantPerVulcan(cfg.codcli);
  if (!tenant) return null;
  const db = getTenantDb(tenant);
  return schemaVulcanPresente(db) ? db : null;
}

const dipendenzeReali: DipendenzeQuadroVulcan = { config: () => leggiConfigVulcan(), db: dbReale };

const VUOTO: Omit<QuadroVulcan, "stato" | "motivo"> = {
  destinazione: null,
  battito: { il: null, esito: null },
  coda: { in_attesa: 0, falliti: 0 },
  ultimo_ad: null,
  ultimo_inventario: null,
  ultimo_errore: null,
};

export function quadroVulcan(dip: Partial<DipendenzeQuadroVulcan> = {}): QuadroVulcan {
  const d: DipendenzeQuadroVulcan = { ...dipendenzeReali, ...dip };
  const cfg = d.config();
  if (cfg.stato === "spento") return { stato: "spento", motivo: null, ...VUOTO };
  if (cfg.stato === "non_valida") return { stato: "non_valida", motivo: cfg.motivo, ...VUOTO };
  const destinazione = cfg.url.host;
  const db = d.db(cfg);
  if (!db) {
    return {
      stato: "non_valida",
      motivo: "cliente non presente su questa istanza (o coda assente nel suo database): niente da inviare",
      ...VUOTO,
      destinazione,
    };
  }
  const st = leggiStatoVulcan(db);
  const sospeso = st.sospeso_gettone !== null && st.sospeso_gettone === cfg.improntaGettone;
  const c = conteggiCoda(db);
  const ad = ultimoInviato(db, "ad-health");
  const inv = ultimoInviato(db, "inventario");
  const err = ultimoErrore(db);
  return {
    stato: sospeso ? "sospeso" : "attivo",
    motivo: sospeso ? (st.sospeso_motivo ?? "invii sospesi per questo gettone") : null,
    destinazione,
    battito: { il: st.battito_il, esito: st.battito_esito },
    coda: { in_attesa: c.in_attesa, falliti: c.falliti },
    ultimo_ad: ad ? { il: ad.inviato_il, report_id: ad.risposta_id } : null,
    ultimo_inventario: inv ? { il: inv.inviato_il, oggetti: inv.oggetti } : null,
    ultimo_errore: err ? { il: err.quando, tipo: err.tipo, errore: err.errore } : null,
  };
}

export type StatoInvioAd = {
  stato: "spento" | "in_coda" | "inviato" | "scartato" | "fallito";
  il: string | null;
  motivo: string | null;
};

/**
 * L'invio di un'esecuzione AD Health (`rif = run.id`) nel DB del tenant che la pagina sta
 * guardando. null = mai accodata (esecuzione precedente all'accensione, o di un cliente che
 * non è quello dell'invio).
 */
export function statoInvioAd(db: Database.Database, runId: number, config: () => ConfigVulcan = () => leggiConfigVulcan()): StatoInvioAd | null {
  if (config().stato === "spento") return { stato: "spento", il: null, motivo: null };
  if (!schemaVulcanPresente(db)) return null;
  const r = db
    .prepare(
      `SELECT stato, esito_il, inviato_il, ultimo_errore FROM vulcan_coda
       WHERE tipo = 'ad-health' AND rif = ? AND stato <> 'superato' ORDER BY id DESC LIMIT 1`,
    )
    .get(String(runId)) as { stato: string; esito_il: string | null; inviato_il: string | null; ultimo_errore: string | null } | undefined;
  if (!r) return null;
  if (r.stato === "inviato") return { stato: "inviato", il: r.inviato_il, motivo: null };
  if (r.stato === "scartato") return { stato: "scartato", il: r.esito_il, motivo: r.ultimo_errore };
  if (r.stato === "fallito") return { stato: "fallito", il: r.esito_il, motivo: r.ultimo_errore };
  return { stato: "in_coda", il: r.esito_il, motivo: r.ultimo_errore };
}
