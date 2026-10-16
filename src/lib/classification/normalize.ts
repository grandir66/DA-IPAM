import type { DeviceFingerprintSnapshot } from "@/types";
import { classifyDeviceDetailed } from "@/lib/device-classifier";
import type { ClassificationEvidence, EvidenceSource } from "./types";
import { SOURCE_WEIGHTS } from "./weights";

/** Input grezzo da cascade / fingerprint / naabu → evidence. */
export interface NormalizeInput {
  ip: string;
  hostname: string | null;
  vendor: string | null;
  os_info: string | null;
  open_ports: number[];
  snmp_sysdescr: string | null;
  snmp_sysobjectid: string | null;
  detection: DeviceFingerprintSnapshot | null;
  naabu_ports?: number[] | null;
  cascade_slug?: string | null;
  cascade_method?: string | null;
}

const MANAGEMENT_BANNER_RE = /esxi|idrac|ilo|proxmox|synology|qnap/i;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function evidence(
  source: EvidenceSource,
  attribute: string,
  value: string,
  opts: {
    timestamp: string;
    confidence: number;
    observed?: boolean;
    votes_for?: string;
  }
): ClassificationEvidence {
  const row: ClassificationEvidence = {
    source,
    attribute,
    value,
    weight: SOURCE_WEIGHTS[source],
    confidence: clamp01(opts.confidence),
    observed: opts.observed ?? true,
    timestamp: opts.timestamp,
  };
  if (opts.votes_for) row.votes_for = opts.votes_for;
  return row;
}

function httpBannerVotesFor(banner: string): string | undefined {
  const m = banner.match(MANAGEMENT_BANNER_RE);
  if (!m) return undefined;
  switch (m[0].toLowerCase()) {
    case "esxi":
    case "proxmox":
      return "hypervisor";
    case "idrac":
    case "ilo":
      return "server";
    case "synology":
    case "qnap":
      return "storage";
    default:
      return undefined;
  }
}

function nmapOsVotesFor(
  nmapOs: string,
  cascadeSlug: string | null | undefined
): string | undefined {
  const lower = nmapOs.toLowerCase();
  if (/\blinux\b/.test(lower)) return "server_linux";
  if (/\bwindows\b/.test(lower)) return "server_windows";
  return cascadeSlug ?? undefined;
}

function cascadeVotes(
  method: string | null | undefined,
  slug: string | null | undefined
): string | undefined {
  if (!slug) return undefined;
  if (method === "oid" || method === "text") return slug;
  return undefined;
}

/**
 * Voto derivato da UN SINGOLO segnale.
 *
 * Riusa le regole di `device-classifier.ts` (hostname/vendor/port/text) passando
 * un solo campo per volta: così l'evidenza vota esattamente ciò che quel segnale
 * implica, senza duplicare le tabelle di regole e senza che un segnale forte
 * "trascini" gli altri. Ritorna undefined quando il segnale non è discriminante
 * (es. vendor Ubiquiti, che produce AP, switch e gateway).
 */
function singleSignalVote(
  signal:
    | { hostname: string }
    | { vendor: string }
    | { osInfo: string }
    | { openPorts: number[] },
): string | undefined {
  if ("openPorts" in signal) {
    return (
      classifyDeviceDetailed({ openPorts: signal.openPorts.map((port) => ({ port })) })
        .classification ?? undefined
    );
  }
  return classifyDeviceDetailed(signal).classification ?? undefined;
}

/**
 * Normalizza segnali multi-sorgente in `ClassificationEvidence[]` (Fase B facade).
 */
