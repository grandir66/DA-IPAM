/**
 * La lettura «Informazioni apparato» (piano 2026-10-22 scansione automatica, Task 4): quello che «Interroga» legge e
 * scrive della parte informazioni (`getDeviceInfo` e scrittura sull'apparato, sull'host e sull'asset; STP; sonda delle
 * interfacce; scansione Proxmox), estratto dalla rotta `src/app/api/devices/[id]/query/route.ts` senza cambiarlo. La
 * rotta chiama i pezzi con le sue righe di progresso (`log`); il job `apparati_scelti` chiama `leggiInfoApparato`.
 * `tipoLetturaApparato` è la scelta unica del ramo: la rotta la usa anche per la parte ARP/MAC.
 *
 * Le righe di `log` sono quelle di sempre del progresso di «Interroga» (le vede l'admin nella scheda); il journal non
 * riceve niente da qui.
 */
import {
  getInventoryAssetByNetworkDevice,
  getNetworkDeviceById,
  haSnmpApparato,
  credenzialeSnmpApparato,
  syncDeviceToHost,
  trackDeviceInfoChanges,
  updateInventoryAsset,
  updateNetworkDevice,
} from "@/lib/db";
import { profiloHpDaSysDescr, vendorSubtypeFromProductProfile } from "@/lib/device-product-profiles";
import { getDeviceInfo, resolveNasKind } from "@/lib/devices/device-info";
import { isProxmoxDevice } from "@/lib/devices/device-connection-test";
import { probeDeviceInterfaces } from "@/lib/devices/interface-probe";
import { resolvePhysicalDevice } from "@/lib/devices/identity-resolver";
import { codiceTrasporto } from "@/lib/devices/mikrotik-letture";
import { entroTempoApparato, TEMPO_APPARATO_MS } from "@/lib/devices/lucchetto-apparato";
import { getSnmpStpInfo } from "@/lib/devices/snmp-stp-info";
import { walkConSessioneSua, type SessioneWalk } from "@/lib/devices/snmp-walk";
import { createSwitchClient, type SwitchClient } from "@/lib/devices/switch-client";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import { apriSessioneSnmp, versioneApparato } from "@/lib/protocols/snmp-sessione";
// Statico: run-proxmox-device-scan importa il facade db, che risolve db-tenant (ADR 0002).
import { runProxmoxDeviceScan } from "@/lib/proxmox/run-proxmox-device-scan";
import type { NetworkDevice } from "@/types";

export type Log = (riga: string) => void;
const muto: Log = () => {};

export type EsitoInfo = { stato: "letto"; campi: number } | { stato: "vuoto" } | { stato: "errore"; codice: string };

export type TipoLettura = "proxmox" | "windows" | "ssh" | "arp_poll" | "snmp" | "switch";

/**
 * Il ramo della lettura di un apparato, con la logica di sempre del POST di «Interroga»: Proxmox → scansione Proxmox;
 * Windows, Linux/SSH e NAS → info del computer; router con ARP (Stormshield, MikroTik…, anche con community SNMP: la
 * tabella ARP la legge solo `arp_poll`) → router; SNMP-info (stampanti, telecamere, AP, firewall, VM…) → info SNMP;
 * il resto → switch. `etichetta` è quella del progresso.
 */
export function tipoLetturaApparato(device: NetworkDevice): { tipo: TipoLettura; etichetta: string } {
  if (isProxmoxDevice(device)) return { tipo: "proxmox", etichetta: "Proxmox VE" };
  const scanTarget = (device as { scan_target?: string | null }).scan_target;
  const nasKind = resolveNasKind(device);
  const isWindows = device.protocol === "winrm" || device.vendor === "windows" || scanTarget === "windows";
  const isLinuxVendor = scanTarget === "linux" || device.vendor === "linux" || device.vendor === "other" || device.vendor === "synology" || device.vendor === "qnap";
  const isSshScannable = isLinuxVendor || nasKind != null;
  if (isWindows) return { tipo: "windows", etichetta: "WinRM" };
  if (isSshScannable) return { tipo: "ssh", etichetta: nasKind != null ? "Storage" : "Linux/SSH" };
  if (networkDeviceUsesArpPoll(device)) return { tipo: "arp_poll", etichetta: "Router" };
  const isSnmpInfoDevice = (device.protocol === "snmp_v2" || device.protocol === "snmp_v3" || haSnmpApparato(device))
    && ["stampante", "telecamera", "voip", "iot", "access_point", "firewall", "vm"].includes(device.classification ?? "");
  if (isSnmpInfoDevice) return { tipo: "snmp", etichetta: "SNMP" };
  return { tipo: "switch", etichetta: "Switch" };
}

