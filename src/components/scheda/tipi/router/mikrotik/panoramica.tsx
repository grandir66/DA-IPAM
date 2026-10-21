"use client";

/**
 * Panoramica dei router MikroTik raggiungibili in SSH (artboard MkPanoramica, M1-M7): striscia dei numeri, poi in
 * griglia a tre colonne Risorse · Hardware · Contatori e Interfacce per tipo. Un riquadro senza dato non si rende;
 * cosa manca lo dice la riga delle fonti. I riquadri DNS e Utenti arrivano col Task 11. Deve stare in 1440×900.
 */
import type { ReactNode } from "react";
import { LoadError } from "@/components/shared/load-error";
import { caselleMikrotik, contatoriMikrotik, perTipo, usoPercento, type ContatoriMikrotik } from "@/lib/scheda/mikrotik";
import type { TabId } from "@/lib/scheda/tipo-scheda";
import { parseUtcDate } from "../../../blocchi";
import { BarraUso } from "../../../barra-uso";
import { Riquadro } from "../../../riquadro";
import { RigaFonti, type Fonte } from "../../../riga-fonti";
import { StrisciaNumeri } from "../../../striscia-numeri";
import type { ContestoScheda } from "../../../contesto";
import { rotteDi } from "../dati-router";
import { hardwareDi, risorseDi, useInterfacceMikrotik } from "./dati-mikrotik";

