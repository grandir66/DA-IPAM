/**
 * Probe WS-Discovery passivo per attribuzione (fase 3 §4.5): Probe SOAP
 * **unicast** (mai multicast, per non generare traffico di scoperta su tutta
 * la LAN) verso <ip>:3702. Estrae `Types`/`Scopes` dal ProbeMatch in modo
 * **namespace-agnostico**: i prefissi dei tag SOAP variano tra implementazioni
 * (`wsd:`, `d:`, `soap:`...), quindi il parsing rimuove i prefissi dei TAG
 * (`removeNSPrefix`) e cerca per nome locale. I *contenuti* di `Types` restano
 * invece QName con il proprio prefisso (es. "dn:NetworkVideoTransmitter"): la
 * mappatura in `evidenceFromWsd` fa match per sottostringa sul nome locale del
 * tipo, quindi resta corretta indipendentemente dall'alias scelto dal device.
 * Nessuna eccezione propagata: qualunque anomalia produce `null`.
 */
import dgram from "dgram";
import { randomUUID } from "crypto";
import { XMLParser } from "fast-xml-parser";

export interface WsdFinding {
  types: string[];
  scopes: string[];
}

const DEFAULT_TIMEOUT_MS = 2000;
const WSD_PORT = 3702;

function buildProbeMessage(messageId: string): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <e:Header>
    <w:MessageID>urn:uuid:${messageId}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe/>
  </e:Body>
</e:Envelope>`;
  return Buffer.from(xml, "utf8");
}

/** Invia il Probe e attende il primo datagramma di risposta (ProbeMatches) entro il timeout. */
function collectWsdResponse(ip: string, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const finish = (result: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // già chiuso
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("message", (msg) => finish(msg));
    socket.on("error", () => finish(null));
    socket.once("listening", () => {
      try {
        socket.send(buildProbeMessage(randomUUID()), WSD_PORT, ip);
      } catch {
        finish(null);
      }
    });
    try {
      socket.bind(0);
    } catch {
      finish(null);
    }
  });
}

/**
 * Raccoglie ricorsivamente i valori testuali di tutti i tag il cui nome
 * (dopo `removeNSPrefix`) e' esattamente `localName`, ovunque si trovino
 * nell'albero (ProbeMatch puo' essere singolo oggetto o array). Esportata
 * per i test: e' la parte di parsing piu' fragile del probe.
 */
export function collectByLocalName(node: unknown, localName: string, acc: string[] = []): string[] {
  if (node === null || node === undefined) return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectByLocalName(item, localName, acc);
    return acc;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === localName) {
        if (typeof value === "string") {
          acc.push(value);
        } else if (value && typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
          const text = (value as Record<string, unknown>)["#text"];
          if (typeof text === "string") acc.push(text);
        }
        continue;
      }
      collectByLocalName(value, localName, acc);
    }
  }
  return acc;
}

/** Types/Scopes sono liste separate da whitespace (QName per Types, URI per Scopes). */
function splitWhitespaceLists(raw: string[]): string[] {
  return raw
    .flatMap((s) => s.split(/\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parsing del ProbeMatches SOAP: namespace-agnostico via `removeNSPrefix`. Mai eccezioni. */
function parseProbeMatches(xml: string): WsdFinding {
  try {
    const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
    const parsed: unknown = parser.parse(xml);
    const types = splitWhitespaceLists(collectByLocalName(parsed, "Types"));
    const scopes = splitWhitespaceLists(collectByLocalName(parsed, "Scopes"));
    return { types, scopes };
  } catch {
    return { types: [], scopes: [] };
  }
}

/**
 * WS-Discovery Probe unicast verso <ip>:3702: genera un MessageID uuid,
 * invia il Probe SOAP e parsa la ProbeMatch. Ritorna `null` se non arriva
 * nessuna risposta entro il timeout o su qualunque errore.
 */
export async function probeWsd(ip: string, opts?: { timeoutMs?: number }): Promise<WsdFinding | null> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const resp = await collectWsdResponse(ip, timeoutMs);
    if (!resp) return null;
    return parseProbeMatches(resp.toString("utf8"));
  } catch {
    return null;
  }
}
