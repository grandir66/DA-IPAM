/**
 * GET /api/physical-devices/[id]/hosts
 *
 * Ritorna tutti gli host membri di un cluster fisico. Usato dalla sezione
 * "IP collegati" in /objects/[id] per mostrare gli IP aggregati.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { listHostsByPhysicalDevice, getPhysicalDeviceById } from "@/lib/devices/physical-device-db";
import { getDb } from "@/lib/db";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const { id } = await context.params;
    const physicalDeviceId = Number(id);
    if (!Number.isFinite(physicalDeviceId) || physicalDeviceId <= 0) {
      return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    }

    const device = getPhysicalDeviceById(physicalDeviceId);
    if (!device) return NextResponse.json({ error: "Cluster fisico non trovato" }, { status: 404 });

    const rawHosts = listHostsByPhysicalDevice(physicalDeviceId);
    if (rawHosts.length === 0) {
      return NextResponse.json({ device, hosts: [] }, { headers: NO_CACHE_HEADERS });
    }

    // Arricchimento minimo: hostname, vendor, status — per la UI cluster
    const placeholders = rawHosts.map(() => "?").join(",");
    const enriched = getDb().prepare(
      `SELECT h.id, h.ip, h.hostname, h.vendor, h.status, h.network_id, h.physical_device_id,
              h.inferred_os_family, h.inferred_device_type, n.name AS network_name, n.cidr AS network_cidr
         FROM hosts h
         JOIN networks n ON n.id = h.network_id
        WHERE h.id IN (${placeholders})
        ORDER BY h.ip`
    ).all(...rawHosts.map((h) => h.id)) as Array<{
      id: number;
      ip: string;
      hostname: string | null;
      vendor: string | null;
      status: "online" | "offline" | "unknown";
      network_id: number;
      physical_device_id: number | null;
      inferred_os_family: string | null;
      inferred_device_type: string | null;
      network_name: string;
      network_cidr: string;
    }>;

    return NextResponse.json({ device, hosts: enriched }, { headers: NO_CACHE_HEADERS });
  });
}
