"use client";

/**
 * «Dettagli» > Sistema (spostato da `objects/[id]/page.tsx`, 21/10): inventario base, SNMP, NAS, sistema
 * operativo, hardware, schede di rete, sicurezza e licenza, aggiornamenti, processi, storage e utenti.
 * Modello, seriale, firmware e MAC sono in Gestione, le prove della classificazione dietro «Perché?».
 */
import { Badge } from "@/components/ui/badge";
import { Boxes, Network, HardDrive, ServerCog, Cpu, Shield, Activity, Disc, Users, Table as TableIcon } from "lucide-react";
import { parseDbDate } from "@/lib/db-date";
import type { HostSnmpData } from "@/types";
import { InfoRow, Section, formatGb, parseUtcDate } from "../blocchi";
import type { ContestoScheda } from "../contesto";

export function DettagliSistema({ ctx }: { ctx: ContestoScheda }) {
  const { host, device } = ctx;
  return (
    <div className="space-y-4">
      {/* ─── F5.A: Inventario base — SEMPRE visibile, anche senza device_info.
          Software di inventario: OS, SN, modello, tipologia sono indispensabili
          per OGNI device, anche per quelli "Altri/Indeterminato". Pesca da host
          (campi popolati da SNMP/ARP/scan) e dai suggerimenti F1 (inferred_*).
          device_info (quando presente, via WinRM/SSH/SNMP-rich) ha priorità
          come override per campi più dettagliati. */}
      <Section icon={<Boxes className="h-4 w-4" />} title="Inventario base">
        {(() => {
          const di = device?.device_info ?? null;
          const mfg = di?.manufacturer ?? host.device_manufacturer ?? null;
          const osName = di?.os_name ?? host.os_info ?? null;
          const tipologia = host.inferred_device_type
            ?? (device?.device_type as string | undefined)
            ?? (host.classification && host.classification !== "unknown" ? host.classification : null);
          const vendor = host.inferred_vendor ?? device?.vendor ?? host.vendor ?? null;
          const osFamily = host.inferred_os_family ?? null;
          return (
            <>
            <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              <InfoRow label="Tipologia" value={tipologia} />
              <InfoRow label="Vendor" value={vendor} />
              <InfoRow label="OS family" value={osFamily} />
              <InfoRow label="OS / Sistema" value={osName} />
              <InfoRow label="Manufacturer" value={mfg} />
              {host.inferred_at && (
                <InfoRow
                  label="Auto-classificazione"
                  value={`${host.inferred_confidence ?? 0}% · ${parseDbDate(host.inferred_at).toLocaleDateString("it-IT")}`}
                />
              )}
            </dl>
            </>
          );
        })()}
      </Section>

      <SezioneSnmp ctx={ctx} />

      {/* ─── F5.D: Storage NAS (Synology/QNAP) ───
          nas_inventory è popolato da scan SNMP + (opzionale) SSH. Mostra dischi
          con SMART status, RAID/pool, volumi, servizi, UPS — la cosa che oggi
          vivevano solo nel JSON raw senza essere visibili. */}
      {(() => {
        const nas = device?.device_info?.nas_inventory ?? null;
        if (!nas) return null;
        const snmp = nas.snmp;
        const ssh = nas.ssh;
        return (
          <Section icon={<HardDrive className="h-4 w-4" />} title={`Storage NAS — ${nas.vendor === "synology" ? "Synology" : "QNAP"}`}>
            <div className="space-y-3">
              <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
                <InfoRow label="Stato sistema" value={snmp?.system_status ?? null} />
                <InfoRow label="Temperatura sistema" value={snmp?.temperature_c != null ? `${snmp.temperature_c} °C` : null} />
                <InfoRow label="Temperatura CPU" value={snmp?.cpu_temperature_c != null ? `${snmp.cpu_temperature_c} °C` : null} />
                <InfoRow label="UPS" value={snmp?.ups?.status ? `${snmp.ups.status}${snmp.ups.battery_pct ? ` (${snmp.ups.battery_pct})` : ""}` : null} />
                <InfoRow label="CPU model" value={ssh?.cpu_model ?? null} />
                <InfoRow label="Kernel" value={ssh?.kernel ?? null} mono />
                <InfoRow label="Pacchetti installati" value={ssh?.synology_packages_count != null ? String(ssh.synology_packages_count) : null} />
                <InfoRow label="Fonti dati" value={nas.sources && nas.sources.length ? nas.sources.join(" + ") : null} />
              </dl>

              {/* Dischi fisici */}
              {snmp?.disks && snmp.disks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Dischi ({snmp.disks.length})</div>
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Slot</th>
                          <th className="text-left px-2 py-1.5 font-medium">Modello</th>
                          <th className="text-left px-2 py-1.5 font-medium">Capacità</th>
                          <th className="text-left px-2 py-1.5 font-medium">Stato</th>
                          <th className="text-left px-2 py-1.5 font-medium">SMART</th>
                          <th className="text-left px-2 py-1.5 font-medium">Temp.</th>
                          <th className="text-left px-2 py-1.5 font-medium">Serial</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {snmp.disks.map((d, i) => (
                          <tr key={i} className="hover:bg-muted/30">
                            <td className="px-2 py-1.5 font-mono">{d.slot ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.model ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.capacity_gb != null ? `${d.capacity_gb} GB` : "—"}</td>
                            <td className="px-2 py-1.5">
                              {d.status ? <Badge variant={/ok|normal|active/i.test(d.status) ? "default" : "destructive"} className="text-[10px]">{d.status}</Badge> : "—"}
                            </td>
                            <td className="px-2 py-1.5">{d.smart_health ?? "—"}</td>
                            <td className="px-2 py-1.5">{d.temperature_c != null ? `${d.temperature_c} °C` : "—"}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px]">{d.serial ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* RAID groups */}
              {snmp?.raids && snmp.raids.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">RAID groups ({snmp.raids.length})</div>
                  <div className="border rounded-md divide-y">
                    {snmp.raids.map((r, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span className="font-medium">{r.name ?? `RAID #${i + 1}`}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {r.status && (
                            <Badge variant={/ok|normal|active/i.test(r.status) ? "default" : "destructive"} className="text-[10px]">{r.status}</Badge>
                          )}
                          {r.total_gb != null && <span>{r.free_gb != null ? `${r.free_gb}/${r.total_gb} GB free` : `${r.total_gb} GB`}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Volumi / storage pools */}
              {snmp?.volumes_snmp && snmp.volumes_snmp.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Volumi ({snmp.volumes_snmp.length})</div>
                  <div className="border rounded-md divide-y">
                    {snmp.volumes_snmp.map((v, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span>{v.name ?? `Vol #${i + 1}`} {v.raid_type && <span className="text-xs text-muted-foreground">({v.raid_type})</span>}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {v.status && <Badge variant={/ok|normal|active/i.test(v.status) ? "default" : "destructive"} className="text-[10px]">{v.status}</Badge>}
                          {v.size_gb != null && <span>{v.free_gb != null ? `${v.free_gb}/${v.size_gb} GB free` : `${v.size_gb} GB`}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Storage pools (QNAP) */}
              {snmp?.storage_pools && snmp.storage_pools.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Storage pool ({snmp.storage_pools.length})</div>
                  <div className="border rounded-md divide-y">
                    {snmp.storage_pools.map((p, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span>{p.name ?? `Pool #${i + 1}`}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {p.status && <Badge variant={/ok|normal|active/i.test(p.status) ? "default" : "destructive"} className="text-[10px]">{p.status}</Badge>}
                          {p.total_gb != null && <span>{p.used_gb != null ? `${p.used_gb}/${p.total_gb} GB used` : `${p.total_gb} GB`}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Servizi SNMP NAS */}
              {snmp?.services && snmp.services.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Servizi NAS ({snmp.services.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {snmp.services.map((s, i) => (
                      <Badge key={i} variant={s.state && /running|active|ok/i.test(s.state) ? "default" : "outline"} className="text-[10px]">
                        {s.name ?? "?"}{s.state ? `: ${s.state}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* SSH previews (raw text) */}
              {(ssh?.synology_shares_preview || ssh?.qnap_qpkg_preview || ssh?.mdstat_summary) && (
                <div className="text-xs text-muted-foreground space-y-1 border-t border-border/50 pt-2">
                  {ssh?.mdstat_summary && <div><span className="font-medium text-foreground">mdstat:</span> <code className="text-[10px]">{ssh.mdstat_summary}</code></div>}
                  {ssh?.synology_shares_preview && <div><span className="font-medium text-foreground">Share Synology:</span> {ssh.synology_shares_preview}</div>}
                  {ssh?.qnap_qpkg_preview && <div><span className="font-medium text-foreground">QPKG:</span> {ssh.qnap_qpkg_preview}</div>}
                </div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ─── 3. Sistema operativo (Windows/Linux server) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasOsContent = !!(
          di.hostname || di.os_name || di.os_version || di.domain ||
          di.kernel_version || di.uptime || di.uptime_days != null ||
          di.last_boot || di.registered_user
        );
        if (!hasOsContent) return null;
        return (
          <Section icon={<ServerCog className="h-4 w-4" />} title="Sistema operativo"
            badge={
              <span className="ml-2 inline-flex gap-1.5">
                {di.is_domain_controller && <Badge variant="outline" className="text-[10px] border-purple-400 text-purple-700 bg-purple-50">Domain Controller</Badge>}
                {di.is_server && !di.is_domain_controller && <Badge variant="outline" className="text-[10px]">Server</Badge>}
                {di.is_virtual && di.virtualization && <Badge variant="outline" className="text-[10px]">{di.virtualization}</Badge>}
              </span>
            }>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoRow label="Hostname" value={di.hostname ?? null} />
              <InfoRow label="Dominio" value={di.domain ?? null} />
              <InfoRow label="OS" value={di.os_name ?? null} />
              <InfoRow label="Versione" value={di.os_version ?? null} />
              <InfoRow label="Build" value={di.os_build ?? null} />
              <InfoRow label="Kernel" value={di.kernel_version ?? null} />
              <InfoRow label="Architettura" value={di.architecture ?? null} />
              <InfoRow label="Domain role" value={di.domain_role ?? null} />
              <InfoRow label="Ultimo boot" value={di.last_boot ?? null} />
              <InfoRow label="Data install" value={di.install_date ?? null} />
              <InfoRow label="Load avg" value={di.load_average ?? null} />
              <InfoRow label="Utente registrato" value={di.registered_user ?? null} />
              <InfoRow label="Organizzazione" value={di.organization ?? null} />
            </dl>
          </Section>
        );
      })()}

      {/* ─── 3.1 Hardware ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.cpu_model || di.ram_total_gb != null || di.bios_version ||
          di.gpu || di.memory_modules?.length || di.physical_disks?.length ||
          di.manufacturer || di.model
        );
        if (!hasContent) return null;
        const gpuList = Array.isArray(di.gpu) ? di.gpu : (di.gpu ? [{ name: di.gpu }] : []);
        return (
          <Section icon={<Cpu className="h-4 w-4" />} title="Hardware">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <InfoRow label="Produttore" value={di.manufacturer ?? null} />
              <InfoRow label="Modello" value={di.model ?? null} />
              <InfoRow label="System type" value={di.system_type ?? null} />
              <InfoRow label="Serial" value={di.serial_number ?? null} mono />
              <InfoRow label="CPU" value={di.cpu_model ?? null} />
              <InfoRow label="CPU produttore" value={di.cpu_manufacturer ?? null} />
              <InfoRow label="Core / Thread" value={di.cpu_cores ? `${di.cpu_cores} core${di.cpu_threads ? ` / ${di.cpu_threads} thread` : ""}` : null} />
              <InfoRow label="Frequenza" value={di.cpu_speed_mhz ? `${di.cpu_speed_mhz} MHz` : null} />
              <InfoRow label="Processor count" value={di.processor_count != null ? String(di.processor_count) : null} />
              <InfoRow label="RAM" value={di.ram_total_gb ? `${di.ram_total_gb.toFixed(1)} GB` : null} />
              <InfoRow label="RAM libera" value={di.ram_free_mb != null ? `${(di.ram_free_mb / 1024).toFixed(1)} GB` : null} />
              <InfoRow label="BIOS" value={di.bios_manufacturer || di.bios_version ? `${di.bios_manufacturer ?? ""} ${di.bios_version ?? ""}`.trim() : null} />
            </dl>

            {/* GPU */}
            {gpuList.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">GPU</div>
                <div className="flex flex-wrap gap-1.5">
                  {gpuList.map((g, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {g.name ?? "?"}
                      {g.vram_mb && ` · ${(g.vram_mb / 1024).toFixed(1)} GB`}
                      {g.driver && <span className="text-muted-foreground"> · {g.driver}</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Memory modules */}
            {di.memory_modules && di.memory_modules.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                  Memory modules ({di.memory_modules.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {di.memory_modules.map((m, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">
                      {m.locator ?? `Slot${i}`}: {m.size_gb ? `${m.size_gb} GB` : "?"}
                      {m.speed_mhz && ` @ ${m.speed_mhz} MHz`}
                      {m.manufacturer && <span className="text-muted-foreground"> · {m.manufacturer}</span>}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Section>
        );
      })()}

      {/* ─── 3.2 Schede di rete del sistema ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        const nics = di?.network_adapters ?? [];
        if (nics.length === 0) return null;
        return (
          <Section icon={<Network className="h-4 w-4" />} title="Schede di rete del sistema"
            badge={<Badge variant="outline" className="ml-2 text-[10px]">{nics.length}</Badge>}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1.5 pr-3">Interfaccia</th>
                    <th className="text-left pr-3">MAC</th>
                    <th className="text-left pr-3">IP</th>
                    <th className="text-left pr-3">DHCP</th>
                    <th className="text-left pr-3">Speed</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {nics.map((n, i) => {
                    const ips = Array.isArray(n.ips) ? n.ips.join(", ") : (n.ips ?? "");
                    const mac = n.mac ?? n.mac_address ?? "";
                    return (
                      <tr key={i} className="border-b border-border/30 last:border-0">
                        <td className="py-1 pr-3 font-mono">{n.name ?? "—"}</td>
                        <td className="pr-3 font-mono">{mac || "—"}</td>
                        <td className="pr-3 font-mono">{ips || "—"}</td>
                        <td className="pr-3">{n.dhcp === true ? <Badge variant="outline" className="text-[10px]">DHCP</Badge> : n.dhcp === false ? <Badge variant="outline" className="text-[10px]">Statico</Badge> : "—"}</td>
                        <td className="pr-3 font-mono text-[10px]">{n.speed_mbps ? `${n.speed_mbps} Mb/s` : "—"}</td>
                        <td>{n.status ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })()}

      {/* ─── 3.3 Sicurezza e licenza (Windows) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.license_status || di.license_name || di.antivirus ||
          di.firewall_active != null || di.firewall_type || di.server_roles?.length
        );
        if (!hasContent) return null;
        const avList: Array<{ name?: string; status?: string }> = Array.isArray(di.antivirus)
          ? di.antivirus.map((a) => typeof a === "string" ? { name: a } : a)
          : [];
        return (
          <Section icon={<Shield className="h-4 w-4" />} title="Sicurezza e licenza">
            <div className="space-y-3">
              {/* Licenza Windows */}
              {(di.license_status || di.license_name) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Licenza</div>
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <InfoRow label="Status" value={di.license_status ?? null} />
                    <InfoRow label="Edition" value={di.license_name ?? null} />
                    <InfoRow label="Product key" value={di.license_partial_key ?? null} mono />
                    <InfoRow label="OS Serial" value={di.os_serial ?? null} mono />
                  </dl>
                </div>
              )}

              {/* Antivirus */}
              {avList.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Antivirus ({avList.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {avList.map((a, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {a.name ?? "?"}{a.status && <span className="text-muted-foreground"> · {a.status}</span>}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Firewall */}
              {(di.firewall_active != null || di.firewall_type) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Firewall</div>
                  <div className="flex items-center gap-2 text-xs">
                    {di.firewall_active === true && <Badge variant="outline" className="text-[10px] border-emerald-400 text-emerald-700 bg-emerald-50">Attivo</Badge>}
                    {di.firewall_active === false && <Badge variant="outline" className="text-[10px] border-red-400 text-red-700 bg-red-50">Disattivo</Badge>}
                    {di.firewall_type && <span className="font-mono text-muted-foreground">{di.firewall_type}</span>}
                    {di.firewall_rules_count != null && <span className="text-muted-foreground">{di.firewall_rules_count} regole</span>}
                  </div>
                </div>
              )}

              {/* Server roles */}
              {di.server_roles && di.server_roles.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Server roles ({di.server_roles.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {di.server_roles.map((r, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] border-blue-400 text-blue-700 bg-blue-50">{r}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ─── 3.4 Aggiornamenti Windows (hotfixes) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        const hf = di?.installed_hotfixes ?? [];
        if (hf.length === 0 && (di?.pending_updates_count ?? 0) === 0) return null;
        return (
          <Section icon={<Activity className="h-4 w-4" />} title="Aggiornamenti Windows"
            badge={
              <span className="ml-2 inline-flex gap-1.5">
                <Badge variant="outline" className="text-[10px]">{hf.length} installati</Badge>
                {(di?.pending_updates_count ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 bg-amber-50">{di?.pending_updates_count} pending</Badge>
                )}
              </span>
            }>
            {hf.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                <div className="flex flex-wrap gap-1.5">
                  {hf.slice(0, 50).map((h, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">
                      {h.id ?? "?"}{h.installed_on && <span className="text-muted-foreground"> · {h.installed_on}</span>}
                    </Badge>
                  ))}
                  {hf.length > 50 && <Badge variant="outline" className="text-[10px]">+{hf.length - 50} altri</Badge>}
                </div>
              </div>
            )}
          </Section>
        );
      })()}

      {/* ─── 3.5 Linux: listening ports + cron ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        const lp = di?.listening_ports ?? [];
        const cj = di?.cron_jobs ?? [];
        if (lp.length === 0 && cj.length === 0) return null;
        return (
          <Section icon={<TableIcon className="h-4 w-4" />} title="Processi e schedulazioni">
            <div className="space-y-3">
              {lp.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Porte in ascolto ({lp.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                    {lp.slice(0, 50).map((p, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] font-mono">
                        {p.protocol ?? "?"}:{p.port ?? "?"}{p.process && <span className="text-muted-foreground"> · {p.process}</span>}
                      </Badge>
                    ))}
                    {lp.length > 50 && <Badge variant="outline" className="text-[10px]">+{lp.length - 50} altre</Badge>}
                  </div>
                </div>
              )}
              {cj.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Cron jobs ({cj.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {cj.slice(0, 15).map((c, i) => (
                      <div key={i} className="text-xs font-mono flex items-baseline gap-3">
                        <Badge variant="outline" className="text-[10px] shrink-0">{c.user ?? "?"}</Badge>
                        <span className="text-muted-foreground shrink-0">{c.schedule ?? ""}</span>
                        <span className="truncate" title={c.command ?? ""}>{c.command ?? ""}</span>
                      </div>
                    ))}
                    {cj.length > 15 && <p className="text-[10px] text-muted-foreground">+{cj.length - 15} altri</p>}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}

      {/* ─── 3.6 Storage / Filesystem (logici + fisici) ─── */}
      {(() => {
        const di = device?.device_info ?? null;
        if (!di) return null;
        const hasContent = !!(
          di.disks?.length || di.physical_disks?.length ||
          di.important_services?.length || di.local_users?.length || di.logged_on_users?.length
        );
        if (!hasContent) return null;
        return (
          <Section icon={<HardDrive className="h-4 w-4" />} title="Storage, servizi e utenti">
            <div className="space-y-4">
              {/* Dischi logici */}
              {di.disks && di.disks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3" /> Filesystem ({di.disks.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {di.disks.map((d, i) => {
                      const usedPct = d.size_gb && d.free_gb != null
                        ? Math.round(((d.size_gb - d.free_gb) / d.size_gb) * 100)
                        : null;
                      return (
                        <div key={i} className="text-xs border rounded px-2 py-1.5 flex items-center justify-between gap-2">
                          <div className="font-mono truncate">
                            {d.device ?? "—"}
                            {d.label && <span className="text-muted-foreground"> · {d.label}</span>}
                          </div>
                          <div className="shrink-0 text-muted-foreground">
                            {formatGb(d.free_gb)} / {formatGb(d.size_gb)}
                            {usedPct != null && (
                              <span className={`ml-1 ${usedPct >= 90 ? "text-red-600 font-semibold" : usedPct >= 75 ? "text-amber-600" : ""}`}>
                                · {usedPct}% usato
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dischi fisici */}
              {di.physical_disks && di.physical_disks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Disc className="h-3 w-3" /> Dischi fisici ({di.physical_disks.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {di.physical_disks.map((d, i) => (
                      <div key={i} className="text-xs border rounded px-2 py-1.5">
                        <div className="font-mono">{d.device ?? "—"}</div>
                        <div className="text-muted-foreground text-[11px] mt-0.5">
                          {d.model ?? "—"}{d.vendor && ` · ${d.vendor}`} · {formatGb(d.size_gb)}
                          {d.interface_type && ` · ${d.interface_type}`}
                          {d.serial && <span className="font-mono"> · {d.serial}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Servizi importanti */}
              {di.important_services && di.important_services.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Servizi rilevanti ({di.important_services.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {di.important_services.map((s, i) => {
                      const running = s.state?.toLowerCase() === "running";
                      return (
                        <Badge
                          key={i}
                          variant="outline"
                          className={`text-[10px] ${running ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}
                          title={`${s.display_name ?? s.name ?? ""} · ${s.start_mode ?? ""}`}
                        >
                          {s.name ?? "?"} · {s.state ?? "?"}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Utenti locali */}
              {di.local_users && di.local_users.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> Utenti locali ({di.local_users.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {di.local_users.map((u, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={`text-[10px] ${u.disabled ? "text-muted-foreground line-through" : ""}`}
                        title={u.full_name ?? u.name ?? ""}
                      >
                        {u.name ?? "?"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Utenti loggati */}
              {di.logged_on_users && di.logged_on_users.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-emerald-600" /> Utenti attualmente connessi ({di.logged_on_users.length})
                  </div>
                  <div className="space-y-1">
                    {di.logged_on_users.map((u, i) => (
                      <div key={i} className="text-xs flex items-center gap-3 font-mono">
                        <span className="font-medium">{u.username ?? "?"}</span>
                        {u.session_type && <Badge variant="outline" className="text-[10px]">{u.session_type}</Badge>}
                        {u.logon_time && <span className="text-muted-foreground">{u.logon_time}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}
    </div>
  );
}

/** Informazioni di rete (SNMP). Esportata: la scheda router e firewall la porta in «Configurazione», senza «Dettagli». */
export function SezioneSnmp({ ctx }: { ctx: ContestoScheda }) {
  const { host, device } = ctx;
  let snmp: HostSnmpData | null = null;
  try { if (host.snmp_data) snmp = JSON.parse(host.snmp_data) as HostSnmpData; } catch { /* skip */ }
  const isNetworkGear = device?.device_type === "router" || device?.device_type === "switch" || device?.device_type === "firewall";
  if (!isNetworkGear && !snmp) return null;
  return (
    <Section icon={<Network className="h-4 w-4" />} title="Informazioni di rete (SNMP)">
      <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
        <InfoRow label="Sysname (SNMP)" value={device?.sysname ?? snmp?.sysName ?? null} />
        <InfoRow label="Sysdescr" value={device?.sysdescr ?? snmp?.sysDescr ?? null} />
        <InfoRow label="sysObjectID" value={snmp?.sysObjectID ?? null} mono />
        <InfoRow label="Uptime SNMP" value={snmp?.sysUpTime ?? null} />
        <InfoRow label="ARP entries" value={snmp?.arpEntryCount != null ? String(snmp.arpEntryCount) : null} />
        <InfoRow label="SNMP port" value={snmp?.port ? String(snmp.port) : null} />
        <InfoRow label="Part number" value={device?.part_number ?? snmp?.partNumber ?? null} />
        <InfoRow label="Ultima query device" value={device?.last_info_update ? parseUtcDate(device.last_info_update).toLocaleString("it-IT") : null} />
      </dl>
      {/* Hints vendor-specifici che il discovery cattura via OID custom */}
      {(snmp?.mikrotikIdentity || snmp?.unifiSummary || snmp?.ifDescrSummary || snmp?.hostResourcesSummary) && (
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground border-t border-border/50 pt-2">
          {snmp?.mikrotikIdentity && <p><span className="font-medium text-foreground">MikroTik:</span> {snmp.mikrotikIdentity}</p>}
          {snmp?.unifiSummary && <p><span className="font-medium text-foreground">UniFi:</span> {snmp.unifiSummary}</p>}
          {snmp?.ifDescrSummary && <p><span className="font-medium text-foreground">Interfacce:</span> {snmp.ifDescrSummary}</p>}
          {snmp?.hostResourcesSummary && <p><span className="font-medium text-foreground">Risorse:</span> {snmp.hostResourcesSummary}</p>}
        </div>
      )}
    </Section>
  );
}
