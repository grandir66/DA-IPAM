"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FingerprintExplanation, ClassificationFeature } from "@/types";

interface FingerprintExplanationPanelProps {
  explanation: FingerprintExplanation;
}

const SOURCE_LABEL: Record<string, string> = {
  ports: "Porte aperte",
  snmp_oid: "SNMP OID",
  snmp_sysdescr: "SNMP sysDescr",
  banner_http: "Banner HTTP",
  banner_ssh: "Banner SSH",
  hostname: "Hostname",
  mac_vendor: "MAC vendor",
  ttl: "TTL",
  nmap_os: "nmap OS",
};

function ContributionBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
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

function FeatureRow({ feature }: { feature: ClassificationFeature }) {
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
        {SOURCE_LABEL[feature.source] ?? feature.source}
      </td>
      <td className="py-1.5 pr-3 text-xs font-medium max-w-[200px] truncate" title={feature.label}>
        {feature.label}
      </td>
      <td className="py-1.5 text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={feature.value}>
        {feature.value}
      </td>
      <td className="py-1.5 pl-3">
        <ContributionBar value={feature.contribution} />
      </td>
    </tr>
  );
}

export function FingerprintExplanationPanel({ explanation }: FingerprintExplanationPanelProps) {
  const [open, setOpen] = useState(false);

  if (explanation.features.length === 0 && explanation.unmatched_signals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Nessun dato di fingerprinting disponibile.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border/60 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        <span className="font-medium text-xs">Perché questa classificazione?</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-3 py-2">
          {explanation.features.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Segnali rilevati</p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="text-left text-xs text-muted-foreground pb-1 pr-3 font-normal">Tipo</th>
                    <th className="text-left text-xs text-muted-foreground pb-1 pr-3 font-normal">Segnale</th>
                    <th className="text-left text-xs text-muted-foreground pb-1 font-normal">Valore</th>
                    <th className="text-left text-xs text-muted-foreground pb-1 pl-3 font-normal">Contributo</th>
                  </tr>
                </thead>
                <tbody>
                  {explanation.features.map((f, i) => (
                    <FeatureRow key={i} feature={f} />
                  ))}
                </tbody>
              </table>
            </>
          )}

          {explanation.unmatched_signals.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                {explanation.unmatched_signals.length} segnali presenti ma non determinanti
              </summary>
              <ul className="mt-1 space-y-0.5 pl-2">
                {explanation.unmatched_signals.map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    <span className="font-medium">{SOURCE_LABEL[s.source] ?? s.source}:</span>{" "}
                    <span className="font-mono">{s.value}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
