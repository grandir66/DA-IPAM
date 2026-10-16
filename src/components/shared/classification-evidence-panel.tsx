"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  ClassificationConflict,
  ClassificationEvidence,
  ClassificationJson,
} from "@/lib/classification/types";

interface ClassificationEvidencePanelProps {
  reason: string | null;
  confidence: number | null;
  classificationJson: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  naabu: "Naabu",
  nmap: "Nmap",
  snmp: "SNMP",
  http: "HTTP",
  ssh: "SSH",
  smb: "SMB",
  mac_oui: "MAC OUI",
  dns: "DNS",
  ttl: "TTL",
  rule: "Regola",
};

function parseClassificationJson(raw: string | null): ClassificationJson | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Partial<ClassificationJson>;
    if (!Array.isArray(obj.evidence)) return null;
    return {
      evidence: obj.evidence as ClassificationEvidence[],
      conflicts: Array.isArray(obj.conflicts)
        ? (obj.conflicts as ClassificationConflict[])
        : undefined,
      fingerprint_hash:
        typeof obj.fingerprint_hash === "string" ? obj.fingerprint_hash : "",
      engine_version:
        typeof obj.engine_version === "string" ? obj.engine_version : "",
      sources: Array.isArray(obj.sources)
        ? (obj.sources as ClassificationJson["sources"])
        : [],
    };
  } catch {
    return null;
  }
}

function ContributionBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const color =
    pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function EvidenceRow({ evidence }: { evidence: ClassificationEvidence }) {
  const contribution = evidence.weight * evidence.confidence;
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
        {SOURCE_LABEL[evidence.source] ?? evidence.source}
      </td>
      <td className="py-1.5 pr-3 text-xs font-medium max-w-[160px] truncate" title={evidence.attribute}>
        {evidence.attribute}
      </td>
      <td className="py-1.5 text-xs text-muted-foreground font-mono truncate max-w-[140px]" title={evidence.value}>
        {evidence.value}
      </td>
      <td className="py-1.5 pl-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
        {evidence.votes_for ?? "—"}
      </td>
      <td className="py-1.5 pl-3">
        <ContributionBar value={contribution} />
      </td>
    </tr>
  );
}

export function ClassificationEvidencePanel({
  reason,
  confidence,
  classificationJson,
}: ClassificationEvidencePanelProps) {
  const [open, setOpen] = useState(false);
  const snapshot = parseClassificationJson(classificationJson);
  const evidence = snapshot?.evidence ?? [];
  const conflicts = snapshot?.conflicts ?? [];

  if (!reason && evidence.length === 0 && conflicts.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {(reason || confidence != null) && (
        <div className="flex flex-wrap items-start gap-2">
          {confidence != null && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              {Math.round(confidence)}%
            </span>
          )}
          {reason && (
            <p className="text-xs text-foreground leading-relaxed flex-1 min-w-[12rem]">
              {reason}
            </p>
          )}
        </div>
      )}

      {(evidence.length > 0 || conflicts.length > 0) && (
        <div className="rounded-md border border-border/60 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
          >
            <span className="font-medium text-xs">
              Evidence classificazione
              {evidence.length > 0 ? ` (${evidence.length})` : ""}
              {conflicts.length > 0 ? ` · ${conflicts.length} conflitti` : ""}
            </span>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>

          {open && (
            <div className="px-3 py-2">
              {evidence.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Fonti</p>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left text-xs text-muted-foreground pb-1 pr-3 font-normal">Fonte</th>
                        <th className="text-left text-xs text-muted-foreground pb-1 pr-3 font-normal">Attributo</th>
                        <th className="text-left text-xs text-muted-foreground pb-1 font-normal">Valore</th>
                        <th className="text-left text-xs text-muted-foreground pb-1 pl-2 pr-2 font-normal">Vota</th>
                        <th className="text-left text-xs text-muted-foreground pb-1 pl-3 font-normal">Peso×conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.map((e, i) => (
                        <EvidenceRow key={i} evidence={e} />
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {conflicts.length > 0 && (
                <div className={evidence.length > 0 ? "mt-3" : undefined}>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Conflitti</p>
                  <ul className="space-y-1">
                    {conflicts.map((c, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.a}</span>
                        {" "}({Math.round(c.score_a)}) vs{" "}
                        <span className="font-medium text-foreground">{c.b}</span>
                        {" "}({Math.round(c.score_b)}) · Δ {Math.round(c.delta)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {snapshot?.engine_version && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  engine {snapshot.engine_version}
                  {snapshot.sources.length > 0
                    ? ` · ${snapshot.sources.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}`
                    : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
