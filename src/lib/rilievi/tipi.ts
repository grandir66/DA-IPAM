/**
 * Un rilievo della pagina Findings: CVE, trunk o giro di rete.
 * Niente database: lo usano API, adapter e client.
 */
import type { Severity } from "@/lib/severity-style";

export const FONTI_RILIEVO = ["edge", "wazuh", "trunk", "giro"] as const;
export type FonteRilievo = (typeof FONTI_RILIEVO)[number];

export const FONTI_RILIEVO_UI: Record<FonteRilievo, { nome: string; riga: string }> = {
  edge: { nome: "Edge", riga: "Vulnerabilità da Greenbone/Nuclei (VA)" },
  wazuh: { nome: "Wazuh", riga: "Vulnerabilità degli endpoint (Wazuh)" },
  trunk: { nome: "Trunk", riga: "Allarmi del sensore sulla porta trunk" },
  giro: { nome: "Giri", riga: "Certificati, servizi aperti e login di fabbrica visti dalle sonde" },
};

// Tab per motore nella pagina Findings (Riccardo, 10/11): una vista comune più un tab per
// motore. IPAM/Nety raggruppa le fonti interne (trunk + giri); Edge e Wazuh sono distinti.
export const MOTORI_RILIEVO = ["tutti", "ipam", "edge", "wazuh"] as const;
export type MotoreRilievo = (typeof MOTORI_RILIEVO)[number];
export const MOTORI_RILIEVO_UI: Record<MotoreRilievo, { nome: string; fonti: readonly FonteRilievo[] }> = {
  tutti: { nome: "Tutti", fonti: [] },
  ipam: { nome: "IPAM / Nety", fonti: ["trunk", "giro"] },
  edge: { nome: "Edge (VA)", fonti: ["edge"] },
  wazuh: { nome: "Wazuh", fonti: ["wazuh"] },
};

export interface RilievoUnito {
  id: string;
  fonte: FonteRilievo;
  gravita: Severity;
  titolo: string;
  prova: string;
  rimedio: string;
  ip: string | null;
  host_id: number | null;
  network_id: number | null;
  network_name: string | null;
  visto: string | null;
  /** Chiave CVE aggregata, per aprire gli host. */
  cve_key: string | null;
  host_count: number;
}

export interface RollupRilievi {
  Critical: number;
  High: number;
  Medium: number;
  Low: number;
}

export interface ElencoRilievi {
  data: RilievoUnito[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rollup: RollupRilievi;
  perFonte: Record<FonteRilievo, number>;
  totaleGlobale: number;
  nonDisponibili: FonteRilievo[];
  parziali: FonteRilievo[];
}
