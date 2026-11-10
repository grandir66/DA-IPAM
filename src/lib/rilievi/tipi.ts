/**
 * Un rilievo della pagina Findings: CVE, trunk o giro di rete.
 * Niente database: lo usano API, adapter e client.
 */
import type { Severity } from "@/lib/severity-style";

export const FONTI_RILIEVO = ["cve", "trunk", "giro"] as const;
export type FonteRilievo = (typeof FONTI_RILIEVO)[number];

export const FONTI_RILIEVO_UI: Record<FonteRilievo, { nome: string; riga: string }> = {
  cve: { nome: "CVE", riga: "Vulnerabilità da Edge e Wazuh" },
  trunk: { nome: "Trunk", riga: "Allarmi del sensore sulla porta trunk" },
  giro: { nome: "Giri", riga: "Certificati e protocolli visti dalle sonde" },
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
}
