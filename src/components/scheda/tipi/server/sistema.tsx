"use client";

/**
 * Tab «Sistema» dei server: sistema operativo, hardware, dischi, schede di rete, sicurezza e licenza, e
 * l'identificazione dell'host. Raccoglie quello che stava in Dettagli > Sistema (OS, Hardware, Schede di rete,
 * Sicurezza e licenza, Storage), Dettagli > Generale (sistema e fornitore, LibreNMS, profilo MDM) e Dettagli > Rete
 * (IP collegati, Sulla mappa, SNMP): niente si perde, cambia il posto.
 */
import Link from "next/link";
import { normalizzaDischi, testoGb } from "@/lib/scheda/server";
import { parseDbDate } from "@/lib/db-date";
import { MobileProfilePanel } from "@/components/mobile/MobileProfilePanel";
import { Campo } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { SezioneLibreNms } from "../../dettagli/generale";
import { DettagliRete } from "../../dettagli/rete";
import { SezioneSnmp } from "../../dettagli/sistema";
import { Riquadro } from "../../riquadro";
import { ElencoDischi, dataBreve, infoDi, lnk, td, th } from "./dati-server";


const num = (n: number | undefined | null, unita: string): string | null => (n != null ? `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })} ${unita}` : null);

export function SistemaServer({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, vmSu, ad } = ctx;
  const di = infoDi(ctx);
  const dischi = normalizzaDischi(di?.disks);
  const gpu = Array.isArray(di?.gpu) ? di.gpu : di?.gpu ? [{ name: di.gpu }] : [];
  const moduli = di?.memory_modules ?? [];
  const nic = di?.network_adapters ?? [];
  const av = (di?.antivirus ?? []).map((a) => (typeof a === "string" ? { name: a } : a));
  const funzionalita = di?.server_roles ?? [];
  const licenza = di?.license_status || di?.license_name;
  const haSicurezza = !!(licenza || av.length > 0 || di?.firewall_active != null || di?.firewall_type || funzionalita.length > 0);
  const tipologia = host.inferred_device_type ?? (device?.device_type as string | undefined) ?? (host.classification && host.classification !== "unknown" ? host.classification : null);
  const macchina = vmSu ? (
    vmSu.href ? <span>VM {vmSu.vmid} su <Link href={vmSu.href} className={lnk}>{vmSu.nodo}</Link></span> : `VM ${vmSu.vmid} su ${vmSu.nodo}`
  ) : di?.is_virtual ? (di.virtualization ?? "macchina virtuale") : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Riquadro titolo="Sistema operativo" vuoto={!di && !host.os_info}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Campo label="Sistema" value={di?.os_name ?? host.os_info} />
            <Campo label="Versione · build" value={[di?.os_version, di?.os_build].filter(Boolean).join(" · ")} />
            <Campo label="Kernel" value={di?.kernel_version} />
            <Campo label="Architettura" value={di?.architecture} />
            <Campo label="Nome" value={di?.hostname} />
            <Campo label="Dominio" value={di?.domain} />
            <Campo label="OU in Active Directory" value={ad?.computer?.ou} />
            <Campo label="Ruolo nel dominio" value={di?.domain_role} />
            <Campo label="Macchina">{macchina}</Campo>
            <Campo label="Ultimo avvio" value={dataBreve(di?.last_boot)} />
            <Campo label="Installato il" value={dataBreve(di?.install_date)} />
            <Campo label="Carico medio" value={di?.load_average} />
            <Campo label="Utente registrato" value={di?.registered_user} />
            <Campo label="Organizzazione" value={di?.organization} />
          </dl>
        </Riquadro>

        <Riquadro titolo="Hardware" vuoto={!(di && (di.cpu_model || di.ram_total_gb != null || di.manufacturer || di.model || di.bios_version))}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Campo label="Produttore" value={di?.manufacturer} />
            <Campo label="Modello" value={di?.model} />
            <Campo label="Tipo di sistema" value={di?.system_type} />
            <Campo label="Seriale" value={di?.serial_number} mono />
            <Campo label="CPU" value={di?.cpu_model} />
            <Campo label="Core · thread" value={di?.cpu_cores ? `${di.cpu_cores}${di.cpu_threads ? ` · ${di.cpu_threads}` : ""}` : null} />
            <Campo label="Frequenza" value={num(di?.cpu_speed_mhz, "MHz")} />
            <Campo label="Processori" value={di?.processor_count != null ? String(di.processor_count) : null} />
            <Campo label="RAM" value={num(di?.ram_total_gb, "GB")} />
            <Campo label="RAM libera" value={di?.ram_free_mb != null ? `${(di.ram_free_mb / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} GB` : null} />
            <Campo label="BIOS" value={[di?.bios_manufacturer, di?.bios_version].filter(Boolean).join(" ")} />
          </dl>
          {gpu.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-[13px] font-semibold text-muted-foreground">Scheda video</div>
              <ul className="space-y-0.5 text-[13px]">
                {gpu.map((g, i) => <li key={i}>{(g as { name?: string }).name ?? "?"}{(g as { vram_mb?: number }).vram_mb ? ` · ${((g as { vram_mb: number }).vram_mb / 1024).toFixed(1)} GB` : ""}{(g as { driver?: string }).driver ? ` · ${(g as { driver: string }).driver}` : ""}</li>)}
              </ul>
            </div>
          )}
          {moduli.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-[13px] font-semibold text-muted-foreground">Moduli di memoria ({moduli.length})</div>
              <ul className="space-y-0.5 font-mono text-[13px]">
                {moduli.map((m, i) => <li key={i}>{m.locator ?? `Slot${i}`}: {m.size_gb ? `${m.size_gb} GB` : "?"}{m.speed_mhz ? ` @ ${m.speed_mhz} MHz` : ""}{m.manufacturer ? ` · ${m.manufacturer}` : ""}</li>)}
              </ul>
            </div>
          )}
        </Riquadro>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Riquadro titolo={`Dischi e filesystem (${dischi.length})`} vuoto={dischi.length === 0 && !(di?.physical_disks?.length)}>
          <ElencoDischi dischi={dischi} />
          {(di?.physical_disks?.length ?? 0) > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-[13px] font-semibold text-muted-foreground">Dischi fisici ({di?.physical_disks?.length})</div>
              <ul className="space-y-1 text-[13px]">
                {di?.physical_disks?.map((d, i) => (
                  <li key={i}>
                    <span className="font-mono font-semibold">{d.device ?? "—"}</span>{" "}
                    <span className="text-muted-foreground">{[d.model, d.vendor, d.size_gb != null ? testoGb(d.size_gb) : null, d.interface_type, d.serial].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Riquadro>

        <Riquadro titolo="Sicurezza e licenza" vuoto={!haSicurezza}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Campo label="Licenza" value={di?.license_status ? <span><span aria-hidden>{/^licensed$/i.test(di.license_status) ? "✓ " : "▲ "}</span>{di.license_status}</span> : null} />
            <Campo label="Edizione" value={di?.license_name} />
            <Campo label="Chiave (parziale)" value={di?.license_partial_key} mono />
            <Campo label="Seriale del sistema" value={di?.os_serial} mono />
            <Campo label="Antivirus">
              {av.length > 0 ? av.map((a) => `${a.name ?? "?"}${a.status ? ` · ${a.status}` : ""}`).join(", ") : null}
            </Campo>
            <Campo label="Firewall">
              {di?.firewall_active != null || di?.firewall_type
                ? <span><span aria-hidden>{di?.firewall_active === false ? "✕ " : di?.firewall_active ? "✓ " : "● "}</span>{di?.firewall_active === false ? "spento" : di?.firewall_active ? "attivo" : "stato non letto"}{di?.firewall_type ? ` · ${di.firewall_type}` : ""}{di?.firewall_rules_count != null ? ` · ${di.firewall_rules_count} regole` : ""}</span>
                : null}
            </Campo>
          </dl>
          {funzionalita.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1 text-[13px] font-semibold text-muted-foreground">Ruoli e funzionalità installati ({funzionalita.length})</div>
              <p className="text-[13px]">{funzionalita.join(" · ")}</p>
            </div>
          )}
        </Riquadro>
      </div>

      <Riquadro titolo={`Schede di rete (${nic.length})`} vuoto={nic.length === 0}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Interfaccia</th><th className={th}>MAC</th><th className={th}>IP</th><th className={th}>Indirizzamento</th><th className={th}>Velocità</th><th className={th}>Stato</th></tr></thead>
            <tbody>
              {nic.map((n, i) => (
                <tr key={i}>
                  <td className={`${td} font-mono font-semibold`}>{n.name ?? "—"}</td>
                  <td className={`${td} font-mono`}>{n.mac ?? n.mac_address ?? "—"}</td>
                  <td className={`${td} font-mono`}>{(Array.isArray(n.ips) ? n.ips.join(", ") : n.ips) || "—"}</td>
                  <td className={td}>{n.dhcp === true ? "DHCP" : n.dhcp === false ? "statico" : "—"}</td>
                  <td className={td}>{n.speed_mbps ? `${n.speed_mbps} Mb/s` : "—"}</td>
                  <td className={td}>{n.status ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>

      <Riquadro titolo="Identificazione" vuoto={!(tipologia || host.inferred_vendor || host.vendor || host.inferred_os_family || host.ip_assignment)}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Campo label="Tipologia" value={tipologia} />
          <Campo label="Produttore (da inferenza)" value={host.inferred_vendor ?? device?.vendor} />
          <Campo label="Produttore (MAC)" value={host.vendor} />
          <Campo label="Famiglia di sistema" value={host.inferred_os_family} />
          <Campo label="Assegnazione IP" value={host.ip_assignment} />
          <Campo label="Classificazione automatica" value={host.inferred_at ? `${host.inferred_confidence ?? 0}% · ${parseDbDate(host.inferred_at).toLocaleDateString("it-IT")}` : null} />
        </dl>
      </Riquadro>

      <SezioneSnmp ctx={ctx} />
      <DettagliRete ctx={ctx} />
      <SezioneLibreNms ctx={ctx} />
      <MobileProfilePanel hostId={host.id} />
    </div>
  );
}
