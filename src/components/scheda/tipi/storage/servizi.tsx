"use client";

/**
 * Tab «Servizi» del NAS: servizi di `nas_inventory.snmp.services`, sistema e UPS, e le anteprime dei comandi
 * SSH (RAID del kernel, cartelle condivise, pool, temperature, QPKG), che erano solo in /devices.
 */
import { statoServizio } from "@/lib/scheda/nas";
import { Campo } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import { SenzaInventario, nasDi } from "./dati-nas";

export function ElencoServizi({ servizi, max }: { servizi: Array<{ name?: string; state?: string | null }>; max?: number }) {
  return (
    <ul className="space-y-1.5 text-[13px]">
      {servizi.slice(0, max ?? servizi.length).map((s, i) => {
        const st = statoServizio(s.state);
        return (
          <li key={`${s.name}-${i}`} className="flex items-baseline gap-3">
            <span className="min-w-[5rem] font-semibold">{s.name ?? "?"}</span>
            <span><span aria-hidden>{st.segno} </span>{st.testo}</span>
          </li>
        );
      })}
    </ul>
  );
}

const ANTEPRIME: Array<{ chiave: "mdstat_summary" | "synology_shares_preview" | "synology_storage_lines" | "synology_temperature_lines" | "qnap_raid_info_preview" | "qnap_storage_cfg_preview" | "qnap_qpkg_preview"; titolo: string }> = [
  { chiave: "mdstat_summary", titolo: "RAID (kernel)" },
  { chiave: "synology_shares_preview", titolo: "Cartelle condivise (SSH)" },
  { chiave: "synology_storage_lines", titolo: "Pool e volumi (SSH)" },
  { chiave: "synology_temperature_lines", titolo: "Temperature (SSH)" },
  { chiave: "qnap_raid_info_preview", titolo: "RAID (SSH)" },
  { chiave: "qnap_storage_cfg_preview", titolo: "Storage (getcfg)" },
  { chiave: "qnap_qpkg_preview", titolo: "QPKG (prime voci)" },
];

export function ServiziNas({ ctx }: { ctx: ContestoScheda }) {
  const nas = nasDi(ctx);
  if (!nas) return <SenzaInventario />;
  const s = nas.snmp;
  const ssh = nas.ssh;
  const servizi = s?.services ?? [];
  const ups = s?.ups && (s.ups.status != null || s.ups.battery_pct != null) ? s.ups : null;
  const haSistema = !!(s?.system_status || s?.temperature_c != null || s?.cpu_temperature_c != null || ups || ssh?.cpu_model || ssh?.kernel || ssh?.synology_packages_count != null);
  const anteprime = ANTEPRIME.filter((a) => ssh?.[a.chiave]);
  if (servizi.length === 0 && !haSistema && anteprime.length === 0) {
    return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">L&apos;apparato non ha dato servizi né anteprime SSH.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Riquadro titolo={`Servizi (${servizi.length})`} vuoto={servizi.length === 0}><ElencoServizi servizi={servizi} /></Riquadro>
        <Riquadro titolo="Sistema" vuoto={!haSistema}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            <Campo label="Stato sistema" value={s?.system_status} />
            <Campo label="Temperatura sistema" value={s?.temperature_c != null ? `${s.temperature_c} °C` : null} />
            <Campo label="Temperatura CPU" value={s?.cpu_temperature_c != null ? `${s.cpu_temperature_c} °C` : null} />
            <Campo label="UPS" value={ups ? [ups.status && !/^\d+$/.test(ups.status) ? ups.status : null, ups.battery_pct ? `batteria ${ups.battery_pct}%` : null].filter(Boolean).join(" · ") || null : null} />
            <Campo label="CPU" value={ssh?.cpu_model} />
            <Campo label="Kernel" value={ssh?.kernel} mono />
            <Campo label="Pacchetti installati" value={ssh?.synology_packages_count != null ? String(ssh.synology_packages_count) : null} />
          </dl>
        </Riquadro>
      </div>
      {anteprime.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {anteprime.map((a) => (
            <Riquadro key={a.chiave} titolo={a.titolo}>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[13px]">{ssh?.[a.chiave]}</pre>
            </Riquadro>
          ))}
        </div>
      )}
    </div>
  );
}
