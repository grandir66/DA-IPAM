/**
 * Anomalie del DNS di Active Directory: dentro il DNS (doppioni, forward e reverse che non si
 * corrispondono, alias rotti) e rispetto a quello che DA-IPAM vede in rete. Funzione pura: non
 * legge e non scrive niente, si calcola a ogni richiesta dai record in archivio.
 *
 * Due freni al rumore (misura del 17/11/2026 sul 70791: 78 «IP sconosciuti» e 111 «host senza
 * nome», quasi tutti non errori): un IP conta come sconosciuto solo dentro una rete censita, e
 * un host conta come senza nome solo se è un computer di AD o ha già un nome in DA-IPAM.
 */
import type { VoceDns, ZonaDns } from "./record";

export const TIPI_ANOMALIA_DNS = [
  "ip_piu_nomi", "nome_piu_ip", "a_senza_ptr", "a_senza_zona_inversa", "ptr_altro_nome", "ptr_senza_a",
  "ip_piu_ptr", "cname_rotto", "nome_diverso", "host_spento", "ip_sconosciuto", "host_senza_nome",
] as const;
export type TipoAnomaliaDns = (typeof TIPI_ANOMALIA_DNS)[number];

export const ETICHETTE_ANOMALIA_DNS: Record<TipoAnomaliaDns, string> = {
  ip_piu_nomi: "Stesso IP, più nomi",
  nome_piu_ip: "Stesso nome, più IP",
  a_senza_ptr: "Nome senza reverse",
  a_senza_zona_inversa: "Manca la zona reverse",
  ptr_altro_nome: "Reverse con un altro nome",
  ptr_senza_a: "Reverse senza nome",
  ip_piu_ptr: "Stesso IP, più reverse",
  cname_rotto: "Alias verso un nome che non esiste",
  nome_diverso: "Nome diverso da DA-IPAM",
  host_spento: "Host spento da tempo",
  ip_sconosciuto: "IP che DA-IPAM non conosce",
  host_senza_nome: "Host acceso senza nome in DNS",
};

export interface AnomaliaDns {
  tipo: TipoAnomaliaDns;
  /** `tipo:ip` o `tipo:fqdn`, stabile fra una lettura e l'altra: è la chiave di «È voluto». */
  chiave: string;
  ip: string | null;
  nomi: string[];
  hostId: number | null;
  dettaglio: string;
  /** Tutti i record coinvolti sono statici: Windows non li toglierà mai da solo. */
  tuttoStatico: boolean;
}

export interface HostPerDns {
  id: number;
  ip: string;
  hostname: string | null;
  status: string | null;
  last_seen: string | null;
  inAd: boolean;
}

export interface DatiAnomalieDns {
  zone: readonly ZonaDns[];
  voci: readonly VoceDns[];
  host: readonly HostPerDns[];
  /** Reti censite, in forma CIDR IPv4. */
  reti: readonly string[];
  voluti: ReadonlySet<string>;
  adesso: Date;
  /** Giorni dopo i quali un host spento fa notizia. Di serie 30. */
  giorniSpento?: number;
}

function numero(ip: string): number | null {
  const o = ip.split(".");
  if (o.length !== 4) return null;
  let n = 0;
  for (const x of o) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = n * 256 + Number(x);
  }
  return n;
}

function dentro(ip: string, cidr: string): boolean {
  const [base, bit] = cidr.split("/");
  const a = numero(ip);
  const b = numero(base ?? "");
  const lunga = Number(bit);
  if (a == null || b == null || !Number.isInteger(lunga) || lunga < 0 || lunga > 32) return false;
  const passo = 2 ** (32 - lunga);
  return Math.floor(a / passo) === Math.floor(b / passo);
}

const corto = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().split(".")[0] ?? "";

