/**
 * Registro (audit) degli accessi (Riccardo, 20/10; ADR 0023): una riga JSONL per ogni azione
 * dell'admin sulla verifica in due passaggi, in `<DATA_DIR>/audit/accessi-YYYY-MM-DD.jsonl`,
 * conservato 400 giorni come quello della pulizia host. Mai segreti, mai codici: chi, cosa,
 * su chi, quando.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../data-dir";

export const GIORNI_REGISTRO_ACCESSI = 400;

export interface RigaRegistroAccessi {
  azione: "seconda_verifica_richiedi" | "seconda_verifica_azzera" | "seconda_verifica_togli";
  utente: string;
  utenteId: number;
  da: string;
}

const CHIAVE = Symbol.for("da-ipam.accesso.registro-accessi");
function ultimaPulizia(): { giorno: string } {
  const g = globalThis as unknown as Record<symbol, { giorno: string } | undefined>;
  return (g[CHIAVE] ??= { giorno: "" });
}

/** Scrive una riga; lancia se non ci riesce (l'azione dell'admin non deve passare senza traccia). */
export function scriviRegistroAccessi(riga: RigaRegistroAccessi, adesso = new Date()): void {
  const dir = path.join(resolveDataDir(), "audit");
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  fs.appendFileSync(path.join(dir, `accessi-${giorno}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...riga })}\n`);
  const s = ultimaPulizia();
  if (s.giorno === giorno) return;
  s.giorno = giorno;
  try {
    const soglia = new Date(adesso.getTime() - GIORNI_REGISTRO_ACCESSI * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dir)) {
      const m = /^accessi-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < soglia) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch (e) {
    console.warn("[registro-accessi] pulizia dei file vecchi fallita, si riprova domani:", e);
  }
}
