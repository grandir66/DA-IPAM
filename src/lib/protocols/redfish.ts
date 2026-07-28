/**
 * Redfish (BMC iLO/iDRAC/XClarity) — Attribution v2 Fase 4b Task 1 (spec §7.4).
 *
 * Un BMC (iLO/iDRAC/XClarity/…) espone via HTTPS un'API Redfish che descrive
 * l'HARDWARE del server ospite (produttore, modello, seriale, firmware) — dati
 * altrimenti irraggiungibili da probe/credenziali OS (l'host `ILOSGH942WX1N`
 * della spec è oggi `unknown` proprio per questo). Il service root
 * (`GET /redfish/v1/`) è quasi sempre anonimo: `redfishDetect` lo sfrutta per
 * un'evidenza debole senza credenziali; `redfishFetchInfo` con Basic Auth
 * naviga fino alla risorsa ComputerSystem per i campi completi.
 *
 * Sicurezza operativa (Global Constraints del piano): certificati BMC
 * self-signed → `rejectUnauthorized:false`; timeout 8s e limite 256KB per
 * risposta per non restare appesi su un BMC lento/malevolo; NESSUNA eccezione
 * propagata al chiamante — ogni funzione pubblica intercetta tutto e degrada a
 * null/`{present:false}`/`{ok:false}`. Il gate anti-lockout (CredentialRunBudget)
 * resta responsabilità del chiamante (`scanner/discovery.ts`), qui NON si fanno
 * retry impliciti che aggirerebbero il budget.
 *
 * Le funzioni di parsing (`parseServiceRoot`, `parseSystemResource`,
 * `parseFirstMemberPath`, `parseManagerFirmware`) sono PURE ed esportate
 * separatamente dall'I/O di rete (stesso pattern di `http-tls.ts`/`smb2.ts`):
 * permette di testare "JSON malformato", "risposta non-Redfish" ecc. senza
 * aprire socket veri.
 */
import https from "https";
import { vendorSlug, VENDOR_PLACEHOLDER_RE } from "@/lib/attribution/emitters";
import { isValidCategory } from "@/lib/attribution/taxonomy";
import type { EvidenceInput } from "@/lib/attribution/types";

export interface RedfishInfo {
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  biosVersion: string | null;
  bmcFirmware: string | null;
  powerState: string | null;
  healthStatus: string | null;
  hostName: string | null;
  sku: string | null;
}

export interface RedfishDetectResult {
  present: boolean;
  vendorHint: string | null;
}

const DEFAULT_PORT = 443;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 256 * 1024;
const SERVICE_ROOT_PATH = "/redfish/v1/";
const DEFAULT_SYSTEMS_PATH = "/redfish/v1/Systems";
const DEFAULT_MANAGERS_PATH = "/redfish/v1/Managers";

interface RawResponse {
  status: number;
  body: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function basicAuthHeader(user: string, pass: string): Record<string, string> {
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/** Estrae il path da un riferimento Redfish `{"@odata.id": "..."}`. */
function odataId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return strOrNull(value["@odata.id"]);
}

/**
 * GET grezza su HTTPS: certificato self-signed accettato (`rejectUnauthorized:false`,
 * i BMC non hanno mai un certificato valido), limite `MAX_BODY_BYTES` (oltre soglia
 * la risposta viene scartata, mai un buffer illimitato), timeout esplicito. Mai
 * eccezioni: qualunque fallimento (rete, timeout, socket) risolve a `null`.
 */
function httpsGet(
  ip: string,
  port: number,
  path: string,
  opts: { timeoutMs: number; headers?: Record<string, string> }
): Promise<RawResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    let req: ReturnType<typeof https.request> | null = null;

    const finish = (result: RawResponse | null) => {
      if (settled) return;
      settled = true;
      req?.destroy();
      resolve(result);
    };

    try {
      req = https.request(
        {
          host: ip,
          port,
          path,
          method: "GET",
          rejectUnauthorized: false,
          timeout: opts.timeoutMs,
          headers: { Accept: "application/json", ...opts.headers },
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
      req.end();
    } catch {
      finish(null);
    }
  });
}

