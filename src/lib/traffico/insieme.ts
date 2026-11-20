/**
 * Il traffico visto sulla rete intera (pagina `/traffico`, scheda «Chi parla con chi»): le coppie di un
 * periodo raggruppate fra reti, per host e per coppia. `calcolaInsieme` è pura (la provano i test);
 * `insiemeTraffico` la aggancia al database del tenant.
 *
 * Lo stesso flusso visto da due collector o da due fonti si prende al massimo, mai sommato (come in `lettura.ts`).
 */
import { getNetworks } from "@/lib/db-tenant";
import { isIpInCidr } from "@/lib/utils";
import { DIFFUSIONE, ESTERNO } from "./anomalie";
import { dbTraffico, GIORNI_TENUTI } from "./lettura";
import { nomiDegliIp, type NomeDiIp } from "./quadro";

export const VISTE = ["reti", "host", "coppie"] as const;
export type Vista = (typeof VISTE)[number];
export const PERIODI = [1, 7, 30] as const;
export const PER_PAGINA = 50;
/** Oltre questo numero di coppie si lavora sulle più grosse e la pagina lo dice. */
export const MASSIMO_COPPIE = 50000;

/** Chiave di una rete nella vista: l'id di una rete censita, oppure una delle tre parole. */
export const RETE_ESTERNO = "esterno";
export const RETE_DIFFUSIONE = "diffusione";
export const RETE_NON_CENSITA = "nessuna";

export interface RigaCoppia { client: string; server: string; proto: number; porta: number; byte: number; ultima_vista: string }
export interface Servizio { proto: number; porta: number; byte: number }
export interface RigaReti { da: string; a: string; host: number; coppie: number; byte: number; servizi: Servizio[] }
export interface RigaHost { ip: string; contatta: number; contattato_da: number; byte_client: number; byte_server: number; servizi: Servizio[] }
export interface FiltroInsieme {
  vista: Vista;
  pagina?: number;
  /** Una rete, da una parte o dall'altra. */
  rete?: string;
  /** Rete di chi apre il collegamento e rete di chi risponde (il dettaglio di una riga «fra reti»). */
  da?: string;
  a?: string;
  cerca?: string;
}
export interface Insieme {
  tessere: { host: number; coppie: number; byte: number; byte_esterno: number };
  totale: number;
  pagina: number;
  perPagina: number;
  reti: RigaReti[];
  host: RigaHost[];
  coppie: RigaCoppia[];
}

const interno = (ip: string): boolean => ip !== ESTERNO && ip !== DIFFUSIONE && ip !== "";

function serviziPrincipali(m: Map<string, Servizio>, quanti = 3): Servizio[] {
  return [...m.values()].sort((x, y) => y.byte - x.byte).slice(0, quanti);
}
function sommaServizio(m: Map<string, Servizio>, r: RigaCoppia): void {
  const k = `${r.proto}/${r.porta}`;
  const s = m.get(k);
  if (s) s.byte += r.byte;
  else m.set(k, { proto: r.proto, porta: r.porta, byte: r.byte });
}

/**
 * `reteDi`: la chiave della rete di un indirizzo. `nomeDi`: il nome dell'host, per la ricerca.
 * La ricerca di sole cifre è una porta; altrimenti un pezzo di indirizzo o di nome.
 */
