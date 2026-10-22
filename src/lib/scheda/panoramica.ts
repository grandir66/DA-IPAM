/**
 * Pezzi puri della scheda apparato (21/10): porte dal JSON dell'host, «acceso da», le caselle
 * della striscia generica e i vecchi nomi di tab. Nessun accesso a database né a React: si provano
 * da soli (`__tests__/panoramica.test.ts`).
 */
import type { TabId } from "./tipo-scheda";
import type { Casella } from "@/components/scheda/striscia-numeri";

/** Porte aperte da `hosts.open_ports`: elenco di numeri, di `{port, protocol}` o `{tcp, udp}`. JSON rotto = nessuna porta. */
export function porteDaJson(json: string | null | undefined): { tcp: number[]; udp: number[] } {
  let tcp: number[] = [];
  let udp: number[] = [];
  try {
    if (json) {
      const parsed: unknown = JSON.parse(json);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (typeof p === "object" && p !== null && "port" in p && (p as { port?: unknown }).port) {
            const o = p as { port: number; protocol?: string };
            if ((o.protocol ?? "tcp") === "tcp") tcp.push(o.port);
            else if (o.protocol === "udp") udp.push(o.port);
          } else if (typeof p === "number") tcp.push(p);
        }
      } else if (typeof parsed === "object" && parsed !== null) {
        const o = parsed as { tcp?: unknown; udp?: unknown };
        if (Array.isArray(o.tcp)) tcp = o.tcp as number[];
        if (Array.isArray(o.udp)) udp = o.udp as number[];
      }
    }
  } catch { /* JSON rotto: nessuna porta */ }
  return { tcp, udp };
}

/** «41 g» dai giorni di uptime, altrimenti il testo che l'apparato ha dato; niente dato = null (la casella non si rende). */
export function accesoDa(di: { uptime_days?: number | null; uptime?: string | null } | null | undefined): string | null {
  if (!di) return null;
  if (typeof di.uptime_days === "number" && Number.isFinite(di.uptime_days)) return `${di.uptime_days} g`;
  const testo = typeof di.uptime === "string" ? di.uptime.trim() : "";
  return testo !== "" ? testo : null;
}

/**
 * Striscia dei numeri di host e `generico`: solo da dati che esistono. Lo stato c'è sempre;
 * porte aperte e «acceso da» solo se noti. Offline è in attenzione.
 */
export function casellePanoramicaGenerica(i: {
  stato: "online" | "offline" | "unknown";
  ms: number | null;
  tcp: number[];
  udp: number[];
  acceso: string | null;
}): Casella[] {
  const caselle: Casella[] = [];
  const valoreStato = i.stato === "online" ? "✓ online" : i.stato === "offline" ? "✕ offline" : "● sconosciuto";
  caselle.push({
    etichetta: "Stato",
    valore: valoreStato,
    ...(i.ms != null ? { sotto: `${i.ms} ms` } : {}),
    ...(i.stato === "offline" ? { attenzione: true } : {}),
  });
  if (i.tcp.length > 0) {
    caselle.push({
      etichetta: "Porte aperte",
      valore: String(i.tcp.length),
      ...(i.udp.length > 0 ? { sotto: `+ ${i.udp.length} UDP` } : {}),
    });
  }
  if (i.acceso) caselle.push({ etichetta: "Acceso da", valore: i.acceso });
  return caselle;
}

/** Vecchi nomi di tab (?tab=software di inventory-agent-card, ?tab=vulnerabilita…) → tab nuova, con l'eventuale sotto-tab di Dettagli. */
const VECCHI: Record<string, { tab: TabId; sotto?: string }> = {
  generale: { tab: "panoramica" },
  sistema: { tab: "dettagli", sotto: "sistema" },
  network: { tab: "dettagli", sotto: "network" },
  software: { tab: "dettagli", sotto: "software" },
  vulnerabilita: { tab: "sicurezza" },
  asset: { tab: "gestione" },
  storico: { tab: "storico" },
};

const ALTERNATIVE: Record<string, TabId> = { software: "aggiornamenti", network: "sistema" };

const TUTTI: ReadonlySet<string> = new Set<TabId>([
  "panoramica", "porte", "vlan", "vicini", "interfacce", "routing", "dhcp", "configurazione", "dischi", "volumi",
  "servizi_nas", "vm", "nodi", "storage_px", "rete_px", "sistema", "servizi", "aggiornamenti", "software", "utenti",
  "ad", "dipendenze", "dettagli", "sicurezza", "gestione", "storico", "bridge", "dispositivi", "sensori",
]);

/** Tab da aprire per `?tab=`: un nome nuovo se il tipo lo ha, un vecchio nome tradotto, altrimenti la prima tab. */
export function tabDaQuery(q: string | null | undefined, tabs: readonly TabId[]): { tab: TabId; sotto?: string } {
  const prima = { tab: tabs[0] ?? ("panoramica" as TabId) };
  if (!q) return prima;
  // Vecchi nomi con un omonimo nuovo (sistema, software, storico): vale prima il nuovo se il tipo ha quella tab.
  if (TUTTI.has(q) && tabs.includes(q as TabId)) return { tab: q as TabId };
  const v = VECCHI[q];
  if (v && tabs.includes(v.tab)) return v;
  // Server: «Dettagli» non c'è più. ?tab=software su Linux (i pacchetti stanno in «Aggiornamenti») e ?tab=network (la rete sta in «Sistema»).
  const alt = ALTERNATIVE[q];
  if (alt && tabs.includes(alt)) return { tab: alt };
  return prima;
}
