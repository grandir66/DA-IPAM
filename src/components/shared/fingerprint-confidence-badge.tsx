"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FingerprintConfidenceBadgeProps {
  confidence: number; // 0–1
  deviceLabel?: string | null;
  className?: string;
}

export function FingerprintConfidenceBadge({
  confidence,
  deviceLabel,
  className,
}: FingerprintConfidenceBadgeProps) {
  if (confidence <= 0) return null;

  const pct = Math.round(confidence * 100);

  const variant =
    confidence >= 0.75
      ? "bg-green-100 text-green-800 border-green-200"
      : confidence >= 0.5
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-red-100 text-red-800 border-red-200";

  const label = confidence >= 0.75 ? "Alta" : confidence >= 0.5 ? "Media" : "Bassa";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium cursor-default ${variant} ${className ?? ""}`}
          >
            {pct}%
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-semibold">Confidenza rilevamento: {label} ({pct}%)</p>
          {deviceLabel && <p className="text-muted-foreground mt-0.5">Dispositivo: {deviceLabel}</p>}
          <p className="text-muted-foreground mt-0.5">
            Basata su porte aperte, SNMP, banner, MAC vendor e TTL
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
