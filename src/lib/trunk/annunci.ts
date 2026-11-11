/**
 * L'elenco «Annunci» della pagina del trunk (tavola approvata da Riccardo il 10/11/2026: «la tavola è
 * perfetta»): chi si presenta da solo sul trunk, **una riga per apparato e non per annuncio**. Un
 * MikroTik si annuncia da ogni interfaccia e in più protocolli: qui è una riga, con le sue interfacce
 * dentro. Sola lettura di `trunk_vicini`; lo stato rispetto a DA-IPAM dice cosa resta da fare.
 */
import type Database from "better-sqlite3";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";

export interface InterfacciaAnnunciata {
  porta: string;
  protocollo: string;
  vid: number;
  indirizzo: string | null;
  ultima_vista: string;
}

export interface ApparatoAnnunciato {
  chiave: string;
  nome: string;
  /** Protocolli con cui si annuncia, in maiuscolo: MNDP, UBNT, CDP, LLDP. */
  protocolli: string[];
  modello: string | null;
  versione: string | null;
  /** Categoria decisa dal riconoscimento sull'host agganciato (`network.switch`…), se c'è. */
  categoria: string | null;
  interfacce: InterfacciaAnnunciata[];
  /** VLAN distinte da cui si presenta (0 = senza tag). */
  vlan: number[];
  /** L'host di DA-IPAM a cui è agganciato; null = in DA-IPAM non c'è. */
  host: { id: number; ip: string } | null;
  /** L'host è anche registrato come apparato di rete (quindi viene letto). */
  apparato: boolean;
  /** Un indirizzo con cui si annuncia, per dire dov'è quando in DA-IPAM non c'è. */
  indirizzo: string | null;
  ultima_vista: string;
}

interface Riga {
  protocollo: string;
  sistema: string;
  porta: string;
  vid: number;
  indirizzo: string | null;
  ultima_vista: string;
  piattaforma: string | null;
  versione: string | null;
  mac: string | null;
  host_id: number | null;
  host_ip: string | null;
  categoria: string | null;
  apparato: number;
}

/** Chi dice il modello vero viene prima di chi dice solo il produttore. */
const ordineModello = (protocollo: string): number => (protocollo === "mndp" || protocollo === "ubnt" ? 0 : 1);

/** Raggruppa le righe degli annunci per apparato. Funzione pura. */
export function raggruppaAnnunci(righe: readonly Riga[]): ApparatoAnnunciato[] {
  const mappa = new Map<string, { a: ApparatoAnnunciato; righe: Riga[] }>();
  for (const r of righe) {
    // Lo stesso nome è lo stesso apparato; chi non dice il nome si distingue per MAC.
    const chiave = r.sistema && r.sistema !== "?" ? `n:${r.sistema.toLowerCase()}` : `m:${r.mac ?? r.indirizzo ?? r.porta}`;
    let g = mappa.get(chiave);
    if (!g) {
      g = {
        a: {
          chiave, nome: r.sistema && r.sistema !== "?" ? r.sistema : r.mac ?? r.indirizzo ?? "senza nome",
          protocolli: [], modello: null, versione: null, categoria: null, interfacce: [], vlan: [],
          host: null, apparato: false, indirizzo: null, ultima_vista: r.ultima_vista,
        },
        righe: [],
      };
      mappa.set(chiave, g);
    }
    g.righe.push(r);
  }
  const esito: ApparatoAnnunciato[] = [];
  for (const { a, righe: sue } of mappa.values()) {
    const perModello = [...sue].sort((x, y) => ordineModello(x.protocollo) - ordineModello(y.protocollo) || y.ultima_vista.localeCompare(x.ultima_vista));
    a.protocolli = [...new Set(sue.map((r) => r.protocollo.toUpperCase()))].sort();
    a.modello = perModello.find((r) => r.piattaforma)?.piattaforma ?? null;
    a.versione = perModello.find((r) => r.versione)?.versione?.split("\n")[0]?.trim().slice(0, 60) ?? null;
    const conHost = perModello.find((r) => r.host_id != null);
    a.host = conHost?.host_id != null ? { id: conHost.host_id, ip: conHost.host_ip ?? conHost.indirizzo ?? "" } : null;
    a.categoria = conHost?.categoria ?? null;
    a.apparato = sue.some((r) => r.apparato > 0);
    a.indirizzo = sue.find((r) => r.indirizzo)?.indirizzo ?? null;
    a.ultima_vista = sue.reduce((m, r) => (r.ultima_vista > m ? r.ultima_vista : m), "");
    const viste = new Map<string, InterfacciaAnnunciata>();
    for (const r of [...sue].sort((x, y) => y.ultima_vista.localeCompare(x.ultima_vista))) {
      const k = `${r.porta}|${r.vid}`;
      if (!viste.has(k)) viste.set(k, { porta: r.porta, protocollo: r.protocollo.toUpperCase(), vid: r.vid, indirizzo: r.indirizzo, ultima_vista: r.ultima_vista });
    }
    a.interfacce = [...viste.values()].sort((x, y) => x.vid - y.vid || x.porta.localeCompare(y.porta));
    a.vlan = [...new Set(a.interfacce.map((i) => i.vid))].sort((x, y) => x - y);
    esito.push(a);
  }
  // In cima ciò che resta da fare: chi non è in DA-IPAM, poi chi non è un apparato, poi per nome.
  const peso = (a: ApparatoAnnunciato) => (!a.host ? 0 : !a.apparato ? 1 : 2);
  return esito.sort((x, y) => peso(x) - peso(y) || x.nome.localeCompare(y.nome));
}

export function getAnnunciTrunk(dbh?: Database.Database): ApparatoAnnunciato[] {
  const d = dbh ?? getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
  let righe: Riga[];
  try {
    righe = d.prepare(
      `SELECT v.protocollo, v.sistema, v.porta, v.vid, v.indirizzo, v.ultima_vista, v.piattaforma, v.versione, v.mac, v.host_id,
              h.ip AS host_ip, h.attr_category AS categoria,
              (SELECT COUNT(*) FROM network_devices nd WHERE nd.host_id = v.host_id) AS apparato
         FROM trunk_vicini v LEFT JOIN hosts h ON h.id = v.host_id
        ORDER BY v.ultima_vista DESC LIMIT 2000`,
    ).all() as Riga[];
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/.test(e.message)) return [];
    throw e;
  }
  return raggruppaAnnunci(righe);
}