export function normalizeToEvidence(
  input: NormalizeInput,
  nowIso?: string
): ClassificationEvidence[] {
  const ts = nowIso ?? new Date().toISOString();
  const out: ClassificationEvidence[] = [];
  const snap = input.detection;
  const snmpVotes = cascadeVotes(input.cascade_method, input.cascade_slug);

  if (input.snmp_sysobjectid?.trim()) {
    out.push(
      evidence("snmp", "sysObjectID", input.snmp_sysobjectid.trim(), {
        timestamp: ts,
        confidence: 0.95,
        observed: true,
        votes_for: snmpVotes,
      })
    );
  }

  if (input.snmp_sysdescr?.trim()) {
    out.push(
      evidence("snmp", "sysDescr", input.snmp_sysdescr.trim(), {
        timestamp: ts,
        confidence: input.cascade_method === "text" ? 0.9 : 0.75,
        observed: true,
        votes_for: snmpVotes,
      })
    );
  }

  if (input.hostname?.trim()) {
    const hostname = input.hostname.trim();
    out.push(
      evidence("dns", "hostname", hostname, {
        timestamp: ts,
        confidence: 0.6,
        observed: true,
        votes_for: singleSignalVote({ hostname }),
      })
    );
  }

  if (input.vendor?.trim()) {
    const vendor = input.vendor.trim();
    out.push(
      evidence("mac_oui", "vendor", vendor, {
        timestamp: ts,
        confidence: 0.7,
        observed: true,
        votes_for: singleSignalVote({ vendor }),
      })
    );
  }

  if (input.naabu_ports && input.naabu_ports.length > 0) {
    out.push(
      evidence("naabu", "tcp_ports", input.naabu_ports.join(","), {
        timestamp: ts,
        confidence: 0.8,
        observed: true,
        votes_for: singleSignalVote({ openPorts: input.naabu_ports }),
      })
    );
  }

  if (snap?.banner_http?.trim()) {
    const banner = snap.banner_http.trim();
    const dedicated = httpBannerVotesFor(banner);
    const isManagement = Boolean(dedicated);
    out.push(
      evidence("http", "title", banner, {
        timestamp: ts,
        confidence: isManagement ? 0.95 : 0.6,
        observed: true,
        votes_for: dedicated ?? (input.cascade_method === "text" ? input.cascade_slug ?? undefined : undefined),
      })
    );
  }

  if (snap?.banner_ssh?.trim()) {
    const bannerSsh = snap.banner_ssh.trim();
    out.push(
      evidence("ssh", "banner", bannerSsh, {
        timestamp: ts,
        confidence: 0.55,
        observed: true,
        votes_for: singleSignalVote({ osInfo: bannerSsh }),
      })
    );
  }

  if (snap?.nmap_os?.trim()) {
    const nmapOs = snap.nmap_os.trim();
    const conf =
      typeof snap.final_confidence === "number"
        ? clamp01(snap.final_confidence)
        : 0.5;
    out.push(
      evidence("nmap", "os_guess", nmapOs, {
        timestamp: ts,
        confidence: conf,
        observed: true,
        votes_for: nmapOsVotesFor(nmapOs, input.cascade_slug),
      })
    );
  }

  if (snap?.ttl != null && Number.isFinite(snap.ttl)) {
    out.push(
      evidence("ttl", "ttl", String(snap.ttl), {
        timestamp: ts,
        confidence: 0.5,
        observed: true,
        votes_for: snap.os_hint?.trim()
          ? nmapOsVotesFor(snap.os_hint, input.cascade_slug)
          : undefined,
      })
    );
  } else if (snap?.os_hint?.trim()) {
    out.push(
      evidence("ttl", "os_hint", snap.os_hint.trim(), {
        timestamp: ts,
        confidence: 0.45,
        observed: false,
        votes_for: nmapOsVotesFor(snap.os_hint, input.cascade_slug),
      })
    );
  }

  if (snap?.final_device?.trim()) {
    const conf =
      typeof snap.final_confidence === "number"
        ? clamp01(snap.final_confidence)
        : 0.5;
    out.push(
      evidence("rule", "final_device", snap.final_device.trim(), {
        timestamp: ts,
        confidence: conf,
        observed: false,
        votes_for: input.cascade_slug ?? undefined,
      })
    );
  }

  return out;
}
