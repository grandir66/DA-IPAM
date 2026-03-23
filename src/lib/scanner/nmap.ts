import { execFile } from "child_process";
import { promisify } from "util";
import { XMLParser } from "fast-xml-parser";
import type { NmapResult, NmapPort } from "@/types";
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

function parseNmapXml(xml: string): NmapResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ["host", "port", "hostname", "script", "elem"].includes(name),
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
          ports.push({
            port: parseInt(portId),
            protocol,
            state: portState ?? "open",
            service: port.service?.["@_name"] || null,
            version: port.service?.["@_product"]
              ? `${port.service["@_product"]} ${port.service["@_version"] || ""}`.trim()
              : null,
          });
          if (port["@_portid"] === "161" && port.script) {
            const scripts = Array.isArray(port.script) ? port.script : [port.script];
            for (const s of scripts) extractSnmp(s);
          }
        }
      }
    }

    if (host.hostscript?.script) {
      const scripts = Array.isArray(host.hostscript.script) ? host.hostscript.script : [host.hostscript.script];
      for (const s of scripts) extractSnmp(s);
    }

    let os: string | null = null;
    if (host.os?.osmatch) {
      const osmatch = Array.isArray(host.os.osmatch) ? host.os.osmatch[0] : host.os.osmatch;
      os = osmatch?.["@_name"] || null;
    }

    results.push({
      ip, alive, ports, os, mac,
      snmpHostname: snmpHostname || undefined,
      snmpSysDescr: snmpSysDescr || undefined,
      snmpSysObjectID: snmpSysObjectID || undefined,
    });
  }

  return results;
}
