"use client";

/** Pezzi di tabella condivisi fra Panoramica e Interfacce: stato con segno + parola, indirizzi, velocità, stato della rotta. */
import type { InterfacciaScheda } from "@/lib/scheda/router";

export function StatoInterfaccia({ stato }: { stato: InterfacciaScheda["stato"] }) {
  if (stato === "up") return <span className="font-semibold">✓ su</span>;
  if (stato === "down") return <span className="text-muted-foreground">● giù</span>;
  return <span className="text-muted-foreground">● non noto</span>;
}

export const indirizzoTesto = (a: InterfacciaScheda["indirizzi"][number]): string => (a.prefisso != null ? `${a.ip}/${a.prefisso}` : a.ip);

/** Gli indirizzi, uno per riga (o solo il primo IPv4 con `breve`). */
export function IndirizziCella({ i, breve = false }: { i: InterfacciaScheda; breve?: boolean }) {
  if (i.indirizzi.length === 0) return <span className="text-muted-foreground">—</span>;
  const lista = breve ? [i.indirizzi.find((a) => a.famiglia === 4) ?? i.indirizzi[0]] : i.indirizzi;
  return (
    <span className="inline-flex flex-col font-mono">
      {lista.map((a) => <span key={a.ip}>{indirizzoTesto(a)}</span>)}
      {breve && i.indirizzi.length > 1 && <span className="font-sans text-[13px] text-muted-foreground">+{i.indirizzi.length - 1}</span>}
    </span>
  );
}

/** 10000 → «10G», 1000 → «1G», 100 → «100M»; null se non noto. */
export function velocitaTesto(mbps: number | null): string | null {
  if (mbps == null || mbps <= 0) return null;
  if (mbps >= 1000 && mbps % 1000 === 0) return `${mbps / 1000}G`;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1).replace(".", ",")}G`;
  return `${mbps}M`;
}

export function StatoRotta({ attiva }: { attiva: boolean }) {
  return attiva ? <span className="font-semibold">✓ attiva</span> : <span className="text-muted-foreground">● inattiva</span>;
}
