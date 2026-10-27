/**
 * Quali host archiviare (pulizia degli host assenti, piano 2026-10-20, Task 2). Modulo puro: niente DB,
 * niente Node; i dati li carica `pulizia-candidati.ts`, l'archiviazione la fa `pulizia-archivio.ts`.
 *
 * Decisioni di Riccardo del 20/10 (spec `2026-10-20-pulizia-host-assenti-design.md`, da non riaprire):
 * 1. un host `offline` non visto da oltre GIORNI_ASSENZA_ARCHIVIO giorni va in archivio (motivo «assente»);
 *    per un host mai visto vale `first_seen`, poi `created_at`; senza nessuna data non si archivia;
 * 2. non si archivia mai un host legato a qualcosa che una persona ha scritto (apparato, monitorato, nome a
 *    mano, asset, credenziali, unione a mano, gruppo multihomed): il legame lo calcola il caricatore in SQL e
 *    arriva qui come `escluso`, con il perché; `esclusi` elenca gli offline che una regola avrebbe preso;
 * 3. stesso MAC, IP cambiato: il vecchio IP si archivia SUBITO (motivo «cambio_ip»), solo se nel gruppo dello
 *    stesso MAC c'è UN solo host online, visto dopo l'ultima volta del vecchio. Con due o più online (router,
 *    firewall, multihomed che rispondono per più IP) il gruppo non si tocca.
 *
 * Decisione di Riccardo del 20/10, dopo la prova a vuoto sull'hub (tenant 70791): il MAC 82:FA:6F:7D:6D:54 stava
 * su 14 host della stessa /24; l'unico online era un router MikroTik che risponde in proxy ARP, gli offline
 * macchine diverse (VEEAM-PX-02, VEEAM-PX-03, una NVIDIA…), e la regola 3 ne archiviava 11 subito «ora
 * 192.168.15.155». Da allora la regola 3 vale solo per una COPPIA: nel gruppo (rete, MAC) esattamente due host,
 * uno online e uno offline più vecchio, con nomi coerenti. Il nome è quello vero (`nomeVero`: custom_name, poi
 * hostname, poi dns_reverse; mai l'IP di ripiego); due nomi sono diversi solo se ci sono tutti e due e non
 * coincidono a meno di spazi e maiuscole. Un gruppo che non è una coppia così torna alla regola 1 (60 giorni):
 * non è un escluso. Il blocco del MAC su più host online, qui sotto, resta com'è.
 *
 * Due strette del controllore (revisione del 20/10, prudenza sui gateway con un'interfaccia per VLAN: uno
 * switch L3 o un router usa lo stesso MAC su tutte le sue reti):
 * - un MAC presente su due o più host online, in tutto il tenant, blocca l'intero gruppo: nessun suo host
 *   offline si archivia, nemmeno dopo i 60 giorni; quelli che una regola avrebbe preso vanno in `esclusi`
 *   con «MAC su più host online» (o col legame scritto a mano, se ne hanno uno);
 * - il cambio IP vale solo dentro la stessa rete (`networkId`): il vecchio IP con lo stesso MAC su un'altra
 *   rete non sparisce subito, resta alla regola dei 60 giorni.
 *
 * Solo `offline` è candidato: `online` e `unknown` mai. Le date sono nel formato di SQLite (UTC senza fuso) e
 * si leggono con `parseDbDate`, mai `new Date(x)` (CONTEXT §8). Una data che non si legge non fa candidato.
 * `macToHex` da solo riempie di zeri («AB:CD» → ABCD00000000): un MAC fa gruppo solo se ha 12 cifre
 * esadecimali e non è tutto zeri (`normalizeMacForStorage`).
 */
import { parseDbDate } from "@/lib/db-date";
import { macToHex, normalizeMacForStorage } from "@/lib/utils";

export const GIORNI_ASSENZA_ARCHIVIO = 60;

export interface HostPerPulizia {
  id: number;
  networkId: number;
  ip: string;
  mac: string | null;
  /** Il nome da mostrare: il nome vero, o l'IP se non ce n'è. */
  nome: string;
  /** Il nome vero (custom_name, hostname, dns_reverse), null se l'host non ne ha: l'IP di `nome` non conta. */
  nomeVero: string | null;
  status: "online" | "offline" | "unknown";
  lastSeen: string | null;
  firstSeen: string | null;
  createdAt: string | null;
  /** Motivo leggibile per cui l'host non si archivia mai (es. «apparato», «credenziali»), o null. */
  escluso: string | null;
}

export interface Candidato {
  id: number;
  ip: string;
  mac: string | null;
  nome: string;
  ultimaVista: string | null;
  motivo: "assente" | "cambio_ip";
  dettaglio: string;
}

export interface EsitoSelezione {
  candidati: Candidato[];
  esclusi: Array<{ id: number; ip: string; nome: string; perche: string }>;
}

const GIORNO_MS = 86_400_000;

export const PERCHE_MAC_SU_PIU_ONLINE = "MAC su più host online";

