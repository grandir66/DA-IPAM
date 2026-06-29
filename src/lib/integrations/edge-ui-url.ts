/**
 * Deriva la base URL della UI dell'edge (browser-reachable) dal base_url di sync.
 *
 * La UI dell'edge gira su :6443 (nginx reverse-proxy dell'appliance consolidated),
 * porta distinta da quella dell'API di sync salvata in `vuln_scanners.base_url`.
 *
 * Ritorna null se l'host non è raggiungibile da browser
 * (docker-internal/localhost/.internal): in quel caso il deep-link non ha senso.
 *
 * Sorgente di verità condivisa tra la card di configurazione
 * (settings → moduli) e il tile del launchpad.
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
