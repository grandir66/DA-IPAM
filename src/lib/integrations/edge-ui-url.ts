/**
 * Deriva la base URL della UI dell'edge (browser-reachable) dal base_url di sync.
 *
 * La UI dell'edge gira su :6443 (nginx reverse-proxy dell'appliance consolidated),
 * porta distinta da quella dell'API di sync salvata in `vuln_scanners.base_url`.
 *
 * Ritorna null se l'host non è raggiungibile da browser
 * (docker-internal/localhost/.internal): in quel caso il deep-link non ha senso.
 *
 * Solo RIPIEGO storico per un edge fuori dall'appliance (passo 4b, 16/10): la
 * 6443 dell'appliance la serve nginx sul nodo di DA-IPAM, non l'host di base_url
 * (in full è l'IP dell'edge). La fonte è `resolveEdgeBrowserUrl` in
 * `public-url-server.ts`, usata dalla Launchpad, dalla card e dalla verifica.
 */
export function deriveEdgeUiBase(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return null;
  }
  const host = u.hostname;
  if (
    host === "host.docker.internal" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".internal")
  ) {
    return null;
  }
  return `https://${host}:6443`;
}
