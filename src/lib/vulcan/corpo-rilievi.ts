/**
 * Il corpo dei rilievi delle Scansioni interne per l'hub DA-Vul-can (`POST /api/ipam/rilievi`).
 *
 * Riccardo, 11/11/2026: i controlli interni «valgono come greenbone o nuclei», quindi vanno
 * all'hub come le altre scansioni. È una fotografia: tutti i rilievi che la pagina Findings dà
 * oggi per la fonte «giro» (servizi visti da un giro recente), a lista bianca di campi. Escono:
 * titolo, gravità, prova, rimedio, IP, nome, rete, porta. Mai password, segreti o nomi di utente:
 * di un login di fabbrica esce solo che le credenziali di fabbrica danno accesso (Riccardo,
 * 11/11/2026: «il nome di default non esce»). `corpoRilievi` è pura.
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

/** Lettura passiva del trunk, a livello statistico (Riccardo, 11/11/2026): solo conteggi, mai indirizzi, MAC o nomi. */
export interface RetePassiva {
  rilievi: Array<{ tipo: string; categoria: string; gravita: string; quanti: number }>;
  vicini: number;
  vlan: number;
  vlan_con_dhcp: number;
  server_dhcp: number;
  dispositivi: number;
  protocolli: Array<{ nome: string; dispositivi: number }>;
}

export interface DatiRilievi { rilievi: RilievoInterno[]; parziale: boolean; passiva?: RetePassiva | null }

/** Ultimi 30 giorni, come le regole del trunk. Senza sensore (tabelle assenti o vuote) = null: il campo non parte. */
export function leggiRetePassiva(db: Database.Database): RetePassiva | null {
  try {
    const oss = db.prepare("SELECT mac_normalized AS mac, protocolli FROM trunk_osservazioni WHERE ultima_vista IS NULL OR julianday(ultima_vista) >= julianday('now') - 30").all() as Array<{ mac: string; protocolli: string | null }>;
    const vlan = db.prepare("SELECT server_dhcp FROM trunk_vlan WHERE vista = 1").all() as Array<{ server_dhcp: string | null }>;
    const vicini = (db.prepare("SELECT COUNT(*) AS n FROM trunk_vicini").get() as { n: number }).n;
    const rilievi = db.prepare("SELECT tipo, categoria, gravita, COUNT(*) AS quanti FROM rete_rilievi WHERE chiuso_il IS NULL GROUP BY tipo, categoria, gravita ORDER BY tipo, gravita").all() as RetePassiva["rilievi"];
    if (oss.length === 0 && vlan.length === 0 && vicini === 0 && rilievi.length === 0) return null;
    const perProtocollo = new Map<string, Set<string>>();
    for (const o of oss) for (const nome of (o.protocolli ?? "").split(",").filter(Boolean)) {
      const s = perProtocollo.get(nome) ?? new Set<string>();
      s.add(o.mac);
      perProtocollo.set(nome, s);
    }
    let vlanConDhcp = 0, server = 0;
    for (const v of vlan) {
      let n = 0;
      try {
        const x: unknown = JSON.parse(v.server_dhcp ?? "[]");
        n = Array.isArray(x) ? x.length : 0;
      } catch {
        n = 0;
      }
      if (n > 0) vlanConDhcp++;
      server += n;
    }
    return {
      rilievi: rilievi.map((r) => ({ tipo: String(r.tipo).slice(0, 60), categoria: String(r.categoria).slice(0, 40), gravita: String(r.gravita).slice(0, 20), quanti: r.quanti })),
      vicini,
      vlan: vlan.length,
      vlan_con_dhcp: vlanConDhcp,
      server_dhcp: server,
      dispositivi: new Set(oss.map((o) => o.mac)).size,
      protocolli: Array.from(perProtocollo, ([nome, s]) => ({ nome: nome.slice(0, 40), dispositivi: s.size })).sort((a, b) => b.dispositivi - a.dispositivi || a.nome.localeCompare(b.nome)).slice(0, 100),
    };
  } catch {
    return null;
  }
}

/** La prova che esce al posto di quella di DA-IPAM, per i rilievi la cui prova nomina un utente. */
export const PROVA_SENZA_UTENTE: Readonly<Record<string, string>> = {
  "login-fabbrica": "Le credenziali di fabbrica danno accesso.",
  "ipmi-rakp": "RAKP Message 2 con status 0 per un utente di fabbrica: HMAC recuperabile.",
};
/** Lo stesso per il titolo: «IPMI RAKP utente admin su …» nomina l'utente provato. */
const titoloSenzaUtente = (t: string): string => t.replace(/\butente admin\b/u, "utente di fabbrica");

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
  return { rilievi, parziale: servizi.length > 4000, passiva: leggiRetePassiva(db) };
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
      titolo: titoloSenzaUtente(r.titolo).slice(0, 300),
      prova: taglia(PROVA_SENZA_UTENTE[r.tipo] ?? r.prova, 2000),
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
      ...(d.passiva ? { rete_passiva: d.passiva } : {}),
      rilievi: righe,
    }),
    rilievi: righe.length,
  };
}
