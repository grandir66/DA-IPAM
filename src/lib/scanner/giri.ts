import type { GiroInElenco, JobInElenco, ScanProgress } from "@/types";

/** Il nome di ogni tipo di giro nella bacheca e nel pannello. Le interrogazioni di un apparato hanno già il loro. */
const ETICHETTE_GIRO: Record<string, string> = {
  ping: "Ping",
  fast: "Scansione veloce",
  network_discovery: "Scoperta rete",
  snmp: "SNMP",
  nmap: "Nmap",
  windows: "WinRM (Windows)",
  ssh: "SSH (Linux)",
  ipam_full: "Scansione completa IPAM",
  credential_validate: "Verifica credenziali",
  scan_icmp: "ICMP",
  scan_nmap_base: "Nmap base",
  scan_snmp_verify: "Verifica SNMP",
  scan_naabu: "Naabu",
  scan_full: "Scansione completa",
  profilo_approfondito: "Profilo Approfondito",
  profilo_iot_ot: "Profilo IoT / OT",
  sequenza_scoperta: "Scoperta host",
  sequenza_avanzata: "Avanzata",
  sequenza_accesso: "Accesso agli host",
  sequenza_ricognizione: "Ricognizione delicata",
  profilo_ricognizione: "Ricognizione delicata",
};

export function etichettaGiro(scanType: string): string {
  return ETICHETTE_GIRO[scanType] ?? scanType;
}

/**
 * Il giro è di questo cliente? La mappa dei giri è una sola per tutti i tenant e gli id delle
 * reti si ripetono da un cliente all'altro. Un giro senza cliente non si mostra a nessuno.
 */
export function giroDelCliente(giro: ScanProgress, tenantCode: string | null): boolean {
  return tenantCode != null && giro.tenant_code === tenantCode;
}

/** Elenco per la bacheca: prima quelli in corso, poi i più recenti. I log si leggono aprendo il giro. */
export function giriDelCliente(giri: ScanProgress[], tenantCode: string | null): GiroInElenco[] {
  return giri
    .filter((g) => giroDelCliente(g, tenantCode) && !g.sequenza_id)
    .sort((a, b) => {
      const inCorso = Number(b.status === "running") - Number(a.status === "running");
      return inCorso !== 0 ? inCorso : b.started_at.localeCompare(a.started_at);
    })
    .map((g) => {
      const giro: GiroInElenco & Partial<Pick<ScanProgress, "logs" | "tenant_code" | "sequenza_id">> = { ...g };
      delete giro.logs;
      delete giro.tenant_code;
      delete giro.sequenza_id;
      return giro;
    });
}

/**
 * Job dello scheduler in esecuzione. Quello di una rete che ha già un giro in corso si tace: il giro
 * dice la stessa cosa, con l'avanzamento.
 */
export function jobInEsecuzione(
  jobs: Array<{ id: number; network_id: number | null }>,
  isInEsecuzione: (id: number) => boolean,
  giri: GiroInElenco[],
  nomeJob: (id: number) => string,
): JobInElenco[] {
  const retiOccupate = new Set(giri.filter((g) => g.status === "running").map((g) => g.network_id));
  return jobs
    .filter((j) => isInEsecuzione(j.id) && (j.network_id == null || !retiOccupate.has(j.network_id)))
    .map((j) => ({ id: j.id, nome: nomeJob(j.id) }));
}
