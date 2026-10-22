"use client";

/**
 * Tab «VLAN» dei router MikroTik in SSH (artboard MkVlan, M15-M16; censimento §1.8): un riquadro per bridge con nome, MAC e
 * i 19 attributi, poi la matrice porte × VLAN. Senza `/interface bridge vlan` (lettura del Task 10 spenta o mai fatta) la
 * matrice è parziale: colonne dai PVID e solo la U implicita, e una riga sotto lo dice. Compare solo con almeno un bridge.
 */
import type { ReactNode } from "react";
import { LoadError } from "@/components/shared/load-error";
import { descriviBond, fonteLetturaScheda, matriceVlan, type CellaVlan, type MatriceVlan } from "@/lib/scheda/mikrotik";
import type { RigaBridgeMk } from "@/lib/devices/mikrotik-scheda";
import { Riquadro } from "../../../riquadro";
import { RigaFonti, type Fonte } from "../../../riga-fonti";
import type { ContestoScheda } from "../../../contesto";
import { oraMk, StatoPorta } from "./bridge";
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

/** U pieno scuro, T bordo spesso su chiaro: si distinguono dalla lettera e dalla luminanza, mai dal solo colore. */
function Cella({ c }: { c: CellaVlan }) {
  if (c === "U") return <span className="inline-flex h-[26px] w-[30px] items-center justify-center rounded border-2 border-[#0D2537] bg-[#0D2537] text-sm font-bold text-white dark:border-sky-100 dark:bg-sky-100 dark:text-[#0D2537]">U</span>;
  if (c === "T") return <span className="inline-flex h-[26px] w-[30px] items-center justify-center rounded border-[3px] border-[#0D2537] bg-white text-sm font-bold text-[#0D2537] dark:border-sky-100 dark:bg-transparent dark:text-sky-100">T</span>;
  return null;
}

const thFisso = "whitespace-nowrap px-3 py-1.5 text-left align-bottom text-[13px] font-semibold text-muted-foreground";

function Matrice({ m, letturaScheda }: { m: MatriceVlan; letturaScheda: { acceso: boolean } }) {
  if (m.righe.length === 0 || m.colonne.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna VLAN o porta configurata per questo bridge.</p>;
  }
  return (
    <>
      <div className="-mx-4 overflow-x-auto">
        <table className="text-[13px]">
          <thead className="border-b-2 bg-muted/40">
            <tr>
              <th rowSpan={2} className={thFisso}>Interfaccia</th>
              <th rowSpan={2} className={thFisso}>Stato</th>
              <th rowSpan={2} className={thFisso}>PVID</th>
              {m.colonne.map((c) => (
                <th key={c.etichetta} className="border-l px-1 pt-1.5 text-center align-bottom text-[13px] font-semibold">
                  {/* Nome in verticale come nel Manager: la colonna resta larga quanto la cella U/T, e 12+ VLAN entrano a 1440. */}
                  <span className="mx-auto block max-h-[8rem] overflow-hidden text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] rotate-180" title={c.nome ?? undefined}>{c.nome ?? "·"}</span>
                </th>
              ))}
            </tr>
            <tr>
              {m.colonne.map((c) => (
                <th key={c.etichetta} className="border-l px-1 pb-1.5 text-center">
                  <span className="inline-block rounded border border-[#B8C4CC] bg-muted px-1.5 font-mono text-[13px] font-semibold">{c.etichetta}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.righe.map((r) => (
              <tr key={r.porta} className={`border-b ${r.stato === "attiva" ? "" : "bg-muted/30"}`}>
                <td className="whitespace-nowrap px-3 py-1">
                  <span className="font-mono font-semibold">{r.porta}</span>
                  {r.bond && <span className="ml-2 text-muted-foreground">· {descriviBond(r.bond)}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-1"><StatoPorta s={r.stato} /></td>
                <td className="whitespace-nowrap px-3 py-1">
                  {r.pvid != null ? <span className="rounded border border-[#B8C4CC] bg-muted px-1.5 font-mono font-semibold">P:{r.pvid}</span> : "—"}
                </td>
                {r.celle.map((c, k) => <td key={m.colonne[k].etichetta} className="h-[32px] border-l px-1 text-center"><Cella c={c} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Cella c="U" /> untagged</span>
        <span className="inline-flex items-center gap-1.5"><Cella c="T" /> tagged</span>
        <span>✓ attiva · ● inattiva · ✕ disabilitata</span>
        <span>U se la porta è negli untagged della VLAN o il suo PVID è quella VLAN; T se è nei tagged.</span>
      </p>
      {!m.completa && (
        <p className="mt-1 text-[13px] font-semibold text-foreground">
          Tagged: serve la lettura «VLAN, DNS e utenti dei MikroTik», {letturaScheda.acceso ? "mai letta" : "spenta"}. Qui solo le VLAN dei PVID.
        </p>
      )}
    </>
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