/** vendorHint dal service root: `Vendor` diretto (Dell) oppure prima chiave di `Oem` (HPE→"Hpe", Lenovo→"Lenovo"). */
function extractVendorHint(root: Record<string, unknown>): string | null {
  const vendor = strOrNull(root["Vendor"]);
  if (vendor) return vendor;
  const oem = root["Oem"];
  if (isRecord(oem)) {
    const keys = Object.keys(oem);
    if (keys.length > 0) return keys[0];
  }
  return null;
}

/**
 * Parsing PURO del service root Redfish (`GET /redfish/v1/`). Un BMC reale
 * dichiara `@odata.id` e/o `RedfishVersion`: se mancano entrambi, o il body non
 * è un JSON valido/oggetto, `present:false` (mai un'eccezione).
 */
export function parseServiceRoot(body: string): RedfishDetectResult {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { present: false, vendorHint: null };
  }
  if (!isRecord(json)) return { present: false, vendorHint: null };
  const hasOdataId = typeof json["@odata.id"] === "string" && json["@odata.id"].trim() !== "";
  const hasVersion = typeof json["RedfishVersion"] === "string" && json["RedfishVersion"].trim() !== "";
  if (!hasOdataId && !hasVersion) return { present: false, vendorHint: null };
  return { present: true, vendorHint: extractVendorHint(json) };
}

/** Parsing PURO dei campi rilevanti di una risorsa ComputerSystem Redfish. JSON malformato/non-oggetto → null. */
export function parseSystemResource(body: string): Omit<RedfishInfo, "bmcFirmware"> | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  const status = isRecord(json["Status"]) ? json["Status"] : null;
  return {
    manufacturer: strOrNull(json["Manufacturer"]),
    model: strOrNull(json["Model"]),
    serialNumber: strOrNull(json["SerialNumber"]),
    biosVersion: strOrNull(json["BiosVersion"]),
    powerState: strOrNull(json["PowerState"]),
    healthStatus: status ? strOrNull(status["Health"]) : null,
    hostName: strOrNull(json["HostName"]),
    sku: strOrNull(json["SKU"]),
  };
}

/** Parsing PURO del primo `@odata.id` in `Members` di una collection Redfish (Systems/Managers). */
export function parseFirstMemberPath(body: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  const members = json["Members"];
  if (!Array.isArray(members) || members.length === 0) return null;
  return odataId(members[0]);
}

/** Parsing PURO del firmware da una risorsa Manager Redfish. */
export function parseManagerFirmware(body: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  return strOrNull(json["FirmwareVersion"]);
}

/**
 * Rilevazione senza credenziali: `GET /redfish/v1/` è anonimo su quasi tutti i
 * BMC. Usata dai probe passivi (Fase 3, `run-probes.ts`) su host con 443/8443
 * aperte — nessuna eccezione propagata.
 */
export async function redfishDetect(
  ip: string,
  opts?: { port?: number; timeoutMs?: number }
): Promise<RedfishDetectResult> {
  try {
    const port = opts?.port ?? DEFAULT_PORT;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const resp = await httpsGet(ip, port, SERVICE_ROOT_PATH, { timeoutMs });
    if (!resp || resp.status >= 400) return { present: false, vendorHint: null };
    return parseServiceRoot(resp.body);
  } catch {
    return { present: false, vendorHint: null };
  }
}

/**
 * Verifica minima delle credenziali via Basic Auth su `/redfish/v1/Systems`
 * (a differenza del service root, quasi sempre protetto): 401/403 → credenziali
 * non valide, risposta non conforme (niente `Members`) → errore esplicito.
 * Nessun retry: il gate anti-lockout è responsabilità del chiamante.
 */
export async function redfishValidate(
  ip: string,
  user: string,
  pass: string,
  opts?: { port?: number; timeoutMs?: number }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const port = opts?.port ?? DEFAULT_PORT;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const resp = await httpsGet(ip, port, DEFAULT_SYSTEMS_PATH, { timeoutMs, headers: basicAuthHeader(user, pass) });
    if (!resp) return { ok: false, error: "nessuna risposta dal servizio Redfish" };
    if (resp.status === 401 || resp.status === 403) return { ok: false, error: "credenziali non valide" };
    if (resp.status >= 400) return { ok: false, error: `errore HTTP ${resp.status}` };
    if (resp.body.trim() === "") return { ok: false, error: "risposta vuota dal servizio Redfish" };
    return { ok: true };
  } catch {
    return { ok: false, error: "errore imprevisto nella validazione Redfish" };
  }
}

