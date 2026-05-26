/**
 * Proxy che restituisce un PNG di grafico LibreNMS per il device richiesto.
 *
 * Query params:
 *   device_id  (int, obbligatorio)
 *   type       (string, default: device_bits) — es. device_bits, device_processor,
 *              device_mempool, device_ping_perf, port_bits, ...
 *   from       (string, default: -1d)   — relativo (-1d / -6h) o epoch
 *   to         (string, default: now)
 *   width      (int, default 1200)
 *   height     (int, default 250)
 *
 * Implementazione: chiamiamo `/api/v0/devices/:id/graphs/:type` con
 * `X-Auth-Token` server-side e restituiamo il PNG decodificato.
 * Cache: `Cache-Control: private, max-age=60` (rinfresca ogni minuto).
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shape della risposta LibreNMS API per i grafici:
 *
 * - LibreNMS vecchio (~v1.x):  { status, image: "<base64>", image_type: "image/png" }
 * - LibreNMS recente (≥24.x):  { status, image: { image: "<base64>", "content-type": "image/svg+xml" }, count }
 *
 * Gestiamo entrambi i formati.
 */
interface LibreNMSGraphResponse {
  image_type?: string;
  image?: string | { image: string; "content-type"?: string; image_type?: string };
  status?: string;
  message?: string;
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
  const type = url.searchParams.get("type") ?? "device_bits";
  const from = url.searchParams.get("from") ?? "-1d";
  const to = url.searchParams.get("to") ?? "now";
  const width = url.searchParams.get("width") ?? "1200";
  const height = url.searchParams.get("height") ?? "250";

  if (!deviceId || !/^\d+$/.test(deviceId)) {
    return NextResponse.json({ error: "device_id mancante o non valido" }, { status: 400 });
  }

  const base = cfg.url.replace(/\/+$/, "");
  const params = new URLSearchParams({ from, to, width, height, output: "base64" });
  // v0.2.609 fix: il path LibreNMS API per un grafico singolo è `/devices/{id}/{type}`,
  // NON `/devices/{id}/graphs/{type}`. Il path con `graphs/` esiste solo come listing
  // (`/devices/{id}/graphs` → elenco dei tipi disponibili).
  // Riferimento: docs.librenms.org/API/Devices/#get-graph-by-type
  const upstreamUrl = `${base}/api/v0/devices/${encodeURIComponent(deviceId)}/${encodeURIComponent(type)}?${params.toString()}`;

  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      headers: { "X-Auth-Token": cfg.apiToken, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `LibreNMS HTTP ${res.status}`, details: text.slice(0, 300) },
        { status: 502 },
      );
    }

    const ct = res.headers.get("content-type") ?? "";
    if (ct.startsWith("image/")) {
      // Alcune versioni rispondono direttamente con il binario.
      const buf = Buffer.from(await res.arrayBuffer());
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "content-type": ct,
          "cache-control": "private, max-age=60",
        },
      });
    }

    const data = (await res.json()) as LibreNMSGraphResponse;
    // v0.2.610 fix: gestione struttura nested. LibreNMS ≥24 risponde con
    //   { image: { image: "<base64>", "content-type": "image/svg+xml" } }
    // mentre versioni precedenti rispondevano con
    //   { image: "<base64>", image_type: "image/png" }
    let imageB64: string | undefined;
    let imageMime: string | undefined;
    if (typeof data.image === "string") {
      imageB64 = data.image;
      imageMime = data.image_type;
    } else if (data.image && typeof data.image === "object") {
      imageB64 = data.image.image;
      imageMime = data.image["content-type"] ?? data.image.image_type;
    }
    if (!imageB64) {
      return NextResponse.json(
        { error: "Grafico non disponibile", details: data.message ?? "" },
        { status: 404 },
      );
    }

    // L'immagine può venire come "data:image/png;base64,..." prefissata o solo base64.
    const m = imageB64.match(/^data:([^;]+);base64,(.*)$/);
    const mime = m?.[1] ?? imageMime ?? "image/png";
    const b64 = m?.[2] ?? imageB64;
    const buf = Buffer.from(b64, "base64");

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": mime,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Errore contatto LibreNMS", details: msg }, { status: 502 });
  }
}
