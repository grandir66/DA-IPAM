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
  ip: string;
  mac: string | null;
  nome: string;
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

/** Regola 3: per ogni offline del gruppo, l'IP dell'unico online se il vecchio è stato visto prima di lui. */
function cambiIp(host: HostPerPulizia[]): Map<number, string> {
  const gruppi = new Map<string, HostPerPulizia[]>();
  for (const x of host) {
    const k = chiaveMac(x.mac);
    if (k === null) continue;
    const g = gruppi.get(k);
    if (g) g.push(x);
    else gruppi.set(k, [x]);
  }
  const esito = new Map<number, string>();
  for (const g of gruppi.values()) {
    const online = g.filter((x) => x.status === "online");
    if (online.length !== 1) continue;
    const nuovo = online[0];
    const vistoNuovo = istante(nuovo.lastSeen);
    if (vistoNuovo === null) continue;
    for (const vecchio of g) {
      if (vecchio.status !== "offline" || vecchio.ip === nuovo.ip) continue;
      const vistoVecchio = istante(vecchio.lastSeen);
      if (vistoVecchio !== null && vistoVecchio < vistoNuovo) esito.set(vecchio.id, nuovo.ip);
    }
  }
  return esito;
}

export function selezionaCandidati(host: HostPerPulizia[], adesso: Date): EsitoSelezione {
  const soglia = adesso.getTime() - GIORNI_ASSENZA_ARCHIVIO * GIORNO_MS;
  const cambi = cambiIp(host);
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
    if (x.escluso !== null) {
      esclusi.push({ id: x.id, ip: x.ip, nome: x.nome, perche: x.escluso });
      continue;
    }
    candidati.push({ id: x.id, ip: x.ip, mac: x.mac, nome: x.nome, ultimaVista: x.lastSeen, motivo, dettaglio });
  }

  candidati.sort((a, b) => (a.motivo === b.motivo ? confrontaIp(a.ip, b.ip) : a.motivo < b.motivo ? -1 : 1));
  esclusi.sort((a, b) => confrontaIp(a.ip, b.ip));
  return { candidati, esclusi };
}
