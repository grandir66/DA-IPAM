"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Router, Network, Wifi, HardDrive, Server, Box, HelpCircle } from "lucide-react";
import type { TopologyStatus } from "@/lib/topology/types";

const ICON: Record<string, typeof Router> = {
  router: Router,
  switch: Network,
  firewall: Server,
  access_point: Wifi,
  nas: HardDrive,
  hypervisor: Server,
  vm: Box,
  server: Server,
  external: HelpCircle,
};

const COLOR: Record<TopologyStatus, string> = {
  ok: "#16a34a",
  warning: "#f59e0b",
  fail: "#dc2626",
  unknown: "#9ca3af",
};

export function StatusNode({ data }: NodeProps) {
  const d = data as { label: string; type: string; status: TopologyStatus; mgmtIp: string | null };
  const Icon = ICON[d.type] ?? HelpCircle;
  const color = COLOR[d.status] ?? COLOR.unknown;
  return (
    <div
      style={{ borderColor: color }}
      className="flex w-[160px] items-center gap-2 rounded-md border-2 bg-white px-2 py-1.5 shadow-sm"
    >
      <Handle type="target" position={Position.Top} />
      <span style={{ color }}>
        <Icon size={20} />
      </span>
      <span className="truncate text-xs" title={d.mgmtIp ?? ""}>
        {d.label}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
