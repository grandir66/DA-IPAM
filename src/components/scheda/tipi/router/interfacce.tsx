"use client";

/**
 * Tab «Interfacce» di router e firewall: tutte le interfacce con indirizzi, velocità e MAC (le colonne senza dato
 * non si rendono), i vicini LLDP/CDP/MNDP, LibreNMS, «Sulla mappa» e gli IP collegati (che senza «Dettagli» non
 * avrebbero più un posto).
 */
import { LoadError } from "@/components/shared/load-error";
import { parseDbDate } from "@/lib/db-date";
import { interfaccePanoramica, contaInterfacce } from "@/lib/scheda/router";
import { Riquadro } from "../../riquadro";
import { SezioneLibreNms } from "../../dettagli/generale";
import { IpCollegati, SullaMappa } from "../../dettagli/rete";
import type { ContestoScheda } from "../../contesto";
import { IndirizziCella, StatoInterfaccia, velocitaTesto } from "./celle";
import { rotteDi, useInterfacce } from "./dati-router";

export function InterfacceRouter({ ctx }: { ctx: ContestoScheda }) {
  const { device, hostId, isAdmin } = ctx;
  const { stato, riprova } = useInterfacce(device?.id);
  const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";
  const vicini = device?.neighbors ?? [];

  let corpo;
  if (stato.fase === "carico") {
    corpo = <Riquadro titolo="Interfacce"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>;
  } else if (stato.fase === "errore") {
    corpo = <LoadError what="le interfacce" message={stato.messaggio} onRetry={riprova} />;
  } else if (!stato.dati.collegato) {
    corpo = (
      <Riquadro titolo="Interfacce">
        <p className="text-sm text-muted-foreground">Questo apparato non è ancora abbinato a un apparato fisico, quindi le sue interfacce non sono state lette: non vuol dire che non ne abbia. L&apos;abbinamento avviene alla prossima scansione con SNMP.</p>
      </Riquadro>
    );
  } else if (stato.dati.interfacce.length === 0) {
    corpo = <Riquadro titolo="Interfacce"><p className="text-sm text-muted-foreground">Nessuna interfaccia letta per questo apparato.</p></Riquadro>;
  } else {
    const lista = stato.dati.interfacce;
    const rotte = rotteDi(ctx);
    const uscite = new Set(interfaccePanoramica(lista, rotte, lista.length).filter((x) => x.uscita).map((x) => x.i.ifname));
    const n = contaInterfacce(lista);
    const col = {
      alias: lista.some((i) => !!i.alias),
      tipo: lista.some((i) => !!i.tipo),
      velocita: lista.some((i) => i.velocita_mbps != null),
      mac: lista.some((i) => !!i.mac),
    };
    corpo = (
      <Riquadro
        titolo={`Interfacce (${n.totale})`}
        azione={<span className="text-[13px] text-muted-foreground">{n.su} su · {n.totale - n.su} giù{n.vlan > 0 ? ` · ${n.vlan} VLAN` : ""}{stato.dati.aggiornato ? ` · letto ${parseDbDate(stato.dati.aggiornato).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</span>}
      >
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr>
                <th className={th}>Interfaccia</th>
                {uscite.size > 0 && <th className={th}>Ruolo</th>}
                <th className={th}>Stato</th>
                {col.tipo && <th className={th}>Tipo</th>}
                <th className={th}>Indirizzi</th>
                {col.velocita && <th className={th}>Velocità</th>}
                {col.mac && <th className={th}>MAC</th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.ifname} className={`border-b align-top ${i.stato === "up" ? "" : "bg-muted/30 text-muted-foreground"}`}>
                  <td className="px-3 py-1.5"><span className="font-mono font-semibold">{i.ifname}</span>{col.alias && i.alias ? <span className="block text-[13px] font-normal text-muted-foreground">{i.alias}</span> : null}</td>
                  {uscite.size > 0 && <td className="whitespace-nowrap px-3 py-1.5">{uscite.has(i.ifname) ? "uscita internet" : "—"}</td>}
                  <td className="whitespace-nowrap px-3 py-1.5"><StatoInterfaccia stato={i.stato} /></td>
                  {col.tipo && <td className="px-3 py-1.5">{i.tipo ?? "—"}</td>}
                  <td className="px-3 py-1.5"><IndirizziCella i={i} /></td>
                  {col.velocita && <td className="whitespace-nowrap px-3 py-1.5">{velocitaTesto(i.velocita_mbps) ?? "—"}</td>}
                  {col.mac && <td className="px-3 py-1.5 font-mono">{i.mac ?? "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>
    );
  }

  return (
    <div className="space-y-4">
      {corpo}

      <Riquadro titolo={`Vicini LLDP/CDP/MNDP (${vicini.length})`} vuoto={vicini.length === 0}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr><th className={th}>Interfaccia</th><th className={th}>Vicino</th><th className={th}>Porta remota</th><th className={th}>Protocollo</th><th className={th}>Indirizzo</th><th className={th}>Piattaforma</th></tr>
            </thead>
            <tbody>
              {vicini.map((v, k) => (
                <tr key={v.id ?? k} className="border-b">
                  <td className="px-3 py-1.5 font-mono font-semibold">{v.local_port ?? v.interface_name ?? "—"}</td>
                  <td className="px-3 py-1.5">{v.remote_device_name ?? v.neighbor_name ?? v.remote_mac ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{v.remote_port ?? v.neighbor_port ?? "—"}</td>
                  <td className="px-3 py-1.5 uppercase">{v.protocol ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{v.remote_ip ?? v.neighbor_address ?? "—"}</td>
                  <td className="px-3 py-1.5">{v.remote_platform ?? v.neighbor_platform ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>

      <SezioneLibreNms ctx={ctx} />
      {Number.isFinite(hostId) && hostId > 0 && <SullaMappa hostId={hostId} isAdmin={isAdmin} />}
      <IpCollegati ctx={ctx} />
    </div>
  );
}
