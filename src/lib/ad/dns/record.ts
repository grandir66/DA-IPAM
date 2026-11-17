/**
 * Record DNS di Active Directory: come si leggono dall'attributo `dnsRecord` dei nodi `dnsNode`.
 *
 * Solo i record degli host (Riccardo, 17/11/2026: «solo per i record degli host A, CNAME, PTR…
 * non record di dominio»): A, AAAA, CNAME, PTR. Ogni altro tipo (SRV, NS, SOA…) dà `null`.
 *
 * Struttura del record: lunghezza dei dati (2 byte, little endian), tipo (2), versione (1),
 * rango (1), flag (2), seriale (4), TTL (4, big endian), riservato (4), ora del rinnovo
 * (4, ore dal 1601-01-01 UTC; zero = record statico), poi i dati.
 */

export type TipoRecordDns = "A" | "AAAA" | "CNAME" | "PTR";

export interface VoceDns {
  zona: string;
  nome: string;
  fqdn: string;
  tipo: TipoRecordDns;
  /** A: IPv4; AAAA: IPv6; CNAME e PTR: nome senza punto finale, minuscolo. */
  dato: string;
  /** A: l'IP; PTR: l'IP ricavato da nome e zona; altrimenti null. */
  ip: string | null;
  statica: boolean;
  /** Ultimo rinnovo, forma `datetime('now')` di SQLite (UTC); null per un record statico. */
  rinnovataIl: string | null;
  ttl: number;
}

export interface ZonaDns {
  nome: string;
  inversa: boolean;
  partizione: "dominio" | "foresta" | "sistema";
}

const TIPI: Record<number, TipoRecordDns> = { 1: "A", 5: "CNAME", 12: "PTR", 28: "AAAA" };
const INTESTAZIONE = 24;
const INIZIO_1601_MS = Date.UTC(1601, 0, 1);

/** Nome DNS nel formato di AD: lunghezza totale, numero di etichette, poi le etichette. */
function nomeDns(b: Buffer): string {
  const etichette: string[] = [];
  const quante = b[1] ?? 0;
  let p = 2;
  for (let i = 0; i < quante && p < b.length; i++) {
    const lunga = b[p] ?? 0;
    etichette.push(b.subarray(p + 1, p + 1 + lunga).toString("utf8"));
    p += 1 + lunga;
  }
  return etichette.join(".").toLowerCase().replace(/\.$/, "");
}

function ipv6(b: Buffer): string {
  const gruppi: string[] = [];
  for (let i = 0; i < 16; i += 2) gruppi.push(b.readUInt16BE(i).toString(16));
  return gruppi.join(":");
}

/** Data in forma `YYYY-MM-DD HH:MM:SS` (UTC), la stessa di `datetime('now')`. */
function formaSqlite(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

export function leggiRecord(b: Buffer): Pick<VoceDns, "tipo" | "dato" | "statica" | "rinnovataIl" | "ttl"> | null {
  if (b.length < INTESTAZIONE) return null;
  const tipo = TIPI[b.readUInt16LE(2)];
  if (!tipo) return null;
  const dati = b.subarray(INTESTAZIONE, INTESTAZIONE + b.readUInt16LE(0));
  let dato = "";
  if (tipo === "A") dato = dati.length >= 4 ? `${dati[0]}.${dati[1]}.${dati[2]}.${dati[3]}` : "";
  else if (tipo === "AAAA") dato = dati.length >= 16 ? ipv6(dati) : "";
  else dato = nomeDns(dati);
  if (!dato) return null;
  const ore = b.readUInt32LE(20);
  return {
    tipo,
    dato,
    statica: ore === 0,
    rinnovataIl: ore === 0 ? null : formaSqlite(INIZIO_1601_MS + ore * 3_600_000),
    ttl: b.readUInt32BE(12),
  };
}

/** Zona reverse IPv4? */
export function zonaInversa(zona: string): boolean {
  return /\.in-addr\.arpa$/i.test(zona);
}

/** IP di un PTR: le etichette del nodo più quelle della zona, rovesciate (vale anche per zone /16 e /8). */
export function ipDaPtr(nome: string, zona: string): string | null {
  if (!zonaInversa(zona)) return null;
  const parti = [...nome.split("."), ...zona.replace(/\.in-addr\.arpa$/i, "").split(".")].reverse();
  return parti.length === 4 && parti.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255) ? parti.join(".") : null;
}

/** Zone di servizio e di dominio: non sono zone degli host. */
export function zonaDiDominio(zona: string): boolean {
  const z = zona.toLowerCase();
  return z === "rootdnsservers" || z.startsWith("..") || z.startsWith("_msdcs");
}

/** Nodi di dominio dentro una zona degli host: apice, servizi (`_ldap._tcp`…), deleghe delle partizioni. */
export function nodoDiDominio(nome: string): boolean {
  const n = nome.toLowerCase();
  return n === "@" || n.startsWith("_") || n.includes("._") || n === "domaindnszones" || n === "forestdnszones";
}
