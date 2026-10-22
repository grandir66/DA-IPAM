"use client";
/**
 * Cella IP di Discovery con gli IP accorpati (piano 2026-10-22, Task 5; artboard Discovery A2-A4).
 * «+N IP» sulla riga principale apre l'elenco degli altri IP dello stesso device fisico (IP, rete, stato con
 * segno + parola, «apri ›»). Niente colonna nuova: sta dentro la cella IP.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import type { InfoClusterDiscovery } from "@/lib/devices/cluster-discovery";

// Stessi segni e parole della testata di Discovery.
const STATO: Record<string, string> = { online: "● online", offline: "○ offline" };

export function BadgeAltriIp({ cluster, nome }: { cluster: InfoClusterDiscovery; nome: string }) {
  const [aperto, setAperto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const n = cluster.altri.length;

  useEffect(() => {
    if (!aperto) return;
    const chiudi = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && (box.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setAperto(false);
    };
    document.addEventListener("mousedown", chiudi);
    document.addEventListener("keydown", chiudi);
    window.addEventListener("scroll", chiudi, true);
    return () => {
      document.removeEventListener("mousedown", chiudi);
      document.removeEventListener("keydown", chiudi);
      window.removeEventListener("scroll", chiudi, true);
    };
  }, [aperto]);

  function apri() {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 440)) });
    setAperto((v) => !v);
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={apri}
        aria-expanded={aperto}
        title="Altri IP dello stesso device fisico: non hanno una riga propria"
        className={cn("inline-flex h-6 items-center rounded-md border-2 px-2 text-[13px] font-semibold leading-none", STILE_STATO.da_verificare.classi)}
      >
        +{n} IP
      </button>
      {aperto && pos && (
        <div
          ref={box}
          role="dialog"
          aria-label={`Altri IP di ${nome}`}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-[420px] rounded-lg border-2 border-[#0D2537] bg-popover p-3 text-popover-foreground shadow-xl"
        >
          <div className="flex items-center gap-2">
            <b className="text-sm">Altri IP di {nome}</b>
            <button type="button" onClick={() => setAperto(false)} aria-label="Chiudi" className="ml-auto rounded-md border px-2 py-0.5">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-1 text-[13px] text-muted-foreground">stesso device fisico · non compaiono come righe proprie</p>
          <ul>
            {cluster.altri.map((a) => (
              <li key={a.host_id} className="grid grid-cols-[130px_minmax(0,1fr)_auto] items-center gap-2 border-b py-1.5 text-[13px] last:border-b-0">
                <span className="font-mono">{a.ip}</span>
                <span className="truncate text-muted-foreground">
                  {a.network_name} · {STATO[a.status] ?? "? n.d."}
                </span>
                <Link href={`/objects/${a.host_id}`} className="font-semibold text-primary hover:underline">apri ›</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
