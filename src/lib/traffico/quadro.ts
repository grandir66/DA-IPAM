/**
 * Quello che la pagina `/traffico` mostra intorno all'elenco: i collector e come stanno, le reti ancora in
 * apprendimento, quante anomalie aspettano. Più i nomi degli host per gli IP di una pagina di anomalie.
 */
import { hostPerMacDegliIp } from "./identita";
import { getNetworks } from "@/lib/db-tenant";
import { GIORNI_APPRENDIMENTO, RETE_NESSUNA } from "./anomalie";
import { dbTraffico, elencoCollector } from "./lettura";

export interface CollectorQuadro {
  id: number;
  nome: string;
  sede: string;
  attivo: boolean;
  ultimo_contatto: string | null;
  ultimo_errore: string | null;
  ultimo_buco: string | null;
  copertura: number | null;
}
export interface ReteInApprendimento { network_id: number; nome: string; cidr: string; fino_al: string }
export interface QuadroTraffico {
  collector: CollectorQuadro[];
  apprendimento: ReteInApprendimento[];
  /** Anomalie ancora «nuove», per gravità. */
  nuove: { alta: number; media: number; bassa: number };
}

export function quadroTraffico(): QuadroTraffico {
  const d = dbTraffico();
  const reti = new Map(getNetworks().map((n) => [n.id, { nome: n.name, cidr: n.cidr }]));
  const inCorso = d.prepare(`
    SELECT network_id, datetime(prima_vista, '+${GIORNI_APPRENDIMENTO} days') AS fino_al FROM traffico_reti
    WHERE datetime(prima_vista, '+${GIORNI_APPRENDIMENTO} days') > datetime('now') ORDER BY fino_al`).all() as { network_id: number; fino_al: string }[];
  const nuove = { alta: 0, media: 0, bassa: 0 };
  for (const r of d.prepare("SELECT gravita, COUNT(*) AS n FROM traffico_anomalie WHERE stato = 'nuova' GROUP BY gravita").all() as { gravita: number; n: number }[]) {
    if (r.gravita >= 3) nuove.alta += r.n;
    else if (r.gravita === 2) nuove.media += r.n;
    else nuove.bassa += r.n;
  }
  return {
    collector: elencoCollector().map((c) => ({
      id: c.id, nome: c.nome, sede: c.sede, attivo: c.attivo, ultimo_contatto: c.ultimo_contatto,
      ultimo_errore: c.ultimo_errore, ultimo_buco: c.ultimo_buco, copertura: c.copertura,
    })),
    apprendimento: inCorso
      // una rete tolta dal censimento non si nomina più
      .filter((r) => r.network_id === RETE_NESSUNA || reti.has(r.network_id))
      .map((r) => ({
        network_id: r.network_id,
        nome: r.network_id === RETE_NESSUNA ? "Fuori dalle reti censite" : reti.get(r.network_id)!.nome,
        cidr: r.network_id === RETE_NESSUNA ? "" : reti.get(r.network_id)!.cidr,
        fino_al: r.fino_al,
      })),
    nuove,
  };
}

export interface NomeDiIp { id: number; nome: string | null }

/** Per ogni IP che è un host censito: l'id (per il collegamento alla scheda) e il nome, se ne ha uno. */
export function nomiDegliIp(ip: string[]): Record<string, NomeDiIp> {
  const unici = [...new Set(ip.filter((x) => x.includes(".") || x.includes(":")))].slice(0, 400);
  if (unici.length === 0) return {};
  const righe = dbTraffico().prepare(
    `SELECT id, ip, COALESCE(NULLIF(custom_name, ''), NULLIF(hostname, '')) AS nome FROM hosts WHERE ip IN (${unici.map(() => "?").join(", ")})`,
  ).all(...unici) as { id: number; ip: string; nome: string | null }[];
  const esito: Record<string, NomeDiIp> = {};
  for (const r of righe) esito[r.ip] = { id: r.id, nome: r.nome };
  // Un IP che ha cambiato padrone (DHCP): vale l'host del MAC visto per ultimo con quell'indirizzo.
  for (const [quale, h] of hostPerMacDegliIp(dbTraffico(), unici)) esito[quale] = h;
  return esito;
}

/** Le reti censite, per gli interruttori dei controlli (più la riga «fuori dalle reti censite»). */
export function retiPerControlli(): { id: number; nome: string; cidr: string }[] {
  return [...getNetworks().map((n) => ({ id: n.id, nome: n.name, cidr: n.cidr })), { id: RETE_NESSUNA, nome: "Fuori dalle reti censite", cidr: "" }];
}
