/**
 * «Solo da questi indirizzi»: un utente può entrare soltanto da un elenco di indirizzi (Protezione, tappa 4;
 * piano §4.8, strato 7). Facoltativo e spento di serie: senza elenco l'utente entra da ovunque, come prima.
 * L'elenco sta nelle impostazioni dell'hub (nessuna colonna nuova). NetBird/DA-Link passa sempre, come nel filtro
 * di rete: è la via dei tecnici.
 *
 * Vale solo con le porte interne chiuse: l'indirizzo è quello che passa nginx, e chi arrivasse dritto alla porta
 * dell'applicazione potrebbe scriverselo da sé. Per questo un indirizzo non letto, con un elenco presente, NON entra.
 */
import { getSetting, setSetting } from "@/lib/db-hub";
import { inElenco, RETE_NETBIRD } from "@/lib/protezione/anteprima";
import { tipoIndirizzo } from "@/lib/protezione/politica";
import { inRete } from "@/lib/protezione/sistemi";

export const CHIAVE_INDIRIZZI_UTENTE = "accesso_indirizzi_utente";
export const MASSIMO_INDIRIZZI_UTENTE = 32;

/** Con questo elenco, da questo indirizzo si entra? Modulo puro. */
export function puoEntrareDa(elenco: readonly string[], indirizzo: string | null): boolean {
  if (elenco.length === 0) return true;
  if (!indirizzo) return false;
  if (inRete(indirizzo, RETE_NETBIRD)) return true;
  return inElenco(indirizzo, elenco);
}

/** Gli elenchi di tutti gli utenti, per id. Un valore rotto nelle impostazioni vale «nessun elenco» e si dice nel journal. */
export function indirizziUtenti(): Record<string, string[]> {
  const grezzo = getSetting(CHIAVE_INDIRIZZI_UTENTE);
  if (!grezzo) return {};
  try {
    const dati = JSON.parse(grezzo) as unknown;
    if (!dati || typeof dati !== "object" || Array.isArray(dati)) return {};
    const pulito: Record<string, string[]> = {};
    for (const [id, voci] of Object.entries(dati as Record<string, unknown>)) {
      if (/^\d+$/.test(id) && Array.isArray(voci)) pulito[id] = voci.filter((v): v is string => typeof v === "string" && tipoIndirizzo(v) !== null);
    }
    return pulito;
  } catch {
    console.error("[accesso] elenco degli indirizzi per utente non leggibile: vale come nessun elenco");
    return {};
  }
}

export function indirizziDellUtente(utenteId: number): string[] {
  return indirizziUtenti()[String(utenteId)] ?? [];
}

/** Gli errori di un elenco, in parole; vuoto = si può salvare. */
export function erroriElencoUtente(elenco: readonly string[]): string[] {
  const errori: string[] = [];
  if (elenco.length > MASSIMO_INDIRIZZI_UTENTE) errori.push(`Più di ${MASSIMO_INDIRIZZI_UTENTE} voci`);
  for (const v of elenco) if (tipoIndirizzo(v) === null) errori.push(`«${v}» non è un indirizzo né una rete ammessa`);
  if (new Set(elenco).size !== elenco.length) errori.push("Una voce è scritta due volte");
  return errori;
}

/** Salva l'elenco di un utente; vuoto = toglie il vincolo. Lancia se l'elenco ha errori. */
export function impostaIndirizziUtente(utenteId: number, elenco: readonly string[]): void {
  const errori = erroriElencoUtente(elenco);
  if (errori.length > 0) throw new Error(errori.join("; "));
  const tutti = indirizziUtenti();
  if (elenco.length === 0) delete tutti[String(utenteId)];
  else tutti[String(utenteId)] = [...elenco];
  setSetting(CHIAVE_INDIRIZZI_UTENTE, JSON.stringify(tutti));
}
