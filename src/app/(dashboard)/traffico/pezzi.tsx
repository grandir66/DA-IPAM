import Link from "next/link";
import { cn } from "@/lib/utils";
import { GRAVITA } from "@/lib/traffico/frasi";
import type { NomeDiIp } from "@/lib/traffico/quadro";

/** Fondo pieno e segno diversi per livello: si distingue per forma e luminosità, non per tinta. */
export const CLASSE_GRAVITA: Record<number, string> = {
  1: "border-border bg-muted text-foreground",
  2: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]",
  3: "border-[#8E1B20] bg-[#8E1B20] text-white",
};

export function SegnoGravita({ gravita }: { gravita: number }) {
  const g = GRAVITA[gravita] ?? GRAVITA[1];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", CLASSE_GRAVITA[gravita] ?? CLASSE_GRAVITA[1])}>
      <span aria-hidden>{g.segno}</span>
      {g.testo}
    </span>
  );
}

/** Un capo della conversazione: nome dell'host (col collegamento alla scheda) e IP; «esterno» e «diffusione» a parole. */
export function Indirizzo({ ip, nomi }: { ip: string; nomi: Record<string, NomeDiIp> }) {
  if (!ip) return <span className="text-muted-foreground">—</span>;
  if (ip === "esterno") return <span>fuori dalla rete</span>;
  if (ip === "diffusione") return <span>a tutti (diffusione)</span>;
  const h = nomi[ip];
  if (!h) return <span className="font-mono font-semibold">{ip}</span>;
  return (
    <Link href={`/objects/${h.id}`} className="block underline-offset-2 hover:underline">
      {h.nome && <span className="block font-semibold text-cian-testo">{h.nome}</span>}
      <span className={cn("font-mono", h.nome ? "text-[13px] text-muted-foreground" : "font-semibold text-cian-testo")}>{ip}</span>
    </Link>
  );
}
