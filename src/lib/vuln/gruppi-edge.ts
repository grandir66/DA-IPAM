/**
 * Contratto IPAM → Edge per lanciare un gruppo di device (piano profili-per-device, Passo 4, 06/11/2026).
 * Solo tipi e lettura della risposta: moduli puri, nessuna rete. La chiamata sta in `edge-subnet-bridge.ts`.
 *
 * `POST /api/v1/networks/{id}/gruppi` di Edge risponde `{ok, scan_id, network_id, status, ip_tolti,
 * error_message}` letti dalla riga `scans`. Una forma diversa è un errore detto: il lancio può essere già
 * partito, quindi non si legge come successo né come fallimento («non so»).
 */
import type { EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";

/** Cosa si manda a Edge per un gruppo. `nuclei_profilo` e assessment `null` = quel motore non gira. */
export interface GruppoPerEdge {
  ips: string[];
  profile: EdgeScanProfile;
  nuclei_profilo: string | null;
  assessment_profile_id: string | null;
}

export interface RispostaGruppo {
  ok: true;
  scan_id: number;
  network_id: number;
  status: string;
  ip_tolti: string[];
  error_message: string | null;
}

/**
 * Esito di un lancio, un nome per ogni caso (mai un booleano):
 * - `lanciato`: la riga esiste e non è in errore (anche se in coda: Edge fa una scansione alla volta);
 * - `non_partito`: Edge ha risposto 200 ma la riga è in errore (gruppo di soli impianti): non è un guasto;
 * - `da_aggiornare`: la sonda non ha la rotta (404 «Not Found»). Niente ripiego sulla rete intera;
 * - `gia_in_corso`: Edge ha già in coda o in corso un gruppo con quegli IP (409, con lo scan_id): non è un guasto;
 * - `rete_non_registrata`, `sonda_assente`, `allineamento_fallito`: prima del lancio, non è partito niente;
 * - `rifiutato` (400, 409, 422) e `motore_non_disponibile` (503): Edge ha detto di no, col motivo;
 * - `non_so`: timeout, connessione caduta, risposta illeggibile. Il gruppo può essere partito o no.
 */
export type EsitoGruppoEdge =
  | { stato: "lanciato"; scan_id: number; status: string; ip_tolti: string[] }
  | { stato: "non_partito"; scan_id: number; ip_tolti: string[]; messaggio: string }
  | { stato: "gia_in_corso"; scan_id: number | null; messaggio: string }
  | { stato: "da_aggiornare" }
  | { stato: "rete_non_registrata"; messaggio?: string }
  | { stato: "sonda_assente"; messaggio: string }
  | { stato: "allineamento_fallito"; messaggio: string }
  | { stato: "rifiutato"; status: 400 | 409 | 422; messaggio: string }
  | { stato: "motore_non_disponibile"; messaggio: string }
  | { stato: "non_so"; messaggio: string };

export type StatoGruppoEdge = EsitoGruppoEdge["stato"];

export function leggiRispostaGruppo(raw: unknown): { ok: true; dati: RispostaGruppo } | { ok: false; error: string } {
  const KO = (campo: string) => ({ ok: false as const, error: `Risposta di Edge sui gruppi non valida: ${campo}` });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return KO("non è un oggetto");
  const r = raw as Record<string, unknown>;
  if (r.ok !== true) return KO("ok non è true");
  if (typeof r.scan_id !== "number" || !Number.isInteger(r.scan_id)) return KO("scan_id");
  if (typeof r.network_id !== "number" || !Number.isInteger(r.network_id)) return KO("network_id");
  if (typeof r.status !== "string") return KO("status");
  if (!Array.isArray(r.ip_tolti) || r.ip_tolti.some((x) => typeof x !== "string")) return KO("ip_tolti");
  if (r.error_message !== null && typeof r.error_message !== "string") return KO("error_message");
  return {
    ok: true,
    dati: {
      ok: true,
      scan_id: r.scan_id,
      network_id: r.network_id,
      status: r.status,
      ip_tolti: r.ip_tolti as string[],
      error_message: r.error_message as string | null,
    },
  };
}
