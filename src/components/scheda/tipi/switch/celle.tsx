"use client";

/** Pezzi di tabella condivisi fra Panoramica e Porte: stato con segno + parola, velocità, PoE, «attaccato a». */
import Link from "next/link";
import type { SwitchPort } from "@/types";
import { etichettaVelocita } from "@/lib/scheda/porte-da-guardare";
import { attaccatoA } from "./dati-porte";

export function StatoPorta({ p, trunkSegno = true }: { p: SwitchPort; trunkSegno?: boolean }) {
  if (p.status === "up") {
    return <span className="font-semibold">{p.is_trunk && trunkSegno ? "✓ trunk" : "✓ su"}</span>;
  }
  if (p.status === "disabled") return <span className="text-muted-foreground">✕ disabilitata</span>;
  return <span className="text-muted-foreground">● giù</span>;
}

export function Velocita({ p }: { p: SwitchPort }) {
  const v = etichettaVelocita(p.speed);
  const d = p.duplex && p.duplex !== "unknown" ? p.duplex : null;
  if (!v && !d) return <span className="text-muted-foreground">—</span>;
  return <span className={d === "half" ? "font-semibold" : undefined}>{[v, d].filter(Boolean).join(" · ")}</span>;
}

export function PoePorta({ p }: { p: SwitchPort }) {
  if (p.poe_status === "delivering") {
    return <span className="font-semibold">{p.poe_power_mw ? `${(p.poe_power_mw / 1000).toFixed(1).replace(".", ",")} W` : "eroga"}</span>;
  }
  return <span className="text-muted-foreground">{p.poe_status ? p.poe_status : "—"}</span>;
}

export function AttaccatoCella({ p }: { p: SwitchPort }) {
  const a = attaccatoA(p);
  return (
    <span className="inline-flex flex-col">
      {a.hostId ? (
        <Link href={`/objects/${a.hostId}`} className="font-medium text-[#006C96] underline-offset-2 hover:underline dark:text-sky-300">{a.testo}</Link>
      ) : (
        <span className={a.testo === "—" || a.testo === "nessun MAC" ? "text-muted-foreground" : undefined}>{a.testo}</span>
      )}
      {a.dettaglio && <span className="text-[13px] text-muted-foreground">{a.dettaglio}</span>}
    </span>
  );
}

/** Quali colonne hanno almeno un dato: le altre non si rendono (es. ProCurve senza duplex né PoE). */
export function colonneConDato(porte: SwitchPort[]) {
  return {
    velocita: porte.some((p) => !!p.speed || (!!p.duplex && p.duplex !== "unknown")),
    vlan: porte.some((p) => p.vlan != null),
    poe: porte.some((p) => !!p.poe_status),
    stp: porte.some((p) => !!p.stp_state),
  };
}
