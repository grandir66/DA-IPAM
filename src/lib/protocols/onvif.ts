/**
 * ONVIF (telecamere IP) — Attribution v2 Fase 4b Task 3 (spec §7.4).
 *
 * `GetDeviceInformation` è la chiamata SOAP più economica del profilo ONVIF
 * Device Management Service: espone produttore/modello/firmware/seriale in
 * modo dichiarativo — se un device la implementa, ONVIF stesso NE È la
 * definizione (categoria av.camera a 0.95, autoritativa, stesso trattamento
 * di `redfish` per compute.server).
 *
 * DATO DAL CAMPO (2026-07-28, rete reale con 13 telecamere Dahua, solo porte
 * 80/5000 aperte): una POST SOAP anonima su `/onvif/device_service` ritorna
 * risposta VUOTA — queste camere richiedono WS-Security UsernameToken
 * digest. Il percorso anonimo resta supportato (molte camere di altri vendor
 * rispondono comunque, spec Task 3) ma il valore reale su questa rete si
 * realizza SOLO con credenziali. Nessuna eccezione propagata: qualunque
 * fallimento (rete, timeout, XML malformato, SOAP Fault) degrada a `null`.
 *
 * Sicurezza operativa (Global Constraints del piano): il gate anti-lockout
 * (CredentialRunBudget) resta responsabilità del chiamante (discovery.ts) —
 * qui nessun retry implicito che lo aggirerebbe. Limite 256KB per risposta,
 * timeout 8s di default.
 */
import http from "http";
import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";
import { collectByLocalName } from "@/lib/scanner/probes/wsd";
import { vendorSlug, VENDOR_PLACEHOLDER_RE } from "@/lib/attribution/emitters";
import { isValidCategory } from "@/lib/attribution/taxonomy";
import type { EvidenceInput } from "@/lib/attribution/types";

