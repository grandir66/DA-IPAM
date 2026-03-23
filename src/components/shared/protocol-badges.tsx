"use client";

import { Badge } from "@/components/ui/badge";

const PROTOCOL_CONFIG: Record<string, { label: string; className: string }> = {
  ssh: {
    label: "SSH",
    className: "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400",
  },
  snmp: {
    label: "SNMP",
    className: "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400",
  },
  winrm: {
    label: "WinRM",
    className: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400",
  },
  api: {
    label: "API",
    className: "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400",
  },
};

interface ProtocolBadgesProps {
  protocols: string[];
  onClick?: () => void;
}

export function ProtocolBadges({ protocols, onClick }: ProtocolBadgesProps) {
  if (!protocols || protocols.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
      title={onClick ? "Clicca per gestire le credenziali" : undefined}
    >
      {protocols.map((proto) => {
        const config = PROTOCOL_CONFIG[proto];
        if (!config) return null;
        return (
          <Badge
            key={proto}
            variant="outline"
            className={`text-[10px] px-1.5 py-0 h-4 leading-none ${config.className}`}
          >
            {config.label}
          </Badge>
        );
      })}
    </div>
  );
}
