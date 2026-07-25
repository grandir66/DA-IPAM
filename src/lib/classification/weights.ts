import type { EvidenceSource } from "./types";

/** Pesi default 0–1 (spec §6.2). */
export const SOURCE_WEIGHTS: Record<EvidenceSource, number> = {
  snmp: 0.95,
  http: 0.9,
  smb: 0.75,
  ssh: 0.55,
  mac_oui: 0.4,
  nmap: 0.45,
  dns: 0.35,
  ttl: 0.25,
  naabu: 0.2,
  rule: 0.7,
};
