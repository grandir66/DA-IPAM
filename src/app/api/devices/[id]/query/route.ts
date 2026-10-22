import { withTenantFromSession } from "@/lib/api-tenant";
import { NextResponse } from "next/server";
import { getNetworkDeviceById, upsertArpEntries, upsertMacPortEntries, upsertSwitchPorts, resolveMacToDevice, resolveMacToNetworkDevice, upsertNeighbors, upsertRoutes, haSnmpApparato, cleanOrphanedForeignKeys, getMultihomedStatusByDeviceId } from "@/lib/db";
import { createRouterClient } from "@/lib/devices/router-client";
import { createSwitchClient } from "@/lib/devices/switch-client";
import { lookupVendor } from "@/lib/scanner/mac-vendor";
import { updateHostIfExists, getNetworks, upsertDhcpLease, upsertMacIpMapping, syncIpAssignmentsForNetwork, getCurrentTenantCode } from "@/lib/db";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { dipendenzeDb, testoDubbio, valutaFonte, type ValutazioneFonte } from "@/lib/acquisizione-modulare/fonte";
import { DIPENDENZE_VERE, eseguiAcquisizioneModulare, lasciaLucchetto, prendiLucchetto } from "@/lib/acquisizione-modulare/esegui";
import { lettoreDb } from "@/lib/acquisizione-modulare/richiesta";
import { isIpInCidr, normalizePortNameForMatch } from "@/lib/utils";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { letturaAccesa, senzaCampiCavi } from "@/lib/topology/letture/interruttori";
import { resolveDeviceAcquisition } from "@/lib/devices/device-acquisition-resolve";
import { getScanProgress } from "@/lib/scanner/discovery";
import type { ScanProgress } from "@/types";
import { letturaVlanSwitch, vlanSwitchDaLeggere } from "@/lib/cron/jobs";
import { leggiInfoComputer, leggiProxmox, leggiStpSnmp, leggiStpSwitch, salvaInfoApparato, sondaInterfacce, tipoLetturaApparato } from "@/lib/devices/lettura-info";
import { apparatoOccupato, avviaConLucchetto, MESSAGGIO_OCCUPATO } from "@/lib/devices/lucchetto-apparato";

// ═══════════════════════════════════════════════════════════════════════════
// Progress tracking (stessa map globale usata da discovery.ts)
// ═══════════════════════════════════════════════════════════════════════════

const GLOBAL_KEY = "__daipam_scan_progress__" as const;

function getProgressMap(): Map<string, ScanProgress> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, ScanProgress>();
  return g[GLOBAL_KEY] as Map<string, ScanProgress>;
}

let _deviceQueryCounter = 0;

function createDeviceQueryProgress(deviceName: string, scanType: string): ScanProgress {
  const id = `devquery-${++_deviceQueryCounter}-${Date.now()}`;
  const progress: ScanProgress = {
    id,
    network_id: 0,
    scan_type: scanType,
    status: "running",
    total: 0,
    scanned: 0,
    found: 0,
    phase: `Connessione a ${deviceName}...`,
    started_at: new Date().toISOString(),
    logs: [],
  };
  getProgressMap().set(id, progress);
  return progress;
}

function plog(p: ScanProgress, msg: string) {
  p.logs!.push(`[${new Date().toLocaleTimeString("it-IT")}] ${msg}`);
  if (p.logs!.length > 200) p.logs = p.logs!.slice(-200);
}

