"use client";

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn, parseCidr, longToIp, hostOpenPortsToFullLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { Host } from "@/types";
import { ipAssignmentShortLabel } from "@/lib/ip-assignment";

interface IpGridProps {
  cidr: string;
  hosts: Host[];
  gateway?: string | null;
}

interface CellData {
  ip: string;
  host: Host | null;
  isNetwork: boolean;
  isBroadcast: boolean;
  isGateway: boolean;
}

const COLS_PER_ROW = 32;
const IPS_PER_BLOCK = 256;

export const IpGrid = memo(function IpGrid({ cidr, hosts, gateway }: IpGridProps) {
  const router = useRouter();

  const parsed = useMemo(() => {
    try {
      const trimmed = String(cidr || "").trim();
      if (!trimmed) return null;
      return parseCidr(trimmed);
    } catch {
      return null;
    }
  }, [cidr]);

  const hostMap = useMemo(() => new Map(hosts.map((h) => [h.ip, h])), [hosts]);

  // Blocchi /24 per reti più grandi di /24
  const blocks = useMemo(() => {
    if (!parsed || typeof parsed.networkLong !== "number" || typeof parsed.broadcastLong !== "number" || parsed.networkLong > parsed.broadcastLong) {
      return [];
    }
    const { networkLong, broadcastLong } = parsed;
    const list: { label: string; startLong: number; endLong: number }[] = [];
    const startBlock = ((networkLong >>> 8) << 8) >>> 0;

    for (let base = startBlock; base <= broadcastLong; base += IPS_PER_BLOCK) {
      const blockStart = Math.max(base, networkLong);
      const blockEnd = Math.min(base + IPS_PER_BLOCK - 1, broadcastLong);
      const prefix3 = longToIp(base).split(".").slice(0, 3).join(".");
      list.push({
        label: `${prefix3}.0/24`,
        startLong: blockStart,
        endLong: blockEnd,
      });
    }
    return list;
  }, [parsed]);

  const [currentBlock, setCurrentBlock] = useState(0);
  const block = blocks[currentBlock] ?? blocks[0];
  const needsNav = blocks.length > 1;

  // Celle del blocco corrente
  const cells = useMemo(() => {
    const result: CellData[] = [];
    if (!block || !parsed) return result;
    const { networkLong, broadcastLong, prefix } = parsed;

    for (let i = block.startLong; i <= block.endLong; i++) {
      const ip = longToIp(i);
      result.push({
        ip,
        host: hostMap.get(ip) || null,
        isNetwork: i === networkLong && prefix < 31,
        isBroadcast: i === broadcastLong && prefix < 31,
        isGateway: ip === gateway,
      });
    }
    return result;
  }, [block, parsed, hostMap, gateway]);

  if (!parsed) {
    return (
      <p className="text-muted-foreground text-sm py-4">CIDR non valido: {cidr}</p>
    );
  }

  const getCellTooltipContent = (cell: CellData) => {
    const lines: string[] = [cell.ip];
    if (cell.isNetwork) lines.push("Indirizzo di rete");
    if (cell.isBroadcast) lines.push("Broadcast");
    if (cell.isGateway) lines.push("Gateway");
    if (cell.host) {
      const name = cell.host.custom_name || cell.host.hostname || cell.host.dns_reverse || null;
      if (name) lines.push(`Nome: ${name}`);
      lines.push(`Stato: ${cell.host.status}`);
      if (cell.host.mac) lines.push(`MAC: ${cell.host.mac}`);
      if (cell.host.vendor) lines.push(`Vendor: ${cell.host.vendor}`);
      const ipAsg = ipAssignmentShortLabel(cell.host.ip_assignment);
      if (ipAsg) lines.push(`DHCP: ${ipAsg}`);
      const adDns = (cell.host as Host & { ad_dns_host_name?: string | null }).ad_dns_host_name;
      if (adDns) lines.push("AD: ✓");
      if (cell.host.classification) lines.push(`Classificazione: ${cell.host.classification}`);
      const device = (cell.host as { device?: { id: number; name: string; sysname?: string | null; vendor: string; protocol: string } }).device;
      if (device) {
        const displayName = cell.host.custom_name || cell.host.hostname || cell.host.dns_reverse || device.sysname || (device.name !== cell.host.ip ? device.name : null) || "—";
        lines.push(`Dispositivo: ${displayName} (${device.vendor}, ${device.protocol.toUpperCase()})`);
      }
      if (cell.host.open_ports) {
        const full = hostOpenPortsToFullLabel(cell.host.open_ports);
        if (full) lines.push(`Porte: ${full}`);
      }
      if (cell.host.last_seen) lines.push(`Ultimo contatto: ${new Date(cell.host.last_seen).toLocaleString("it-IT")}`);
    } else if (!cell.isNetwork && !cell.isBroadcast) lines.push("Non occupato");
    return lines;
  };

  return (
    <TooltipProvider delay={100}>
    <div className="space-y-3">
      {/* Pulsanti di spostamento per reti > /24 */}
      {needsNav && block && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentBlock === 0} onClick={() => setCurrentBlock(0)}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentBlock === 0} onClick={() => setCurrentBlock((b) => Math.max(0, b - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
          <span className="font-mono text-sm font-medium">
            {block.label} (blocco {currentBlock + 1} di {blocks.length})
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentBlock >= blocks.length - 1} onClick={() => setCurrentBlock((b) => Math.min(blocks.length - 1, b + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentBlock >= blocks.length - 1} onClick={() => setCurrentBlock(blocks.length - 1)}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* IP Grid — 32 celle per riga */}
      <div className="overflow-x-auto">
        {cells.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">Nessuna cella da mostrare</p>
        ) : (
        <table className="border-collapse">
          <tbody>
            {Array.from({ length: Math.ceil(cells.length / COLS_PER_ROW) }, (_, rowIdx) => {
              const rowCells = cells.slice(rowIdx * COLS_PER_ROW, rowIdx * COLS_PER_ROW + COLS_PER_ROW);
              return (
                <tr key={rowIdx}>
                  {rowCells.map((cell) => {
                    const lastOctet = cell.ip.split(".").pop();
                    const colorClass = cell.isNetwork || cell.isBroadcast
                      ? "bg-muted-foreground/20"
                      : cell.isGateway
                      ? "bg-accent/60"
                      : cell.host?.status === "online"
                      ? "bg-success/80 text-white"
                      : cell.host?.status === "offline"
                      ? "bg-destructive/80 text-white"
                      : cell.host
                      ? "bg-muted-foreground/40"
                      : "bg-card";
                    const tooltipLines = getCellTooltipContent(cell);
                    return (
                      <td key={cell.ip} className="p-0">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                className={cn(
                                  "w-8 h-8 text-[10px] font-mono border border-border rounded",
                                  colorClass,
                                  cell.host && "cursor-pointer hover:opacity-90",
                                )}
                                onClick={() => cell.host && router.push(`/hosts/${cell.host.id}`)}
                              />
                            }
                          >
                            {lastOctet}
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[280px]">
                            <div className="space-y-0.5 text-left">
                              {tooltipLines.map((line, i) => (
                                <div key={i}>{line}</div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                  {Array.from({ length: COLS_PER_ROW - rowCells.length }, (_, i) => (
                    <td key={`pad-${rowIdx}-${i}`} className="p-0" aria-hidden="true">
                      <span className="block w-8 h-8" />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
});
