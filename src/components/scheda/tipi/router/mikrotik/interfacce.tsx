"use client";

/**
 * Tab «Interfacce» dei router MikroTik raggiungibili in SSH (artboard MkInterfacce, M8-M14): chip di filtro, un riquadro
 * per tipo di interfaccia (Ethernet · VLAN · Bond · Bridge · VPN e tunnel · Altro), poi i vicini con la versione che
 * annunciano e, come prima, LibreNMS, «Sulla mappa» e gli IP collegati. Le colonne vuote per tutto il gruppo non si
 * rendono. «Dettagli»: dei bond (modo, slave, hash, MLAG, controllo link) e dei bridge (VLAN filter) dall'ultima fotografia della
 * topologia (Task 9); il genitore delle VLAN arriva col Task 11.
 */
import { Fragment, useState } from "react";
import type { RigaBondMk, RigaBridgeMk } from "@/lib/devices/mikrotik-scheda";
import { LoadError } from "@/components/shared/load-error";
import { parseDbDate } from "@/lib/db-date";
import { raggruppaInterfacce, statoInterfaccia } from "@/lib/scheda/mikrotik";
import type { InterfacciaScheda } from "@/lib/scheda/router";
import { Riquadro } from "../../../riquadro";
import { SezioneLibreNms } from "../../../dettagli/generale";
import { IpCollegati, SullaMappa } from "../../../dettagli/rete";
import type { ContestoScheda } from "../../../contesto";
import { IndirizziCella } from "../celle";
import { useInterfacceMikrotik, useSchedaMikrotik } from "./dati-mikrotik";

type Filtro = "tutte" | "su" | "non_attive";

const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";

/** Segno + parola, come la legenda: ✓ attiva · ● inattiva · ✕ disabilitata (la disabilitata è un segno X di RouterOS, non un guasto). */
function StatoMikrotik({ i }: { i: InterfacciaScheda }) {
  const s = statoInterfaccia(i);
  if (s === "attiva") return <span className="font-semibold">✓ attiva</span>;
  if (s === "disabilitata") return <span className="font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ disabilitata</span>;
  return <span className="text-muted-foreground">● inattiva</span>;
}

/** Riga «Dettagli» di un bond (M10): modo · slave · hash · MLAG · controllo link. */
function DettagliBond({ b }: { b: RigaBondMk }) {
  const link = b.link_monitoring ? [b.link_monitoring, b.link_monitoring === "mii" ? b.mii_interval : null].filter(Boolean).join(" ") : null;
  const voci: [string, string | null][] = [
    ["modo", b.mode], ["slave", b.slaves.length > 0 ? b.slaves.join(", ") : null], ["hash", b.transmit_hash_policy], ["MLAG", b.mlag_id ?? "—"],
    ["controllo link", link],
  ];
  return (
    <span className="text-[13px]">
      <span className="mr-2 font-semibold text-muted-foreground">Dettagli</span>
      {voci.filter(([, v]) => v).map(([k, v], n) => (
        <Fragment key={k}>{n > 0 && <span className="text-muted-foreground"> · </span>}{k} <b>{v}</b></Fragment>
      ))}
    </span>
  );
}

/** VLAN filter di un bridge (M11): ✓ sì / ✕ no, segno e parola. */
function FiltroVlan({ b }: { b: RigaBridgeMk }) {
  if (b.vlan_filtering === null) return <span className="text-muted-foreground">—</span>;
  return <span>VLAN filter <b>{b.vlan_filtering ? "✓ sì" : "✕ no"}</b></span>;
}

/** «7.15.3 (stable)» → «7.15.3»: il testo intero resta nel title. */
const primoPezzo = (v: string): string => v.trim().split(/\s+/)[0] ?? v;

export function InterfacceMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const { device, hostId, isAdmin } = ctx;
  const { stato, riprova } = useInterfacceMikrotik(device?.id);
  // Dettagli di bond e bridge: se la fotografia non c'è (o non si carica) la colonna e la riga semplicemente non compaiono.
  const { stato: scheda } = useSchedaMikrotik(device?.id);
  const bondPer = new Map((scheda.fase === "ok" ? scheda.dati.bond : []).map((b) => [b.name, b]));
  const bridgePer = new Map((scheda.fase === "ok" ? scheda.dati.bridge : []).map((b) => [b.name, b]));
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
            filtro: g.gruppo === "bridge" && g.righe.some((i) => bridgePer.has(i.ifname)),
          };
          const nCol = 3 + [col.tipo, col.mtu, col.mac, col.commento, col.filtro].filter(Boolean).length;
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
                      {col.filtro && <th className={th}>Dettagli</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.righe.map((i) => {
                      const bond = g.gruppo === "bond" ? bondPer.get(i.ifname) : undefined;
                      const br = bridgePer.get(i.ifname);
                      const spenta = statoInterfaccia(i) === "attiva" ? "" : "bg-muted/30 text-muted-foreground";
                      return (
                        <Fragment key={i.ifname}>
                          <tr className={`align-top ${bond ? "" : "border-b"} ${spenta}`}>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono font-semibold">{i.ifname}</td>
                            {col.tipo && <td className="whitespace-nowrap px-3 py-1.5">{i.tipo ?? "—"}</td>}
                            <td className="whitespace-nowrap px-3 py-1.5"><StatoMikrotik i={i} /></td>
                            {col.mtu && <td className="whitespace-nowrap px-3 py-1.5">{i.mtu ?? "—"}</td>}
                            {col.mac && <td className="whitespace-nowrap px-3 py-1.5 font-mono">{i.mac ?? "—"}</td>}
                            <td className="px-3 py-1.5"><IndirizziCella i={i} /></td>
                            {col.commento && <td className="px-3 py-1.5">{i.alias ?? "—"}</td>}
                            {col.filtro && <td className="whitespace-nowrap px-3 py-1.5">{br ? <FiltroVlan b={br} /> : "—"}</td>}
                          </tr>
                          {bond && (
                            <tr className={`border-b ${spenta}`}>
                              <td colSpan={nCol} className="px-3 pb-1.5 pt-0"><DettagliBond b={bond} /></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