/** Millisecondi della data del DB, o null se manca o non si legge. */
function istante(valore: string | null): number | null {
  if (valore === null) return null;
  const ms = parseDbDate(valore).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Chiave del gruppo: il MAC in 12 cifre esadecimali maiuscole, o null se non è un MAC vero. */
function chiaveMac(mac: string | null): string | null {
  return mac !== null && normalizeMacForStorage(mac) ? macToHex(mac) : null;
}

/** Ordine per IP numerico (IPv4); quello che non è IPv4 va in fondo, in ordine di testo. */
function confrontaIp(a: string, b: string): number {
  const numero = (ip: string): number | null => {
    const parti = ip.trim().split(".");
    if (parti.length !== 4 || !parti.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
    return parti.reduce((acc, p) => acc * 256 + Number(p), 0);
  };
  const na = numero(a);
  const nb = numero(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Raggruppa per chiave, saltando gli host senza chiave. */
function raggruppa(host: HostPerPulizia[], chiave: (x: HostPerPulizia) => string | null): Map<string, HostPerPulizia[]> {
  const gruppi = new Map<string, HostPerPulizia[]>();
  for (const x of host) {
    const k = chiave(x);
    if (k === null) continue;
    const g = gruppi.get(k);
    if (g) g.push(x);
    else gruppi.set(k, [x]);
  }
  return gruppi;
}

/** Gli host il cui MAC (in tutto il tenant, attraverso le reti) è su due o più host online. */
function macSuPiuOnline(host: HostPerPulizia[]): Set<number> {
  const bloccati = new Set<number>();
  for (const g of raggruppa(host, (x) => chiaveMac(x.mac)).values()) {
    if (g.filter((x) => x.status === "online").length >= 2) for (const x of g) bloccati.add(x.id);
  }
  return bloccati;
}

/** Due nomi veri diversi: tutti e due presenti e diversi a meno di spazi e maiuscole. */
function nomiDiversi(a: string | null, b: string | null): boolean {
  const pulito = (n: string | null) => (n === null ? "" : n.trim().toLowerCase());
  return pulito(a) !== "" && pulito(b) !== "" && pulito(a) !== pulito(b);
}

/**
 * Regola 3, dentro la stessa rete e solo per una coppia (decisione di Riccardo del 20/10): nel gruppo (rete, MAC)
 * esattamente due host, uno online e uno offline visto prima di lui, senza nomi veri diversi → l'IP dell'online.
 * I gruppi bloccati da `macSuPiuOnline` li scarta il chiamante.
 */
function cambiIp(host: HostPerPulizia[]): Map<number, string> {
  const esito = new Map<number, string>();
  const gruppi = raggruppa(host, (x) => {
    const k = chiaveMac(x.mac);
    return k === null ? null : `${x.networkId}/${k}`;
  });
  for (const g of gruppi.values()) {
    if (g.length !== 2) continue;
    const nuovo = g.find((x) => x.status === "online");
    const vecchio = g.find((x) => x.status === "offline");
    if (!nuovo || !vecchio || nomiDiversi(nuovo.nomeVero, vecchio.nomeVero)) continue;
    const vistoNuovo = istante(nuovo.lastSeen);
    const vistoVecchio = istante(vecchio.lastSeen);
    if (vistoNuovo !== null && vistoVecchio !== null && vistoVecchio < vistoNuovo) esito.set(vecchio.id, nuovo.ip);
  }
  return esito;
}

/** `giorni`: la soglia di assenza del cliente (Opzioni, `soglie-pulizia.ts`); di serie GIORNI_ASSENZA_ARCHIVIO. */
export function selezionaCandidati(host: HostPerPulizia[], adesso: Date, giorni: number = GIORNI_ASSENZA_ARCHIVIO): EsitoSelezione {
  const soglia = adesso.getTime() - giorni * GIORNO_MS;
  const cambi = cambiIp(host);
  const bloccati = macSuPiuOnline(host);
  const candidati: Candidato[] = [];
  const esclusi: EsitoSelezione["esclusi"] = [];

  for (const x of host) {
    if (x.status !== "offline") continue;
    let motivo: Candidato["motivo"];
    let dettaglio: string;
    const ipNuovo = cambi.get(x.id);
    if (ipNuovo !== undefined) {
      motivo = "cambio_ip";
      dettaglio = `ora ${ipNuovo}`;
    } else {
      const riferimento = istante(x.lastSeen ?? x.firstSeen ?? x.createdAt);
      if (riferimento === null || riferimento >= soglia) continue;
      motivo = "assente";
      dettaglio = `assente da ${Math.floor((adesso.getTime() - riferimento) / GIORNO_MS)} giorni`;
    }
    const perche = x.escluso ?? (bloccati.has(x.id) ? PERCHE_MAC_SU_PIU_ONLINE : null);
    if (perche !== null) {
      esclusi.push({ id: x.id, ip: x.ip, nome: x.nome, perche });
      continue;
    }
    candidati.push({ id: x.id, ip: x.ip, mac: x.mac, nome: x.nome, ultimaVista: x.lastSeen, motivo, dettaglio });
  }

  candidati.sort((a, b) => (a.motivo === b.motivo ? confrontaIp(a.ip, b.ip) : a.motivo < b.motivo ? -1 : 1));
  esclusi.sort((a, b) => confrontaIp(a.ip, b.ip));
  return { candidati, esclusi };
}
