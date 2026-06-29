"use client";

/**
 * Mini-icona presenza MeshCentral (3 stati, spec §8/D7), clone semplificato di
 * wazuh-host-badge.tsx. Lo stato è SEMPRE prefetchato dal parent (lista discovery);
 * questo badge non fa fetch per-riga.
 *
 * Stati:
 *   - absent (grigio)  → nessun nodo MeshCentral mappato a questo host
 *   - active (verde)   → present && conn&1 && synced_at entro 14 giorni
 *   - stale  (ambra)   → present ma offline o synced_at vecchio (>14g)
 */

import { MonitorSmartphone, MonitorOff } from "lucide-react";

type MeshState = { present: boolean; nodeId?: string; conn?: number; syncedAt?: string } | null;

interface Props {
  hostId: number;
  mesh: MeshState;
  mode?: "icon" | "row";
  className?: string;
}

const STALE_DAYS = 14;

function isFresh(syncedAt?: string): boolean {
  if (!syncedAt) return false;
  const t = Date.parse(syncedAt.includes("T") ? syncedAt : syncedAt.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= STALE_DAYS * 24 * 60 * 60 * 1000;
}

function kindOf(mesh: MeshState): "active" | "stale" | "absent" {
  if (!mesh || !mesh.present) return "absent";
  const online = ((mesh.conn ?? 0) & 1) === 1;
  return online && isFresh(mesh.syncedAt) ? "active" : "stale";
}

function colorClass(kind: "active" | "stale" | "absent"): string {
  if (kind === "active") return "text-emerald-600 dark:text-emerald-400";
  if (kind === "stale") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground/30";
}

function fmtTs(ts?: string): string {
  if (!ts) return "—";
  try {
    return new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z").toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

export function MeshCentralHostBadge({ hostId, mesh, mode = "icon", className }: Props) {
  void hostId; // riservato per future azioni (apertura sessione dal badge)
  const kind = kindOf(mesh);
  const color = colorClass(kind);
  const Icon = kind === "absent" ? MonitorOff : MonitorSmartphone;

  const title =
    kind === "absent"
      ? "Nessun agente MeshCentral su questo host"
      : kind === "active"
        ? `MeshCentral: online • node ${mesh?.nodeId ?? "?"} • sync ${fmtTs(mesh?.syncedAt)}`
        : `MeshCentral: offline o stale • node ${mesh?.nodeId ?? "?"} • sync ${fmtTs(mesh?.syncedAt)}`;

  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      {mode === "row" && <span className={`text-xs ${color}`}>MeshCentral</span>}
    </span>
  );
}
