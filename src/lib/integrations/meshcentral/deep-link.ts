const VALID_VIEWMODES = new Set([11, 12, 13]); // 11 desktop · 12 terminal · 13 files

/**
 * Bitmask `hide` di MeshCentral: nasconde la sua chrome per lasciare solo la
 * sessione. Bit ricavati dal sorgente (views/default.handlebars), non dalla doc:
 *   1  = logout control      2  = barra superiore
 *   4  = footer              8  = titoli di pagina
 *   16 = BARRA LATERALE  → QV('page_leftbar', false)
 *
 * 31 = 1+2+4+8+16. Prima si usava 15, che lasciava visibile la barra laterale di
 * MeshCentral: dentro la nostra pagina si vedevano le sue icone accanto al
 * desktop, rompendo l'illusione di un modulo nativo (segnalato dall'utente con
 * uno screenshot il 2026-07-17). Puntiamo sempre a un nodo preciso, quindi la
 * navigazione di MeshCentral non serve mai.
 */
const MC_HIDE_CHROME = 31;

/**
 * Build the MeshCentral launch-out deep-link (spec §10).
 *
 *   https://<serverUrl>/?login=<token>&node=<nodeId>&viewmode=<vm>&hide=31
 *
 * - Param names are case-sensitive; uses `node=` (server-resolved, cold-link
 *   safe), NOT `gotonode`.
 * - `hide=31` collapses the MeshCentral chrome (barra laterale inclusa) per una
 *   sessione senza cornice: vedi MC_HIDE_CHROME.
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
    `&node=${encodeURIComponent(nodeIdParam(opts.nodeId))}` +
    `&viewmode=${opts.viewmode}` +
    `&hide=${MC_HIDE_CHROME}`;
  return `https://${host}/?${query}`;
}

/**
 * `?node=` vuole l'id GREZZO, senza il prefisso `node//`.
 *
 * MeshCentral lo ricostruisce da se' (webserver.js):
 *   var nodeidsplit = req.query.node.split('/');
 *   req.query.node = 'node/' + domain.id + '/' + nodeidsplit[0];
 * Passando `node//ABC` lo split da' ["node","","ABC"] e prende [0] = "node",
 * producendo l'id inesistente `node//node`: il nodo non viene MAI selezionato.
 * La console si apre sull'elenco dispositivi e desktop/terminale restano vuoti —
 * il sintomo era "schermo nero e barra laterale visibile", scambiato per un
 * problema di certificato o di host headless (segnalato dall'utente, 2026-07-17).
 *
 * Stessa trappola di `/meshsettings?id=` con il prefisso `mesh//` (install-scripts.ts):
 * MeshCentral vuole SEMPRE l'id nudo nei parametri URL, mai la forma `tipo//id`.
 */
function nodeIdParam(nodeId: string): string {
  return nodeId.replace(/^node\/\//, "");
}
