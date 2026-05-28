/**
 * GET /api/integrations/librenms/graph-list?device_id=N
 *
 * Proxy di `/api/v0/devices/{id}/graphs` di LibreNMS: ritorna i tipi di grafico
 * disponibili per quel device (dipendono dal vendor/OS: un router Mikrotik ha
 * device_bits/device_processor, un host Windows magari solo device_ping_perf +
 * device_uptime, ecc.).
 *
 * Usato dalla UI per mostrare SOLO i grafici esistenti invece di una lista
 * hardcoded che produce errori 404 sulla maggior parte dei device.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LibreNMSGraphListEntry {
  name: string;
  desc?: string;
}

export async function GET(req: Request) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url || !cfg.apiToken) {
    return NextResponse.json({ error: "LibreNMS non configurato" }, { status: 404 });
  }

  const url = new URL(req.url);
  const deviceId = url.searchParams.get("device_id");
  if (!deviceId || !/^\d+$/.test(deviceId)) {
    return NextResponse.json({ error: "device_id mancante o non valido" }, { status: 400 });
  }

  const base = cfg.url.replace(/\/+$/, "");
  const upstreamUrl = `${base}/api/v0/devices/${encodeURIComponent(deviceId)}/graphs`;

  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      headers: { "X-Auth-Token": cfg.apiToken, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `LibreNMS HTTP ${res.status}`, graphs: [] },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { status?: string; graphs?: LibreNMSGraphListEntry[] };
    return NextResponse.json({ graphs: data.graphs ?? [] }, {
      headers: { "Cache-Control": "private, max-age=300" }, // 5 min: cambia raramente
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Errore contatto LibreNMS", graphs: [], details: msg }, { status: 502 });
  }
}
