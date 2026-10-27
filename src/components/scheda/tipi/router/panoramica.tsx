"use client";

/**
 * Panoramica di router e firewall NON MikroTik in SSH (artboard Firewall): striscia dei numeri, interfacce (prima le
 * uscite e quelle su, max 8), instradamento (default e statiche, max 5) e fonti. I MikroTik in SSH hanno la loro
 * (`mikrotik/panoramica.tsx`, scelta in tab-scheda): qui l'uso dei pool DHCP, che si legge solo da un MikroTik, non
 * c'è più. Un riquadro senza dato non si rende; cosa manca lo dice la riga delle fonti. Deve stare in 1440×900.
 */
import { LoadError } from "@/components/shared/load-error";
import { accesoDa } from "@/lib/scheda/panoramica";
import { caselleRouter, eRottaDefault, interfaccePanoramica } from "@/lib/scheda/router";
import { parseUtcDate } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { RigaFontiScheda, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import type { ContestoScheda } from "../../contesto";
import { IndirizziCella, StatoInterfaccia, StatoRotta, velocitaTesto } from "./celle";
import { regoleDi, rotteDi, useInterfacce } from "./dati-router";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const lnk = "text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300";

export function PanoramicaRouter({ ctx }: { ctx: ContestoScheda }) {
  const { device, librenms, apriTab } = ctx;
  const rotte = rotteDi(ctx);
  const regole = regoleDi(ctx);
  const di = device?.device_info ?? null;
  const { stato: ifc, riprova: riprovaIfc } = useInterfacce(device?.id);

  const interfacce = ifc.fase === "ok" ? ifc.dati.interfacce : null;

  const caselle = caselleRouter({ interfacce, rotte, regole, pool: [], acceso: accesoDa(di) });
  const visibili = interfacce ? interfaccePanoramica(interfacce, rotte, 8) : [];
  const conRuolo = visibili.some((v) => v.uscita);
  const statiche = [...rotte.filter(eRottaDefault), ...rotte.filter((r) => !eRottaDefault(r) && r.protocol === "static")].slice(0, 5);

  const fonti: Fonte[] = [];
  if (device) {
    fonti.push(di?.scanned_at ? { nome: "Scansione apparato", esito: "ok", quando: breve(di.scanned_at) } : { nome: "Scansione apparato", esito: "assente", nota: "mai eseguita" });
  }
  if (ifc.fase === "ok") {
    fonti.push(!ifc.dati.collegato
      ? { nome: "Interfacce", esito: "assente", nota: "apparato non ancora abbinato a un apparato fisico" }
      : ifc.dati.interfacce.length === 0
        ? { nome: "Interfacce", esito: "assente", nota: "nessuna letta" }
        : { nome: "Interfacce", esito: "ok", ...(ifc.dati.aggiornato ? { quando: breve(ifc.dati.aggiornato) } : {}) });
  }
  const ultimaRotta = rotte.map((r) => r.timestamp).filter(Boolean).sort().pop();
  fonti.push(rotte.length > 0
    ? { nome: "Rotte", esito: "ok", ...(ultimaRotta ? { quando: breve(ultimaRotta) } : {}) }
    : { nome: "Rotte", esito: "assente", nota: "non lette" });
  if (!regole) fonti.push({ nome: "Regole firewall", esito: "assente", nota: "non raccolte per questo produttore" });
  if (librenms?.configured) {
    fonti.push(librenms.mapped
      ? { nome: "LibreNMS", esito: "ok", ...(librenms.lastSyncedAt ? { quando: breve(librenms.lastSyncedAt) } : {}) }
      : { nome: "LibreNMS", esito: "non_abbinato" });
  }

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          {ifc.fase === "errore" && <LoadError what="le interfacce" message={ifc.messaggio} onRetry={riprovaIfc} />}
          {ifc.fase === "carico" && <Riquadro titolo="Interfacce"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>}
          <Riquadro
            titolo={`Interfacce${interfacce ? ` (${interfacce.length})` : ""}`}
            vuoto={visibili.length === 0}
            azione={<button type="button" onClick={() => apriTab("interfacce")} className={lnk}>tutte ({interfacce?.length ?? visibili.length}) ›</button>}
          >
            <div className="-m-4 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 bg-muted/40">
                  <tr>
                    {["Interfaccia", conRuolo && "Ruolo", "Stato", "Indirizzo", "Velocità"].filter(Boolean).map((h) => (
                      <th key={String(h)} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibili.map(({ i, uscita }) => (
                    <tr key={i.ifname} className={`border-b ${i.stato === "up" ? "" : "text-muted-foreground"}`}>
                      <td className="px-3 py-1.5 font-mono font-semibold">{i.ifname}</td>
                      {conRuolo && <td className="whitespace-nowrap px-3 py-1.5">{uscita ? "uscita internet" : "—"}</td>}
                      <td className="whitespace-nowrap px-3 py-1.5"><StatoInterfaccia stato={i.stato} /></td>
                      <td className="px-3 py-1.5"><IndirizziCella i={i} breve /></td>
                      <td className="whitespace-nowrap px-3 py-1.5">{velocitaTesto(i.velocita_mbps) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Riquadro>
        </div>

        <div className="min-w-0 space-y-4">
          <Riquadro
            titolo="Instradamento"
            vuoto={statiche.length === 0}
            azione={<button type="button" onClick={() => apriTab("routing")} className={lnk}>tutte ({rotte.length}) ›</button>}
          >
            <ul className="space-y-1.5 text-[13px]">
              {statiche.map((r, n) => (
                <li key={r.id ?? n} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono font-semibold">{r.destination}</span>
                  <span className="text-muted-foreground">{r.gateway ? `via ${r.gateway}` : r.interface_name ? `su ${r.interface_name}` : ""}{r.distance != null && r.distance > 1 ? ` · distanza ${r.distance}` : ""}</span>
                  <span className="ml-auto"><StatoRotta attiva={r.active == null || r.active === 1} /></span>
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