function finishProgress(p: ScanProgress, status: "completed" | "failed", phase: string) {
  p.status = status;
  p.phase = phase;
  p.scanned = p.total;
  setTimeout(() => getProgressMap().delete(p.id), 300_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: router query
// ═══════════════════════════════════════════════════════════════════════════

async function runRouterQuery(deviceId: number, device: Parameters<typeof createRouterClient>[0], p: ScanProgress) {
  cleanOrphanedForeignKeys();

  p.phase = "Connessione al router...";
  const client = await createRouterClient(device);
  plog(p, `✓ Connesso a ${device.name} (${device.host})`);

  // ARP table
  p.phase = "Acquisizione tabella ARP...";
  const entries = await client.getArpTable();
  p.total = entries.length;
  plog(p, `✓ ${entries.length} entry ARP ricevute`);

  p.phase = "Salvataggio ARP entries...";
  upsertArpEntries(deviceId, entries);
  p.scanned = entries.length;
  plog(p, `✓ ARP entries salvate`);

  // Neighbors
  if (client.getNeighbors) {
    try {
      p.phase = "Acquisizione neighbors LLDP/CDP...";
      const neighbors = await client.getNeighbors();
      if (neighbors.length > 0) {
        // T2 (spec §13.5.2, MK1): discovered-by e capacità solo con la lettura dei MikroTik accesa (I33), come nel giro.
        upsertNeighbors(deviceId, letturaAccesa("mikrotik") ? neighbors : neighbors.map(senzaCampiCavi));
        plog(p, `✓ ${neighbors.length} neighbors (LLDP/CDP/MNDP)`);
      } else {
        plog(p, "— Nessun neighbor trovato");
      }
    } catch { plog(p, "— Neighbors non disponibili"); }
  }

  // Routes
  if (client.getRoutingTable) {
    try {
      p.phase = "Acquisizione tabella routing...";
      const routes = await client.getRoutingTable();
      if (routes.length > 0) {
        upsertRoutes(deviceId, routes);
        plog(p, `✓ ${routes.length} route`);
      }
    } catch { plog(p, "— Routing table non disponibile"); }
  }

  // DHCP leases
  if (client.getDhcpLeases) {
    try {
      p.phase = "Acquisizione DHCP leases...";
      const leases = await client.getDhcpLeases();
      if (leases.length > 0) {
        const dhcpNetworks = new Set<number>();
        const nets = getNetworks();
        for (const lease of leases) {
          const network = nets.find((n) => isIpInCidr(lease.ip, n.cidr));
          if (!network) continue;
          const vendor = await lookupVendor(lease.mac);
          // DHCP è fonte PASSIVA: aggiorna solo host esistenti, MAI inserisce.
          // Il server tiene lease per giorni dopo lo spegnimento; lo status e la
          // CREAZIONE host la decide solo network_discovery (ICMP + TCP).
          const host = updateHostIfExists({
            network_id: network.id, ip: lease.ip, mac: lease.mac,
            ...(lease.hostname && { hostname: lease.hostname }),
            hostname_source: "dhcp", vendor: vendor || undefined,
          });
          upsertMacIpMapping({
            mac: lease.mac, ip: lease.ip, source: "dhcp", source_device_id: deviceId,
            network_id: network.id, host_id: host?.id ?? null, vendor: vendor ?? undefined,
            hostname: lease.hostname ?? undefined,
          });
          const sourceType = device.vendor === "mikrotik" ? "mikrotik" : "other";
          upsertDhcpLease({
            source_type: sourceType, source_device_id: deviceId, source_name: device.name,
            server_name: lease.server ?? null, ip_address: lease.ip, mac_address: lease.mac,
            hostname: lease.hostname ?? null, status: lease.status ?? null,
            lease_expires: lease.expiresAfter ?? null, description: lease.comment ?? null,
            dynamic_lease: lease.dynamic === true ? 1 : lease.dynamic === false ? 0 : null,
            host_id: host?.id ?? null, network_id: network.id,
          });
          dhcpNetworks.add(network.id);
        }
        for (const nid of dhcpNetworks) syncIpAssignmentsForNetwork(nid);
        plog(p, `✓ ${leases.length} DHCP leases`);
      } else {
        plog(p, "— Nessun lease DHCP");
      }
    } catch (err) {
      plog(p, `✗ DHCP leases: ${err instanceof Error ? err.message : "errore"}`);
    }
  }

  // Aggiorna host con MAC/vendor da ARP
  p.phase = "Aggiornamento host da ARP...";
  const networks = getNetworks();
  let hostsUpdated = 0;
  for (const entry of entries) {
    if (!entry.ip || !entry.mac) continue;
    const network = networks.find((n) => isIpInCidr(entry.ip!, n.cidr));
    if (!network) continue;
    const vendor = await lookupVendor(entry.mac);
    // ARP è fonte PASSIVA: aggiorna solo host esistenti, MAI inserisce.
    updateHostIfExists({ network_id: network.id, ip: entry.ip, mac: entry.mac, vendor: vendor || undefined });
    hostsUpdated++;
  }
  plog(p, `✓ ${hostsUpdated} host aggiornati con MAC/vendor`);

  // Port schema
  p.phase = "Acquisizione schema porte (SNMP)...";
  const portInfos = await client.getPortSchema?.().catch(() => []) ?? [];
  if (portInfos.length > 0) {
    const macsByPortByIndex = new Map<number, { macs: string[] }>();
    const macsByPortByName = new Map<string, { macs: string[] }>();
    for (const e of entries) {
      const ifName = (e.interface_name ?? "").trim();
      if (!ifName) continue;
      const ifIndexMatch = ifName.match(/^if(\d+)$/i);
      if (ifIndexMatch) {
        const idx = parseInt(ifIndexMatch[1], 10);
        const existing = macsByPortByIndex.get(idx) || { macs: [] };
        existing.macs.push(e.mac);
        macsByPortByIndex.set(idx, existing);
      } else {
        const key = normalizePortNameForMatch(ifName);
        const existing = macsByPortByName.get(key) || { macs: [] };
        existing.macs.push(e.mac);
        macsByPortByName.set(key, existing);
      }
    }

    const switchPorts = portInfos.map((port) => {
      const portMacs = macsByPortByIndex.get(port.port_index) ?? macsByPortByName.get(normalizePortNameForMatch(port.port_name.trim()));
      const macCount = portMacs?.macs.length || 0;
      const isTrunk = macCount > 1 ? 1 : 0;
      let singleMac: string | null = null, singleMacVendor: string | null = null,
          singleMacIp: string | null = null, singleMacHostname: string | null = null, hostId: number | null = null;
      if (macCount === 1 && portMacs) {
        singleMac = portMacs.macs[0];
        const resolved = resolveMacToDevice(singleMac);
        singleMacIp = resolved.ip; singleMacHostname = resolved.hostname;
        singleMacVendor = resolved.vendor; hostId = resolved.host_id;
      }
      let trunk_primary_device_id: number | null = null, trunk_primary_name: string | null = null;
      if (isTrunk && portMacs && !port.trunk_neighbor_name) {
        const matches: { device_id: number; device_name: string; device_type: string }[] = [];
        for (const mac of portMacs.macs) {
          const nd = resolveMacToNetworkDevice(mac, deviceId);
          if (nd) matches.push(nd);
        }
        const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
        if (primary) { trunk_primary_device_id = primary.device_id; trunk_primary_name = primary.device_name; }
      }
      return {
        port_index: port.port_index, port_name: port.port_name.trim(), status: port.status,
        speed: port.speed, duplex: port.duplex, vlan: port.vlan, poe_status: port.poe_status,
        poe_power_mw: port.poe_power_mw, mac_count: macCount, is_trunk: isTrunk,
        single_mac: singleMac, single_mac_vendor: singleMacVendor, single_mac_ip: singleMacIp,
        single_mac_hostname: singleMacHostname, host_id: hostId,
        trunk_neighbor_name: port.trunk_neighbor_name ?? null, trunk_neighbor_port: port.trunk_neighbor_port ?? null,
        trunk_primary_device_id, trunk_primary_name, stp_state: port.stp_state ?? null,
      };
    });
    upsertSwitchPorts(deviceId, switchPorts);
    plog(p, `✓ ${portInfos.length} porte switch`);
  } else {
    plog(p, "— Nessuna porta SNMP");
  }

  // Device info
  p.phase = "Acquisizione info dispositivo...";
  await salvaInfoApparato(device, (r) => plog(p, r));

  // STP via SNMP
  p.phase = "Acquisizione STP (SNMP)...";
  await leggiStpSnmp(device, (r) => plog(p, r));

  const portsMsg = portInfos.length > 0 ? `, ${portInfos.length} porte` : "";

  // Fase 1+2 aggregazione: probe interfacce + identity resolver (best-effort).
  await sondaInterfacce(deviceId, (r) => plog(p, r));

  finishProgress(p, "completed", `Completata: ${entries.length} ARP${portsMsg}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: switch query
// ═══════════════════════════════════════════════════════════════════════════

async function runSwitchQuery(deviceId: number, device: Parameters<typeof createSwitchClient>[0], p: ScanProgress) {
  p.phase = "Connessione allo switch...";
  const client = await createSwitchClient(device);
  plog(p, `✓ Connesso a ${device.name} (${device.host})`);

  p.phase = "Acquisizione MAC table...";
  const entries = await client.getMacTable();
  p.total = entries.length;
  plog(p, `✓ ${entries.length} entry MAC`);

  upsertMacPortEntries(deviceId, entries.map((e) => ({
    mac: e.mac, port_name: e.port_name.trim(), vlan: e.vlan, port_status: e.port_status, speed: e.speed,
  })), "device");
  p.scanned = entries.length;
  plog(p, `✓ MAC table salvata`);

  // Port schema
  p.phase = "Acquisizione schema porte...";
  const portInfos = await client.getPortSchema();
  if (portInfos.length > 0) {
    const macsByPort = new Map<string, { macs: string[]; vlan: number | null }>();
    for (const e of entries) {
      const key = normalizePortNameForMatch(e.port_name.trim());
      const existing = macsByPort.get(key) || { macs: [], vlan: e.vlan };
      existing.macs.push(e.mac);
      if (e.vlan != null) existing.vlan = e.vlan;
      macsByPort.set(key, existing);
    }

    const switchPorts = portInfos.map((port) => {
      const portMacs = macsByPort.get(normalizePortNameForMatch(port.port_name.trim()));
      const macCount = portMacs?.macs.length || 0;
      const isTrunk = macCount > 1 ? 1 : 0;
      let singleMac: string | null = null, singleMacVendor: string | null = null,
          singleMacIp: string | null = null, singleMacHostname: string | null = null, hostId: number | null = null;
      if (macCount === 1 && portMacs) {
        singleMac = portMacs.macs[0];
        const resolved = resolveMacToDevice(singleMac);
        singleMacIp = resolved.ip; singleMacHostname = resolved.hostname;
        singleMacVendor = resolved.vendor; hostId = resolved.host_id;
      }
      let trunk_primary_device_id: number | null = null, trunk_primary_name: string | null = null;
      if (isTrunk && portMacs && !port.trunk_neighbor_name) {
        const matches: { device_id: number; device_name: string; device_type: string }[] = [];
        for (const mac of portMacs.macs) {
          const nd = resolveMacToNetworkDevice(mac, deviceId);
          if (nd) matches.push(nd);
        }
        const primary = matches.find((m) => m.device_type === "router") ?? matches[0];
        if (primary) { trunk_primary_device_id = primary.device_id; trunk_primary_name = primary.device_name; }
      }
      return {
        port_index: port.port_index, port_name: port.port_name.trim(), status: port.status,
        speed: port.speed, duplex: port.duplex, vlan: portMacs?.vlan ?? port.vlan,
        poe_status: port.poe_status, poe_power_mw: port.poe_power_mw, mac_count: macCount,
        is_trunk: isTrunk, single_mac: singleMac, single_mac_vendor: singleMacVendor,
        single_mac_ip: singleMacIp, single_mac_hostname: singleMacHostname, host_id: hostId,
        trunk_neighbor_name: port.trunk_neighbor_name ?? null, trunk_neighbor_port: port.trunk_neighbor_port ?? null,
        trunk_primary_device_id, trunk_primary_name, stp_state: port.stp_state ?? null,
      };
    });
    upsertSwitchPorts(deviceId, switchPorts);
    plog(p, `✓ ${portInfos.length} porte switch`);
  }

  // Device info
  p.phase = "Acquisizione info dispositivo...";
  await salvaInfoApparato(device, (r) => plog(p, r));

  // STP
  await leggiStpSwitch(deviceId, client, (r) => plog(p, r));

  // VLAN degli switch (Task 9, ADR 0029): solo con la lettura accesa (spenta, «Interroga» non manda niente di nuovo allo
  // switch), senza aspettare l'ora; lucchetto ed esito come nel giro. Interruttore guardato per primo. Un errore del DB
  // (interruttore, esito, scrittura) si dice nel progresso e non fa fallire tutto «Interroga» (revisione del Task 9).
  try {
    if (letturaAccesa("switch_vlan") && vlanSwitchDaLeggere(device)) {
      p.phase = "Acquisizione VLAN (SNMP)...";
      const v = await letturaVlanSwitch(device, undefined, { ignoraCadenza: true });
      if (v.stato === "letto") plog(p, `✓ VLAN: ${v.valore}`);
      else if (v.stato === "errore") plog(p, `— VLAN non lette: ${v.esito.codice ?? "errore"}`);
      else if (v.motivo === "lucchetto") plog(p, "— VLAN: lettura già in corso");
      else if (v.motivo === "schema") plog(p, "— VLAN: schema non aggiornato");
    }
  } catch (e) {
    // Nel journal il messaggio dell'errore con l'id dell'apparato (niente nome; un IP nel messaggio si toglie); nel progresso il codice.
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>");
    console.error(`[query] VLAN switch apparato ${deviceId}: ${msg}`);
    plog(p, `— VLAN non lette: ${String((e as { code?: unknown })?.code ?? "errore")}`);
  }

  finishProgress(p, "completed", `Completata: ${entries.length} MAC, ${portInfos.length} porte`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: info-only query (Windows, SSH, SNMP)
// ═══════════════════════════════════════════════════════════════════════════

async function runInfoQuery(deviceId: number, device: Parameters<typeof leggiInfoComputer>[0], scanLabel: string, p: ScanProgress) {
  p.phase = `Acquisizione dati ${scanLabel}...`;
  p.total = 1;
  const fields = await leggiInfoComputer(device, scanLabel, (r) => plog(p, r));
  if (!fields) {
    finishProgress(p, "failed", `Nessun dato da ${scanLabel}`);
    return;
  }
  p.scanned = 1;

  await sondaInterfacce(deviceId, (r) => plog(p, r));

  finishProgress(p, "completed", `${scanLabel}: ${fields.length} campi acquisiti`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Background task: acquisizione con un collector (fonte «pronta»)
// ═══════════════════════════════════════════════════════════════════════════

function avviaAcquisizioneModulare(
  deviceId: number,
  device: NonNullable<ReturnType<typeof getNetworkDeviceById>>,
  fonte: Extract<ValutazioneFonte, { esito: "pronta" }>,
  utente: { id?: string | null; name?: string | null },
) {
  if (!prendiLucchetto(deviceId)) {
    return NextResponse.json({ error: "Un'acquisizione con collector di questo apparato è già in corso" }, { status: 409 });
  }
  const progress = createDeviceQueryProgress(device.name, `Collector ${fonte.collector} — ${device.name}`);
  const tenantCode = getCurrentTenantCode();
  const runTask = async () => {
    try {
      if (!tenantCode) throw new Error("Contesto tenant assente");
      const dbh = getTenantDb(tenantCode);
      const esito = await eseguiAcquisizioneModulare({
        deviceId, device, collector: fonte.collector, credenziali: fonte.credenziali,
        utente: { id: utente.id ? Number(utente.id) : null, nome: utente.name ?? null },
        log: (riga) => plog(progress, riga),
      }, { ...DIPENDENZE_VERE, leggi: lettoreDb(dbh) });
      finishProgress(progress, esito.status === "error" ? "failed" : "completed",
        esito.status === "error" ? `Collector ${fonte.collector}: lettura non riuscita (snapshot #${esito.snapshotId})` : `Collector ${fonte.collector}: snapshot #${esito.snapshotId} (${esito.status})`);
    } catch (err) {
      lasciaLucchetto(deviceId);
      console.error(`[Device Query] Collector error device ${deviceId}:`, err instanceof Error ? err.message : "errore");
      plog(progress, "✗ Acquisizione con collector non riuscita");
      finishProgress(progress, "failed", "Acquisizione con collector non riuscita");
    }
  };
  // Lucchetto comune con il giro ARP e «Interroga» (conLucchettoApparato): mai due letture dello stesso apparato insieme.
  const bgTask = avviaConLucchetto(deviceId, tenantCode, runTask);
  bgTask.catch(() => {
    lasciaLucchetto(deviceId);
    finishProgress(progress, "failed", "Errore fatale");
  });
  return NextResponse.json({ id: progress.id, progress });
}

// ═══════════════════════════════════════════════════════════════════════════
// POST handler
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const device = getNetworkDeviceById(Number(id));
      if (!device) {
        return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
      }

      // Multihomed scan dedup: se il device è registrato su un IP "secondary"
      // di un gruppo multihomed, evitiamo di rifare il query (stesso device fisico).
      // Bypass: ?force=1 nella query string.
      const url = new URL(_request.url);
      const force = url.searchParams.get("force") === "1";
      const mh = getMultihomedStatusByDeviceId(Number(id));
      if (mh && !mh.is_primary && !force) {
        return NextResponse.json({
          error: "scan_skipped_multihomed_secondary",
          message: `Device secondary di un gruppo multihomed (${mh.peers_count} IF). Scan saltato: esegui sul primary (${mh.primary_ip}) o forza con ?force=1.`,
          multihomed: { group_id: mh.group_id, primary_host_id: mh.primary_host_id, primary_ip: mh.primary_ip, peers_count: mh.peers_count },
        }, { status: 409 });
      }

      const acquisition = resolveDeviceAcquisition(device, haSnmpApparato(device));

      if (!acquisition.implemented) {
        return NextResponse.json(
          { error: acquisition.notImplementedHint ?? `${acquisition.label} non ancora disponibile` },
          { status: 501 }
        );
      }

      // Un apparato in lettura (giro ARP, job `apparati_scelti`, un altro «Interroga») non si legge due volte: 409 prima di
      // creare il progresso. La lettura in sottofondo tiene il lucchetto fino alla fine (decisione 10b del piano 2026-10-22).
      const deviceId = Number(id);
      if (apparatoOccupato(deviceId)) {
        return NextResponse.json({ error: MESSAGGIO_OCCUPATO }, { status: 409 });
      }
      const tenantCode = getCurrentTenantCode();
      // Il ramo della lettura, scelta unica con il job `apparati_scelti` (lettura-info.ts).
      const { tipo, etichetta: scanLabel } = tipoLetturaApparato(device);
      /** Il lucchetto preso da un altro proprio adesso (corsa senza `await` in mezzo: non succede, ma si chiude). */
      const seOccupato = (progress: ScanProgress) => (stato: "fatto" | "occupato") => {
        if (stato === "occupato") {
          plog(progress, `✗ ${MESSAGGIO_OCCUPATO}`);
          finishProgress(progress, "failed", MESSAGGIO_OCCUPATO);
        }
      };

      // Acquisizione modulare (piano 2026-10-21 C1-C2, tavola C1): lo stesso pulsante, un altro formato. Con
      // l'interruttore spento, senza un collector per il prodotto o con «classica» scelta, `valutaFonte` lo dice e da
      // qui in giù il percorso è quello di sempre, invariato (prova `acquisizione-modulare/__tests__/aggancio.test.ts`).
      const fonte = valutaFonte(device, dipendenzeDb());
      if (fonte.esito === "dubbio") {
        return NextResponse.json({ error: testoDubbio(fonte), dubbio: fonte.motivo }, { status: 409 });
      }
      if (fonte.esito === "pronta") {
        return avviaAcquisizioneModulare(deviceId, device, fonte, adminCheck.user);
      }

      if (tipo === "proxmox") {
        const progress = createDeviceQueryProgress(device.name, `Proxmox VE — ${device.name}`);

        const runTask = async () => {
          try {
            const r = await leggiProxmox(deviceId, (riga) => plog(progress, riga));
            finishProgress(progress, "completed", r.messaggio);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Errore sconosciuto";
            console.error(`[Device Query] Proxmox scan error device ${deviceId}:`, err);
            plog(progress, `✗ ${msg}`);
            finishProgress(progress, "failed", msg);
          }
        };

        const bgTask = avviaConLucchetto(deviceId, tenantCode, runTask);
        bgTask.then(seOccupato(progress)).catch((err) => {
          console.error(`[Device Query] Unhandled Proxmox error device ${deviceId}:`, err);
          const msg = err instanceof Error ? err.message : "Errore fatale";
          plog(progress, `✗ ${msg}`);
          finishProgress(progress, "failed", msg);
        });

        return NextResponse.json({ id: progress.id, progress });
      }

      // Crea progress e lancia task in background
      const progress = createDeviceQueryProgress(device.name, `${scanLabel} — ${device.name}`);

      const runTask = async () => {
        try {
          // I device router/firewall con capability ARP (Stormshield, Mikrotik, ...) vanno in arp_poll anche se hanno
          // community SNMP, altrimenti runInfoQuery raccoglie solo sysname/descr e non la tabella ARP (tipoLetturaApparato).
          if (tipo === "windows" || tipo === "ssh" || tipo === "snmp") {
            await runInfoQuery(deviceId, device, scanLabel, progress);
          } else if (tipo === "arp_poll") {
            await runRouterQuery(deviceId, device, progress);
          } else {
            await runSwitchQuery(deviceId, device, progress);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Errore sconosciuto";
          console.error(`[Device Query] Error device ${deviceId}:`, err);
          plog(progress, `✗ ${msg}`);
          finishProgress(progress, "failed", msg);
        }
      };

      const bgTask = avviaConLucchetto(deviceId, tenantCode, runTask);
      bgTask.then(seOccupato(progress)).catch((err) => {
        console.error(`[Device Query] Unhandled error device ${deviceId}:`, err);
        const msg = err instanceof Error ? err.message : "Errore fatale";
        plog(progress, `✗ ${msg}`);
        finishProgress(progress, "failed", msg);
      });

      return NextResponse.json({ id: progress.id, progress });
    } catch (error) {
      console.error("Device query error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nella query" },
        { status: 500 }
      );
    }
  });
}
