/**
 * Costruisce FingerprintExplanation da DeviceFingerprintSnapshot.
 * Converte i detection_sources in ClassificationFeature[] leggibili dall'utente.
 */

import type {
  DeviceFingerprintSnapshot,
  ClassificationFeature,
  FeatureSource,
  FingerprintExplanation,
} from "@/types";

export function buildFingerprintExplanation(
  snap: DeviceFingerprintSnapshot,
  classification: string,
  macVendor: string | null,
): FingerprintExplanation {
  const features: ClassificationFeature[] = [];
  const unmatched: { source: FeatureSource; value: string }[] = [];
  const sources = new Set(snap.detection_sources ?? []);

  // ── TTL ────────────────────────────────────────────────────────────────────
  if (snap.ttl != null) {
    if (sources.has("ttl") || sources.has("rule:ttl")) {
      features.push({
        source: "ttl",
        label: `TTL ${snap.ttl}${snap.os_hint ? ` → ${snap.os_hint}` : ""}`,
        value: String(snap.ttl),
        contribution: 0.3,
      });
    } else {
      unmatched.push({ source: "ttl", value: String(snap.ttl) });
    }
  }

  // ── Port signature ─────────────────────────────────────────────────────────
  if (snap.matches && snap.matches.length > 0) {
    const top = snap.matches[0];
    if (
      sources.has("port_signature") ||
      snap.detection_sources.some((s) => s.startsWith("rule:ports"))
    ) {
      features.push({
        source: "ports",
        label: `Port signature: ${top.name}`,
        value: top.matched_ports.join(", "),
        contribution: Math.round(top.confidence * 100) / 100,
      });
      // Aggiunge le porte supplementari come segnali extra
      for (let i = 1; i < Math.min(snap.matches.length, 3); i++) {
        const m = snap.matches[i];
        features.push({
          source: "ports",
          label: `Alternativa: ${m.name}`,
          value: m.matched_ports.join(", "),
          contribution: Math.round(m.confidence * 100) / 100,
        });
      }
    } else if (snap.open_ports.length > 0) {
      unmatched.push({ source: "ports", value: snap.open_ports.join(", ") });
    }
  } else if (snap.open_ports.length > 0) {
    unmatched.push({ source: "ports", value: snap.open_ports.join(", ") });
  }

  // ── SNMP OID ───────────────────────────────────────────────────────────────
  if (snap.snmp_vendor_oid) {
    if (sources.has("snmp") || snap.detection_sources.some((s) => s.startsWith("rule:oid"))) {
      features.push({
        source: "snmp_oid",
        label: `SNMP OID vendor: ${snap.snmp_vendor_oid}`,
        value: snap.snmp_vendor_oid,
        contribution: 0.9,
      });
    } else {
      unmatched.push({ source: "snmp_oid", value: snap.snmp_vendor_oid });
    }
  }

  // ── SNMP sysDescr ──────────────────────────────────────────────────────────
  if (snap.snmp_sysdescr) {
    const short = snap.snmp_sysdescr.slice(0, 80);
    if (snap.detection_sources.some((s) => s.startsWith("rule:sysdescr"))) {
      features.push({
        source: "snmp_sysdescr",
        label: `SNMP sysDescr: ${short}${snap.snmp_sysdescr.length > 80 ? "…" : ""}`,
        value: snap.snmp_sysdescr,
        contribution: 0.85,
      });
    } else {
      unmatched.push({ source: "snmp_sysdescr", value: short });
    }
  }

  // ── Banner HTTP ────────────────────────────────────────────────────────────
  if (snap.banner_http) {
    const short = snap.banner_http.slice(0, 80);
    if (sources.has("banner_http") || snap.detection_sources.some((s) => s.startsWith("rule:banner"))) {
      features.push({
        source: "banner_http",
        label: `Banner HTTP: ${short}${snap.banner_http.length > 80 ? "…" : ""}`,
        value: snap.banner_http,
        contribution: 0.88,
      });
    } else {
      unmatched.push({ source: "banner_http", value: short });
    }
  }

  // ── Banner SSH ─────────────────────────────────────────────────────────────
  if (snap.banner_ssh) {
    const short = snap.banner_ssh.slice(0, 80);
    if (sources.has("banner_ssh") || snap.detection_sources.some((s) => s.startsWith("rule:banner"))) {
      features.push({
        source: "banner_ssh",
        label: `Banner SSH: ${short}${snap.banner_ssh.length > 80 ? "…" : ""}`,
        value: snap.banner_ssh,
        contribution: 0.88,
      });
    } else {
      unmatched.push({ source: "banner_ssh", value: short });
    }
  }

  // ── Hostname ───────────────────────────────────────────────────────────────
  if (snap.hostname) {
    if (snap.detection_sources.some((s) => s.startsWith("rule:hostname"))) {
      features.push({
        source: "hostname",
        label: `Hostname: ${snap.hostname}`,
        value: snap.hostname,
        contribution: 0.6,
      });
    } else {
      unmatched.push({ source: "hostname", value: snap.hostname });
    }
  }

  // ── MAC vendor ─────────────────────────────────────────────────────────────
  if (macVendor) {
    if (snap.detection_sources.some((s) => s.startsWith("rule:mac"))) {
      features.push({
        source: "mac_vendor",
        label: `MAC vendor: ${macVendor}`,
        value: macVendor,
        contribution: 0.5,
      });
    } else {
      unmatched.push({ source: "mac_vendor", value: macVendor });
    }
  }

  // ── nmap OS ────────────────────────────────────────────────────────────────
  if (snap.nmap_os) {
    if (snap.detection_sources.some((s) => s === "nmap_os")) {
      features.push({
        source: "nmap_os",
        label: `nmap OS: ${snap.nmap_os}`,
        value: snap.nmap_os,
        contribution: 0.7,
      });
    } else {
      unmatched.push({ source: "nmap_os", value: snap.nmap_os });
    }
  }

  return {
    final_device: snap.final_device ?? null,
    final_confidence: snap.final_confidence ?? 0,
    classification,
    features,
    unmatched_signals: unmatched,
  };
}