export interface OnvifInfo {
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  serialNumber: string | null;
  hardwareId: string | null;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 256 * 1024;
const SOAP_PATH = "/onvif/device_service";
// Ordine di fallback quando l'opzione port non è specificata (spec Task 3:
// "porta 80, prova anche 8000 e 8080 solo se 80 fallisce").
const FALLBACK_PORTS = [80, 8000, 8080] as const;

const WSSE_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const WSU_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const PASSWORD_DIGEST_TYPE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest";
const NONCE_ENCODING_TYPE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";

interface RawResponse {
  status: number;
  body: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * PURA — costruisce il blocco `<wsse:Security>` UsernameToken con Password
 * digest (profilo WS-Security Username Token 1.0): `Digest = Base64(SHA1(
 * Nonce(raw bytes) + Created(utf8) + Password(utf8)))`. Nonce/Created presi
 * come parametro (non generati qui) per essere testabile deterministicamente
 * senza rete — la generazione reale (nonce casuale, timestamp corrente) vive
 * in `buildEnvelope`.
 */
export function buildWsSecurityHeader(user: string, pass: string, nonceB64: string, createdIso: string): string {
  const nonceBytes = Buffer.from(nonceB64, "base64");
  const digest = crypto
    .createHash("sha1")
    .update(Buffer.concat([nonceBytes, Buffer.from(createdIso, "utf8"), Buffer.from(pass, "utf8")]))
    .digest("base64");
  return (
    `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}" soap:mustUnderstand="1">` +
    `<wsse:UsernameToken>` +
    `<wsse:Username>${escapeXml(user)}</wsse:Username>` +
    `<wsse:Password Type="${PASSWORD_DIGEST_TYPE}">${digest}</wsse:Password>` +
    `<wsse:Nonce EncodingType="${NONCE_ENCODING_TYPE}">${nonceB64}</wsse:Nonce>` +
    `<wsu:Created>${createdIso}</wsu:Created>` +
    `</wsse:UsernameToken>` +
    `</wsse:Security>`
  );
}

/** Busta SOAP `GetDeviceInformation`: con header WS-Security se `user`/`pass` presenti, altrimenti richiesta anonima (spec: "molte camere rispondono anche anonime"). */
function buildEnvelope(user: string | null, pass: string | null): string {
  let header = "";
  if (user && pass) {
    const nonceB64 = crypto.randomBytes(16).toString("base64");
    const createdIso = new Date().toISOString();
    header = `<soap:Header>${buildWsSecurityHeader(user, pass, nonceB64, createdIso)}</soap:Header>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
    header +
    `<soap:Body><tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/></soap:Body>` +
    `</soap:Envelope>`
  );
}

/**
 * POST grezza HTTP (ONVIF è tipicamente in chiaro sulla porta 80/8000/8080,
 * mai HTTPS): limite `MAX_BODY_BYTES`, timeout esplicito, mai eccezioni —
 * qualunque fallimento (rete, timeout, socket) risolve a `null`.
 */
function httpPost(ip: string, port: number, path: string, body: string, timeoutMs: number): Promise<RawResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    let req: ReturnType<typeof http.request> | null = null;

    const finish = (result: RawResponse | null) => {
      if (settled) return;
      settled = true;
      req?.destroy();
      resolve(result);
    };

    try {
      req = http.request(
        {
          host: ip,
          port,
          path,
          method: "POST",
          timeout: timeoutMs,
          headers: {
            "Content-Type": "application/soap+xml; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            if (settled) return;
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
              finish(null);
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", () => finish(null));
        }
      );
      req.on("timeout", () => finish(null));
      req.on("error", () => finish(null));
      req.write(body);
      req.end();
    } catch {
      finish(null);
    }
  });
}

/** Prima occorrenza di un tag per nome locale (namespace-agnostico, riusa `collectByLocalName` di wsd.ts). */
function firstLocal(node: unknown, localName: string): string | null {
  const vals = collectByLocalName(node, localName);
  const first = vals.find((v) => v.trim() !== "");
  return first ? first.trim() : null;
}

/**
 * Parsing PURO della risposta SOAP `GetDeviceInformationResponse`:
 * namespace-agnostico (`removeNSPrefix`, stesso pattern di `wsd.ts`) — i
 * prefissi variano per implementazione (`tds:`, `ns0:`, nessuno...). SOAP
 * Fault, XML malformato o risposta senza alcun campo utile → `null`, mai
 * un'eccezione.
 */
export function parseDeviceInformation(xml: string): OnvifInfo | null {
  if (!xml || xml.trim() === "") return null;
  try {
    // parseTagValue:false — senza, fast-xml-parser converte automaticamente
    // valori numeric-like (es. HardwareId "1.00") in number, perdendo zeri/
    // precisione ("1.00" -> 1): tutti i campi qui devono restare stringhe.
    const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });
    const parsed: unknown = parser.parse(xml);
    if (collectByLocalName(parsed, "Fault").length > 0) return null;

    const manufacturer = firstLocal(parsed, "Manufacturer");
    const model = firstLocal(parsed, "Model");
    const firmwareVersion = firstLocal(parsed, "FirmwareVersion");
    const serialNumber = firstLocal(parsed, "SerialNumber");
    const hardwareId = firstLocal(parsed, "HardwareId");

    if (!manufacturer && !model && !firmwareVersion && !serialNumber && !hardwareId) return null;
    return { manufacturer, model, firmwareVersion, serialNumber, hardwareId };
  } catch {
    return null;
  }
}

/**
 * `GetDeviceInformation` su `http://<ip>/onvif/device_service`: porta 80 di
 * default, fallback 8000/8080 SOLO se 80 non risponde (spec Task 3) — a meno
 * che `opts.port` non fissi una porta esplicita (usato da chi ha già
 * individuato la porta funzionante, es. discovery.ts dopo il primo
 * successo). Con `user`/`pass` usa WS-Security digest; senza, richiesta
 * anonima (funziona su alcune camere, non sulle Dahua osservate sul campo —
 * vedi commento di testa). Nessuna eccezione propagata.
 */
export async function onvifGetDeviceInformation(
  ip: string,
  user: string | null,
  pass: string | null,
  opts?: { port?: number; timeoutMs?: number }
): Promise<OnvifInfo | null> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ports = opts?.port != null ? [opts.port] : FALLBACK_PORTS;
  const body = buildEnvelope(user, pass);

  for (const port of ports) {
    try {
      const resp = await httpPost(ip, port, SOAP_PATH, body, timeoutMs);
      if (!resp || resp.status >= 400) continue;
      const info = parseDeviceInformation(resp.body);
      if (info) return info;
    } catch {
      continue;
    }
  }
  return null;
}

const ONVIF_CATEGORY = "av.camera";
const ONVIF_CONFIDENCE = 0.95;

/**
 * Evidenze PURE da `OnvifInfo`: `GetDeviceInformation` risolto è per
 * definizione un servizio ONVIF su un dispositivo video → `category=av.camera`
 * 0.95 (autoritativa, vedi `AUTHORITATIVE_SOURCES.category` in weights.ts).
 * `vendor` da `manufacturer` via `vendorSlug`, saltato se placeholder
 * (`VENDOR_PLACEHOLDER_RE`). Modello/firmware/seriale finiscono in
 * `raw_value`, mai nel claim.
 */
export function onvifEvidence(info: OnvifInfo): EvidenceInput[] {
  const out: EvidenceInput[] = [];

  if (isValidCategory(ONVIF_CATEGORY)) {
    out.push({
      source: "onvif",
      phase: "credential_validate",
      dimension: "category",
      claim: ONVIF_CATEGORY,
      confidence: ONVIF_CONFIDENCE,
      raw_value: [info.model, info.firmwareVersion].filter(Boolean).join(", ") || null,
    });
  }

  if (info.manufacturer && !VENDOR_PLACEHOLDER_RE.test(info.manufacturer.trim())) {
    out.push({
      source: "onvif",
      phase: "credential_validate",
      dimension: "vendor",
      claim: vendorSlug(info.manufacturer),
      confidence: ONVIF_CONFIDENCE,
      raw_value: info.manufacturer,
    });
  }

  return out;
}
