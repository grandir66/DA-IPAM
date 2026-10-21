"use client";

/**
 * Tab «Interfacce» dei router MikroTik raggiungibili in SSH (artboard MkInterfacce, M8-M14): chip di filtro, un riquadro
 * per tipo di interfaccia (Ethernet · VLAN · Bond · Bridge · VPN e tunnel · Altro), poi i vicini con la versione che
 * annunciano e, come prima, LibreNMS, «Sulla mappa» e gli IP collegati. Le colonne vuote per tutto il gruppo non si
 * rendono. «Dettagli» (genitore delle VLAN, slave dei bond, VLAN filter dei bridge) arriva coi Task 9 e 11.
 */
import { useState } from "react";
import { LoadError } from "@/components/shared/load-error";
import { parseDbDate } from "@/lib/db-date";
import { raggruppaInterfacce, statoInterfaccia } from "@/lib/scheda/mikrotik";
import type { InterfacciaScheda } from "@/lib/scheda/router";
import { Riquadro } from "../../../riquadro";
import { SezioneLibreNms } from "../../../dettagli/generale";
import { IpCollegati, SullaMappa } from "../../../dettagli/rete";
import type { ContestoScheda } from "../../../contesto";
import { IndirizziCella } from "../celle";
import { useInterfacceMikrotik } from "./dati-mikrotik";

type Filtro = "tutte" | "su" | "non_attive";

const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";

/** Segno + parola, come la legenda: ✓ attiva · ● inattiva · ✕ disabilitata (la disabilitata è un segno X di RouterOS, non un guasto). */
function StatoMikrotik({ i }: { i: InterfacciaScheda }) {
  const s = statoInterfaccia(i);
  if (s === "attiva") return <span className="font-semibold">✓ attiva</span>;
  if (s === "disabilitata") return <span className="font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ disabilitata</span>;
  return <span className="text-muted-foreground">● inattiva</span>;
}

/** «7.15.3 (stable)» → «7.15.3»: il testo intero resta nel title. */
const primoPezzo = (v: string): string => v.trim().split(/\s+/)[0] ?? v;

export function InterfacceMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const { device, hostId, isAdmin } = ctx;
  const { stato, riprova } = useInterfacceMikrotik(device?.id);
  const [filtro, setFiltro] = useState<Filtro>("tutte");
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
    const tutte = stato.dati.interfacce;
    const su = tutte.filter((i) => statoInterfaccia(i) === "attiva").length;
    const visibili = tutte.filter((i) => filtro === "tutte" || (filtro === "su") === (statoInterfaccia(i) === "attiva"));
    const gruppi = raggruppaInterfacce(visibili);
    const chip = (id: Filtro, testo: string, n: number) => (
      <button
        key={id}
        type="button"
        aria-pressed={filtro === id}
        onClick={() => setFiltro(id)}
        className={`h-7 rounded-full border px-3 text-[13px] font-semibold ${filtro === id ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-sky-200 dark:bg-sky-200 dark:text-[#0D2537]" : "border-border bg-card hover:bg-muted"}`}
      >
        {testo} {n}
      </button>
    );
    corpo = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {chip("tutte", "Tutte", tutte.length)}
          {chip("su", "Su", su)}
          {chip("non_attive", "Non attive", tutte.length - su)}
          <span className="ml-auto text-[13px] text-muted-foreground">
            ✓ attiva &nbsp; ● inattiva &nbsp; ✕ disabilitata
            {stato.dati.aggiornato ? ` · letto ${parseDbDate(stato.dati.aggiornato).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
        {gruppi.length === 0 && <Riquadro titolo="Interfacce"><p className="text-sm text-muted-foreground">Nessuna interfaccia con questo filtro.</p></Riquadro>}
        {gruppi.map((g) => {
          // Bond e bridge: il tipo è il titolo stesso, la colonna non dice niente.
          const col = {
            tipo: g.gruppo !== "bond" && g.gruppo !== "bridge" && g.righe.some((i) => !!i.tipo),
            mtu: g.righe.some((i) => i.mtu != null),
            mac: g.righe.some((i) => !!i.mac),
            commento: g.righe.some((i) => !!i.alias),
          };
          return (
            <Riquadro
              key={g.gruppo}
              titolo={`${g.titolo} ${g.righe.length}`}
              azione={g.tipi ? <span className="font-mono text-[13px] normal-case tracking-normal text-muted-foreground">{g.tipi}</span> : undefined}
            >
              <div className="-m-4 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="border-b-2 bg-muted/40">
                    <tr>
                      <th className={th}>Nome</th>
                      {col.tipo && <th className={th}>Tipo</th>}
                      <th className={th}>Stato</th>
                      {col.mtu && <th className={th}>MTU</th>}
                      {col.mac && <th className={th}>MAC</th>}
                      <th className={th}>Indirizzi IP</th>
                      {col.commento && <th className={th}>Commento</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.righe.map((i) => (
                      <tr key={i.ifname} className={`border-b align-top ${statoInterfaccia(i) === "attiva" ? "" : "bg-muted/30 text-muted-foreground"}`}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono font-semibold">{i.ifname}</td>
                        {col.tipo && <td className="whitespace-nowrap px-3 py-1.5">{i.tipo ?? "—"}</td>}
                        <td className="whitespace-nowrap px-3 py-1.5"><StatoMikrotik i={i} /></td>
                        {col.mtu && <td className="whitespace-nowrap px-3 py-1.5">{i.mtu ?? "—"}</td>}
                        {col.mac && <td className="whitespace-nowrap px-3 py-1.5 font-mono">{i.mac ?? "—"}</td>}
                        <td className="px-3 py-1.5"><IndirizziCella i={i} /></td>
                        {col.commento && <td className="px-3 py-1.5">{i.alias ?? "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Riquadro>
          );
        })}
      </>
    );
  }

  const conVersione = vicini.some((v) => !!v.remote_version);
  return (
    <div className="space-y-4">
      {corpo}

      <Riquadro titolo={`Vicini LLDP / CDP / MNDP (${vicini.length})`} vuoto={vicini.length === 0}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr>
                <th className={th}>Interfaccia</th><th className={th}>Vicino</th><th className={th}>Porta remota</th><th className={th}>Protocollo</th>
                <th className={th}>Indirizzo</th><th className={th}>Piattaforma</th>{conVersione && <th className={th}>Versione</th>}
              </tr>
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
                  {conVersione && <td className="whitespace-nowrap px-3 py-1.5 font-mono" title={v.remote_version ?? undefined}>{v.remote_version ? primoPezzo(v.remote_version) : "—"}</td>}
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