/**
 * Le informazioni di router e switch (sysname, modello, firmware, seriale…) sull'apparato, sull'host e sull'asset. Non
 * lancia: un errore è «— Device info non disponibile», come prima.
 */
export async function salvaInfoApparato(device: NetworkDevice, log: Log = muto, leggiDati: typeof getDeviceInfo = getDeviceInfo): Promise<EsitoInfo> {
  const deviceId = device.id;
  try {
    const info = await leggiDati(device);
    const now = new Date().toISOString();
    const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware || info.serial_number || info.part_number;
    if (hasInfo) {
      const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
      trackDeviceInfoChanges(deviceId, info);
      updateNetworkDevice(deviceId, {
        sysname: info.sysname ?? undefined,
        sysdescr: info.sysdescr ?? undefined,
        model: info.model ?? undefined,
        firmware: info.firmware ?? undefined,
        serial_number: info.serial_number ?? undefined,
        part_number: info.part_number ?? undefined,
        last_info_update: now,
        last_device_info_json: deviceInfoJson,
      });
      // Il sysDescr dice Comware o ProCurve meglio del profilo di serie scelto alla creazione (70151, 22/10).
      const profilo = profiloHpDaSysDescr(device, info.sysdescr);
      if (profilo) {
        updateNetworkDevice(deviceId, { product_profile: profilo, vendor_subtype: vendorSubtypeFromProductProfile(profilo) });
        log(`✓ Profilo corretto dal sysDescr: ${device.product_profile ?? "nessuno"} → ${profilo}`);
      }
      syncDeviceToHost(deviceId);
      const asset = getInventoryAssetByNetworkDevice(deviceId);
      if (asset) {
        updateInventoryAsset(asset.id, {
          modello: info.model ?? undefined,
          serial_number: info.serial_number ?? undefined,
          part_number: info.part_number ?? undefined,
          firmware_version: info.firmware ?? undefined,
          technical_data: deviceInfoJson,
        });
      }
      const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null);
      log(`✓ Device info: ${fields.length} campi acquisiti`);
      return { stato: "letto", campi: fields.length };
    } else {
      log("— Nessuna info dispositivo via SNMP");
      return { stato: "vuoto" };
    }
  } catch (err) {
    log("— Device info non disponibile");
    return { stato: "errore", codice: codiceTrasporto(err) };
  }
}

/**
 * Le informazioni di un computer o di un apparato SNMP-info (Windows, Linux/SSH, NAS, stampanti…). null = nessun dato
 * (niente scritto). Un errore di `getDeviceInfo` arriva a chi chiama, come prima.
 */
