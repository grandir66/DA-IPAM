"use client";

/**
 * Dati della scheda router e firewall letti dal contesto o dalle rotte: rotte, lease, conteggi delle regole,
 * interfacce (GET /api/devices/[id]/interfacce) e pool DHCP del router (GET .../mikrotik?action=dhcp-pool).
 * Senza il dato, niente riquadro: una fonte che manca la dice la riga delle fonti.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import type { RispostaInterfacce } from "@/lib/devices/interfacce-scheda";
import { poolDhcp, type ConteggiRegole, type ServerDhcp, type PoolDhcp, type UsoPool } from "@/lib/scheda/router";
import type { ContestoScheda } from "../../contesto";

export const rotteDi = (ctx: ContestoScheda) => ctx.device?.routes ?? [];
export const leaseDi = (ctx: ContestoScheda) => ctx.device?.dhcp_leases ?? [];
export const arpDi = (ctx: ContestoScheda) => ctx.device?.arp_entries ?? [];

/** MikroTik raggiungibile in SSH: gli unici per cui la rotta `mikrotik` risponde (lease live, pool, export). */
export const eMikrotikSsh = (ctx: ContestoScheda): boolean => ctx.device?.vendor === "mikrotik" && ctx.device?.protocol === "ssh";

/** Conteggi regole filter · NAT · mangle dalla scansione; null se nessuno dei tre è noto. */
export function regoleDi(ctx: ContestoScheda): ConteggiRegole | null {
  const di = ctx.device?.device_info;
  if (!di) return null;
  const r = { filter: di.firewall_filter_count ?? null, nat: di.firewall_nat_count ?? null, mangle: di.firewall_mangle_count ?? null };
  return r.filter != null || r.nat != null || r.mangle != null ? r : null;
}

/** Lease noti per nome del server DHCP (dal DB, ultima lettura del router). */
export function leasePerServer(ctx: ContestoScheda): Record<string, number> {
  const r: Record<string, number> = {};
  for (const l of leaseDi(ctx)) {
    const s = l.server_name ?? l.server;
    if (s) r[s] = (r[s] ?? 0) + 1;
  }
  return r;
}

export type Caricamento<T> =
  | { fase: "carico" }
  | { fase: "ok"; dati: T }
  | { fase: "errore"; messaggio: string };

/** Interfacce dell'apparato; `riprova` rilegge. Un apparato non abbinato risponde `collegato: false`, non un errore. */
export function useInterfacce(deviceId: number | undefined): { stato: Caricamento<RispostaInterfacce>; riprova: () => void } {
  const [stato, setStato] = useState<Caricamento<RispostaInterfacce>>({ fase: "carico" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!deviceId) return;
    let vivo = true;
    fetchJson<RispostaInterfacce>(`/api/devices/${deviceId}/interfacce`)
      .then((r) => { if (vivo) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message }); })
      .catch(() => { if (vivo) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => { vivo = false; };
  }, [deviceId, n]);
  const riprova = useCallback(() => { setStato({ fase: "carico" }); setN((x) => x + 1); }, []);
  return { stato: deviceId ? stato : { fase: "ok", dati: { interfacce: [], fonte: "device_interfaces", aggiornato: null, collegato: false } }, riprova };
}

/** Ultima lettura SSH dei pool per apparato, tenuta nel browser: la Panoramica la mostra se c'è, senza aprire una sessione sul router. */
const cachePool = new Map<number, { servers: ServerDhcp[]; pools: PoolDhcp[] }>();

/**
 * Uso dei pool DHCP: server + pool letti dal router (SSH) e lease dal DB. Solo se `attivo` (MikroTik SSH).
 * `leggiDalRouter = false` (Panoramica): niente SSH ad ogni apertura della scheda, si usa l'ultima lettura fatta
 * aprendo la tab DHCP in questa sessione del browser; se non c'è, nessun dato (il riquadro non si rende).
 */
export function useUsoPool(ctx: ContestoScheda, attivo: boolean, leggiDalRouter = true): { stato: Caricamento<UsoPool[]>; riprova: () => void } {
  const deviceId = ctx.device?.id;
  const [stato, setStato] = useState<Caricamento<{ servers: ServerDhcp[]; pools: PoolDhcp[] }>>({ fase: "carico" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!attivo || !deviceId || !leggiDalRouter) return;
    let vivo = true;
    fetchJson<{ servers: ServerDhcp[]; pools: PoolDhcp[] }>(`/api/devices/${deviceId}/mikrotik?action=dhcp-pool`)
      .then((r) => {
        if (r.ok) cachePool.set(deviceId, r.data);
        if (vivo) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message });
      })
      .catch(() => { if (vivo) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => { vivo = false; };
  }, [attivo, deviceId, n, leggiDalRouter]);
  const riprova = useCallback(() => { setStato({ fase: "carico" }); setN((x) => x + 1); }, []);
  if (!attivo) return { stato: { fase: "ok", dati: [] }, riprova };
  const dati = leggiDalRouter ? (stato.fase === "ok" ? stato.dati : null) : (deviceId ? cachePool.get(deviceId) ?? null : null);
  if (!leggiDalRouter) {
    return { stato: { fase: "ok", dati: dati ? poolDhcp(dati.servers ?? [], dati.pools ?? [], leasePerServer(ctx)) : [] }, riprova };
  }
  if (stato.fase !== "ok") return { stato, riprova };
  return { stato: { fase: "ok", dati: poolDhcp(stato.dati.servers ?? [], stato.dati.pools ?? [], leasePerServer(ctx)) }, riprova };
}
