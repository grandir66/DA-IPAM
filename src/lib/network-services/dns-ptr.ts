/**
 * Calcolo PTR IPv4 coerente con zone reverse PowerDNS (/8, /16, /24).
 */

export interface PtrProposal {
  ip: string;
  forwardZone: string;
  hostnameFqdn: string;
  ptrName: string;
  reverseZone: string;
  reverseZoneExists: boolean;
  ptrExists: boolean;
  suggestedCidr: string;
}

export interface DnsRecordLike {
  name: string;
  type: string;
  contents: string[];
}

export interface DnsZoneLike {
  name: string;
}

function stripDot(s: string): string {
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

export { stripDot };

export function ensureDot(s: string): string {
  return s.endsWith(".") ? s : `${s}.`;
}

export function isForwardDnsZone(zoneName: string): boolean {
  return !stripDot(zoneName).includes("in-addr.arpa");
}

export function parseIpv4(ip: string): string | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
  }
  return parts.join(".");
}

export function ipv4PtrName(ip: string): string | null {
  const normalized = parseIpv4(ip);
  if (!normalized) return null;
  return `${normalized.split(".").reverse().join(".")}.in-addr.arpa`;
}

/** CIDR /24 di default per creare la zona reverse se assente. */
export function defaultReverseCidr(ip: string): string | null {
  const normalized = parseIpv4(ip);
  if (!normalized) return null;
  const [a, b, c] = normalized.split(".");
  return `${a}.${b}.${c}.0/24`;
}

export function reverseZoneFromCidr(cidr: string): string | null {
  const [addr, prefixStr] = cidr.trim().split("/");
  const prefix = Number(prefixStr);
  const ip = parseIpv4(addr);
  if (!ip || ![8, 16, 24].includes(prefix)) return null;
  const parts = ip.split(".");
  if (prefix === 24) return `${parts[2]}.${parts[1]}.${parts[0]}.in-addr.arpa`;
  if (prefix === 16) return `${parts[1]}.${parts[0]}.in-addr.arpa`;
  return `${parts[0]}.in-addr.arpa`;
}

export function forwardHostnameFqdn(recordName: string, forwardZone: string): string {
  const name = stripDot(recordName.trim());
  const zone = stripDot(forwardZone);
  if (!name) return ensureDot(zone);
  if (name.includes(".")) return ensureDot(name);
  return ensureDot(`${name}.${zone}`);
}

export function matchReverseZone(
  ip: string,
  zones: DnsZoneLike[],
): { reverseZone: string; ptrName: string } | null {
  const ptr = ipv4PtrName(ip);
  if (!ptr) return null;

  const reverseZones = zones
    .map((z) => stripDot(z.name))
    .filter((z) => z.endsWith(".in-addr.arpa"))
    .sort((a, b) => b.length - a.length);

  for (const zone of reverseZones) {
    if (ptr === zone || ptr.endsWith(`.${zone}`)) {
      return { reverseZone: ensureDot(zone), ptrName: ensureDot(ptr) };
    }
  }
  return null;
}

export function ptrRecordExists(records: DnsRecordLike[], ptrName: string): boolean {
  const target = stripDot(ptrName).toLowerCase();
  return records.some(
    (r) =>
      r.type === "PTR" &&
      stripDot(r.name).toLowerCase() === target &&
      r.contents.some((c) => c.trim().length > 0),
  );
}

export function proposePtrFromARecord(input: {
  recordName: string;
  ip: string;
  forwardZone: string;
  zones: DnsZoneLike[];
  reverseRecords?: DnsRecordLike[];
}): PtrProposal | null {
  const ip = parseIpv4(input.ip);
  if (!ip || !isForwardDnsZone(input.forwardZone)) return null;

  const hostnameFqdn = forwardHostnameFqdn(input.recordName, input.forwardZone);
  const ptrName = ensureDot(ipv4PtrName(ip)!);
  const match = matchReverseZone(ip, input.zones);
  const suggestedCidr = defaultReverseCidr(ip)!;
  const fallbackZone = reverseZoneFromCidr(suggestedCidr);

  const reverseZone = match?.reverseZone ?? ensureDot(fallbackZone ?? ptrName);
  const reverseZoneExists = match != null;

  const ptrExists =
    reverseRecordsProvided(input.reverseRecords) &&
    ptrRecordExists(input.reverseRecords!, ptrName);

  return {
    ip,
    forwardZone: ensureDot(stripDot(input.forwardZone)),
    hostnameFqdn,
    ptrName,
    reverseZone,
    reverseZoneExists,
    ptrExists: reverseZoneExists && ptrExists,
    suggestedCidr,
  };
}

function reverseRecordsProvided(records: DnsRecordLike[] | undefined): records is DnsRecordLike[] {
  return Array.isArray(records);
}

export function shouldOfferPtrProposal(
  type: string,
  forwardZone: string | null,
  ip: string,
): boolean {
  return type === "A" && !!forwardZone && isForwardDnsZone(forwardZone) && parseIpv4(ip) != null;
}