export function calcolaInsieme(
  righe: RigaCoppia[],
  reteDi: (ip: string) => string,
  nomeDi: (ip: string) => string | null,
  filtro: FiltroInsieme,
): Insieme {
  const cerca = (filtro.cerca ?? "").trim().toLowerCase();
  const porta = /^\d{1,5}$/.test(cerca) ? Number(cerca) : null;
  const corrisponde = (ip: string): boolean => ip.includes(cerca) || (nomeDi(ip) ?? "").toLowerCase().includes(cerca);
  const tenute = righe.filter((r) => {
    const rc = reteDi(r.client);
    const rs = reteDi(r.server);
    if (filtro.rete && rc !== filtro.rete && rs !== filtro.rete) return false;
    if (filtro.da && rc !== filtro.da) return false;
    if (filtro.a && rs !== filtro.a) return false;
    if (porta !== null) return r.porta === porta;
    return !cerca || corrisponde(r.client) || corrisponde(r.server);
  });

  const host = new Set<string>();
  const coppie = new Set<string>();
  let byte = 0;
  let byteEsterno = 0;
  for (const r of tenute) {
    if (interno(r.client)) host.add(r.client);
    if (interno(r.server)) host.add(r.server);
    coppie.add(`${r.client}>${r.server}`);
    byte += r.byte;
    if (r.client === ESTERNO || r.server === ESTERNO) byteEsterno += r.byte;
  }
  const pagina = Math.max(1, Math.trunc(filtro.pagina ?? 1));
  const taglio = <T,>(tutte: T[]): T[] => tutte.slice((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA);
  const esito: Insieme = {
    tessere: { host: host.size, coppie: coppie.size, byte, byte_esterno: byteEsterno },
    totale: 0, pagina, perPagina: PER_PAGINA, reti: [], host: [], coppie: [],
  };

  if (filtro.vista === "reti") {
    const gruppi = new Map<string, { da: string; a: string; host: Set<string>; coppie: Set<string>; byte: number; servizi: Map<string, Servizio> }>();
    for (const r of tenute) {
      const da = reteDi(r.client);
      const a = reteDi(r.server);
      const k = `${da}>${a}`;
      let g = gruppi.get(k);
      if (!g) { g = { da, a, host: new Set(), coppie: new Set(), byte: 0, servizi: new Map() }; gruppi.set(k, g); }
      if (interno(r.client)) g.host.add(r.client);
      if (interno(r.server)) g.host.add(r.server);
      g.coppie.add(`${r.client}>${r.server}`);
      g.byte += r.byte;
      sommaServizio(g.servizi, r);
    }
    const tutte = [...gruppi.values()].sort((x, y) => y.byte - x.byte)
      .map((g) => ({ da: g.da, a: g.a, host: g.host.size, coppie: g.coppie.size, byte: g.byte, servizi: serviziPrincipali(g.servizi) }));
    esito.totale = tutte.length;
    esito.reti = taglio(tutte);
  } else if (filtro.vista === "host") {
    const per = new Map<string, { contatta: Set<string>; da: Set<string>; byteClient: number; byteServer: number; servizi: Map<string, Servizio> }>();
    const di = (ip: string) => {
      let h = per.get(ip);
      if (!h) { h = { contatta: new Set(), da: new Set(), byteClient: 0, byteServer: 0, servizi: new Map() }; per.set(ip, h); }
      return h;
    };
    for (const r of tenute) {
      if (interno(r.client)) { const h = di(r.client); h.contatta.add(r.server); h.byteClient += r.byte; }
      if (interno(r.server)) { const h = di(r.server); h.da.add(r.client); h.byteServer += r.byte; sommaServizio(h.servizi, r); }
    }
    const tutte = [...per.entries()]
      .map(([ip, h]) => ({ ip, contatta: h.contatta.size, contattato_da: h.da.size, byte_client: h.byteClient, byte_server: h.byteServer, servizi: serviziPrincipali(h.servizi) }))
      .sort((x, y) => (y.byte_client + y.byte_server) - (x.byte_client + x.byte_server));
    esito.totale = tutte.length;
    esito.host = taglio(tutte);
  } else {
    esito.totale = tenute.length;
    esito.coppie = taglio(tenute);
  }
  return esito;
}

export interface ReteVista { chiave: string; nome: string; cidr: string }
export interface NomeChiesto { tipo: string; nome: string; conteggio: number; host: number }
export interface InsiemeTraffico extends Insieme {
  giorni: number;
  /** Le reti censite, per il filtro e per dare un nome alle chiavi. */
  reti_censite: ReteVista[];
  nomi: Record<string, NomeDiIp>;
  nomi_chiesti: NomeChiesto[];
  troncato: boolean;
}

export function insiemeTraffico(filtro: FiltroInsieme & { giorni?: number }): InsiemeTraffico {
  const d = dbTraffico();
  const giorni = Math.max(1, Math.min(GIORNI_TENUTI, Math.trunc(filtro.giorni ?? 1)));
  // «oggi» è il giorno in corso: la tabella tiene una riga per giorno
  const da = `-${giorni - 1} days`;
  const righe = d.prepare(`
    SELECT client, server, proto, porta, MAX(byte) AS byte, MAX(ultima_vista) AS ultima_vista
    FROM (
      SELECT collector_id, fonte, client, server, proto, porta, SUM(byte) AS byte, MAX(ultima_vista) AS ultima_vista
      FROM traffico_coppie WHERE giorno >= date('now', ?)
      GROUP BY collector_id, fonte, client, server, proto, porta)
    GROUP BY client, server, proto, porta ORDER BY byte DESC LIMIT ${MASSIMO_COPPIE + 1}`).all(da) as RigaCoppia[];
  const troncato = righe.length > MASSIMO_COPPIE;
  if (troncato) righe.length = MASSIMO_COPPIE;

  const reti = getNetworks().map((n) => ({ chiave: String(n.id), nome: n.name, cidr: n.cidr }));
  const memo = new Map<string, string>();
  const reteDi = (ip: string): string => {
    if (ip === ESTERNO) return RETE_ESTERNO;
    if (ip === DIFFUSIONE || ip === "") return RETE_DIFFUSIONE;
    let r = memo.get(ip);
    if (r === undefined) {
      r = reti.find((n) => isIpInCidr(ip, n.cidr))?.chiave ?? RETE_NON_CENSITA;
      memo.set(ip, r);
    }
    return r;
  };
  // i nomi servono a tutta la ricerca, non solo alla pagina mostrata: si leggono una volta
  const nomiTutti = new Map<string, string>();
  if ((filtro.cerca ?? "").trim() && !/^\d{1,5}$/.test((filtro.cerca ?? "").trim())) {
    for (const h of d.prepare("SELECT ip, COALESCE(NULLIF(custom_name, ''), NULLIF(hostname, '')) AS nome FROM hosts WHERE COALESCE(NULLIF(custom_name, ''), NULLIF(hostname, '')) IS NOT NULL").all() as { ip: string; nome: string }[]) {
      nomiTutti.set(h.ip, h.nome);
    }
  }
  const esito = calcolaInsieme(righe, reteDi, (ip) => nomiTutti.get(ip) ?? null, filtro);
  const ipDellaPagina = [...esito.host.map((h) => h.ip), ...esito.coppie.flatMap((c) => [c.client, c.server])];
  const nomiChiesti = d.prepare(`
    SELECT tipo, nome, SUM(conteggio) AS conteggio, COUNT(DISTINCT client) AS host FROM traffico_nomi
    WHERE giorno >= date('now', ?) GROUP BY tipo, nome ORDER BY conteggio DESC LIMIT 15`).all(da) as NomeChiesto[];
  return { ...esito, giorni, reti_censite: reti, nomi: nomiDegliIp(ipDellaPagina), nomi_chiesti: nomiChiesti, troncato };
}
