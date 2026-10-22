"use client";

/**
 * Panoramica del server Linux (artboard Linux): striscia (carico, RAM, filesystem peggiore, pacchetti, servizi
 * falliti, acceso da), poi filesystem e sistema a sinistra; servizi principali (i falliti, poi quelli in ascolto
 * su una porta), porte in ascolto con il processo e pianificazioni a destra. Senza scansione: Panoramica generica.
 */
import Link from "next/link";
import { caselleLinux, normalizzaDischi, raggruppaPorte, serviziDaGuardare, serviziInAscolto } from "@/lib/scheda/server";
import { Campo, parseUtcDate } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { PanoramicaGenerica } from "../../panoramica-generica";
import { Riquadro } from "../../riquadro";
import { RigaFontiScheda, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { ElencoDischi, ElencoServizi, dataBreve, infoDi, lnk } from "./dati-server";
import { ServiziDelRuolo, TabellaPorte } from "./servizi";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PanoramicaLinux({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, vmSu, librenms, apriTab } = ctx;
  const di = infoDi(ctx);
  const haDati = !!(di && (di.os_name || di.disks?.length || di.important_services?.length || di.listening_ports?.length || di.cpu_cores || di.ram_total_gb || di.load_average));
  if (!haDati) return <PanoramicaGenerica ctx={ctx} />;

  const caselle = caselleLinux({ di });
  const servizi = di?.important_services ?? [];
  const porte = di?.listening_ports ?? [];
  const cron = di?.cron_jobs ?? [];
  const falliti = serviziDaGuardare(servizi);
  const inAscolto = serviziInAscolto(servizi, porte).filter((s) => !falliti.includes(s));
  const dischi = normalizzaDischi(di?.disks);
  const macchina = vmSu ? (vmSu.href ? <span>VM {vmSu.vmid} su <Link href={vmSu.href} className={lnk}>{vmSu.nodo}</Link></span> : `VM ${vmSu.vmid} su ${vmSu.nodo}`) : di?.is_virtual ? (di.virtualization ?? "macchina virtuale") : null;

  const fonti: Fonte[] = [];
  if (device) fonti.push(di?.scanned_at ? { nome: "Scansione apparato", esito: "ok", quando: breve(di.scanned_at) } : { nome: "Scansione apparato", esito: "assente", nota: "mai eseguita" });
  if (librenms?.configured) fonti.push(librenms.mapped ? { nome: "LibreNMS", esito: "ok" } : { nome: "LibreNMS", esito: "non_abbinato" });
  if (host.last_seen) fonti.push({ nome: "Discovery", esito: "ok", quando: breve(host.last_seen) });

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <Riquadro titolo={`Filesystem (${dischi.length})`} vuoto={dischi.length === 0} azione={<button type="button" onClick={() => apriTab("sistema")} className={lnk}>dettaglio ›</button>}>
            <ElencoDischi dischi={dischi} max={5} />
          </Riquadro>
          <Riquadro titolo="Sistema" azione={<button type="button" onClick={() => apriTab("sistema")} className={lnk}>dettaglio ›</button>}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Campo label="Sistema" value={[di?.os_name, di?.os_version].filter(Boolean).join(" ")} />
              <Campo label="Kernel" value={di?.kernel_version} />
              <Campo label="Macchina">{macchina}</Campo>
              <Campo label="Ultimo avvio" value={dataBreve(di?.last_boot)} />
              <Campo label="Firewall" value={di?.firewall_active == null ? null : <span><span aria-hidden>{di.firewall_active ? "✓ " : "▲ "}</span>{di.firewall_active ? "attivo" : "spento"}</span>} />
            </dl>
          </Riquadro>
        </div>

        <div className="min-w-0 space-y-4">
          <Riquadro titolo="Servizi principali" vuoto={servizi.length === 0} azione={<button type="button" onClick={() => apriTab("servizi")} className={lnk}>tutti ({servizi.length}) ›</button>}>
            {falliti.length > 0 && <div className="mb-3 border-b pb-3"><ElencoServizi servizi={falliti} max={4} senzaAvvio /></div>}
            {inAscolto.length > 0
              ? <ServiziDelRuolo servizi={inAscolto.slice(0, 8)} />
              : falliti.length === 0 && <p className="text-[13px]"><span aria-hidden>✓ </span>Nessun servizio fallito. {porte.length > 0 && !porte.some((p) => p.process) ? "Le porte in ascolto non dicono il processo: i servizi non si abbinano." : ""}</p>}
          </Riquadro>
          <Riquadro titolo={`In ascolto (${raggruppaPorte(porte).length})`} vuoto={porte.length === 0} azione={<button type="button" onClick={() => apriTab("servizi")} className={lnk}>tutte ({raggruppaPorte(porte).length}) ›</button>}>
            <TabellaPorte porte={porte} max={3} />
          </Riquadro>
          <Riquadro titolo={`Pianificazioni (${cron.length})`} vuoto={cron.length === 0} azione={<button type="button" onClick={() => apriTab("servizi")} className={lnk}>tutte ({cron.length}) ›</button>}>
            <ul className="space-y-1 text-[13px]">
              {cron.slice(0, 2).map((c, i) => (
                <li key={i} className="flex items-baseline gap-3">
                  <span className="shrink-0 font-mono font-semibold">{c.schedule}</span>
                  <span className="min-w-0 truncate font-mono text-muted-foreground" title={c.command}>{c.user} · {c.command}</span>
                </li>
              ))}
            </ul>
          </Riquadro>
        </div>
      </div>

      <RigaFontiScheda ctx={ctx} fonti={fonti} />
    </div>
  );
}
