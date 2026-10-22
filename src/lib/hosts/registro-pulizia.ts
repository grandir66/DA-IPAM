/**
 * Registro (audit) della pulizia degli host (piano 2026-10-20, Task 1): una riga JSONL per
 * archiviazione, recupero e cancellazione definitiva, in `<DATA_DIR>/audit/pulizia-host-YYYY-MM-DD.jsonl`
 * (giorno UTC), tenuto `GIORNI_REGISTRO_PULIZIA` giorni (la pulizia dei file la fa questo modulo, una
 * volta al giorno per processo). Modello: `db-maintenance/ripieghi.ts`.
 *
 * A differenza dei ripieghi qui un errore di scrittura LANCIA: chi archivia scrive la riga prima del
 * COMMIT, e un registro che non si scrive annulla l'operazione (zona rossa: niente host tolto senza
 * traccia). Solo la pulizia dei file vecchi non fa fallire niente: lo dice nel journal e riprova domani.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../data-dir";

export const GIORNI_REGISTRO_PULIZIA = 400;

export interface RigaRegistroPulizia {
  azione: "archivia" | "recupera" | "cancella";
  tenant: string | null;
  archivioId: number;
  hostId: number | null;
  ip: string;
  mac: string | null;
  nome: string;
  motivo: string;
  da: string;
}

/** Cartella del registro (letta a ogni chiamata: segue `DA_INVENT_DATA_DIR`). */
export function dirRegistroPulizia(): string {
  return path.join(resolveDataDir(), "audit");
}

// Su globalThis, come i ripieghi: sotto tsx possono coesistere due istanze del modulo.
const CHIAVE = Symbol.for("da-ipam.hosts.registro-pulizia");
function ultimaPulizia(): { giorno: string } {
  const g = globalThis as unknown as Record<symbol, { giorno: string } | undefined>;
  let s = g[CHIAVE];
  if (!s) {
    s = { giorno: "" };
    g[CHIAVE] = s;
  }
  return s;
}

/** Scrive una riga; lancia se non ci riesce (cartella non creabile, disco pieno, permessi). */
export function scriviRegistroPulizia(riga: RigaRegistroPulizia, adesso = new Date()): void {
  scriviRighePulizia([riga], adesso);
}

/** Scrive più righe con una scrittura sola (stesso file, stesso formato); niente righe = niente scrittura. Lancia come sopra. */
export function scriviRighePulizia(righe: readonly RigaRegistroPulizia[], adesso = new Date()): void {
  if (righe.length === 0) return;
  const dir = dirRegistroPulizia();
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  const il = adesso.toISOString();
  fs.appendFileSync(path.join(dir, `pulizia-host-${giorno}.jsonl`), righe.map((r) => `${JSON.stringify({ il, ...r })}\n`).join(""));
  const s = ultimaPulizia();
  if (s.giorno !== giorno) {
    s.giorno = giorno;
    try {
      pulisci(dir, adesso);
    } catch (e) {
      console.warn("[registro-pulizia] pulizia dei file vecchi del registro fallita, si riprova domani:", e);
    }
  }
}

function pulisci(dir: string, adesso: Date): void {
  const soglia = new Date(adesso.getTime() - GIORNI_REGISTRO_PULIZIA * 86_400_000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(dir)) {
    const m = /^pulizia-host-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (m && m[1] < soglia) fs.rmSync(path.join(dir, f), { force: true });
  }
}
