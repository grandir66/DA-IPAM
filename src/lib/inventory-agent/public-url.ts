/** URL pubblico ingest (Bearer token lato client). */
export function publicIngestUrl(request: Request): string {
  const env = process.env.DA_IPAM_PUBLIC_URL?.trim();
  if (env) return `${env.replace(/\/$/, "")}/api/inventory/ingest`;
  try {
    const u = new URL(request.url);
    return `${u.origin}/api/inventory/ingest`;
  } catch {
    return "/api/inventory/ingest";
  }
}

/** Origin hub per script curl/irm (senza trailing slash). */
export function publicHubOrigin(request: Request): string {
  const env = process.env.DA_IPAM_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  try {
    const u = new URL(request.url);
    return u.origin;
  } catch {
    return "";
  }
}
