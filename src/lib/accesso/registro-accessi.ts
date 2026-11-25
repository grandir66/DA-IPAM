/**
 * Registro (audit) degli accessi (Riccardo, 20/10; ADR 0023): una riga JSONL per ogni azione
 * dell'admin sulla verifica in due passaggi, in `<DATA_DIR>/audit/accessi-YYYY-MM-DD.jsonl`,
 * conservato 400 giorni come quello della pulizia host. Mai segreti, mai codici: chi, cosa,
 * su chi, quando.
 */
import fs from "node:fs";
import { resolveDataDir } from "../data-dir";
import { unisci } from "../percorsi";
import { scriviTentativi } from "../protezione/tentativi";

export const GIORNI_REGISTRO_ACCESSI = 400;

export interface RigaRegistroAccessi {
  /** `password_reimposta`: la scrive `scripts/reset-admin-password.cjs`, il recupero dal server (14/11). */
  azione: "seconda_verifica_richiedi" | "seconda_verifica_azzera" | "seconda_verifica_togli" | "password_reimposta" | "codice_recupero_usato" | "codici_recupero_generati"
    | "accesso_riuscito" | "accesso_rifiutato" | "accesso_bloccato"
    | "emergenza_creata" | "emergenza_usata" | "emergenza_tolta"
    // Rilascio su `main` dall'installazione centrale (15/11/2026): chi l'ha fatto e quando.
    | "promozione_main";
  utente: string;
  utenteId: number;
  da: string;
  /** Da quale indirizzo, come lo passa nginx (25/11/2026, Protezione): assente dove non si sa. */
  ip?: string;
}

const CHIAVE = Symbol.for("da-ipam.accesso.registro-accessi");
function ultimaPulizia(): { giorno: string } {
  const g = globalThis as unknown as Record<symbol, { giorno: string } | undefined>;
  return (g[CHIAVE] ??= { giorno: "" });
}

/** Scrive una riga; lancia se non ci riesce (l'azione dell'admin non deve passare senza traccia). */
export function scriviRegistroAccessi(riga: RigaRegistroAccessi, adesso = new Date()): void {
  const dir = unisci(resolveDataDir(), "audit");
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  fs.appendFileSync(unisci(dir, `accessi-${giorno}.jsonl`), `${JSON.stringify({ il: adesso.toISOString(), ...riga })}\n`);
  const s = ultimaPulizia();
  if (s.giorno === giorno) return;
  s.giorno = giorno;
  try {
    const soglia = new Date(adesso.getTime() - GIORNI_REGISTRO_ACCESSI * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dir)) {
      const m = /^accessi-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < soglia) fs.rmSync(unisci(dir, f), { force: true });
    }
  } catch (e) {
    console.warn("[registro-accessi] pulizia dei file vecchi fallita, si riprova domani:", e);
  }
}

/**
 * Una riga per ogni accesso riuscito, rifiutato o bloccato (piano di sicurezza 14/11): prima restavano solo nel
 * journal, che ruota. Non lancia: un disco pieno non deve chiudere fuori tutti, ma si vede nel journal.
 * Il nome è quello scritto da chi prova, tagliato a 64 caratteri; mai la password, mai il codice.
 */
export function registraAccesso(azione: "accesso_riuscito" | "accesso_rifiutato" | "accesso_bloccato", nome: string, utenteId = 0, via = "password", indirizzo: string | null = null): void {
  const utente = nome.trim().slice(0, 64);
  try {
    scriviRegistroAccessi({ azione, utente, utenteId, da: via, ...(indirizzo ? { ip: indirizzo } : {}) });
  } catch (e) {
    console.error("[registro-accessi] accesso non registrato:", e);
  }
  // Un accesso non riuscito è anche un tentativo (Protezione, tappa 3): finisce nel registro che fa partire gli avvisi.
  if (azione !== "accesso_riuscito") {
    scriviTentativi([{ il: new Date().toISOString(), fonte: "pagina", indirizzo, utente, porta: 443, cosa: azione === "accesso_bloccato" ? "utenza bloccata per troppi tentativi" : "accesso rifiutato" }]);
  }
}

/** L'indirizzo di chi chiama dalle intestazioni che mette nginx; `null` se non ci sono. Serve al registro, non a decidere un permesso. */
export function indirizzoDaIntestazioni(h: { get(nome: string): string | null } | null | undefined): string | null {
  const v = (h?.get("x-real-ip") ?? h?.get("x-forwarded-for")?.split(",")[0] ?? "").trim().replace(/^::ffff:/, "");
  return /^[0-9a-fA-F:.]{3,45}$/.test(v) ? v : null;
}
