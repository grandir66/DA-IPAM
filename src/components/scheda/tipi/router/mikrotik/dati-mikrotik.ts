"use client";

/**
 * Dati della scheda MikroTik letti dal contesto: risorse e hardware della scansione SSH (`device_info`) e le interfacce
 * dell'ultima lettura. Una lettura che manca resta null: il riquadro non si rende e la riga delle fonti lo dice.
 */
import type { HardwareMikrotik, RisorseMikrotik } from "@/lib/devices/mikrotik-scheda";
import type { ContestoScheda } from "../../../contesto";
import { useInterfacce } from "../dati-router";

export const risorseDi = (ctx: ContestoScheda): RisorseMikrotik | null => ctx.device?.device_info?.mikrotik_risorse ?? null;
export const hardwareDi = (ctx: ContestoScheda): HardwareMikrotik | null => ctx.device?.device_info?.mikrotik_hardware ?? null;

/** Interfacce dell'ultima lettura (`?ultima=1`): quelle che il router non elenca più restano nel DB ma non si mostrano. */
export const useInterfacceMikrotik = (deviceId: number | undefined) => useInterfacce(deviceId, { ultima: true });
