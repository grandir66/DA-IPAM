/**
 * NIS2 — Engine di rilevamento gap di compliance.
 *
 * Per ogni asset in scope NIS2 identifica i campi mancanti / le misure di
 * protezione non implementate, classificandoli per severità.
 *
 * Le regole derivano dall'art. 21 NIS2 (misure tecniche e organizzative) e da
 * principi di proporzionalità basati su criticità e dati trattati.
 */

import type { InventoryAsset } from "@/types";

export type GapSeverity = "critico" | "alto" | "medio" | "basso";

export interface Nis2Gap {
  /** Chiave del campo non conforme */
  field: string;
  /** Descrizione user-facing */
  message: string;
  severity: GapSeverity;
  /** Categoria della regola (per raggruppamento report) */
  category: "anagrafica" | "responsabilita" | "protezione" | "operativa" | "audit";
}

export interface AssetGapReport {
  asset_id: number;
  hostname: string | null;
  asset_tag: string | null;
  in_scope_nis2: number;
  criticita_nis2: string | null;
  gaps: Nis2Gap[];
  /** Score 0-100: 100 = nessun gap */
  conformance_score: number;
}

const isZero = (v: number | null | undefined): boolean => !v;
const isUnset = (v: string | null | undefined): boolean => v == null || v === "";

/** Calcola conformance score: 100 - somma pesi gap (cap a 0). */
function computeScore(gaps: Nis2Gap[]): number {
  const weights: Record<GapSeverity, number> = { critico: 25, alto: 12, medio: 6, basso: 2 };
  const total = gaps.reduce((acc, g) => acc + weights[g.severity], 0);
  return Math.max(0, 100 - total);
}

/**
 * Analizza un singolo asset e ritorna l'elenco dei gap.
 * Le regole si applicano solo se l'asset è in scope NIS2.
 */
