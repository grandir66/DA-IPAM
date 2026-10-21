"use client";

/**
 * Dati della scheda MikroTik letti dal contesto: risorse e hardware della scansione SSH (`device_info`) e le interfacce
 * dell'ultima lettura. Una lettura che manca resta null: il riquadro non si rende e la riga delle fonti lo dice.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import type { HardwareMikrotik, RigaUtenteMk, RisorseMikrotik } from "@/lib/devices/mikrotik-scheda";
import { statoInterfaccia, type RispostaSchedaMikrotik, type StatoPortaMk } from "@/lib/scheda/mikrotik";
import type { InterfacciaScheda } from "@/lib/scheda/router";
import type { ContestoScheda } from "../../../contesto";
import { useInterfacce, type Caricamento } from "../dati-router";

export const risorseDi = (ctx: ContestoScheda): RisorseMikrotik | null => ctx.device?.device_info?.mikrotik_risorse ?? null;
export const hardwareDi = (ctx: ContestoScheda): HardwareMikrotik | null => ctx.device?.device_info?.mikrotik_hardware ?? null;

/** Interfacce dell'ultima lettura (`?ultima=1`): quelle che il router non elenca più restano nel DB ma non si mostrano. */
export const useInterfacceMikrotik = (deviceId: number | undefined) => useInterfacce(deviceId, { ultima: true });

/**
 * Bridge, porte e bond dell'ultima fotografia (GET /api/devices/[id]/mikrotik-scheda, Task 9), con lo stato delle letture
 * che li riempiono. Solo lettura dal DB: aprire la tab non apre una sessione sul router.
 */
export function useSchedaMikrotik(deviceId: number | undefined): { stato: Caricamento<RispostaSchedaMikrotik>; riprova: () => void } {
  const [stato, setStato] = useState<Caricamento<RispostaSchedaMikrotik>>({ fase: "carico" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!deviceId) return;
    let vivo = true;
    fetchJson<RispostaSchedaMikrotik>(`/api/devices/${deviceId}/mikrotik-scheda`)
      .then((r) => { if (vivo) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message }); })
      .catch(() => { if (vivo) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => { vivo = false; };
  }, [deviceId, n]);
  const riprova = useCallback(() => { setStato({ fase: "carico" }); setN((x) => x + 1); }, []);
  return { stato, riprova };
}

/**
 * Utenti del router (GET /api/devices/[id]/mikrotik-utenti, solo admin). Da viewer la richiesta NON parte: niente 403 nella
 * rete del browser e niente dato che arriva per sbaglio. `null` = non admin.
 */
export function useUtentiMikrotik(deviceId: number | undefined, admin: boolean): Caricamento<{ utenti: RigaUtenteMk[]; letto_il: string | null }> | null {
  const [stato, setStato] = useState<Caricamento<{ utenti: RigaUtenteMk[]; letto_il: string | null }>>({ fase: "carico" });
  useEffect(() => {
    if (!deviceId || !admin) return;
    let vivo = true;
    fetchJson<{ utenti: RigaUtenteMk[]; letto_il: string | null }>(`/api/devices/${deviceId}/mikrotik-utenti`)
      .then((r) => { if (vivo) setStato(r.ok ? { fase: "ok", dati: r.data } : { fase: "errore", messaggio: r.message }); })
      .catch(() => { if (vivo) setStato({ fase: "errore", messaggio: "Richiesta annullata" }); });
    return () => { vivo = false; };
  }, [deviceId, admin]);
  return admin ? stato : null;
}

/** Stato di una porta nella matrice VLAN (censimento §1.8): porta del bridge spenta (X) → disabilitata; poi l'interfaccia letta; non letta = attiva, come il Manager. */
export function statoPortaMatrice(porta: { disabled: boolean } | undefined, nome: string, interfacce: InterfacciaScheda[] | null): StatoPortaMk {
  if (porta?.disabled) return "disabilitata";
  const i = interfacce?.find((x) => x.ifname === nome);
  return i ? statoInterfaccia(i) : "attiva";
}