function giorniDa(sqlite: string | null, adesso: Date): number | null {
  if (!sqlite) return null;
  const t = Date.parse(`${sqlite.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? null : Math.floor((adesso.getTime() - t) / 86_400_000);
}

function aggiungi<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

export function anomalieDns(dati: DatiAnomalieDns): AnomaliaDns[] {
  const giorniSpento = dati.giorniSpento ?? 30;
  const zone = new Set(dati.zone.map((z) => z.nome));
  const zoneDirette = dati.zone.filter((z) => !z.inversa).map((z) => z.nome);

  const aPerIp = new Map<string, VoceDns[]>();
  const aPerNome = new Map<string, VoceDns[]>();
  const ptrPerIp = new Map<string, VoceDns[]>();
  const nomiEsistenti = new Set<string>();
  for (const v of dati.voci) {
    if (v.tipo !== "PTR") nomiEsistenti.add(v.fqdn);
    if (v.tipo === "A") { aggiungi(aPerIp, v.dato, v); aggiungi(aPerNome, v.fqdn, v); }
    else if (v.tipo === "PTR" && v.ip) aggiungi(ptrPerIp, v.ip, v);
  }
  const hostPerIp = new Map<string, HostPerDns>();
  for (const h of dati.host) hostPerIp.set(h.ip, h);

  const esce: AnomaliaDns[] = [];
  const metti = (tipo: TipoAnomaliaDns, su: string, ip: string | null, nomi: string[], record: readonly VoceDns[], dettaglio: string) => {
    const chiave = `${tipo}:${su}`;
    if (dati.voluti.has(chiave)) return;
    esce.push({
      tipo, chiave, ip, nomi: [...new Set(nomi)].sort(), hostId: (ip ? hostPerIp.get(ip)?.id : undefined) ?? null,
      dettaglio, tuttoStatico: record.length > 0 && record.every((r) => r.statica),
    });
  };
  const haZonaInversa = (ip: string) => {
    const o = ip.split(".");
    return [`${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`, `${o[1]}.${o[0]}.in-addr.arpa`, `${o[0]}.in-addr.arpa`].some((z) => zone.has(z));
  };

  for (const [ip, record] of aPerIp) {
    const nomi = [...new Set(record.map((r) => r.fqdn))];
    if (nomi.length > 1) metti("ip_piu_nomi", ip, ip, nomi, record, `${nomi.length} nomi puntano a questo IP`);

    const ptr = ptrPerIp.get(ip);
    if (!ptr) {
      if (haZonaInversa(ip)) metti("a_senza_ptr", ip, ip, nomi, record, "Il nome c'è, il reverse no");
      else metti("a_senza_zona_inversa", ip, ip, nomi, record, "Nessuna zona reverse copre questo IP");
    } else if (!ptr.some((p) => nomi.includes(p.dato))) {
      metti("ptr_altro_nome", ip, ip, nomi, [...record, ...ptr], `Il reverse dice ${[...new Set(ptr.map((p) => p.dato))].join(", ")}`);
    } else {
      // Più nomi sullo stesso IP: si segnala ogni nome che non ha il suo reverse, anche se un altro ce l'ha
      // (Riccardo, 19/11/2026: «segnalare se ci sono discrepanze anche se talvolta sono previste»).
      const senza = nomi.filter((n) => !ptr.some((p) => p.dato === n));
      if (senza.length > 0) metti("a_senza_ptr", ip, ip, senza, record.filter((r) => senza.includes(r.fqdn)), `${senza.length} nomi su ${nomi.length} senza il loro reverse`);
    }

    const h = hostPerIp.get(ip);
    if (!h) {
      if (dati.reti.some((r) => dentro(ip, r))) metti("ip_sconosciuto", ip, ip, nomi, record, "DA-IPAM non ha mai visto un host su questo IP");
      continue;
    }
    const nomeIpam = corto(h.hostname);
    if (nomeIpam && !nomi.some((n) => corto(n) === nomeIpam)) {
      metti("nome_diverso", ip, ip, nomi, record, `In DA-IPAM questo IP si chiama ${nomeIpam}`);
    }
    const giorni = giorniDa(h.last_seen, dati.adesso);
    if (h.status === "offline" && (giorni == null || giorni > giorniSpento)) {
      metti("host_spento", ip, ip, nomi, record, giorni == null ? "DA-IPAM non l'ha mai visto acceso" : `Spento da ${giorni} giorni`);
    }
  }

  for (const [nome, record] of aPerNome) {
    const ip = [...new Set(record.map((r) => r.dato))];
    if (ip.length > 1) metti("nome_piu_ip", nome, null, [nome], record, `Punta a ${ip.sort().join(", ")}`);
  }

  for (const [ip, record] of ptrPerIp) {
    const nomi = [...new Set(record.map((r) => r.dato))];
    if (nomi.length > 1) metti("ip_piu_ptr", ip, ip, nomi, record, `${nomi.length} reverse per lo stesso IP`);
    const orfani = nomi.filter((n) => !aPerNome.get(n)?.some((a) => a.dato === ip));
    if (orfani.length === nomi.length) {
      metti("ptr_senza_a", ip, ip, nomi, record, "Il reverse c'è, ma nessun nome porta a questo IP");
    } else if (orfani.length > 0) {
      // Un reverse giusto non copre quello sbagliato accanto: si segnala il solo reverse rimasto indietro.
      metti("ptr_senza_a", ip, ip, orfani, record.filter((r) => orfani.includes(r.dato)), `Un reverse porta a ${orfani.join(", ")}, che non punta a questo IP`);
    }
  }

  for (const v of dati.voci) {
    if (v.tipo !== "CNAME") continue;
    if (zoneDirette.some((z) => v.dato.endsWith(`.${z}`)) && !nomiEsistenti.has(v.dato)) {
      metti("cname_rotto", v.fqdn, null, [v.fqdn], [v], `Punta a ${v.dato}, che non esiste`);
    }
  }

  for (const h of dati.host) {
    if (h.status !== "online" || aPerIp.has(h.ip)) continue;
    if (!h.inAd && !corto(h.hostname)) continue;
    metti("host_senza_nome", h.ip, h.ip, corto(h.hostname) ? [corto(h.hostname)] : [], [], h.inAd ? "È un computer del dominio, ma nel DNS non c'è" : "DA-IPAM lo conosce per nome, il DNS no");
  }

  const ordine = new Map(TIPI_ANOMALIA_DNS.map((t, i) => [t, i]));
  return esce.sort((x, y) => (ordine.get(x.tipo)! - ordine.get(y.tipo)!) || (numero(x.ip ?? "") ?? 0) - (numero(y.ip ?? "") ?? 0) || x.chiave.localeCompare(y.chiave));
}

export function conteggiAnomalieDns(anomalie: readonly AnomaliaDns[]): Record<TipoAnomaliaDns, number> {
  const c = Object.fromEntries(TIPI_ANOMALIA_DNS.map((t) => [t, 0])) as Record<TipoAnomaliaDns, number>;
  for (const a of anomalie) c[a.tipo]++;
  return c;
}
