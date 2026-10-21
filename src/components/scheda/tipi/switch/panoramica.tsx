"use client";

/**
 * Panoramica dello switch (artboard Switch): striscia dei numeri, pannello frontale con il dettaglio della porta
 * scelta, «Porte da guardare» con i filtri a chip, vicini e VLAN in breve, hardware se noto, fonti. Deve stare in
 * 1440×900 senza scorrere la pagina: la tabella scorre dentro il suo riquadro.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SwitchPort } from "@/types";
import { accesoDa } from "@/lib/scheda/panoramica";
import { casellePanoramicaSwitch, numeroPorta, porteDaGuardare, vlanDistinte, motiviPorta } from "@/lib/scheda/porte-da-guardare";
import { Campo, parseUtcDate } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { RigaFonti, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import type { ContestoScheda } from "../../contesto";
import { PannelloFrontale } from "./pannello-frontale";
import { AttaccatoCella, PoePorta, StatoPorta, Velocita, colonneConDato } from "./celle";
import { attaccatoA, porteDi, viciniDi } from "./dati-porte";

type Filtro = "guardare" | "trunk" | "poe" | "tutte";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Uptime: dalla scansione dell'apparato, altrimenti da LibreNMS (secondi → giorni). */
function accesoDaSwitch(ctx: ContestoScheda): string | null {
  const dalla = accesoDa(ctx.device?.device_info ?? null);
  if (dalla) return dalla;
  const s = ctx.librenms?.device?.uptime_seconds;
  return s ? `${Math.floor(s / 86400)} g` : null;
}

function DettaglioPorta({ p, motivi }: { p: SwitchPort | undefined; motivi: string[] }) {
  if (!p) return <p className="text-sm text-muted-foreground">Clic su una porta del pannello per vederne il dettaglio.</p>;
  const a = attaccatoA(p);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-[13px] text-muted-foreground">Porta</dt>
      <dd className="font-semibold"><span className="font-mono">{p.port_name}</span> · <StatoPorta p={p} /></dd>
      <dt className="text-[13px] text-muted-foreground">Attaccato</dt>
      <dd>{a.hostId ? <Link href={`/objects/${a.hostId}`} className="font-medium text-[#006C96] hover:underline dark:text-sky-300">{a.testo}</Link> : a.testo}{a.dettaglio ? <span className="text-muted-foreground"> · {a.dettaglio}</span> : null}</dd>
      {(p.speed || p.duplex) && (<><dt className="text-[13px] text-muted-foreground">Velocità</dt><dd><Velocita p={p} /></dd></>)}
      {p.vlan != null && (<><dt className="text-[13px] text-muted-foreground">VLAN</dt><dd className="font-mono">{p.vlan}</dd></>)}
      {p.poe_status && (<><dt className="text-[13px] text-muted-foreground">PoE</dt><dd><PoePorta p={p} /></dd></>)}
      <dt className="text-[13px] text-muted-foreground">MAC visti</dt>
      <dd className="font-mono">{p.mac_count}</dd>
      {p.stp_state && (<><dt className="text-[13px] text-muted-foreground">STP</dt><dd className="capitalize">{p.stp_state}</dd></>)}
      {motivi.length > 0 && (<><dt className="text-[13px] text-muted-foreground">Da guardare</dt><dd className="font-semibold">▲ {motivi.join("; ")}</dd></>)}
    </dl>
  );
}

