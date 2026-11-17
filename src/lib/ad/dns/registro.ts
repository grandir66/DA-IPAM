/**
 * Registro su file delle correzioni al DNS di Active Directory: una riga JSONL per passo, in
 * `<DATA_DIR>/audit/dns-ad-YYYY-MM-DD.jsonl` (giorno UTC), tenuto `GIORNI_REGISTRO_DNS` giorni.
 * Modello: `hosts/registro-pulizia.ts`. Sta accanto alla tabella `ad_dns_modifiche`: il file
 * resta anche se il database viene sostituito.
 *
 * Un errore di scrittura LANCIA: chi corregge scrive la riga prima del comando sul DC, e un
 * registro che non si scrive ferma l'operazione (zona rossa: niente scrittura senza traccia).
 */
import fs from "node:fs";
import { resolveDataDir } from "../../data-dir";
import { unisci } from "../../percorsi";

export const GIORNI_REGISTRO_DNS = 400;

export interface RigaRegistroDns {
  fase: "prima" | "dopo";
  tenant: string | null;
  integrazione: number;
  modificaId: number;
  gruppo: string;
  azione: "aggiungi" | "togli";
  zona: string;
  nome: string;
  tipo: string;
  dato: string;
  prima: unknown;
  esito: string;
  messaggio: string | null;
  utenza: string | null;
  da: string;
}

export function dirRegistroDns(): string {
  return unisci(resolveDataDir(), "audit");
}

// Su globalThis: sotto tsx possono coesistere due istanze del modulo.
const CHIAVE = Symbol.for("da-ipam.ad.dns.registro");
function ultimaPulizia(): { giorno: string } {
  const g = globalThis as unknown as Record<symbol, { giorno: string } | undefined>;
  return (g[CHIAVE] ??= { giorno: "" });
}

/** Scrive una riga; lancia se non ci riesce (cartella non creabile, disco pieno, permessi). */
export function scriviRegistroDns(riga: RigaRegistroDns, adesso = new Date()): void {
  const dir = dirRegistroDns();
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  fs.appendFileSync(unisci(dir, `dns-ad-${giorno}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...riga })}\n`);
  const s = ultimaPulizia();
  if (s.giorno === giorno) return;
  s.giorno = giorno;
  try {
    const soglia = new Date(adesso.getTime() - GIORNI_REGISTRO_DNS * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dir)) {
      const m = /^dns-ad-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1]! < soglia) fs.rmSync(unisci(dir, f), { force: true });
    }
  } catch (e) {
    console.warn("[dns-ad] pulizia dei file vecchi del registro fallita, si riprova domani:", e instanceof Error ? e.message : e);
  }
}
