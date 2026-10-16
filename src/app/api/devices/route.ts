import { NextResponse } from "next/server";
import { getNetworkDevices, getRouters, getSwitches, getDevicesByClassificationOrLegacy, getDeviceCredentialProtocolsSummary } from "@/lib/db";
import { senzaColonneVecchie } from "@/lib/devices/colonne-vecchie";
import { creaApparato } from "@/lib/devices/crea-apparato";
import { avvisoPortaProtocollo } from "@/lib/devices/porta-protocollo";
import { requireAdminOrOnboarding, isAuthError } from "@/lib/api-auth";
import { getTenantMode, withTenantFromSession } from "@/lib/api-tenant";
import { queryAllTenants, getHostStatusesByIp } from "@/lib/db-tenant";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function deviceCreateErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Errore nella creazione del dispositivo";
  const m = err.message;
  if (m.includes("ENCRYPTION_KEY")) {
    return "Configurazione server incompleta: manca ENCRYPTION_KEY in .env.local.";
  }
  if (m.includes("SQLITE_CONSTRAINT") || m.toLowerCase().includes("constraint failed")) {
    if (m.includes("FOREIGN KEY") || m.includes("foreign key")) {
      return "Credenziale o riferimento non valido (vincolo database).";
    }
    return "Esiste già un record in conflitto con questi dati oppure vincolo violato.";
  }
  return m.length > 0 && m.length < 220 ? m : "Errore nella creazione del dispositivo";
}

/** Alias storage unificati (Synology, QNAP, nas generico → storage) */
const STORAGE_ALIASES = ["nas", "nas_synology", "nas_qnap"];

export async function GET(request: Request) {
  const mode = await getTenantMode();
  if (mode.mode === "unauthenticated") {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  if (mode.mode === "all") {
    try {
      const { searchParams } = new URL(request.url);
      const type = searchParams.get("type") as "router" | "switch" | null;
      const rawClassification = searchParams.get("classification");
      const classification = rawClassification && STORAGE_ALIASES.includes(rawClassification) ? "storage" : rawClassification;

      const allDevices = queryAllTenants(() => {
        if (classification) {
          return getDevicesByClassificationOrLegacy(classification) as unknown as Record<string, unknown>[];
        }
        const devices = type === "router"
          ? getRouters()
          : type === "switch"
            ? getSwitches()
            : getNetworkDevices();
        return devices as unknown as (Record<string, unknown> & { last_proxmox_scan_result?: unknown })[];
      });
      const credProtoMap = queryAllTenants(() => {
        const credMap = getDeviceCredentialProtocolsSummary();
        return Array.from(credMap.entries()).map(([device_id, protocols]) => ({
          device_id,
          protocols,
        } as unknown as Record<string, unknown>));
      });
      const credLookup = new Map<string, string[]>();
      for (const entry of credProtoMap) {
        const key = `${entry._tenantCode}:${entry.device_id}`;
        credLookup.set(key, entry.protocols as unknown as string[]);
      }
      const masked = allDevices.map((d) => ({
        ...senzaColonneVecchie(d),
        source: "network_device" as const,
        credential_protocols: credLookup.get(`${d._tenantCode}:${d.id}`) || [],
        last_proxmox_scan_result: d.last_proxmox_scan_result ? "HAS_DATA" : null,
      }));
      return NextResponse.json(masked, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error("Error fetching devices (all tenants):", error);
      return NextResponse.json({ error: "Errore nel recupero dei dispositivi" }, { status: 500 });
    }
  }

  return withTenantFromSession(async () => {
    try {
      const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as "router" | "switch" | null;
    const rawClassification = searchParams.get("classification");
    const classification = rawClassification && STORAGE_ALIASES.includes(rawClassification) ? "storage" : rawClassification;

    const credMap = getDeviceCredentialProtocolsSummary();

    if (classification) {
      const networkDevices = getDevicesByClassificationOrLegacy(classification);
      const statiClasse = getHostStatusesByIp(networkDevices.map((d) => d.host));
      const maskedDevices = networkDevices.map((d) => ({
        ...senzaColonneVecchie(d),
        source: "network_device" as const,
        host_status: statiClasse.get(d.host)?.status ?? null,
        host_last_seen: statiClasse.get(d.host)?.last_seen ?? null,
        credential_protocols: credMap.get(d.id) || [],
        last_proxmox_scan_result: d.last_proxmox_scan_result ? "HAS_DATA" : null,
      }));
      return NextResponse.json(maskedDevices, { headers: NO_CACHE_HEADERS });
    }

    const devices = type === "router"
      ? getRouters()
      : type === "switch"
        ? getSwitches()
        : getNetworkDevices();
    // Stato di raggiungibilità dagli host scansionati con lo stesso IP (UI-8):
    // "enabled" dice solo se il dispositivo è attivo in anagrafica.
    const stati = getHostStatusesByIp(devices.map((d) => d.host));
    const masked = devices.map((d) => ({
      ...senzaColonneVecchie(d),
      source: "network_device" as const,
      host_status: stati.get(d.host)?.status ?? null,
      host_last_seen: stati.get(d.host)?.last_seen ?? null,
      credential_protocols: credMap.get(d.id) || [],
      last_proxmox_scan_result: d.last_proxmox_scan_result ? "HAS_DATA" : null,
    }));
    return NextResponse.json(masked, { headers: NO_CACHE_HEADERS });
    } catch (error) {
      console.error("Error fetching devices:", error);
      return NextResponse.json({ error: "Errore nel recupero dei dispositivi" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdminOrOnboarding();
      if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const esito = creaApparato(body);
    if (!esito.ok) {
      return NextResponse.json({ error: esito.error }, { status: esito.status });
    }
    const device = esito.device;
    // Avviso, non rifiuto (16/10): vedi PUT /api/devices/[id].
    const avviso = avvisoPortaProtocollo(device);

    return NextResponse.json({
      ...senzaColonneVecchie(device),
      ...(avviso ? { avvisi: [avviso] } : {}),
    }, { status: 201 });
    } catch (error) {
      console.error("Error creating device:", error);
      return NextResponse.json({ error: deviceCreateErrorMessage(error) }, { status: 500 });
    }
  });
}
