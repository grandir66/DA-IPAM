const VALID_VIEWMODES = new Set([11, 12, 13]); // 11 desktop · 12 terminal · 13 files

/**
 * Build the MeshCentral launch-out deep-link (spec §10).
 *
 *   https://<serverUrl>/?login=<token>&node=<nodeId>&viewmode=<vm>&hide=15
 *
 * - Param names are case-sensitive; uses `node=` (server-resolved, cold-link
 *   safe), NOT `gotonode`.
 * - `hide=15` collapses the MeshCentral chrome for a focused session.
 * - https is always forced (token must never travel over http).
 * - The token and nodeId are URL-encoded so the @/$/= alphabet survives intact
 *   through the browser/proxy.
 */
export function buildRemoteSessionUrl(opts: {
  serverUrl: string;
  token: string;
  nodeId: string;
  viewmode: number;
}): string {
  if (!VALID_VIEWMODES.has(opts.viewmode)) {
    throw new Error(
      `meshcentral deep-link: viewmode must be 11 (desktop), 12 (terminal) or 13 (files), got ${opts.viewmode}`,
    );
  }
  if (!opts.serverUrl) {
    throw new Error("meshcentral deep-link: serverUrl is required");
  }
  if (!opts.token) {
    throw new Error("meshcentral deep-link: token is required");
  }
  if (!opts.nodeId) {
    throw new Error("meshcentral deep-link: nodeId is required");
  }
  // Normalize host: drop any scheme and trailing slashes, force https.
  const host = opts.serverUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const query =
    `login=${encodeURIComponent(opts.token)}` +
    `&node=${encodeURIComponent(opts.nodeId)}` +
    `&viewmode=${opts.viewmode}` +
    `&hide=15`;
  return `https://${host}/?${query}`;
}
