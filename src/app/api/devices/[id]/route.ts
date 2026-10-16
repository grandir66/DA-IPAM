import { NextResponse } from "next/server";
import { getNetworkDeviceById, updateNetworkDevice, deleteNetworkDevice, getArpEntriesByDevice, getMacPortEntriesByDevice, getSwitchPortsByDevice, getNeighborsByDevice, getRoutesByDevice, getDeviceCredentialBindings, getDhcpLeasesByDevice, getDb } from "@/lib/db";
import {
  isValidProductProfileForVendor,
  resolveDeviceTypeForCreate,
  resolveUseForArpPoll,
  applyProductProfileScanDefaults,
  type ProductProfileId,
} from "@/lib/device-product-profiles";
import { coerceProtocolForVendor } from "@/lib/vendor-device-profile";
import { applicaCorpoApparatoDb, avvisoFalliti, RifiutoCredenziali, usataAdessoDb, type EsitoScelte } from "@/lib/credentials/apparato-archivio";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { parseJsonSafe } from "@/lib/json-safe";
import { withTenantFromSession } from "@/lib/api-tenant";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import { senzaColonneVecchie } from "@/lib/devices/colonne-vecchie";
import { avvisoPortaProtocollo } from "@/lib/devices/porta-protocollo";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

const PROXMOX_MAX_VMS = 500;

interface ProxmoxSummary {
  hosts: unknown[];
  vms: unknown[];
  scanned_at: string | null;
  avvisi?: string[];
  _truncated?: boolean;
  _total_vms?: number;
}