export async function leggiInfoComputer(device: NetworkDevice, etichetta: string, log: Log = muto,
  leggiDati: typeof getDeviceInfo = getDeviceInfo): Promise<string[] | null> {
  const deviceId = device.id;
  const info = await leggiDati(device);
  const now = new Date().toISOString();
  const hasInfo = info.sysname || info.sysdescr || info.model || info.firmware ||
    info.serial_number || info.part_number || info.os_name || info.hostname ||
    (info.nas_inventory != null);

  if (!hasInfo) {
    log(`✗ Nessun dato acquisito via ${etichetta}`);
    return null;
  }

  const deviceInfoJson = JSON.stringify({ ...info, scanned_at: now });
  trackDeviceInfoChanges(deviceId, info);
  updateNetworkDevice(deviceId, {
    sysname: info.sysname ?? (info.hostname as string | undefined) ?? undefined,
    sysdescr: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : (info.sysdescr ?? undefined),
    model: info.model ?? undefined,
    firmware: info.os_build ? `Build ${info.os_build}` : (info.os_version ? info.os_version : (info.firmware ?? undefined)),
    serial_number: info.serial_number ?? undefined,
    part_number: info.part_number ?? undefined,
    last_info_update: now,
    last_device_info_json: deviceInfoJson,
  });
  syncDeviceToHost(deviceId);
  const asset = getInventoryAssetByNetworkDevice(deviceId);
  if (asset) {
    updateInventoryAsset(asset.id, {
      modello: info.model ?? undefined,
      serial_number: info.serial_number ?? undefined,
      firmware_version: info.os_name ? `${info.os_name} ${info.os_version || ""}`.trim() : (info.firmware ?? undefined),
      technical_data: deviceInfoJson,
    });
  }
  const fields = Object.keys(info).filter(k => info[k as keyof typeof info] != null);
  log(`✓ ${fields.length} campi acquisiti: ${fields.join(", ")}`);
  return fields;
}

