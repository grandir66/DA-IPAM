/**
 * Probe mDNS passivo per attribuzione (fase 3 §4.5): query DNS **unicast** (mai
 * multicast/broadcast, per non generare traffico di scoperta su tutta la LAN)
 * verso <ip>:5353, con il bit QU (unicast response, RFC 6762 §5.4) impostato
 * nella classe della domanda. Nessuna autenticazione, nessuno stato: solo
 * domande e risposte DNS standard. Parsing difensivo con limiti di buffer
 * verificati ad ogni lettura (inclusa la compressione dei nomi, puntatori
 * 0xC0): qualunque anomalia produce un risultato parziale o `null`, mai
 * un'eccezione propagata.
 */
import dgram from "dgram";

export interface MdnsFinding {
  services: string[]; // service type/instance osservati (es. "_ipp._tcp.local")
  model: string | null; // TXT "model" di _device-info._tcp
  usbMfg: string | null; // TXT "usb_MFG" di _ipp._tcp / _pdl-datastream._tcp
  usbMdl: string | null; // TXT "usb_MDL" di _ipp._tcp / _pdl-datastream._tcp
  hapCategory: number | null; // TXT "ci" di _hap._tcp (HomeKit accessory category)
}

const DEFAULT_TIMEOUT_MS = 2000;
const MDNS_PORT = 5353;
const MAX_DNS_JUMPS = 20; // difesa da catene di puntatori di compressione malformate
const MAX_RESOURCE_RECORDS = 128; // difesa da ANCOUNT/NSCOUNT/ARCOUNT dichiarati abnormi

const DNS_TYPE_PTR = 12;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_SRV = 33;
const DNS_TYPE_ANY = 255;
const DNS_CLASS_IN_QU = 0x8001; // IN + bit QU (top bit) per risposta unicast

const PTR_META_SERVICE = "_services._dns-sd._udp.local";
const TARGET_SERVICES = [
  "_device-info._tcp.local",
  "_ipp._tcp.local",
  "_hap._tcp.local",
  "_airplay._tcp.local",
  "_googlecast._tcp.local",
] as const;

// ---------------------------------------------------------------------------
// Costruzione query DNS
// ---------------------------------------------------------------------------

function encodeDnsName(name: string): Buffer {
  const labels = name.split(".").filter((l) => l.length > 0);
  const parts: Buffer[] = [];
  for (const label of labels) {
    const labelBuf = Buffer.from(label, "utf8");
    if (labelBuf.length > 63) return Buffer.from([0]); // nome anomalo: query vuota, non un crash
    parts.push(Buffer.from([labelBuf.length]), labelBuf);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function buildDnsQuery(id: number, qname: string, qtype: number): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0000, 2); // query standard, nessun flag
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const nameBuf = encodeDnsName(qname);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(qtype, 0);
  tail.writeUInt16BE(DNS_CLASS_IN_QU, 2);
  return Buffer.concat([header, nameBuf, tail]);
}

function buildAllQueries(): Buffer[] {
  const queries: Buffer[] = [buildDnsQuery(1, PTR_META_SERVICE, DNS_TYPE_PTR)];
  TARGET_SERVICES.forEach((svc, i) => queries.push(buildDnsQuery(2 + i, svc, DNS_TYPE_ANY)));
  return queries;
}

// ---------------------------------------------------------------------------
// Parsing difensivo dei messaggi DNS: ogni lettura verifica prima i limiti
// del buffer; catene di puntatori limitate a MAX_DNS_JUMPS.
// ---------------------------------------------------------------------------

interface DnsNameResult {
  name: string;
  nextOffset: number; // offset subito dopo il nome nel flusso originale (non nel target del puntatore)
}

function readDnsName(buf: Buffer, startOffset: number): DnsNameResult | null {
  const labels: string[] = [];
  let offset = startOffset;
  let jumps = 0;
  let sawPointer = false;
  let afterPointerOffset = -1;

  for (;;) {
    if (offset < 0 || offset >= buf.length) return null;
    const len = buf[offset];
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (offset + 1 >= buf.length) return null;
      if (!sawPointer) {
        afterPointerOffset = offset + 2;
        sawPointer = true;
      }
      jumps += 1;
      if (jumps > MAX_DNS_JUMPS) return null;
      offset = ((len & 0x3f) << 8) | buf[offset + 1];
      continue;
    }
    if ((len & 0xc0) !== 0) return null; // valori riservati (0x40/0x80) non validi
    const labelStart = offset + 1;
    const labelEnd = labelStart + len;
    if (labelEnd > buf.length) return null;
    labels.push(buf.subarray(labelStart, labelEnd).toString("utf8"));
    offset = labelEnd;
  }

  return { name: labels.join("."), nextOffset: sawPointer ? afterPointerOffset : offset };
}

interface DnsRecord {
  name: string;
  type: number;
  rdata: Buffer;
  rdataOffset: number; // offset assoluto nel buffer originale (serve per decodificare nomi compressi nel rdata, es. PTR)
}

