/**
 * Link verso i servizi della stessa appliance con l'host del browser (Riccardo,
 * 21/10, «ok per 1»). Modulo puro, client-safe: niente DB, niente `os`.
 *
 * L'installatore (Deploy-Appliance `lib/connect.sh`, `connect_bootstrap_launchpad`)
 * registra gli URL con l'IP LAN dell'appliance (`https://192.168.99.61:6443`). Chi
 * apre DA-IPAM da un nome DNS o da NetBird finiva, coi pulsanti, su un indirizzo
 * irraggiungibile o con un certificato che non corrisponde. Regola: un URL il cui
 * host è l'appliance stessa si apre con l'host con cui il browser ha aperto
 * DA-IPAM, con porta, percorso e schema salvati; un URL di un'altra macchina
 * resta com'è. Nel database resta l'URL vero: qui si decide solo cosa si apre.
 *
 * Host dell'appliance: `host-appliance-server.ts` (server), al client arrivano
 * dal provider `components/shared/url-per-browser.tsx`.
 * Prove: `__tests__/url-per-browser.test.ts`.
 */

/** Sempre l'appliance stessa, qualunque sia la configurazione. */
export const HOST_LOOPBACK = ["127.0.0.1", "localhost", "[::1]"] as const;

/** Host come lo scrive `URL.hostname`: minuscolo, IPv6 fra parentesi quadre. */
export function normalizzaHost(grezzo: string | null | undefined): string | null {
  const v = grezzo?.trim() ?? "";
  if (!v) return null;
  // IPv6 nudo (più di un «:», senza parentesi): `window.location.hostname` lo dà
  // già fra parentesi, un valore scritto a mano no.
  const ipv6Nudo = !v.startsWith("[") && (v.match(/:/g)?.length ?? 0) > 1 && !v.includes("://");
  const conSchema = v.includes("://") ? v : `https://${ipv6Nudo ? `[${v}]` : v}`;
  try {
    const h = new URL(conSchema).hostname.toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

/**
 * L'URL da mettere in un link o in un riquadro. `hostAppliance` sono gli host con
 * cui l'appliance è nota (già normalizzati); `hostBrowser` è
 * `window.location.hostname` (o l'Host della richiesta durante il render sul server).
 * Ogni caso dubbio (URL non valido, relativo, non http, host del browser ignoto)
 * restituisce l'URL così com'è.
 */
export function urlPerIlBrowser<T extends string | null | undefined>(
  url: T,
  hostAppliance: readonly string[],
  hostBrowser: string | null | undefined,
): T {
  if (!url) return url;
  const browser = normalizzaHost(hostBrowser);
  if (!browser) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return url;
  const host = u.hostname.toLowerCase();
  if (host === browser) return url;
  if (!hostAppliance.includes(host) && !(HOST_LOOPBACK as readonly string[]).includes(host)) return url;
  u.hostname = browser;
  const fuori = u.toString();
  // `URL` aggiunge «/» a un URL senza percorso: chi concatena (`${base}/app`) avrebbe «//».
  const senzaBarra = u.pathname === "/" && !u.search && !u.hash && !/^[a-z]+:\/\/[^/?#]+\/$/i.test(url.trim());
  return (senzaBarra ? fuori.replace(/\/$/, "") : fuori) as T;
}

/** Forma minima di `os.networkInterfaces()`. */
export type InterfacceDiRete = Record<
  string,
  ReadonlyArray<{ address: string; family: string | number; internal: boolean }> | undefined
>;

/** Interfacce che non sono l'appliance vista dalla rete: ponti Docker, veth, k8s. */
const INTERFACCIA_VIRTUALE = /^(docker|br-|veth|virbr|cni|flannel|cali|vxlan|kube)/i;

/**
 * Tutti gli host con cui l'appliance è nota: loopback, nome della macchina (intero
 * e corto), indirizzi delle interfacce vere (non Docker, non link-local) e host
 * dichiarati (variabili d'ambiente, voce «DA-IPAM» del vault; anche URL interi).
 */
export function raccogliHostAppliance(fonti: {
  nomeMacchina?: string | null;
  interfacce?: InterfacceDiRete;
  hostDichiarati?: readonly (string | null | undefined)[];
}): string[] {
  const out = new Set<string>(HOST_LOOPBACK);
  const aggiungi = (h: string | null | undefined) => {
    const n = normalizzaHost(h);
    if (n) out.add(n);
  };

  const nome = fonti.nomeMacchina?.trim();
  if (nome) {
    aggiungi(nome);
    aggiungi(nome.split(".")[0]);
  }

  for (const [nomeIf, indirizzi] of Object.entries(fonti.interfacce ?? {})) {
    if (INTERFACCIA_VIRTUALE.test(nomeIf)) continue;
    for (const a of indirizzi ?? []) {
      if (a.internal) continue;
      const v6 = a.family === "IPv6" || a.family === 6;
      if (v6 ? /^fe80:/i.test(a.address) : a.address.startsWith("169.254.")) continue;
      aggiungi(v6 ? `[${a.address.split("%")[0]}]` : a.address);
    }
  }

  for (const h of fonti.hostDichiarati ?? []) aggiungi(h);
  return [...out];
}
