"use client";

/**
 * Panoramica del server Windows (artboard Windows): striscia dei numeri (aggiornamenti, disco peggiore, RAM,
 * protezione, Active Directory se DC, acceso da), poi sistema e dischi a sinistra; servizi da guardare,
 * aggiornamenti, rilievi AD (solo DC) e utenti collegati a destra. Il dato che manca non si rende: se la
 * scansione non ha letto nulla di Windows resta la Panoramica generica (più i rilievi AD, se ci sono).
 */
import Link from "next/link";
import {
  caselleWindows, normalizzaDischi, serviziDaGuardare, serviziDelRuolo, ultimoHotfix,
} from "@/lib/scheda/server";
import { Campo, parseUtcDate } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { PanoramicaGenerica } from "../../panoramica-generica";
import { Riquadro } from "../../riquadro";
import { RigaFonti, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { ElencoDischi, ElencoRilievi, ElencoServizi, LinkPatch, dataBreve, infoDi, lnk } from "./dati-server";
import { ServiziDelRuolo } from "./servizi";
import { TabellaHotfix } from "./aggiornamenti";
import { ElencoSessioni } from "./utenti";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PanoramicaWindows({ ctx }: { ctx: ContestoScheda }) {
  const { host, device, ad, vmSu, librenms, apriTab, ruoli } = ctx;
  const di = infoDi(ctx);
  const haDati = !!(di && (di.os_name || di.disks?.length || di.installed_hotfixes?.length || di.pending_updates_count != null || di.important_services?.length || di.cpu_cores || di.ram_total_gb));
  const rilievi = ad?.rilievi ?? null;
  const rilieviAd = rilievi ? { n: rilievi.length, alti: rilievi.filter((r) => /^(critical|high)$/i.test(r.gravita)).length, controllo: ad?.controllo ? dataBreve(ad.controllo)?.slice(0, 5) ?? null : null } : null;

  const boxAd = rilievi && (
    <Riquadro titolo="Active Directory" azione={<button type="button" onClick={() => apriTab("ad")} className={lnk}>dettaglio ›</button>}>
      {rilievi.length === 0 ? <p className="text-[13px]"><span aria-hidden>✓ </span>Nessun rilievo nell&apos;ultimo controllo.</p> : <ElencoRilievi rilievi={rilievi} max={3} />}
    </Riquadro>
  );

  if (!haDati) {
    return (
      <div className="space-y-4">
        {rilieviAd && <StrisciaNumeri caselle={caselleWindows({ di: null, ad: rilieviAd, adesso: new Date() })} onApriTab={apriTab} />}
        <PanoramicaGenerica ctx={ctx} />
        {boxAd}
      </div>
    );
  }

  const caselle = caselleWindows({ di, ad: rilieviAd, adesso: new Date() });
  const servizi = di?.important_services ?? [];
  const delRuolo = serviziDelRuolo(servizi, ruoli);
  const daGuardare = serviziDaGuardare(servizi);
  const dischi = normalizzaDischi(di?.disks);
  const hf = ultimoHotfix(di?.installed_hotfixes, new Date());
  const sessioni = di?.logged_on_users ?? [];
  const macchina = vmSu ? (vmSu.href ? <span>VM {vmSu.vmid} su <Link href={vmSu.href} className={lnk}>{vmSu.nodo}</Link></span> : `VM ${vmSu.vmid} su ${vmSu.nodo}`) : di?.is_virtual ? (di.virtualization ?? "macchina virtuale") : null;

  const fonti: Fonte[] = [];
  if (device) fonti.push(di?.scanned_at ? { nome: "Scansione apparato", esito: "ok", quando: breve(di.scanned_at) } : { nome: "Scansione apparato", esito: "assente", nota: "mai eseguita" });
  if (ad?.dc) fonti.push(ad.controllo ? { nome: "Active Directory", esito: "ok", quando: dataBreve(ad.controllo) ?? "" } : { nome: "Active Directory", esito: "assente", nota: "nessun controllo" });
  if (librenms?.configured) fonti.push(librenms.mapped ? { nome: "LibreNMS", esito: "ok" } : { nome: "LibreNMS", esito: "non_abbinato" });
  if (host.last_seen) fonti.push({ nome: "Discovery", esito: "ok", quando: breve(host.last_seen) });

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <Riquadro titolo="Sistema" azione={<button type="button" onClick={() => apriTab("sistema")} className={lnk}>dettaglio ›</button>}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Campo label="Sistema" value={[di?.os_name, di?.os_build].filter(Boolean).join(" · ")} />
              <Campo label="Licenza" value={di?.license_status ? <span><span aria-hidden>{/^licensed$/i.test(di.license_status) ? "✓ " : "▲ "}</span>{di.license_status}</span> : null} />
              <Campo label="Macchina">{macchina}</Campo>
              <Campo label="Dominio" value={di?.domain} />
              <Campo label="OU" value={ad?.computer?.ou} />
            </dl>
          </Riquadro>
          <Riquadro titolo={`Dischi (${dischi.length})`} vuoto={dischi.length === 0} azione={<button type="button" onClick={() => apriTab("sistema")} className={lnk}>dettaglio ›</button>}>
            <ElencoDischi dischi={dischi} max={4} />
          </Riquadro>
          <Riquadro titolo={`Utenti collegati (${sessioni.length})`} vuoto={sessioni.length === 0} azione={<button type="button" onClick={() => apriTab("utenti")} className={lnk}>utenti ›</button>}>
            <ElencoSessioni sessioni={sessioni} max={2} />
          </Riquadro>
        </div>

        <div className="min-w-0 space-y-4">
          <Riquadro titolo="Servizi da guardare" vuoto={servizi.length === 0} azione={<button type="button" onClick={() => apriTab("servizi")} className={lnk}>tutti ({servizi.length}) ›</button>}>
            {delRuolo.length > 0 && <div className="mb-3 border-b pb-3"><ServiziDelRuolo servizi={delRuolo} /></div>}
            {daGuardare.length === 0
              ? <p className="text-[13px]"><span aria-hidden>✓ </span>Tutti gli automatici sono attivi.</p>
              : <ElencoServizi servizi={daGuardare} max={4} senzaAvvio />}
          </Riquadro>
          <Riquadro titolo="Aggiornamenti" vuoto={!hf && (di?.pending_updates_count ?? null) == null} azione={<LinkPatch hostId={ctx.hostId} />}>
            {(di?.pending_updates_count ?? 0) > 0 && <p className="mb-2 text-[13px] font-semibold"><span aria-hidden>▲ </span>{di?.pending_updates_count} da installare</p>}
            <TabellaHotfix hotfix={di?.installed_hotfixes} max={4} />
          </Riquadro>
          {boxAd}
        </div>
      </div>

      <RigaFonti fonti={fonti} />
    </div>
  );
}