export function detectGapsForAsset(a: InventoryAsset): Nis2Gap[] {
  if (!a.in_scope_nis2) return [];
  const gaps: Nis2Gap[] = [];

  // ── Anagrafica minima (art. 21 — identificazione asset) ──
  if (isUnset(a.categoria_nis2)) {
    gaps.push({ field: "categoria_nis2", message: "Categoria NIS2 non impostata", severity: "alto", category: "anagrafica" });
  }
  if (isUnset(a.criticita_nis2)) {
    gaps.push({ field: "criticita_nis2", message: "Criticità non valutata", severity: "alto", category: "anagrafica" });
  }
  if (isUnset(a.dati_trattati)) {
    gaps.push({ field: "dati_trattati", message: "Tipologia dati trattati non dichiarata", severity: "medio", category: "anagrafica" });
  }

  // ── Responsabilità (art. 21 §2(f) — ruoli e responsabilità) ──
  if (a.business_owner_id == null) {
    gaps.push({ field: "business_owner_id", message: "Business owner non assegnato", severity: "alto", category: "responsabilita" });
  }
  if (a.technical_owner_id == null) {
    gaps.push({ field: "technical_owner_id", message: "Technical owner non assegnato", severity: "medio", category: "responsabilita" });
  }

  // ── Protezione: backup (art. 21 §2(c) — business continuity) ──
  if (isZero(a.backup_configurato)) {
    const sev: GapSeverity = a.criticita_nis2 === "critica" ? "critico" : a.criticita_nis2 === "alta" ? "alto" : "medio";
    gaps.push({ field: "backup_configurato", message: "Backup non configurato", severity: sev, category: "protezione" });
  } else if (isUnset(a.backup_ultimo_test)) {
    gaps.push({ field: "backup_ultimo_test", message: "Backup mai testato (nessuna data di restore)", severity: "alto", category: "operativa" });
  } else {
    // Backup testato troppo tempo fa?
    const lastTest = new Date(a.backup_ultimo_test!).getTime();
    const days = (Date.now() - lastTest) / (1000 * 60 * 60 * 24);
    if (days > 180) {
      gaps.push({ field: "backup_ultimo_test", message: `Backup non testato da ${Math.floor(days)} giorni (linea guida ENISA: ≤6 mesi)`, severity: "medio", category: "operativa" });
    }
  }

  // ── Protezione: patching & vulnerability management (art. 21 §2(e)) ──
  if (isZero(a.patching_automatico)) {
    const sev: GapSeverity = a.criticita_nis2 === "critica" ? "alto" : "medio";
    gaps.push({ field: "patching_automatico", message: "Patching automatico non attivo", severity: sev, category: "protezione" });
  }

  // ── Protezione: controllo accessi (art. 21 §2(i) — MFA) ──
  if (isZero(a.mfa_admin)) {
    const sev: GapSeverity = a.criticita_nis2 === "critica" || a.criticita_nis2 === "alta" ? "critico" : "alto";
    gaps.push({ field: "mfa_admin", message: "MFA su accessi amministrativi non configurato", severity: sev, category: "protezione" });
  }

  // ── Protezione: logging (art. 21 §2(c) — monitoraggio) ──
  if (isZero(a.log_centralizzati)) {
    gaps.push({ field: "log_centralizzati", message: "Log non centralizzati (SIEM)", severity: "medio", category: "protezione" });
  }

  // ── Protezione: hardening baseline ──
  if (isZero(a.hardening_baseline)) {
    gaps.push({ field: "hardening_baseline", message: "Hardening baseline non applicato", severity: "medio", category: "protezione" });
  }

  // ── Continuità: DR plan (art. 21 §2(c)) ──
  if (isZero(a.dr_plan_documentato) && (a.criticita_nis2 === "critica" || a.criticita_nis2 === "alta")) {
    gaps.push({ field: "dr_plan_documentato", message: "Disaster recovery plan non documentato per asset critico/alto", severity: "alto", category: "protezione" });
  }

  // ── Incident response (art. 21 §2(b)) ──
  if (isZero(a.incident_response_documentata)) {
    const sev: GapSeverity = a.criticita_nis2 === "critica" || a.criticita_nis2 === "alta" ? "alto" : "medio";
    gaps.push({ field: "incident_response_documentata", message: "Procedura incident response non documentata", severity: sev, category: "protezione" });
  }

  // ── Crittografia per dati sensibili / sanitari (art. 21 §2(g)) ──
  if (isZero(a.crittografia_disco) && (a.dati_trattati === "sensibili" || a.dati_trattati === "sanitari" || a.dati_trattati === "finanziari")) {
    gaps.push({ field: "crittografia_disco", message: `Crittografia disco mancante con dati ${a.dati_trattati}`, severity: "critico", category: "protezione" });
  }

  // ── Audit periodico ──
  if (isUnset(a.data_review_nis2)) {
    gaps.push({ field: "data_review_nis2", message: "Mai effettuata review NIS2", severity: "medio", category: "audit" });
  } else {
    const last = new Date(a.data_review_nis2!).getTime();
    const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
    if (days > 365) {
      gaps.push({ field: "data_review_nis2", message: `Review NIS2 scaduta da ${Math.floor(days - 365)} giorni`, severity: "alto", category: "audit" });
    }
  }

  return gaps;
}

/** Genera un report per ogni asset in input. */
export function buildAssetGapReports(assets: InventoryAsset[]): AssetGapReport[] {
  return assets
    .filter((a) => a.in_scope_nis2)
    .map((a) => {
      const gaps = detectGapsForAsset(a);
      return {
        asset_id: a.id,
        hostname: a.hostname,
        asset_tag: a.asset_tag,
        in_scope_nis2: a.in_scope_nis2,
        criticita_nis2: a.criticita_nis2,
        gaps,
        conformance_score: computeScore(gaps),
      };
    });
}

/** Statistiche aggregate per dashboard. */
export interface GapSummary {
  total_in_scope: number;
  total_with_gaps: number;
  avg_conformance_score: number;
  by_severity: Record<GapSeverity, number>;
  by_category: Record<string, number>;
}

export function summarizeGaps(reports: AssetGapReport[]): GapSummary {
  const bySev: Record<GapSeverity, number> = { critico: 0, alto: 0, medio: 0, basso: 0 };
  const byCat: Record<string, number> = {};
  let totalScore = 0;
  let withGaps = 0;
  for (const r of reports) {
    if (r.gaps.length > 0) withGaps++;
    totalScore += r.conformance_score;
    for (const g of r.gaps) {
      bySev[g.severity]++;
      byCat[g.category] = (byCat[g.category] ?? 0) + 1;
    }
  }
  return {
    total_in_scope: reports.length,
    total_with_gaps: withGaps,
    avg_conformance_score: reports.length > 0 ? Math.round(totalScore / reports.length) : 100,
    by_severity: bySev,
    by_category: byCat,
  };
}
