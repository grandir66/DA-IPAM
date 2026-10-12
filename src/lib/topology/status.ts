import type { StatusSignals, TopologyStatus } from "@/lib/topology/types";

function parseSqlUtc(s: string): number {
  // "YYYY-MM-DD HH:MM:SS" (UTC) o ISO
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

export function deriveNodeStatus(sig: StatusSignals): TopologyStatus {
  const now = sig.nowMs ?? Date.now();
  const latencyWarn = sig.latencyWarnMs ?? 150;
  const staleSec = sig.staleSeconds ?? 900;

  // FAIL
  if (sig.hostStatus === "offline") return "fail";
  if (sig.libreStatus === 0) return "fail";
  if (sig.anomalySeverity === "high") return "fail";

  const isLive = sig.hostStatus === "online" || sig.libreStatus === 1;

  // UNKNOWN: nessun segnale di liveness
  if (!isLive) return "unknown";

  // UNKNOWN: vivo per stato ma last_seen troppo vecchio e nessun segnale fresco
  if (sig.lastSeen) {
    const seen = parseSqlUtc(sig.lastSeen);
    if (!Number.isNaN(seen) && now - seen > staleSec * 1000 && sig.libreStatus !== 1) {
      return "unknown";
    }
  }

  // WARNING
  if (sig.anomalySeverity === "medium") return "warning";
  if (sig.uplinkDown) return "warning";
  if (sig.latencyMs != null && sig.latencyMs > latencyWarn) return "warning";

  return "ok";
}