const ora = (iso: string): string =>
  parseUtcDate(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

const lnk = "text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300";

/** Riga «etichetta · valore» dei riquadri Hardware e Risorse. */
function Riga({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
      <span className="text-[13px] font-semibold text-muted-foreground">{etichetta}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** I contatori in ordine di tavola, ognuno con la tab che apre (VLAN, bridge e bond stanno in Interfacce finché non ci sono le loro tab). */
const CONTATORI: { chiave: keyof ContatoriMikrotik; etichetta: string; tab: TabId }[] = [
  { chiave: "indirizzi", etichetta: "Indirizzi IP", tab: "interfacce" },
  { chiave: "vlan", etichetta: "VLAN", tab: "interfacce" },
  { chiave: "porteBridge", etichetta: "Porte bridge", tab: "interfacce" },
  { chiave: "bond", etichetta: "Bond", tab: "interfacce" },
  { chiave: "rotte", etichetta: "Rotte", tab: "routing" },
  { chiave: "utenti", etichetta: "Utenti", tab: "configurazione" },
];

export function PanoramicaMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const { device, apriTab } = ctx;
  const di = device?.device_info ?? null;
  const risorse = risorseDi(ctx);
  const hardware = hardwareDi(ctx);
  const rotte = rotteDi(ctx);
  const { stato: ifc, riprova } = useInterfacceMikrotik(device?.id);
  const interfacce = ifc.fase === "ok" ? ifc.dati.interfacce : null;

  const caselle = caselleMikrotik({ risorse, hardware, scansione: di?.scanned_at ?? null, interfacce, vlan: null });
  const contatori = contatoriMikrotik({ interfacce, rotte: rotte.length, porteBridge: null, bond: null, vlan: null, utenti: null });
  const visibiliContatori = CONTATORI.filter((c) => contatori[c.chiave] != null);
  const tipi = interfacce ? perTipo(interfacce) : [];

  const cpu = risorse?.cpu_carico ?? null;
  const mem = risorse ? usoPercento(risorse.memoria_totale_b, risorse.memoria_libera_b) : null;
  const disco = risorse ? usoPercento(risorse.disco_totale_b, risorse.disco_libero_b) : null;
  const processore = risorse?.cpu_core != null ? `${risorse.cpu_core} core${risorse.cpu_mhz != null ? ` · ${risorse.cpu_mhz} MHz` : ""}` : null;
  const architettura = [risorse?.architettura, risorse?.cpu].filter(Boolean).join(" · ");
  const aggiornabile = hardware?.firmware_aggiornabile && hardware.firmware_aggiornabile !== hardware.firmware_corrente ? hardware.firmware_aggiornabile : null;
  const haRisorse = cpu != null || mem != null || disco != null || processore != null || architettura !== "";
  const haHardware = !!hardware && !!(hardware.modello || hardware.seriale || hardware.firmware_corrente || hardware.firmware_factory);

  const fonti: Fonte[] = [];
  fonti.push(di?.scanned_at ? { nome: "SSH", esito: "ok", quando: ora(di.scanned_at) } : { nome: "SSH", esito: "assente", nota: "mai eseguita" });
  if (ifc.fase === "ok") {
    fonti.push(!ifc.dati.collegato
      ? { nome: "Interfacce", esito: "assente", nota: "apparato non ancora abbinato a un apparato fisico" }
      : ifc.dati.interfacce.length === 0
        ? { nome: "Interfacce", esito: "assente", nota: "nessuna letta" }
        : { nome: "Interfacce", esito: "ok", ...(ifc.dati.aggiornato ? { quando: ora(ifc.dati.aggiornato) } : {}) });
  }
  if (di?.scanned_at && !risorse && !hardware) fonti.push({ nome: "Risorse e hardware", esito: "assente", nota: "si leggono con «Aggiorna»" });

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      {ifc.fase === "errore" && <LoadError what="le interfacce" message={ifc.messaggio} onRetry={riprova} />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Riquadro titolo="Risorse" vuoto={!haRisorse}>
          <div className="space-y-2">
            {cpu != null && <Riga etichetta="CPU"><BarraUso percento={cpu} etichetta={`${cpu}%`} /></Riga>}
            {mem != null && <Riga etichetta="Memoria"><BarraUso percento={mem} etichetta={`${mem}%`} /></Riga>}
            {disco != null && <Riga etichetta="Storage"><BarraUso percento={disco} etichetta={`${disco}%`} /></Riga>}
            {processore && <Riga etichetta="Processore">{processore}</Riga>}
            {architettura !== "" && <Riga etichetta="Architettura">{architettura}</Riga>}
          </div>
        </Riquadro>

        <Riquadro titolo="Hardware" vuoto={!haHardware}>
          <div className="space-y-2">
            {hardware?.modello && <Riga etichetta="Modello"><span className="font-semibold">{hardware.modello}</span></Riga>}
            {hardware?.seriale && <Riga etichetta="Seriale"><span className="font-mono text-[13px]">{hardware.seriale}</span></Riga>}
            {hardware?.firmware_corrente && <Riga etichetta="Firmware">{hardware.firmware_corrente}</Riga>}
            {aggiornabile && <Riga etichetta="Aggiornabile"><span className="font-semibold text-[#6B4F00] dark:text-[#FFD400]"><span aria-hidden>▲ </span>{aggiornabile}</span></Riga>}
            {hardware?.firmware_factory && <Riga etichetta="Factory">{hardware.firmware_factory}</Riga>}
          </div>
        </Riquadro>

        <Riquadro titolo="Contatori" vuoto={visibiliContatori.length === 0}>
          <div className="grid grid-cols-3 gap-2">
            {visibiliContatori.map((c) => (
              <button
                key={c.chiave}
                type="button"
                onClick={() => apriTab(c.tab)}
                className="flex min-w-0 flex-col rounded-lg border px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="text-xl font-bold leading-tight text-[#0D2537] dark:text-foreground">{contatori[c.chiave]}</span>
                <span className="truncate text-[13px] text-muted-foreground">{c.etichetta} ›</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">Contati sull&apos;ultima lettura; ognuno apre la sua tab.</p>
        </Riquadro>

        <Riquadro
          titolo="Interfacce per tipo"
          vuoto={tipi.length === 0}
          azione={<button type="button" onClick={() => apriTab("interfacce")} className={lnk}>tutte ({interfacce?.length ?? 0}) ›</button>}
        >
          <ul className="flex flex-wrap gap-2">
            {tipi.map((t) => (
              <li key={t.tipo} className="inline-flex h-7 items-center gap-1.5 rounded-full border py-0 pl-1 pr-2.5 text-[13px] font-semibold">
                <b className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full bg-[#0D2537] px-1 text-[13px] text-white dark:bg-[#E6EEF4] dark:text-[#0D2537]">{t.numero}</b>
                {t.tipo}
              </li>
            ))}
          </ul>
        </Riquadro>
      </div>

      <RigaFonti fonti={fonti} />
    </div>
  );
}
