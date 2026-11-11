/**
 * Le barre «cose da sistemare per rete» con i filtri di serie della pagina Findings: UN conto solo
 * per Dashboard, Findings e `/api/vulnerabilities/per-rete` (Riccardo, 11/11/2026: «i dati devono
 * essere coerenti tra le schermate»; la sera prima la Dashboard dava LAN Server 701 e Findings 460,
 * perché contavano con due query diverse). Chi mostra queste barre passa da qui.
 */
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";
import { archivioCve, datiCve } from "@/lib/vuln/cve-locali/archivio";
import type { BarraRete } from "./gruppi";
import { elencoRilievi } from "./unione";

/** Il punteggio proprio di ogni CVE dall'archivio NVD locale; senza archivio non si corregge niente. */
export function cvssPerRotte(): ((cves: string[]) => Map<string, { cvss: number | null }>) | undefined {
  try {
    const db = archivioCve();
    return (cves) => datiCve(db, cves);
  } catch (e) {
    console.error("[findings] archivio NVD non leggibile:", e instanceof Error ? e.message : "errore imprevisto");
    return undefined;
  }
}

/** Va chiamata dentro il contesto del tenant. */
export function barreReteDiSerie(): BarraRete[] {
  return elencoRilievi({ conIndicatori: true, pageSize: 1, exploitDi: exploitPerRotte().exploitDi, cvssDi: cvssPerRotte() }).perRete ?? [];
}
