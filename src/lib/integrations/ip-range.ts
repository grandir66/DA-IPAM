/**
 * Supporto CIDR per le identita' "nostre" (reti aziendali, cloud).
 *
 * Perche' l'espansione e non un match nativo: nell'indice Wazuh i campi IP
 * (data.srcip, data.win.eventdata.ipAddress, data.office365.ClientIP) sono
 * mappati come `keyword`, non come tipo `ip`. Un `term` con notazione CIDR su
 * un keyword restituisce zero risultati — verificato sul campo. Le reti vanno
 * quindi trasformate negli indirizzi che contengono.
 */

/** Oltre questa soglia si rinuncia: una /8 genererebbe 16 milioni di termini. */
const MAX_EXPANDED_HOSTS = 1024;

export function isCidr(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(value.trim());
}

function toLong(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

function toIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function parseCidr(cidr: string): { base: number; size: number } | null {
  if (!isCidr(cidr)) return null;
  const [addr, bitsRaw] = cidr.trim().split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const long = toLong(addr!);
  if (long === null) return null;
  const size = 2 ** (32 - bits);
  const mask = size === 2 ** 32 ? 0 : ~(size - 1) >>> 0;
  return { base: (long & mask) >>> 0, size };
}

export function ipInCidr(ip: string | null | undefined, cidr: string): boolean {
  if (!ip) return false;
  const parsed = parseCidr(cidr);
  if (!parsed) return false;
  const long = toLong(ip);
  if (long === null) return false;
  return long >= parsed.base && long < parsed.base + parsed.size;
}

/**
 * Trasforma una lista mista di indirizzi e reti negli indirizzi da usare in un
 * `terms`. Le reti troppo ampie vengono scartate: meglio sopprimere meno del
 * dovuto che spedire migliaia di termini a ogni query.
 */
export function expandIpEntries(entries: string[]): string[] {
  const out = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (!isCidr(entry)) {
      out.add(entry);
      continue;
    }
    const parsed = parseCidr(entry);
    if (!parsed || parsed.size > MAX_EXPANDED_HOSTS) continue;
    for (let i = 0; i < parsed.size; i++) out.add(toIp(parsed.base + i));
  }
  return [...out];
}
