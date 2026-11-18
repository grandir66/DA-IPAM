/**
 * Voce nuova scritta a mano nel DNS di Active Directory (Riccardo, 18/11/2026: «il sistema non
 * permette di registrare nuove voci»). Non nasce da un'anomalia: la persona dice tipo, nome e dato.
 *
 * Passa dalla stessa strada delle correzioni: la richiesta viaggia come un id (`nuova:…`), i passi
 * si ricostruiscono QUI sul server dall'id, e poi valgono anteprima, conferma, convalida, registro
 * e annulla come per ogni altra correzione. Funzioni pure: qui non si scrive niente.
 */
import { nodoPtr, type Correzione, type PassoDns } from "./correzioni";
import type { ZonaDns } from "./record";

export const PREFISSO_VOCE_NUOVA = "nuova:";

export type EsitoVoceNuova = { ok: true; correzione: Correzione } | { ok: false; motivo: string };

const pulito = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");

/** Nome completo: un nome senza punti sta nel dominio dell'integrazione. */
function completo(nome: string, dominio: string): string {
  const n = pulito(nome);
  return n.includes(".") || !dominio ? n : `${n}.${pulito(dominio)}`;
}

/** La zona forward più stretta che contiene il nome, e il nodo dentro quella zona. */
function nodoForward(fqdn: string, zone: readonly ZonaDns[]): { zona: string; nome: string } | null {
  const adatte = zone.filter((z) => !z.inversa && fqdn.endsWith(`.${z.nome}`)).sort((a, b) => b.nome.length - a.nome.length);
  const z = adatte[0];
  return z ? { zona: z.nome, nome: fqdn.slice(0, -z.nome.length - 1) } : null;
}

/** `nuova:A:<nome>:<ip>:<ptr|solo>` · `nuova:CNAME:<nome>:<destinazione>` · `nuova:PTR:<ip>:<nome>`. */
export function voceNuovaDa(id: string, zone: readonly ZonaDns[], dominio: string): EsitoVoceNuova {
  const [prefisso, tipo, primo = "", secondo = "", terzo, ...resto] = id.split(":");
  if (`${prefisso}:` !== PREFISSO_VOCE_NUOVA || resto.length > 0 || !primo.trim() || !secondo.trim()) return { ok: false, motivo: "Voce nuova non leggibile" };
  const passi: PassoDns[] = [];
  let titolo: string;
  if (tipo === "A") {
    const fqdn = completo(primo, dominio);
    const ip = secondo.trim();
    const nodo = nodoForward(fqdn, zone);
    if (!nodo) return { ok: false, motivo: "Il nome non sta in nessuna zona letta da questo dominio" };
    passi.push({ azione: "aggiungi", zona: nodo.zona, nome: nodo.nome, tipo: "A", dato: ip });
    if (terzo === "ptr") {
      const inverso = nodoPtr(ip, zone);
      if (!inverso) return { ok: false, motivo: "Manca la zona reverse per questo indirizzo: crea la voce senza il reverse" };
      passi.push({ azione: "aggiungi", zona: inverso.zona, nome: inverso.nome, tipo: "PTR", dato: fqdn });
    } else if (terzo !== "solo") return { ok: false, motivo: "Voce nuova non leggibile" };
    titolo = `Nuova voce: ${fqdn} → ${ip}${terzo === "ptr" ? ", col reverse" : ""}`;
  } else if (tipo === "CNAME" && terzo === undefined) {
    const fqdn = completo(primo, dominio);
    const verso = completo(secondo, dominio);
    const nodo = nodoForward(fqdn, zone);
    if (!nodo) return { ok: false, motivo: "Il nome non sta in nessuna zona letta da questo dominio" };
    passi.push({ azione: "aggiungi", zona: nodo.zona, nome: nodo.nome, tipo: "CNAME", dato: verso });
    titolo = `Nuovo alias: ${fqdn} → ${verso}`;
  } else if (tipo === "PTR" && terzo === undefined) {
    const ip = primo.trim();
    const fqdn = completo(secondo, dominio);
    const inverso = nodoPtr(ip, zone);
    if (!inverso) return { ok: false, motivo: "Manca la zona reverse per questo indirizzo" };
    passi.push({ azione: "aggiungi", zona: inverso.zona, nome: inverso.nome, tipo: "PTR", dato: fqdn });
    titolo = `Nuovo reverse: ${ip} → ${fqdn}`;
  } else return { ok: false, motivo: "Tipo di voce non previsto" };
  return { ok: true, correzione: { id, chiaveAnomalia: id, titolo, passi, toglieDati: false } };
}