function parseProxmoxSummary(raw: string | null): ProxmoxSummary | null {
  if (!raw?.trim()) return null;
  try {
    const p = JSON.parse(raw) as {
      hosts?: unknown[];
      vms?: unknown[];
      scanned_at?: string;
      avvisi?: string[];
    };
    const allVms = p.vms ?? [];
    const capped = allVms.length > PROXMOX_MAX_VMS;
    return {
      hosts: p.hosts ?? [],
      vms: capped ? allVms.slice(0, PROXMOX_MAX_VMS) : allVms,
      scanned_at: p.scanned_at ?? null,
      avvisi: p.avvisi,
      ...(capped ? { _truncated: true, _total_vms: allVms.length } : {}),
    };
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }

    const isHypervisor = device.device_type === "hypervisor" || device.scan_target === "proxmox";
    const arpCapable = networkDeviceUsesArpPoll(device);
    const arpEntries = arpCapable ? getArpEntriesByDevice(Number(id)) : [];
    const macPortEntries = device.device_type === "switch" ? getMacPortEntriesByDevice(Number(id)) : [];
    const switchPorts = isHypervisor ? [] : getSwitchPortsByDevice(Number(id));
    const neighbors = getNeighborsByDevice(Number(id));
    const routes = arpCapable ? getRoutesByDevice(Number(id)) : [];
    const dhcp_leases = getDhcpLeasesByDevice(Number(id));
    const credential_bindings = getDeviceCredentialBindings(Number(id)).map((b) => ({
      ...b,
      inline_encrypted_password: b.inline_encrypted_password ? "●●●●●●●●" : null,
      source: b.credential_id ? "archive" as const : "inline" as const,
    }));

    const stp_info: unknown = parseJsonSafe<unknown>(device.stp_info, null);

    let device_info: Record<string, unknown> | null = null;
    if (device.last_device_info_json) {
      try {
        const parsed = JSON.parse(device.last_device_info_json);
        if (typeof parsed === "object" && parsed !== null) {
          device_info = parsed as Record<string, unknown>;
          const normalizeWmiDate = (v: unknown): unknown => {
            if (typeof v !== "string") return v;
            const m = v.match(/\/Date\((\d+)\)\//);
            if (m) return new Date(Number(m[1])).toISOString();
            if (/^\d{14}/.test(v)) {
              return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T${v.slice(8,10)}:${v.slice(10,12)}:${v.slice(12,14)}`;
            }
            return v;
          };
          if (device_info.install_date) device_info.install_date = normalizeWmiDate(device_info.install_date);
          if (device_info.last_boot) device_info.last_boot = normalizeWmiDate(device_info.last_boot);
        }
      } catch { /* invalid JSON */ }
    }

    const proxmox_data = isHypervisor ? parseProxmoxSummary(device.last_proxmox_scan_result) : null;

    return NextResponse.json(
      {
        ...senzaColonneVecchie(device),
        last_proxmox_scan_result: null,
        proxmox_data,
        stp_info,
        device_info,
        arp_entries: arpEntries,
        mac_port_entries: macPortEntries,
        switch_ports: switchPorts,
        neighbors,
        routes,
        dhcp_leases,
        credential_bindings,
        // La scelta del motore per il protocollo principale e per SNMP (T20,
        // interfaccia punto 5): la scheda la mostra come «Usata adesso».
        usata_adesso: usataAdessoDb(getDb(), Number(id)),
      },
      { headers: NO_CACHE_HEADERS }
    );
    } catch (error) {
      console.error("Error fetching device:", error);
      return NextResponse.json({ error: "Errore nel recupero del dispositivo" }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const existing = getNetworkDeviceById(Number(id));
    if (!existing) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.host !== undefined) updates.host = body.host;
    if (body.device_type !== undefined) updates.device_type = body.device_type;
    if (body.classification !== undefined) updates.classification = body.classification;
    if (body.vendor !== undefined) updates.vendor = body.vendor;
    if (body.vendor_subtype !== undefined) updates.vendor_subtype = body.vendor_subtype;
    if (body.protocol !== undefined) updates.protocol = body.protocol;
    // Credenziali (tappa 2e, T20): nessuna colonna. `credential_id` e
    // `snmp_credential_id` vanno nei binding con la semantica della modifica
    // in blocco; utente e password, community e token diventano voci
    // dell'apparato. Lo fa `applicaCorpoApparatoDb`, sotto, dopo il
    // protocollo nuovo.
    if (body.api_url !== undefined) updates.api_url = body.api_url;
    if (body.port !== undefined) updates.port = body.port;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.scan_target !== undefined) updates.scan_target = body.scan_target;
    // Versione SNMP: «1»/«2c» la fissa a mano; «auto» la restituisce alla discovery
    // (che la riscrive al prossimo giro). Un valore sconosciuto è un errore, non un default.
    if (body.snmp_version_scelta !== undefined) {
      const scelta = body.snmp_version_scelta;
      if (scelta === "1" || scelta === "2c") {
        updates.snmp_version = scelta;
        updates.snmp_version_fissata = 1;
      } else if (scelta === "auto") {
        if (existing.snmp_version_fissata === 1) {
          updates.snmp_version = null;
          updates.snmp_version_fissata = 0;
        }
      } else {
        return NextResponse.json({ error: "Versione SNMP non valida: auto, 1 o 2c" }, { status: 400 });
      }
    }
    if (body.use_for_arp_poll !== undefined) {
      updates.use_for_arp_poll = body.use_for_arp_poll === 1 || body.use_for_arp_poll === true ? 1 : 0;
    }

    if (body.product_profile !== undefined) {
      const vendorForProfile = (body.vendor !== undefined ? body.vendor : existing.vendor) as import("@/types").NetworkDevice["vendor"];
      const raw = body.product_profile;
      const pp = raw === "" || raw === null ? null : String(raw);
      if (pp !== null && !isValidProductProfileForVendor(vendorForProfile, pp)) {
        return NextResponse.json(
          { error: "Profilo prodotto non valido per questo vendor" },
          { status: 400 }
        );
      }
      updates.product_profile = pp;
      if (pp) {
        const pid = pp as ProductProfileId;
        const defaults = applyProductProfileScanDefaults(pid, vendorForProfile, (body.classification ?? existing.classification) as string | null);
        updates.device_type = defaults.device_type;
        updates.vendor_subtype = defaults.vendor_subtype;
        if (body.scan_target === undefined && defaults.scan_target != null) {
          updates.scan_target = defaults.scan_target;
        }
        if (body.protocol === undefined && defaults.protocol) {
          updates.protocol = coerceProtocolForVendor(vendorForProfile, defaults.protocol);
        }
        if (body.use_for_arp_poll === undefined) {
          updates.use_for_arp_poll = defaults.use_for_arp_poll;
        }
      }
    }
    if (body.classification !== undefined && body.product_profile === undefined) {
      const vendorForClass = (body.vendor ?? existing.vendor) as import("@/types").NetworkDevice["vendor"];
      const profile = (existing.product_profile ?? null) as ProductProfileId | null;
      if (profile && isValidProductProfileForVendor(vendorForClass, profile)) {
        updates.device_type = resolveDeviceTypeForCreate({
          product_profile: profile,
          classification: body.classification as string,
        });
      }
    }
    if (body.classification !== undefined && body.use_for_arp_poll === undefined) {
      const nextType = (updates.device_type ?? existing.device_type) as import("@/types").NetworkDevice["device_type"];
      const nextVendor = (body.vendor ?? existing.vendor) as import("@/types").NetworkDevice["vendor"];
      updates.use_for_arp_poll = resolveUseForArpPoll({
        device_type: nextType,
        classification: body.classification as string,
        vendor: nextVendor,
      });
    }

    // Apparato e credenziali in una transazione: un 409 (togliere binding
    // chiede la conferma) o una voce che non vale non lasciano il resto scritto.
    const dbh = getDb();
    const { device, credenziali } = dbh.transaction(() => {
      const aggiornato = updateNetworkDevice(Number(id), updates as Partial<import("@/types").NetworkDevice>);
      const esito: EsitoScelte | null = aggiornato
        ? applicaCorpoApparatoDb(dbh, Number(id), body as Record<string, unknown>, { conferma: body.conferma_rimozione === true })
        : null;
      return { device: aggiornato, credenziali: esito };
    })();
    if (!device) {
      return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
    }
    // Avviso, non rifiuto (16/10): SSH sulla 161 si salva ma si dice. Un rifiuto
    // bloccherebbe anche il cambio del nome degli apparati già storti, e Proxmox
    // tiene in device.port la porta dell'API anche col protocollo SSH.
    // La voce scelta che resta fallita (D10) si dice, non passa come aggiornata.
    const avvisi = [avvisoPortaProtocollo(device), credenziali ? avvisoFalliti(credenziali.falliti) : null].filter((a): a is string => a != null);

    return NextResponse.json({
      ...senzaColonneVecchie(device),
      ...(avvisi.length > 0 ? { avvisi } : {}),
      credenziali,
      last_proxmox_scan_result: null,
    });
    } catch (error) {
      if (error instanceof RifiutoCredenziali) {
        return NextResponse.json({ error: error.message, ...(error.conferma ? { conferma: error.conferma } : {}) }, { status: error.stato });
      }
      console.error("Error updating device:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
    }
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const deleted = deleteNetworkDevice(Number(id));
      if (!deleted) {
        return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting device:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
    }
  });
}
