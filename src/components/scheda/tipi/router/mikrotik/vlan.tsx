"use client";

/**
 * Tab «VLAN» dei router MikroTik in SSH (artboard MkVlan, M15-M16; censimento §1.8): un riquadro per bridge con nome, MAC e
 * i 19 attributi, poi la matrice porte × VLAN. Senza `/interface bridge vlan` (lettura del Task 10 spenta o mai fatta) la
 * matrice è parziale: colonne dai PVID e solo la U implicita, e una riga sotto lo dice. Compare solo con almeno un bridge.
 */
import type { ReactNode } from "react";
import { LoadError } from "@/components/shared/load-error";
import { fonteLetturaScheda, matriceVlan, type MatriceVlan } from "@/lib/scheda/mikrotik";
import type { RigaBridgeMk } from "@/lib/devices/mikrotik-scheda";
import { Riquadro } from "../../../riquadro";
import { RigaFonti, type Fonte } from "../../../riga-fonti";
import type { ContestoScheda } from "../../../contesto";
import { TabellaMatriceVlan } from "../../../matrice-vlan";
import { oraMk } from "./bridge";
import { statoPortaMatrice, useInterfacceMikrotik, useSchedaMikrotik } from "./dati-mikrotik";

const siNo = (v: boolean | null): string | null => (v === null ? null : v ? "sì" : "no");

/** Le 19 voci della testata, nell'ordine del Manager; una voce senza valore non si mostra. */
function attributi(b: RigaBridgeMk, porte: number, vlan: number): { etichetta: string; valore: ReactNode }[] {
  const v: [string, ReactNode][] = [
    ["VLAN filtering", b.vlan_filtering === null ? null : b.vlan_filtering ? "✓ sì" : "✕ no"],
    ["Protocol mode", b.protocol_mode], ["PVID", b.pvid], ["Porte", porte], ["VLAN", vlan], ["MTU", b.mtu],
    ["Actual MTU", b.actual_mtu], ["L2 MTU", b.l2mtu], ["ARP", b.arp], ["ARP timeout", b.arp_timeout],
    ["Fast forward", siNo(b.fast_forward)], ["IGMP snooping", siNo(b.igmp_snooping)], ["DHCP snooping", siNo(b.dhcp_snooping)],
    ["Priorità", b.priority], ["Ageing time", b.ageing_time], ["Forward delay", b.forward_delay], ["Frame types", b.frame_types],
    ["Ingress filtering", siNo(b.ingress_filtering)], ["Ether type", b.ether_type],
  ];
  return v.filter(([, x]) => x !== null && x !== undefined && x !== "").map(([etichetta, valore]) => ({ etichetta, valore }));
}

function Matrice({ m, letturaScheda }: { m: MatriceVlan; letturaScheda: { acceso: boolean } }) {
  if (m.righe.length === 0 || m.colonne.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna VLAN o porta configurata per questo bridge.</p>;
  }
  return (
    <TabellaMatriceVlan
      m={m}
      avviso={!m.completa && (
        <p className="mt-1 text-[13px] font-semibold text-foreground">
          Tagged: serve la lettura «VLAN, DNS e utenti dei MikroTik», {letturaScheda.acceso ? "mai letta" : "spenta"}. Qui solo le VLAN dei PVID.
        </p>
      )}
    />
  );
}

export function VlanMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const { device } = ctx;
  const { stato, riprova } = useSchedaMikrotik(device?.id);
  const { stato: ifc } = useInterfacceMikrotik(device?.id);
  if (stato.fase === "carico") return <Riquadro titolo="VLAN"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>;
  if (stato.fase === "errore") return <LoadError what="i bridge" message={stato.messaggio} onRetry={riprova} />;
  const s = stato.dati;
  const interfacce = ifc.fase === "ok" ? ifc.dati.interfacce : null;
  const fonti: Fonte[] = [
    !s.letture.topologia.acceso
      ? { nome: "Bridge e porte", esito: "assente", nota: "lettura «Spanning tree, bridge e fasci» spenta" }
      : s.letto_il ? { nome: "Topologia", esito: "ok", quando: oraMk(s.letto_il) } : { nome: "Bridge e porte", esito: "assente", nota: "mai lette" },
    // Ora dei DATI (non dell'ultimo tentativo, che può essere fallito) o il codice dell'errore: revisione del Task 10.
    fonteLetturaScheda("VLAN dei bridge", s.letture.scheda, s.letture.scheda.vlan_il),
  ];

  return (
    <div className="space-y-4">
      {s.bridge.length === 0 && <Riquadro titolo="VLAN"><p className="text-sm text-muted-foreground">Nessun bridge nell&apos;ultima lettura.</p></Riquadro>}
      {s.bridge.map((b) => {
        const porte = s.porte.filter((p) => p.bridge === b.name);
        const m = matriceVlan({
          bridge: b, porte, bond: s.bond, vlanBridge: s.vlanBridge, vlan: s.vlan,
          statoPorta: (nome) => statoPortaMatrice(porte.find((p) => p.interface === nome), nome, interfacce),
        });
        const nVlan = m.colonne.length;
        return (
          <section key={b.name} className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
            <header className="border-b bg-muted/30 px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="font-mono text-lg font-bold text-[#0D2537] dark:text-foreground">{b.name}</h3>
                {b.mac_address && <span className="font-mono text-[13px] text-muted-foreground">{b.mac_address}</span>}
                {b.disabled && <span className="text-[13px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ disabilitato</span>}
                {b.comment && <span className="text-[13px] italic text-muted-foreground">{b.comment}</span>}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4 lg:grid-cols-7 xl:grid-cols-10">
                {attributi(b, porte.length, nVlan).map((a) => (
                  <div key={a.etichetta} className="min-w-0">
                    <dt className="truncate text-[13px] text-muted-foreground">{a.etichetta}</dt>
                    <dd className="truncate text-[13px] font-semibold">{a.valore}</dd>
                  </div>
                ))}
              </dl>
            </header>
            <div className="p-4">
              <h4 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-[#0D2537] dark:text-foreground">Matrice porte × VLAN</h4>
              <Matrice m={m} letturaScheda={s.letture.scheda} />
            </div>
          </section>
        );
      })}
      <RigaFonti fonti={fonti} />
    </div>
  );
}