/**
 * Percorso completo: service root → `Systems` → primo membro → campi hardware;
 * poi `Managers` → primo membro → firmware BMC (best-effort: un fallimento qui
 * non invalida il resto delle info, il firmware resta `null`). Ogni GET è
 * difensivo, nessuna eccezione propagata.
 */
export async function redfishFetchInfo(
  ip: string,
  user: string,
  pass: string,
  opts?: { port?: number; timeoutMs?: number }
): Promise<RedfishInfo | null> {
  try {
    const port = opts?.port ?? DEFAULT_PORT;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const headers = basicAuthHeader(user, pass);

    const rootResp = await httpsGet(ip, port, SERVICE_ROOT_PATH, { timeoutMs, headers });
    if (!rootResp || rootResp.status >= 400) return null;
    let rootJson: unknown;
    try {
      rootJson = JSON.parse(rootResp.body);
    } catch {
      return null;
    }
    if (!isRecord(rootJson)) return null;

    const systemsPath = odataId(rootJson["Systems"]) ?? DEFAULT_SYSTEMS_PATH;
    const systemsResp = await httpsGet(ip, port, systemsPath, { timeoutMs, headers });
    if (!systemsResp || systemsResp.status >= 400) return null;
    const firstSystemPath = parseFirstMemberPath(systemsResp.body);
    if (!firstSystemPath) return null;

    const systemResp = await httpsGet(ip, port, firstSystemPath, { timeoutMs, headers });
    if (!systemResp || systemResp.status >= 400) return null;
    const sys = parseSystemResource(systemResp.body);
    if (!sys) return null;

    let bmcFirmware: string | null = null;
    try {
      const managersPath = odataId(rootJson["Managers"]) ?? DEFAULT_MANAGERS_PATH;
      const managersResp = await httpsGet(ip, port, managersPath, { timeoutMs, headers });
      if (managersResp && managersResp.status < 400) {
        const firstManagerPath = parseFirstMemberPath(managersResp.body);
        if (firstManagerPath) {
          const managerResp = await httpsGet(ip, port, firstManagerPath, { timeoutMs, headers });
          if (managerResp && managerResp.status < 400) {
            bmcFirmware = parseManagerFirmware(managerResp.body);
          }
        }
      }
    } catch {
      // Firmware BMC opzionale (best-effort): nessun impatto sulle altre info già estratte.
    }

    return { ...sys, bmcFirmware };
  } catch {
    return null;
  }
}

const REDFISH_CATEGORY = "compute.server";
const REDFISH_CONFIDENCE = 0.95;

/**
 * Evidenze PURE da `RedfishInfo` (già autenticato via `redfishFetchInfo`): un
 * BMC che risponde con credenziali valide È per definizione un server
 * (dichiarativo) → `category=compute.server` 0.95 (autoritativa, vedi
 * `AUTHORITATIVE_SOURCES.category` in weights.ts). `vendor` da `manufacturer`
 * via `vendorSlug`, saltato se placeholder (`VENDOR_PLACEHOLDER_RE`, es.
 * "Unknown"/"N/A"). Nessun claim `os`: il BMC non conosce in modo affidabile
 * il sistema operativo ospite. Modello/seriale finiscono in `raw_value`, non
 * nel claim.
 */
export function redfishEvidence(info: RedfishInfo): EvidenceInput[] {
  const out: EvidenceInput[] = [];

  if (isValidCategory(REDFISH_CATEGORY)) {
    out.push({
      source: "redfish",
      phase: "credential_validate",
      dimension: "category",
      claim: REDFISH_CATEGORY,
      confidence: REDFISH_CONFIDENCE,
      raw_value: [info.model, info.serialNumber].filter(Boolean).join(", ") || null,
    });
  }

  if (info.manufacturer && !VENDOR_PLACEHOLDER_RE.test(info.manufacturer.trim())) {
    out.push({
      source: "redfish",
      phase: "credential_validate",
      dimension: "vendor",
      claim: vendorSlug(info.manufacturer),
      confidence: REDFISH_CONFIDENCE,
      raw_value: info.manufacturer,
    });
  }

  return out;
}
