/**
 * Verdetto per servizio dal contenuto di `/api/v1/status` del bridge Network Services
 * (passo 4 del piano di solidità, 16/10).
 *
 * Prima la sonda guardava solo il codice HTTP: un 200 voleva dire «ok» anche con
 * Unbound fermo. Il bridge (Deploy-Appliance `modules/net-services-bridge/main.py`)
 * risponde per ognuno dei quattro servizi con `active` (`active` | `inactive`, da
 * `systemctl is-active`) e `enabled` (`enabled` | `disabled`, da `is-enabled`):
 *   - acceso                     → ok;
 *   - fermo ma abilitato         → guasto (doveva girare: è partito male o è caduto);
 *   - fermo e disabilitato       → spento (lo ha spento qualcuno, da «Disabilita»);
 *   - assente dalla risposta     → non so.
 *
 * Parte pura, senza I/O: la usano la sonda (`modules/health.ts`) e la pagina
 * /network-services, così le due dicono la stessa cosa.
 */

export type ServizioBridge = "resolver" | "adblock" | "dns" | "dhcp";

export type VerdettoServizio = "ok" | "off" | "fail" | "non_so";

export interface SaluteServizio {
  servizio: ServizioBridge;
  /** Il programma che fa il servizio sulla VM. */
  nome: string;
  verdetto: VerdettoServizio;
  /** Testo breve per la pagina («attivo», «spento», «fermo ma abilitato»…). */
  stato: string;
}

/** Ordine fisso: è quello della pagina /network-services. */
export const SERVIZI_BRIDGE: readonly ServizioBridge[] = ["resolver", "adblock", "dns", "dhcp"];

export const NOMI_SERVIZI_BRIDGE: Record<ServizioBridge, string> = {
  resolver: "Unbound",
  adblock: "AdGuard",
  dns: "PowerDNS",
  dhcp: "Kea",
};

function campo(v: unknown, k: string): unknown {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
}

/** Verdetto di un servizio dalla sua voce in `services`. */
export function verdettoServizio(servizio: ServizioBridge, voce: unknown): SaluteServizio {
  const nome = NOMI_SERVIZI_BRIDGE[servizio];
  const active = campo(voce, "active");
  const enabled = campo(voce, "enabled");
  if (typeof active !== "string") {
    return { servizio, nome, verdetto: "non_so", stato: "assente dalla risposta del bridge" };
  }
  if (active === "active") return { servizio, nome, verdetto: "ok", stato: "attivo" };
  if (enabled === "enabled") return { servizio, nome, verdetto: "fail", stato: "fermo ma abilitato" };
  return { servizio, nome, verdetto: "off", stato: "spento" };
}

/**
 * I quattro servizi dal corpo di `/api/v1/status`, già letto come JSON.
 * null = il corpo non ha `services`: il bridge risponde, ma non si sa che cosa giri.
 */
export function leggiServiziBridge(corpo: unknown): SaluteServizio[] | null {
  const services = campo(corpo, "services");
  if (services === null || typeof services !== "object") return null;
  return SERVIZI_BRIDGE.map((s) => verdettoServizio(s, campo(services, s)));
}

/**
 * Verdetto del modulo con il bridge raggiungibile e il token accettato.
 * - risposta senza servizi → degradato;
 * - un servizio guasto e nessuno acceso → guasto;
 * - un servizio guasto o non letto, con altri accesi → degradato;
 * - altrimenti ok: un servizio spento a mano non è un guasto, neanche se lo sono tutti.
 */
export function verdettoBridge(servizi: SaluteServizio[] | null): {
  verdict: "ok" | "degraded" | "fail";
  detail: string;
} {
  if (!servizi) {
    return { verdict: "degraded", detail: "Bridge raggiungibile, ma la risposta non dice lo stato dei servizi" };
  }
  const detail = servizi.map((s) => `${s.nome} ${s.stato}`).join(" · ");
  const guasti = servizi.filter((s) => s.verdetto === "fail").length;
  const accesi = servizi.filter((s) => s.verdetto === "ok").length;
  const nonSo = servizi.filter((s) => s.verdetto === "non_so").length;
  if (guasti > 0 && accesi === 0) return { verdict: "fail", detail };
  if (guasti > 0 || nonSo > 0) return { verdict: "degraded", detail };
  return { verdict: "ok", detail };
}
