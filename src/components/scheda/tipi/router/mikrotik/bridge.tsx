"use client";

/**
 * Tab «Bridge» dei router MikroTik in SSH (artboard MkBridge, M17-M18; censimento §1.9): striscia di tre caselle (porte,
 * bond, HW offload) e la tabella «Porte del bridge e spanning tree» con il ruolo STP dell'ultima lettura della topologia.
 * Compare solo se l'ultima fotografia ha almeno un bridge (Task 6). Dati: GET /api/devices/[id]/mikrotik-scheda.
 */
import { LoadError } from "@/components/shared/load-error";
import { descriviBond, statoPortaBridge } from "@/lib/scheda/mikrotik";
import type { RigaBondMk, RigaPortaSchedaMk } from "@/lib/devices/mikrotik-scheda";
import { parseUtcDate } from "../../../blocchi";
import { Riquadro } from "../../../riquadro";
import { RigaFonti, type Fonte } from "../../../riga-fonti";
import { StrisciaNumeri, type Casella } from "../../../striscia-numeri";
import type { ContestoScheda } from "../../../contesto";
import { useSchedaMikrotik } from "./dati-mikrotik";

const th = "whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";
const td = "whitespace-nowrap px-3 py-1.5";

export const oraMk = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

/** ● sì / ○ no (segno e parola: si legge anche senza colori); non letto → «—». */
export function SiNo({ v }: { v: boolean | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  return v ? <span className="font-semibold">● sì</span> : <span className="text-muted-foreground">○ no</span>;
}

// Spostato in `scheda/matrice-vlan.tsx` (Task 10), riesportato per chi lo importa da qui.
import { StatoPorta } from "../../../matrice-vlan";
export { StatoPorta };

/** «yes»/«no» di RouterOS in italiano; «auto» e gli altri valori come sono. */
const parola = (v: string | null): string => (v === "yes" ? "sì" : v === "no" ? "no" : v ?? "—");

const ruoloStp = (p: RigaPortaSchedaMk): string => [p.stp_ruolo, p.stp_stato].filter(Boolean).join(" · ") || "—";

function caselle(porte: RigaPortaSchedaMk[], nBridge: number, bond: RigaBondMk[]): Casella[] {
  const c: Casella[] = [{ etichetta: "Porte", valore: String(porte.length), sotto: `su ${nBridge} bridge` }];
  if (bond.length > 0) {
    c.push({ etichetta: "Bond", valore: String(bond.length), sotto: bond.length === 1 ? [bond[0].name, bond[0].mode].filter(Boolean).join(" · ") : bond.map((b) => b.name).join(", ") });
  }
  if (porte.some((p) => p.hw !== null)) c.push({ etichetta: "HW offload", valore: String(porte.filter((p) => p.hw === true).length), sotto: "porte con hw=yes" });
  return c;
}

export function BridgeMikrotik({ ctx }: { ctx: ContestoScheda }) {
  const { device, apriTab } = ctx;
  const { stato, riprova } = useSchedaMikrotik(device?.id);
  if (stato.fase === "carico") return <Riquadro titolo="Porte del bridge e spanning tree"><p className="text-sm text-muted-foreground">Caricamento…</p></Riquadro>;
  if (stato.fase === "errore") return <LoadError what="i bridge" message={stato.messaggio} onRetry={riprova} />;
  const { porte, bridge, bond, letto_il, letture } = stato.dati;
  const bondPer = new Map(bond.map((b) => [b.name, b]));
  const fonti: Fonte[] = [
    !letture.topologia.acceso
      ? { nome: "Bridge e porte", esito: "assente", nota: "lettura «Spanning tree, bridge e fasci» spenta" }
      : letto_il ? { nome: "Topologia", esito: "ok", quando: oraMk(letto_il) } : { nome: "Bridge e porte", esito: "assente", nota: "mai lette" },
  ];

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle(porte, bridge.length, bond)} onApriTab={apriTab} />
      <Riquadro titolo="Porte del bridge e spanning tree">
        {porte.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessuna porta nei bridge dell&apos;ultima lettura.</p>
        ) : (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b-2 bg-muted/40">
                <tr>
                  <th className={th}>Interfaccia</th><th className={th}>Bridge</th><th className={th}>Stato</th><th className={th}>PVID</th>
                  <th className={th}>Priorità</th><th className={th}>Path cost</th><th className={th}>Edge</th><th className={th}>P2P</th>
                  <th className={th}>HW</th><th className={th}>Frame types</th><th className={th}>Ingress</th><th className={th}>BPDU guard</th>
                  <th className={th}>Ruolo STP</th>
                </tr>
              </thead>
              <tbody>
                {porte.map((p) => {
                  const b = bondPer.get(p.interface);
                  const s = statoPortaBridge(p);
                  return (
                    <tr key={`${p.bridge}/${p.interface}`} className={`border-b align-top ${s === "attiva" ? "" : "bg-muted/30"}`}>
                      <td className="px-3 py-1.5">
                        <span className="font-mono font-semibold">{p.interface}</span>
                        {b && <span className="ml-2 rounded border border-[#0D2537] px-1 text-[13px] font-semibold dark:border-sky-200">bond</span>}
                        {b && <div className="text-[13px] text-muted-foreground">{descriviBond(b)}</div>}
                        {p.comment && <div className="text-[13px] italic text-muted-foreground">{p.comment}</div>}
                      </td>
                      <td className={`${td} font-mono`}>{p.bridge}</td>
                      <td className={td}>
                        <StatoPorta s={s} />
                        {p.hw_offload && <span className="ml-1.5 rounded bg-[#0D2537] px-1 text-[13px] font-bold text-white dark:bg-sky-200 dark:text-[#0D2537]">HW</span>}
                      </td>
                      <td className={`${td} font-mono`}>{p.pvid ?? "—"}</td>
                      <td className={`${td} font-mono`}>{p.priority ?? "—"}</td>
                      <td className={td}>{p.path_cost ?? "—"}</td>
                      <td className={td}>{parola(p.edge)}</td>
                      <td className={td}>{parola(p.point_to_point)}</td>
                      <td className={td}><SiNo v={p.hw} /></td>
                      <td className={td}>{p.frame_types ?? "—"}</td>
                      <td className={td}><SiNo v={p.ingress_filtering} /></td>
                      <td className={td}><SiNo v={p.bpdu_guard} /></td>
                      <td className={td}>{ruoloStp(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {porte.length > 0 && (
          <p className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
            <span>Stato: ✓ attiva · ● inattiva · ✕ disabilitata</span>
            <span>Indicatori: ● sì · ○ no</span>
            <span><b className="rounded bg-[#0D2537] px-1 text-white dark:bg-sky-200 dark:text-[#0D2537]">HW</b> offload hardware attivo</span>
            <span>bond = interfaccia LAG</span>
            <span>Ruolo STP dall&apos;ultima lettura della topologia</span>
          </p>
        )}
      </Riquadro>
      <RigaFonti fonti={fonti} />
    </div>
  );
}
