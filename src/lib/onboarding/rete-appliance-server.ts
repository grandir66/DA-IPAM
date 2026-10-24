/**
 * Lettura vera della rete dell'appliance per il wizard: interfacce, rotte e
 * resolv.conf della macchina. Solo server. La logica sta in `rete-appliance.ts`.
 *
 * Best-effort: un file che manca (macOS in sviluppo, container senza /proc)
 * vale «non so», mai un errore; al peggio il wizard parte coi campi vuoti
 * come prima.
 */
import fs from "node:fs";
import os from "node:os";
import { propostaReteAppliance, type Interfacce, type ReteAppliance } from "./rete-appliance";

function leggi(percorso: string): string | null {
  try {
    return fs.readFileSync(percorso, "utf8");
  } catch {
    return null;
  }
}

function interfacce(): Interfacce {
  try {
    return os.networkInterfaces() as Interfacce;
  } catch {
    return {};
  }
}

export function leggiReteAppliance(): ReteAppliance | null {
  try {
    return propostaReteAppliance({
      interfacce: interfacce(),
      rotte: leggi("/proc/net/route"),
      // Con systemd-resolved /etc/resolv.conf dice 127.0.0.53: i DNS veri stanno nel secondo.
      resolv: [leggi("/etc/resolv.conf"), leggi("/run/systemd/resolve/resolv.conf")],
      ipDichiarato: process.env.APPLIANCE_LAN_IP ?? null,
    });
  } catch (e) {
    console.warn("[onboarding] rete dell'appliance non letta:", e);
    return null;
  }
}
