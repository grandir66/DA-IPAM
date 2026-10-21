"use client";

/**
 * Panoramica di storage e NAS (artboard Nas): striscia dei numeri, alloggiamenti con il dettaglio del disco
 * scelto, volumi e pool con la barra d'uso, servizi e fonti. Senza inventario ricade sulla panoramica generica.
 * Deve stare in 1440×900 senza scorrere la pagina.
 */
import { useState } from "react";
import { accesoDa } from "@/lib/scheda/panoramica";
import { alloggiamenti, caselleStorage, gruppiRaidNas, poolNas, volumiNas } from "@/lib/scheda/nas";
import { parseUtcDate } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { RigaFonti, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { PanoramicaGenerica } from "../../panoramica-generica";
import type { ContestoScheda } from "../../contesto";
import { lnk, nasDi } from "./dati-nas";
import { Alloggiamenti, DettaglioDisco, discoIniziale } from "./dischi";
import { ElencoSpazio } from "./volumi";
import { ElencoServizi } from "./servizi";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PanoramicaStorage({ ctx }: { ctx: ContestoScheda }) {
  const nas = nasDi(ctx);
  const lista = nas ? alloggiamenti(nas.snmp?.disks, nas.vendor) : [];
  const [scelto, setScelto] = useState<number | null>(() => discoIniziale(lista));
  if (!nas) return <PanoramicaGenerica ctx={ctx} />;

  const { apriTab, device } = ctx;
  const di = device?.device_info ?? null;
  const caselle = caselleStorage(nas, accesoDa(di));
  // Un volume per riga; se l'apparato dà solo pool (Synology) o solo gruppi RAID, quelli.
  const volumi = volumiNas(nas);
  const spazio = volumi.length > 0 ? volumi : poolNas(nas).length > 0 ? poolNas(nas) : gruppiRaidNas(nas);
  const servizi = nas.snmp?.services ?? [];

  const quando = di?.scanned_at ? breve(di.scanned_at) : undefined;
  const fonti: Fonte[] = (["snmp", "ssh"] as const).map((f) =>
    nas.sources.includes(f)
      ? { nome: f.toUpperCase(), esito: "ok" as const, ...(quando ? { quando } : {}) }
      : { nome: f.toUpperCase(), esito: "assente" as const, nota: f === "ssh" ? "nessun accesso SSH letto" : "non letto" });

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <Riquadro
            titolo={`Alloggiamenti (${lista.length})`}
            vuoto={lista.length === 0}
            azione={<button type="button" onClick={() => apriTab("dischi")} className={lnk}>dischi e RAID ›</button>}
          >
            <div className="space-y-3">
              <Alloggiamenti lista={lista} scelto={scelto} onScegli={setScelto} />
              {scelto != null && <div className="border-t pt-3"><DettaglioDisco a={lista.find((x) => x.numero === scelto)} /></div>}
            </div>
          </Riquadro>
        </div>

        <div className="min-w-0 space-y-4">
          <Riquadro
            titolo={volumi.length > 0 ? "Volumi" : "Pool e volumi"}
            vuoto={spazio.length === 0}
            azione={<button type="button" onClick={() => apriTab("volumi")} className={lnk}>dettaglio ›</button>}
          >
            <ElencoSpazio voci={spazio} max={6} />
          </Riquadro>
          <Riquadro
            titolo="Servizi"
            vuoto={servizi.length === 0}
            azione={<button type="button" onClick={() => apriTab("servizi_nas")} className={lnk}>tutti ({servizi.length}) ›</button>}
          >
            <ElencoServizi servizi={servizi} max={5} />
          </Riquadro>
        </div>
      </div>

      <RigaFonti fonti={fonti} />
    </div>
  );
}
