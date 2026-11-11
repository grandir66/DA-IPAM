/**
 * Il corpo dei rilievi delle Scansioni interne per l'hub DA-Vul-can (`POST /api/ipam/rilievi`).
 *
 * Riccardo, 11/11/2026: i controlli interni «valgono come greenbone o nuclei», quindi vanno
 * all'hub come le altre scansioni. È una fotografia: tutti i rilievi che la pagina Findings dà
 * oggi per la fonte «giro» (servizi visti da un giro recente), a lista bianca di campi. Escono:
 * titolo, gravità, prova, rimedio, IP, nome, rete, porta. Mai password o segreti: la prova di un
 * login di fabbrica dice il nome dell'utente accettato, non la password. `corpoRilievi` è pura.
 */
import type Database from "better-sqlite3";
import { rilieviDelServizio } from "@/lib/rilievi/del-servizio";
import { serviziPerRilievi } from "@/lib/rilievi/unione";

export const SCHEMA_VERSIONE_RILIEVI = 1;
/** Limite dell'hub: oltre non si invia. */
export const MAX_RILIEVI = 50_000;

export interface RilievoInterno {
  chiave: string;
  tipo: string;
  gravita: string;
  titolo: string;
  prova: string;
  rimedio: string;
  ip: string;
  hostname: string | null;
  rete_cidr: string | null;
  porta: number;
  protocollo: string;
  visto: string | null;
}

export interface DatiRilievi { rilievi: RilievoInterno[]; parziale: boolean }

const taglia = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, max) : null;
};

export function leggiRilieviInterni(db: Database.Database): DatiRilievi {
  const servizi = serviziPerRilievi(db);
  const cidr = new Map((db.prepare("SELECT id, cidr FROM networks").all() as Array<{ id: number; cidr: string }>).map((r) => [r.id, r.cidr]));
  const visti = new Map(
    (db.prepare("SELECT host_id, porta, protocollo, ultimo_visto FROM servizi_rete").all() as Array<{ host_id: number; porta: number; protocollo: string; ultimo_visto: string | null }>)
      .map((r) => [`${r.host_id}:${r.porta}:${r.protocollo}`, r.ultimo_visto]),
  );
  const rilievi: RilievoInterno[] = [];
  for (const s of servizi.slice(0, 4000)) {
    for (const x of rilieviDelServizio(s)) {
      rilievi.push({
        chiave: x.chiaveTriage,
        // `giro:<tipo>:<host>:<porta>`: il tipo è il nome stabile del controllo.
        tipo: x.id.split(":")[1] ?? "",
        gravita: x.gravita,
        titolo: x.titolo,
        prova: x.prova,
        rimedio: x.rimedio,
        ip: s.ip,
        hostname: s.hostname,
        rete_cidr: s.network_id != null ? (cidr.get(s.network_id) ?? null) : null,
        porta: s.porta,
        protocollo: s.protocollo,
        visto: visti.get(`${s.host_id}:${s.porta}:${s.protocollo}`) ?? null,
      });
    }
  }
  return { rilievi, parziale: servizi.length > 4000 };
}

export function corpoRilievi(
  d: DatiRilievi,
  testa: { codcli: string; nodo: string; versione: string; adesso: Date },
): { json: string; rilievi: number } | { errore: string } {
  if (d.rilievi.length > MAX_RILIEVI) return { errore: `oltre 50.000 rilievi (${d.rilievi.length}): l'hub non li accetta` };
  const righe = d.rilievi
    .filter((r) => r.ip && r.titolo && r.tipo)
    .map((r) => ({
      chiave: r.chiave.slice(0, 200),
      tipo: r.tipo.slice(0, 80),
      gravita: r.gravita,
      titolo: r.titolo.slice(0, 300),
      prova: taglia(r.prova, 2000),
      rimedio: taglia(r.rimedio, 2000),
      ip: r.ip.slice(0, 45),
      hostname: taglia(r.hostname, 255),
      rete_cidr: taglia(r.rete_cidr, 49),
      porta: r.porta,
      protocollo: r.protocollo.slice(0, 8),
      visto: taglia(r.visto, 40),
    }))
    .sort((a, b) => (a.chiave < b.chiave ? -1 : a.chiave > b.chiave ? 1 : 0));
  return {
    json: JSON.stringify({
      schema_versione: SCHEMA_VERSIONE_RILIEVI,
      codcli: testa.codcli.slice(0, 20),
      nodo: testa.nodo.slice(0, 80),
      generato_il: testa.adesso.toISOString(),
      versione_ipam: taglia(testa.versione, 40),
      fonte: "scansioni-interne",
      parziale: d.parziale,
      rilievi: righe,
    }),
    rilievi: righe.length,
  };
}