function parseDnsMessage(buf: Buffer): DnsRecord[] | null {
  if (buf.length < 12) return null;
  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);
  const nscount = buf.readUInt16BE(8);
  const arcount = buf.readUInt16BE(10);

  let offset = 12;
  for (let i = 0; i < qdcount; i++) {
    const nameRes = readDnsName(buf, offset);
    if (!nameRes) return null;
    offset = nameRes.nextOffset + 4; // QTYPE(2) + QCLASS(2)
    if (offset > buf.length) return null;
  }

  const records: DnsRecord[] = [];
  const totalRR = Math.min(ancount + nscount + arcount, MAX_RESOURCE_RECORDS);
  for (let i = 0; i < totalRR; i++) {
    const nameRes = readDnsName(buf, offset);
    if (!nameRes) break;
    offset = nameRes.nextOffset;
    if (offset + 10 > buf.length) break; // TYPE(2)+CLASS(2)+TTL(4)+RDLENGTH(2)
    const type = buf.readUInt16BE(offset);
    const rdlength = buf.readUInt16BE(offset + 8);
    const rdataOffset = offset + 10;
    const rdataEnd = rdataOffset + rdlength;
    if (rdataEnd > buf.length) break;
    records.push({ name: nameRes.name, type, rdata: buf.subarray(rdataOffset, rdataEnd), rdataOffset });
    offset = rdataEnd;
  }
  return records;
}

/**
 * Parsing delle TXT character-strings (RFC 1035 §3.3: length-byte + byte).
 * Ogni stringa è "key=value" (o solo "key" per i flag booleani, RFC 6763
 * §6.4). Chiavi normalizzate in minuscolo (case-insensitive per spec).
 * Esportata per i test: è la parte di parsing più fragile insieme a
 * `parseNtlmChallenge` in smb2.ts, merita buffer costruiti a mano.
 */
export function parseTxtRecords(buf: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Buffer.isBuffer(buf)) return result;
  let offset = 0;
  while (offset < buf.length) {
    const len = buf[offset];
    const start = offset + 1;
    const end = start + len;
    if (end > buf.length) break; // character-string troncata: fermarsi, non leggere oltre
    if (len > 0) {
      const raw = buf.subarray(start, end).toString("utf8");
      const eq = raw.indexOf("=");
      const key = (eq === -1 ? raw : raw.slice(0, eq)).trim().toLowerCase();
      const value = eq === -1 ? "" : raw.slice(eq + 1);
      if (key) result[key] = value;
    }
    offset = end;
  }
  return result;
}

function normalizeServiceName(name: string): string {
  return name.toLowerCase().replace(/\.$/, "");
}

function matchesService(name: string, type: string): boolean {
  return normalizeServiceName(name).includes(type.toLowerCase());
}

function aggregateFindings(packets: Buffer[]): MdnsFinding {
  const services = new Set<string>();
  let model: string | null = null;
  let usbMfg: string | null = null;
  let usbMdl: string | null = null;
  let hapCategory: number | null = null;

  for (const pkt of packets) {
    let records: DnsRecord[] | null;
    try {
      records = parseDnsMessage(pkt);
    } catch {
      records = null;
    }
    if (!records) continue;

    for (const rec of records) {
      if (rec.type === DNS_TYPE_PTR) {
        const target = readDnsName(pkt, rec.rdataOffset);
        if (target) services.add(normalizeServiceName(target.name));
        continue;
      }
      if (rec.type === DNS_TYPE_SRV) {
        services.add(normalizeServiceName(rec.name));
        continue;
      }
      if (rec.type !== DNS_TYPE_TXT) continue;

      services.add(normalizeServiceName(rec.name));
      const txt = parseTxtRecords(rec.rdata);

      if (matchesService(rec.name, "_device-info._tcp")) {
        model = model ?? (txt["model"] || null);
      }
      if (matchesService(rec.name, "_ipp._tcp") || matchesService(rec.name, "_pdl-datastream._tcp")) {
        usbMfg = usbMfg ?? (txt["usb_mfg"] || null);
        usbMdl = usbMdl ?? (txt["usb_mdl"] || null);
      }
      if (matchesService(rec.name, "_hap._tcp")) {
        const ci = txt["ci"];
        if (ci !== undefined && hapCategory === null) {
          const n = Number(ci);
          if (Number.isFinite(n)) hapCategory = n;
        }
      }
    }
  }

  return { services: Array.from(services), model, usbMfg, usbMdl, hapCategory };
}

function collectMdnsResponses(ip: string, timeoutMs: number): Promise<Buffer[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const packets: Buffer[] = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // già chiuso
      }
      resolve(packets);
    };

    const timer = setTimeout(finish, timeoutMs);
    socket.on("message", (msg) => packets.push(msg));
    socket.on("error", finish);
    socket.once("listening", () => {
      try {
        for (const q of buildAllQueries()) socket.send(q, MDNS_PORT, ip);
      } catch {
        finish();
      }
    });
    try {
      socket.bind(0);
    } catch {
      finish();
    }
  });
}

/**
 * Query DNS unicast verso <ip>:5353: PTR di `_services._dns-sd._udp.local`
 * più TXT/SRV (via ANY) dei servizi noti. Ritorna `null` se non arriva
 * nessuna risposta entro il timeout (host senza mDNS) o su qualunque errore.
 */
export async function probeMdns(ip: string, opts?: { timeoutMs?: number }): Promise<MdnsFinding | null> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const packets = await collectMdnsResponses(ip, timeoutMs);
    if (packets.length === 0) return null;
    return aggregateFindings(packets);
  } catch {
    return null;
  }
}