/** STP di un router via SNMP. Opzionale: un errore non ferma la lettura, il motivo va nel progresso. */
export async function leggiStpSnmp(device: NetworkDevice, log: Log = muto): Promise<void> {
  try {
    const snmpMod = await import("net-snmp");
    // Credenziale e porta dal motore (tappa 2 credenziali, T8): a un apparato v3 non parte più una community.
    const scelta = credenzialeSnmpApparato(device);
    if (!scelta.ok) throw new Error(scelta.motivo);
    // SN1 (spec topologia §13.5.4): una sessione per lettura. La sessione unica si chiudeva alla fine del primo walk e
    // annullava gli altri otto, partiti insieme. NULL = v1, come prima (createSession senza version). Una lettura non
    // riuscita vale null in getSnmpStpInfo, come prima.
    const snmpWalk = walkConSessioneSua(() => {
      const aperta = apriSessioneSnmp(snmpMod, device.host, scelta.cred, { port: scelta.port, timeout: 5000, versione: versioneApparato(device, "1") });
      if (!aperta.ok) throw new Error(aperta.motivo);
      return aperta.session as unknown as SessioneWalk;
    }, 10_000);
    const stpInfo = await getSnmpStpInfo(snmpWalk);
    if (stpInfo) {
      updateNetworkDevice(device.id, { stp_info: JSON.stringify(stpInfo) });
      log("✓ STP info acquisite");
    }
  } catch (e) {
    // STP opzionale: la scansione continua, ma il motivo si vede nel registro della scansione.
    log(`— STP non letto: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** STP di uno switch dal suo client, se lo sa leggere. Opzionale: un errore non dice niente, come prima. */
export async function leggiStpSwitch(deviceId: number, client: SwitchClient, log: Log = muto): Promise<void> {
  try {
    if ("getStpInfo" in client && typeof client.getStpInfo === "function") {
      const stpInfo = await client.getStpInfo();
      if (stpInfo) {
        updateNetworkDevice(deviceId, { stp_info: JSON.stringify(stpInfo) });
        log("✓ STP info acquisite");
      }
    }
  } catch { /* STP opzionale */ }
}

/**
 * Probe interfacce SNMP IP-MIB + risoluzione physical_device + auto-promote hosts.
 * Best-effort: errori loggati ma non bloccano il flusso chiamante.
 */
export async function sondaInterfacce(deviceId: number, log: Log = muto): Promise<void> {
  try {
    const fresh = getNetworkDeviceById(deviceId);
    if (!fresh) return;
    const probeOutcome = await probeDeviceInterfaces(fresh);
    if (probeOutcome.source === "none") return; // SNMP non configurato: skip silenzioso
    if (probeOutcome.interfaces.length === 0) {
      log(`⚠ Probe interfacce: 0 risultati (${probeOutcome.warnings.slice(0, 2).join("; ") || "no warnings"})`);
      return;
    }
    const resolved = resolvePhysicalDevice(fresh, probeOutcome);
    log(
      `✓ Aggregazione: physical_device #${resolved.physical_device_id} ` +
      `(${resolved.created ? "creato" : "match " + resolved.identity_anchor + " score=" + resolved.identity_confidence}), ` +
      `${resolved.interfaces_upserted} interfacce, ${resolved.addresses_upserted} IP, ` +
      `${resolved.promoted_hosts.filter((h) => h.created).length} host promossi`
    );
  } catch (err) {
    log(`⚠ Probe interfacce fallito: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** La scansione Proxmox (API :8006 + SSH) di un hypervisor. Un errore arriva a chi chiama, come prima. */
export async function leggiProxmox(deviceId: number, log: Log = muto): Promise<{ messaggio: string; oggetti: number }> {
  log("Scan Proxmox (API :8006 + SSH)...");
  const result = await runProxmoxDeviceScan(deviceId);
  const messaggio = `Proxmox: ${result.hosts.length} nodi, ${result.vms.length} VM/CT`;
  log(`✓ ${messaggio}`);
  if (result.avvisi?.length) {
    log(`Avvisi: ${result.avvisi.join(" | ")}`);
  }
  return { messaggio, oggetti: result.hosts.length + result.vms.length };
}

/**
 * «Informazioni apparato» del job `apparati_scelti`: la parte informazioni di «Interroga», col ramo di
 * `tipoLetturaApparato`. Router: info + STP via SNMP + sonda delle interfacce; switch: info + STP dal client; computer e
 * SNMP-info: info + sonda; Proxmox: la scansione. Non lancia: «vuoto» = l'apparato non ha detto niente (niente scritto),
 * «errore» col codice (mai nomi o IP). La parte ARP/MAC non c'è: è «Porte e MAC» (`leggiApparatoArp`). Al più
 * TEMPO_APPARATO_MS: oltre, «errore» `TEMPO_SCADUTO` (revisione del Task 4). `opzioni` solo per le prove.
 */
export async function leggiInfoApparato(device: NetworkDevice, log: Log = muto,
  opzioni: { tempoMs?: number; leggiDati?: typeof getDeviceInfo } = {}): Promise<EsitoInfo> {
  try {
    return await entroTempoApparato(corpoInfoApparato(device, log, opzioni.leggiDati ?? getDeviceInfo), opzioni.tempoMs ?? TEMPO_APPARATO_MS);
  } catch (err) {
    return { stato: "errore", codice: codiceTrasporto(err) };
  }
}

async function corpoInfoApparato(device: NetworkDevice, log: Log, leggiDati: typeof getDeviceInfo): Promise<EsitoInfo> {
  try {
    const { tipo, etichetta } = tipoLetturaApparato(device);
    switch (tipo) {
      case "proxmox": {
        const r = await leggiProxmox(device.id, log);
        return { stato: "letto", campi: r.oggetti };
      }
      case "windows":
      case "ssh":
      case "snmp": {
        const campi = await leggiInfoComputer(device, etichetta, log, leggiDati);
        if (!campi) return { stato: "vuoto" };
        await sondaInterfacce(device.id, log);
        return { stato: "letto", campi: campi.length };
      }
      case "arp_poll": {
        const e = await salvaInfoApparato(device, log, leggiDati);
        await leggiStpSnmp(device, log);
        await sondaInterfacce(device.id, log);
        return e;
      }
      case "switch": {
        const e = await salvaInfoApparato(device, log, leggiDati);
        try {
          await leggiStpSwitch(device.id, await createSwitchClient(device), log);
        } catch { /* STP opzionale: il client che non si crea non toglie le informazioni lette */ }
        return e;
      }
    }
  } catch (err) {
    return { stato: "errore", codice: codiceTrasporto(err) };
  }
}
