import { execFile } from "child_process";
import { segnaleGiro } from "./ferma-giro";
import { promisify } from "util";
import { XMLParser } from "fast-xml-parser";
import type { NmapResult, NmapPort, NmapScriptOutput } from "@/types";
import { stripUdpFromArgs, buildUdpScanArgs, buildTcpScanArgs } from "./ports";

/** Argomenti profilo utente: la fase TCP non deve mai includere -sU (UDP è una seconda invocazione). */
function tcpProfileArgs(customArgs: string | undefined): string {
  const trimmed = customArgs?.trim();
  if (!trimmed) return buildTcpScanArgs(null);
  return stripUdpFromArgs(trimmed);
}

const execFileAsync = promisify(execFile);

export async function isNmapAvailable(): Promise<boolean> {
  try {
    await execFileAsync("nmap", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Quick host discovery for the whole subnet using nmap -sn.
 */
export async function nmapDiscoverHosts(
  target: string,
  timeout: number = 90000
): Promise<NmapResult[]> {
  const args = ["-sn", "-T4", "--min-rate", "200", "--max-retries", "1", "-oX", "-", target];
  try {
    const { stdout } = await execFileAsync("nmap", args, {
      signal: segnaleGiro(),
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseNmapXml(stdout);
  } catch (error) {
    console.error("[Nmap] Host discovery error:", error);
    throw new Error(`Nmap host discovery failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Port scan a single IP.
 *
 * Strategia:
 *  1. Scansione TCP (-sT, non richiede root) — sempre eseguita
 *  2. Scansione UDP (-sU, richiede root) — tentata separatamente, non bloccante
 *  3. I risultati vengono fusi (TCP + UDP)
 *
 * Non eseguire mai TCP e UDP in un unico comando nmap: alcuni profili/ambienti vanno in errore.
 * Il parametro `customArgs` personalizza **solo la scansione TCP**; `-sU` viene ignorato qui
 * (la UDP è sempre `buildUdpScanArgs()` in processo separato).
 *
 * SNMP non viene gestito qui — è compito di discovery.ts via net-snmp / snmpwalk.
 */
export async function nmapPortScan(
  ip: string,
  customArgs?: string,
  /** Timeout exec per singola fase (TCP o UDP); con entrambe le fasi servono ~2× questo tempo. Default 280s. */
  timeout: number = 280_000,
  opts?: { skipUdp?: boolean; onLog?: (msg: string) => void; udpPorts?: string | null }
): Promise<NmapResult | null> {
  const tcpArgs = ensureTcpOnly(tcpProfileArgs(customArgs));
  const skipUdp = opts?.skipUdp === true;
  const emitLog = opts?.onLog ?? (() => {});

  // --- Fase 1/2: TCP (-sT), processo dedicato ---
  let tcpResult: NmapResult | null = null;
  try {
    const args = [...tcpArgs.split(/\s+/).filter(Boolean), "-oX", "-", ip];
    const cmdLine = `nmap ${args.join(" ")}`;
    emitLog(`TCP ${ip}: ${cmdLine}`);
    const { stdout } = await execFileAsync("nmap", args, {
      signal: segnaleGiro(),
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    const results = parseNmapXml(stdout);
    tcpResult = results.length > 0 ? results[0] : null;
    const portList = tcpResult?.ports.map((p) => `${p.port}/${p.protocol}`).join(", ") || "—";
    emitLog(`TCP ${ip}: ${tcpResult?.ports.length ?? 0} porte → ${portList}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Nmap] TCP scan error for ${ip}:`, errMsg);
    emitLog(`✗ TCP ${ip}: ${errMsg.slice(0, 80)}`);
  }

  if (skipUdp) {
    return tcpResult
      ? {
          ip,
          alive: true,
          ports: tcpResult.ports.sort((a, b) => a.port - b.port),
          os: tcpResult.os,
          mac: tcpResult.mac,
        }
      : null;
  }

  // --- Fase 2/2: UDP (-sU), processo dedicato (richiede spesso root / capability raw) ---
  let udpResult: NmapResult | null = null;
  const udpArgs = buildUdpScanArgs(opts?.udpPorts);
  try {
    const args = [...udpArgs.split(/\s+/).filter(Boolean), "-oX", "-", ip];
    const cmdLine = `nmap ${args.join(" ")}`;
    emitLog(`UDP ${ip}: ${cmdLine}`);
    const { stdout } = await execFileAsync("nmap", args, {
      signal: segnaleGiro(),
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    const results = parseNmapXml(stdout);
    udpResult = results.length > 0 ? results[0] : null;
    if (udpResult && udpResult.ports.length > 0) {
      const portList = udpResult.ports.map((p) => `${p.port}/${p.protocol}`).join(", ");
      emitLog(`UDP ${ip}: ${udpResult.ports.length} porte → ${portList}`);
    } else {
      emitLog(`UDP ${ip}: 0 porte`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/root|privileges|permission/i.test(msg)) {
      emitLog(`UDP ${ip}: skip (richiede root)`);
    } else {
      console.warn(`[Nmap] UDP scan ${ip} fallito:`, msg);
      emitLog(`✗ UDP ${ip}: ${msg.slice(0, 80)}`);
    }
  }

  // --- Merge TCP + UDP results ---
  if (!tcpResult && !udpResult) return null;

  const mergedPorts: NmapPort[] = [...(tcpResult?.ports ?? [])];
  if (udpResult) {
    for (const p of udpResult.ports) {
      if (!mergedPorts.some((m) => m.port === p.port && m.protocol === p.protocol)) {
        mergedPorts.push(p);
      }
    }
  }

  return {
    ip,
    alive: true,
    ports: mergedPorts.sort((a, b) => a.port - b.port),
    os: tcpResult?.os ?? udpResult?.os ?? null,
    mac: tcpResult?.mac ?? udpResult?.mac ?? null,
  };
}

/**
 * Assicura che gli args siano TCP-only.
 * Se l'utente ha passato args con -sU o -sS -sU, viene estratta solo la parte TCP.
 */
function ensureTcpOnly(argsStr: string): string {
  if (argsStr.includes("-sU") || argsStr.includes("-sS")) {
    const stripped = stripUdpFromArgs(argsStr);
    if (!stripped.includes("-sT") && !stripped.includes("-sS")) {
      return `-sT ${stripped}`;
    }
    return stripped.replace("-sS", "-sT");
  }
  if (!argsStr.includes("-sT") && !argsStr.includes("-sS")) {
    return `-sT ${argsStr}`;
  }
  return argsStr;
}

/**
 * I `<cpe>` che nmap emette sotto `<service>` quando riconosce il software.
 *
 * Perche' esiste: sono la chiave del match CVE. `cpe:/a:openbsd:openssh:9.6p1`
 * si confronta con i cpeMatch dell'NVD; la stringa libera "OpenSSH 9.6p1 Ubuntu
 * 3ubuntu13.15" no. Fino al 2026-09-07 il parser leggeva solo product+version e
 * buttava i CPE: misurato su 664 porte reali, 194 avevano la versione e **zero**
 * arrivavano al database con un CPE.
 *
 * Tollera le tre forme che fast-xml-parser puo' restituire (stringa singola,
 * array, oggetto con `#text`) perche' dipendono da come nmap ha scritto il nodo.
 */
function extractCpes(raw: unknown): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    const testo =
      typeof item === "string"
        ? item
        : typeof item === "object" && item !== null && "#text" in item
          ? String((item as { "#text"?: unknown })["#text"] ?? "")
          : "";
    const cpe = testo.trim();
    if (cpe.startsWith("cpe:") && !out.includes(cpe)) out.push(cpe);
  }
  return out;
}

/**
 * Tetto di serie in byte per l'output di un singolo script NSE.
 *
 * Perche' c'e': `mqtt-subscribe` stampa i messaggi che il broker pubblica, e un
 * broker di impianto chiacchierone riempirebbe la riga dell'host. I profili
 * passano il proprio tetto (`ProfiloScansione.tettoByteOutput`).
 */
export const TETTO_OUTPUT_SCRIPT_BYTE = 4096;

/**
 * Un nodo `<script>` di nmap -> forma utilizzabile.
 *
 * Fino al 2026-11-04 l'unico script letto era `snmp-info` e tutto il resto
 * veniva buttato qui dentro: chiedere `--script=...` non produceva niente. I
 * profili di `scanner/profili/` hanno bisogno degli `<elem key="...">`, non del
 * testo: `rdp-ntlm-info` da' il nome DNS e la build di Windows, `ssl-cert` il
 * CN, `s7-info` modello, firmware e numero di serie.
 */
function leggiScript(
  script: { "@_id"?: string; "@_output"?: string; elem?: unknown; output?: string; table?: unknown },
  tettoByte: number
): NmapScriptOutput | null {
  const id = (script["@_id"] ?? "").trim();
  if (!id) return null;
  const elems: Record<string, string> = {};
  /* Le `<table>` annidate si appiattiscono in chiavi con il punto
   * ("subject.commonName") e, quando la tabella non ha `key`, con l'indice
   * ("0.fingerprint"). Senza questo `ssl-cert` e `ssh-hostkey` darebbero zero
   * campi: i loro dati stanno tutti dentro tabelle, non in `<elem>` di primo
   * livello. Tetto di 200 chiavi: nmap non ne produce tante, ma un output
   * malformato non deve far crescere la riga senza limite. */
  const raccogli = (nodo: unknown, prefisso: string, profondita: number): void => {
    if (profondita > 4 || Object.keys(elems).length >= 200) return;
    if (typeof nodo !== "object" || nodo === null) return;
    const n = nodo as { elem?: unknown; table?: unknown };
    const listaElem = Array.isArray(n.elem) ? n.elem : n.elem ? [n.elem] : [];
    for (const e of listaElem) {
      if (Object.keys(elems).length >= 200) return;
      const chiaveGrezza =
        typeof e === "object" && e !== null ? String((e as { "@_key"?: string })["@_key"] ?? "").trim() : "";
      const grezzo = typeof e === "object" && e !== null ? (e as { "#text"?: unknown })["#text"] : e;
      const valore = grezzo === undefined || grezzo === null ? "" : String(grezzo).trim();
      if (!valore) continue;
      /* Senza `key` (liste come gli algoritmi di ssl-cert) la chiave e' l'indice. */
      const chiave = chiaveGrezza || String(listaElem.indexOf(e));
      elems[prefisso ? `${prefisso}.${chiave}` : chiave] = valore;
    }
    const listaTable = Array.isArray(n.table) ? n.table : n.table ? [n.table] : [];
    for (const [i, t] of listaTable.entries()) {
      const chiaveTab =
        typeof t === "object" && t !== null ? String((t as { "@_key"?: string })["@_key"] ?? "").trim() : "";
      const nome = chiaveTab || String(i);
      raccogli(t, prefisso ? `${prefisso}.${nome}` : nome, profondita + 1);
    }
  };
  raccogli(script, "", 0);
  /* Il testo libero sta nell'ATTRIBUTO `output`, quindi `@_output` col prefisso
   * configurato: letto come `script.output` era sempre vuoto, e con lui i
   * lettori di nbstat e upnp-info che ci si appoggiano. */
  const grezzoOut = script["@_output"] ?? script.output;
  const output = typeof grezzoOut === "string" && grezzoOut.trim() ? grezzoOut.slice(0, tettoByte) : null;
  return { id, output, elems };
}

/** Esportata per i test: e' il punto dove i CPE si perdevano in silenzio. */
export function parseNmapXml(xml: string, opts?: { tettoByteOutput?: number }): NmapResult[] {
  const tettoByte = opts?.tettoByteOutput ?? TETTO_OUTPUT_SCRIPT_BYTE;
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    /* I valori restano stringhe. Di serie fast-xml-parser converte cio' che
     * sembra un numero, esadecimali compresi: il numero di serie `0x60c12345`
     * che enip-info riporta su un PLC Allen-Bradley diventava `1623270213`.
     * Qui nessun `#text` e' un numero da calcolare (CPE, sysDescr, campi degli
     * script): sono tutti identificativi, e vanno tenuti come sono scritti. */
    parseTagValue: false,
    isArray: (name) => ["host", "port", "hostname", "script", "elem", "cpe", "table"].includes(name),
  });

  const parsed = parser.parse(xml);
  const results: NmapResult[] = [];

  const nmapRun = parsed.nmaprun;
  if (!nmapRun?.host) return results;

  const hosts = Array.isArray(nmapRun.host) ? nmapRun.host : [nmapRun.host];

  for (const host of hosts) {
    const addresses = Array.isArray(host.address) ? host.address : [host.address];
    const ipAddr = addresses.find(
      (a: Record<string, string>) => a["@_addrtype"] === "ipv4"
    );
    const macAddr = addresses.find(
      (a: Record<string, string>) => a["@_addrtype"] === "mac"
    );

    if (!ipAddr) continue;

    const ip = ipAddr["@_addr"];
    const mac = macAddr ? macAddr["@_addr"] : null;
    const alive = host.status?.["@_state"] === "up";

    const ports: NmapPort[] = [];
    let snmpHostname: string | null = null;
    let snmpSysDescr: string | null = null;
    let snmpSysObjectID: string | null = null;

    const extractSnmp = (script: { "@_id"?: string; elem?: unknown; output?: string }) => {
      if (script["@_id"] !== "snmp-info") return;
      const elems = Array.isArray(script.elem) ? script.elem : script.elem ? [script.elem] : [];
      for (const e of elems) {
        const key = ((e as { "@_key"?: string })["@_key"] ?? "").toLowerCase();
        const val =
          (typeof e === "object" && e !== null && "#text" in e ? (e as { "#text"?: string })["#text"] : null) ??
          (typeof e === "object" && e !== null && "value" in e ? (e as { value?: string }).value : null) ??
          (typeof e === "string" ? e : null);
        const s = val ? String(val).trim() : "";
        if ((key === "sysname" || key === "sysName") && s) snmpHostname = s;
        if ((key === "sysdescr" || key === "sysDescr") && s) snmpSysDescr = s;
        if ((key === "sysobjectid" || key === "sysObjectID") && s) snmpSysObjectID = s;
      }
      if ((!snmpHostname || !snmpSysDescr || !snmpSysObjectID) && script.output) {
        const out = String(script.output);
        const m1 = out.match(/sysName[:\s]+([^\n]+)/i);
        const m2 = out.match(/sysDescr[:\s]+([^\n]+)/i);
        const m3 = out.match(/sysObjectID[:\s]+([^\n]+)/i);
        if (m1) snmpHostname = snmpHostname || m1[1].trim();
        if (m2) snmpSysDescr = snmpSysDescr || m2[1].trim();
        if (m3) snmpSysObjectID = snmpSysObjectID || m3[1].trim();
      }
    };

    if (host.ports?.port) {
      const portList = Array.isArray(host.ports.port) ? host.ports.port : [host.ports.port];
      for (const port of portList) {
        const portState = port.state?.["@_state"] as string | undefined;
        const protocol = (port["@_protocol"] as string | undefined) || "tcp";
        /** TCP: open + open|filtered. UDP: solo `open` — `open|filtered` su UDP è quasi sempre ambiguo (falsi positivi massicci). */
        const isResponding =
          protocol === "udp"
            ? portState === "open"
            : portState === "open" || portState === "open|filtered";
        if (isResponding) {
          const portId = port["@_portid"];
          const svc = port.service as
            | { "@_name"?: string; "@_product"?: string; "@_version"?: string; cpe?: unknown }
            | undefined;
          const prodotto = svc?.["@_product"]?.trim() || null;
          const versione = svc?.["@_version"]?.trim() || null;
          ports.push({
            port: parseInt(portId),
            protocol,
            state: portState ?? "open",
            service: svc?.["@_name"] || null,
            /* Stringa unita invariata: la leggono UI, classificatore e fingerprint. */
            version: prodotto ? `${prodotto} ${versione || ""}`.trim() : null,
            product: prodotto,
            product_version: versione,
            cpes: extractCpes(svc?.cpe),
          });
          if (port.script) {
            const scripts = Array.isArray(port.script) ? port.script : [port.script];
            /* snmp-info resta trattato come sempre, solo sulla 161: la lettura
             * SNMP di `discovery.ts` dipende da questi tre campi. */
            if (port["@_portid"] === "161") {
              for (const s of scripts) extractSnmp(s);
            }
            const letti: NmapScriptOutput[] = [];
            for (const s of scripts) {
              const letto = leggiScript(s, tettoByte);
              if (letto) letti.push(letto);
            }
            if (letti.length > 0) ports[ports.length - 1].scripts = letti;
          }
        }
      }
    }

    const hostScripts: NmapScriptOutput[] = [];
    if (host.hostscript?.script) {
      const scripts = Array.isArray(host.hostscript.script) ? host.hostscript.script : [host.hostscript.script];
      for (const s of scripts) extractSnmp(s);
      for (const s of scripts) {
        const letto = leggiScript(s, tettoByte);
        if (letto) hostScripts.push(letto);
      }
    }

    let os: string | null = null;
    let osPrecisione: number | null = null;
    if (host.os?.osmatch) {
      const osmatch = Array.isArray(host.os.osmatch) ? host.os.osmatch[0] : host.os.osmatch;
      os = osmatch?.["@_name"] || null;
      const accuracy = Number(osmatch?.["@_accuracy"]);
      osPrecisione = Number.isFinite(accuracy) ? accuracy : null;
    }

    results.push({
      ip, alive, ports, os, ...(osPrecisione !== null ? { osPrecisione } : {}), mac,
      ...(hostScripts.length > 0 ? { hostScripts } : {}),
      snmpHostname: snmpHostname || undefined,
      snmpSysDescr: snmpSysDescr || undefined,
      snmpSysObjectID: snmpSysObjectID || undefined,
    });
  }

  return results;
}

/**
 * La porta come si salva in `hosts.open_ports`. Fino all'08/11/2026 i cinque giri di discovery
 * ricopiavano solo porta, protocollo, servizio e versione: prodotto, versione separata e CPE
 * (letti dal parser dal 07/09) si perdevano qui, e sulla VM 533 nessun host aveva un CPE.
 * I campi nuovi si scrivono solo se ci sono, per non gonfiare il JSON delle porte senza dati.
 */
export function portaDaSalvare(p: NmapPort): PortaScansione {
  const out: PortaScansione = { port: p.port, protocol: p.protocol, service: p.service, version: p.version };
  if (p.product) out.product = p.product;
  if (p.product_version) out.product_version = p.product_version;
  if (p.cpes && p.cpes.length > 0) out.cpes = p.cpes;
  return out;
}

export type PortaScansione = {
  port: number;
  protocol: string;
  service: string | null;
  version: string | null;
  product?: string;
  product_version?: string;
  cpes?: string[];
};