export function PanoramicaSwitch({ ctx }: { ctx: ContestoScheda }) {
  const { device, librenms, apriTab } = ctx;
  const porte = porteDi(ctx);
  const vicini = viciniDi(ctx);
  const [filtro, setFiltro] = useState<Filtro>("guardare");
  const [scelta, setScelta] = useState<number | null>(null);

  const guarda = useMemo(() => porteDaGuardare(porte), [porte]);
  const motiviPer = useMemo(() => new Map(guarda.map((g) => [g.porta.id, g.motivi])), [guarda]);

  const caselle = casellePanoramicaSwitch({
    porte,
    vicini: vicini.length,
    protocolliVicini: [...new Set(vicini.map((v) => v.protocollo).filter(Boolean))],
    acceso: accesoDaSwitch(ctx),
  });

  const conteggi = {
    guardare: guarda.length,
    trunk: porte.filter((p) => p.is_trunk).length,
    poe: porte.filter((p) => p.poe_status === "delivering").length,
    tutte: porte.length,
  };
  const elenco = porte.filter((p) =>
    filtro === "guardare" ? motiviPer.has(p.id) : filtro === "trunk" ? !!p.is_trunk : filtro === "poe" ? p.poe_status === "delivering" : true,
  );
  const col = colonneConDato(porte);
  const selezionata = porte.find((p) => p.id === scelta);
  const vlan = vlanDistinte(porte);

  const di = device?.device_info ?? null;
  const haHardware = !!(di && (di.cpu_model || di.ram_total_gb || di.ram_total_mb));

  const fonti: Fonte[] = [];
  if (device) {
    fonti.push(di?.scanned_at
      ? { nome: "Scansione apparato", esito: "ok", quando: breve(di.scanned_at) }
      : porte.length > 0 && porte[0]?.timestamp
        ? { nome: "Scansione porte", esito: "ok", quando: breve(porte[0].timestamp) }
        : { nome: "Scansione apparato", esito: "assente", nota: "mai eseguita" });
  }
  if (librenms?.configured) {
    fonti.push(librenms.mapped
      ? { nome: "LibreNMS", esito: "ok", ...(librenms.lastSyncedAt ? { quando: breve(librenms.lastSyncedAt) } : {}) }
      : { nome: "LibreNMS", esito: "non_abbinato" });
  }

  const chip = (id: Filtro, etichetta: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFiltro(id)}
      aria-pressed={filtro === id}
      className={cn("h-7 rounded-full border px-3 text-[13px] font-semibold", filtro === id ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-slate-200 dark:bg-slate-200 dark:text-[#0D2537]" : "bg-card hover:bg-muted")}
    >
      {etichetta} {conteggi[id]}
    </button>
  );

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <Riquadro titolo="Pannello frontale" vuoto={porte.length === 0}>
        <PannelloFrontale porte={porte} scelta={scelta} onScegli={setScelta} />
      </Riquadro>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Riquadro
            titolo="Porte da guardare"
            vuoto={porte.length === 0}
            azione={<div className="flex flex-wrap items-center gap-1.5">{chip("guardare", "Da guardare")}{chip("trunk", "Trunk")}{conteggi.poe > 0 && chip("poe", "PoE")}{chip("tutte", "Tutte")}
              <button type="button" onClick={() => apriTab("porte")} className="ml-1 text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300">tabella completa ›</button></div>}
          >
            {elenco.length === 0 ? (
              <p className="text-sm text-muted-foreground">{filtro === "guardare" ? "✓ Nessuna porta da guardare: niente half duplex, né porte non trunk con molti MAC." : "Nessuna porta."}</p>
            ) : (
              <div className="-m-4 max-h-[230px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 border-b-2 bg-muted">
                    <tr>
                      {["Porta", "Stato", col.velocita && "Velocità", col.vlan && "VLAN", col.poe && "PoE", col.stp && "STP", "Cosa c'è attaccato", "Perché"].filter(Boolean).map((h) => (
                        <th key={String(h)} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {elenco.map((p) => (
                      <tr key={p.id} onClick={() => setScelta(p.id)} className={cn("cursor-pointer border-b hover:bg-muted/40", scelta === p.id && "bg-[#FFF6C2] dark:bg-[#4A3F00]")}>
                        <td className="px-3 py-1.5 font-mono font-semibold">{numeroPorta(p)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{motiviPer.has(p.id) && <span aria-hidden>▲ </span>}<StatoPorta p={p} /></td>
                        {col.velocita && <td className="whitespace-nowrap px-3 py-1.5"><Velocita p={p} /></td>}
                        {col.vlan && <td className="px-3 py-1.5 font-mono">{p.vlan ?? "—"}</td>}
                        {col.poe && <td className="whitespace-nowrap px-3 py-1.5"><PoePorta p={p} /></td>}
                        {col.stp && <td className="px-3 py-1.5 capitalize">{p.stp_state ?? "—"}</td>}
                        <td className="px-3 py-1.5"><AttaccatoCella p={p} /></td>
                        <td className="px-3 py-1.5">{(motiviPer.get(p.id) ?? []).join("; ") || (p.is_trunk ? "uplink" : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Riquadro>
        </div>

        <div className="min-w-0 space-y-4">
          <Riquadro titolo={selezionata ? `Porta ${numeroPorta(selezionata)}` : "Dettaglio porta"} vuoto={porte.length === 0}>
            <DettaglioPorta p={selezionata} motivi={selezionata ? motiviPorta(selezionata) : []} />
          </Riquadro>

          <Riquadro titolo={`Vicini (${vicini.length})`} vuoto={vicini.length === 0}
            azione={<button type="button" onClick={() => apriTab("vicini")} className="text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300">tutti ›</button>}>
            <ul className="space-y-1 text-[13px]">
              {vicini.slice(0, 4).map((v) => (
                <li key={v.chiave} className="flex gap-2"><span className="w-14 shrink-0 font-mono font-semibold">{v.portaLocale.replace(/^\D+/, "") || v.portaLocale}</span><span className="min-w-0 truncate">{v.nome}{v.portaRemota ? ` · porta ${v.portaRemota}` : ""} <span className="text-muted-foreground">· {v.protocollo.toUpperCase()}</span></span></li>
              ))}
            </ul>
          </Riquadro>

          <Riquadro titolo={`VLAN (${vlan.length})`} vuoto={vlan.length === 0}
            azione={<button type="button" onClick={() => apriTab("vlan")} className="text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300">dettaglio ›</button>}>
            <ul className="space-y-1 text-[13px]">
              {vlan.slice(0, 5).map((v) => (
                <li key={v.vlan} className="flex gap-2"><span className="w-12 shrink-0 font-mono font-semibold">{v.vlan}</span><span>{v.porte} {v.porte === 1 ? "porta" : "porte"}{v.trunk > 0 ? ` (${v.trunk} trunk)` : ""}</span></li>
              ))}
            </ul>
          </Riquadro>

          <Riquadro titolo="Hardware" vuoto={!haHardware}>
            <dl className="grid grid-cols-2 gap-3">
              <Campo label="CPU" value={di?.cpu_model} />
              <Campo label="RAM" value={di?.ram_total_gb != null ? `${di.ram_total_gb} GB` : di?.ram_total_mb ? `${di.ram_total_mb} MB` : null} />
            </dl>
          </Riquadro>
        </div>
      </div>

      <RigaFonti fonti={fonti} />
    </div>
  );
}
