/**
 * SSO LibreNMS per accesso diretto su nginx :7443.
 * Esegue login server-side e reindirizza con cookie laravel_session (Path=/).
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getIntegrationConfig } from "@/lib/integrations/config";
import { resolveIntegrationBrowserUrl } from "@/lib/integrations/public-url-server";
import {
  buildDirectLibreNMSSetCookies,
  librenmsAutologinCookieHeader,
  librenmsAutologinEnabled,
} from "@/lib/integrations/librenms-proxy-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  const cfg = getIntegrationConfig("librenms");
  if (cfg.mode === "disabled" || !cfg.url) {
    return new Response("LibreNMS non configurato", { status: 404 });
  }

  const target = `${resolveIntegrationBrowserUrl("librenms", cfg.url).replace(/\/+$/, "")}/`;

  if (!librenmsAutologinEnabled()) {
    return NextResponse.redirect(target);
  }

  const cookies = await librenmsAutologinCookieHeader();
  if (!cookies) {
    return new Response(
      "SSO LibreNMS non disponibile — verifica password admin in Impostazioni → Moduli → LibreNMS",
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const headers = new Headers();
  headers.set("Location", target);
  for (const sc of buildDirectLibreNMSSetCookies(cookies)) {
    headers.append("Set-Cookie", sc);
  }
  return new Response(null, { status: 302, headers });
}
