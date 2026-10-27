/**
 * Registro (audit) degli invii verso l'hub DA-Vul-can (A-IPAM, Task 6), modello
 * `accesso/registro-accessi.ts`: una riga JSONL per ogni invio riuscito, scarto,
 * fallimento definitivo, sospensione e «Invia ora», in
 * `<DATA_DIR>/audit/invii-vulcan-YYYY-MM-DD.jsonl`, conservato 400 giorni.
 *
 * Mai gettone, URL, IP, hostname, nomi di dominio o corpo: si scrivono SOLO i campi
 * elencati qui (un oggetto con chiavi in più non le porta nel file), lo sha256 al
 * massimo a 12 caratteri esadecimali, il motivo è una frase nostra.
 */
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import type { TipoInvio } from "./coda";
import { unisci } from "../percorsi";

export const GIORNI_REGISTRO_VULCAN = 400;

export interface RigaAuditVulcan {
  azione: "invio" | "scarto" | "fallito" | "sospeso" | "invia_ora";
  tipo?: TipoInvio | "ping" | "battito";
  http?: number;
  byte?: number;
  oggetti?: number | null;
  /** Primi 12 caratteri dello sha256 del JSON (si tagliano qui comunque). */
  sha?: string;
  risposta_id?: string | null;
  /** Frase nostra (scarto, fallimento, sospensione): mai testo dell'hub. */
  motivo?: string;
  /** Chi ha chiesto «Invia ora». */
  da?: string;
}

const CAMPI: readonly (keyof RigaAuditVulcan)[] = ["azione", "tipo", "http", "byte", "oggetti", "sha", "risposta_id", "motivo", "da"];

function pulita(r: RigaAuditVulcan): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of CAMPI) {
    const v = r[k];
    if (v === undefined) continue;
    if (k === "sha") {
      if (typeof v === "string" && /^[0-9a-f]{1,64}$/.test(v)) o.sha = v.slice(0, 12);
      continue;
    }
    o[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return o;
}

const CHIAVE = Symbol.for("da-ipam.vulcan.registro");
function ultimaPulizia(): { giorno: string } {
  const g = globalThis as unknown as Record<symbol, { giorno: string } | undefined>;
  return (g[CHIAVE] ??= { giorno: "" });
}

/** Scrive una riga; lancia se non ci riesce (chi chiama decide: il giro lo dice nel journal). */
export function scriviRegistroVulcan(riga: RigaAuditVulcan, adesso = new Date()): void {
  const dir = unisci(resolveDataDir(), "audit");
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  fs.appendFileSync(unisci(dir, `invii-vulcan-${giorno}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...pulita(riga) })}\n`);
  const s = ultimaPulizia();
  if (s.giorno === giorno) return;
  s.giorno = giorno;
  try {
    const soglia = new Date(adesso.getTime() - GIORNI_REGISTRO_VULCAN * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dir)) {
      const m = /^invii-vulcan-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < soglia) fs.rmSync(unisci(dir, f), { force: true });
    }
  } catch (e) {
    console.warn("[vulcan] pulizia dei registri d'invio vecchi fallita, si riprova domani:", e instanceof Error ? e.message : "errore");
  }
}
