"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Installazione «tecnico» (ADR 0037, piano 2026-11-08, Task 5; proposta approvata da Riccardo
 * l'08/11, «Sì, tutta»). Il tipo d'installazione lo legge il layout dal server (`isTecnico()`)
 * e lo passa qui: i componenti del browser non vedono le variabili del servizio.
 *
 * - `SelettoreProfilo`: in cima alla barra, cambia profilo con un clic.
 * - `FasciaProfilo`: in cima a ogni pagina, dice su quale cliente si scrive.
 * Fuori dal tipo «tecnico» non compaiono: barra e pagine restano come oggi.
 */

const VISTA_TUTTE = "__ALL__";
/** Oltre questo numero di profili l'elenco ha la casella di ricerca. */
const SOGLIA_RICERCA = 8;

const ContestoTecnico = createContext(false);

export function ProfiloInstallazioneProvider({ tecnico, children }: { tecnico: boolean; children: ReactNode }) {
  return <ContestoTecnico.Provider value={tecnico}>{children}</ContestoTecnico.Provider>;
}

export function useTecnico(): boolean {
  return useContext(ContestoTecnico);
}

interface ProfiloSessione {
  code: string;
  name: string;
}

function useProfili() {
  const { data: session, update } = useSession();
  const u = session?.user as Record<string, unknown> | undefined;
  const profili = (u?.tenants ?? []) as ProfiloSessione[];
  const corrente = (u?.tenantCode as string | null | undefined) ?? null;
  const isSuperadmin = u?.role === "superadmin";
  const attuale = profili.find((p) => p.code === corrente) ?? null;
  return { profili, corrente, attuale, isSuperadmin, update };
}

/** Cambia profilo e lo dice; l'hub rifiuta un profilo non ammesso e lascia quello di prima. */
function useCambiaProfilo() {
  const { corrente, update } = useProfili();
  const router = useRouter();
  const [cambio, setCambio] = useState(false);
  async function cambia(codice: string, nome: string): Promise<boolean> {
    if (codice === corrente) return true;
    setCambio(true);
    try {
      const nuova = await update({ tenantCode: codice });
      const ottenuto = (nuova?.user as Record<string, unknown> | undefined)?.tenantCode;
      if (ottenuto !== codice) {
        toast.error("Profilo non disponibile per il tuo utente");
        return false;
      }
      toast.success(codice === VISTA_TUTTE ? "Ora vedi tutti i profili, in sola lettura" : `Ora lavori su ${nome}`);
      router.refresh();
      return true;
    } finally {
      setCambio(false);
    }
  }
  return { cambia, cambio };
}

export { useCambiaProfilo };

/** Selettore del profilo, in cima alla barra al posto della riga «Istanza». */
export function SelettoreProfilo({ compresso = false, onNavigate }: { compresso?: boolean; onNavigate?: () => void }) {
  const { profili, corrente, attuale, isSuperadmin, update } = useProfili();
  const { cambia, cambio } = useCambiaProfilo();
  const [aperto, setAperto] = useState(false);
  const [cerca, setCerca] = useState("");
  const contenitore = useRef<HTMLDivElement>(null);

  // Chiusura col clic fuori e con Esc, con pulizia degli ascoltatori (regola 8).
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (contenitore.current && !contenitore.current.contains(e.target as Node)) setAperto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAperto(false); };
    document.addEventListener("mousedown", fuori);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuori);
      document.removeEventListener("keydown", esc);
    };
  }, [aperto]);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    if (!q) return profili;
    return profili.filter((p) => p.name.toLowerCase().includes(q) || p.code.includes(q));
  }, [profili, cerca]);

  const nome = corrente === VISTA_TUTTE ? "Tutti i profili" : attuale?.name ?? "Nessun profilo scelto";
  const codice = corrente === VISTA_TUTTE ? "sola lettura" : attuale?.code ?? "scegline uno";

  async function scegli(codiceScelto: string, nomeScelto: string) {
    const ok = await cambia(codiceScelto, nomeScelto);
    if (ok) {
      setAperto(false);
      setCerca("");
      onNavigate?.();
    }
  }

  return (
    <div ref={contenitore} className="relative mt-1">
      <button
        type="button"
        onClick={() => {
          // All'apertura l'hub ricarica l'elenco dei profili (callback jwt): un profilo creato
          // da un'altra scheda compare senza uscire e rientrare.
          if (!aperto && corrente) void update({ tenantCode: corrente });
          setAperto((v) => !v);
        }}
        disabled={cambio}
        aria-haspopup="listbox"
        aria-expanded={aperto}
        title={compresso ? `Profilo: ${nome} · ${codice}` : "Cambia profilo cliente"}
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-left text-sidebar-foreground transition-colors hover:bg-primary/20 disabled:opacity-60",
          compresso && "md:justify-center md:px-0",
        )}
      >
        <Building2 className="h-4 w-4 shrink-0" />
        <span className={cn("min-w-0 flex-1", compresso && "md:hidden")}>
          <span className="block truncate text-sm font-bold">{nome}</span>
          <span className="block truncate font-mono text-[13px] text-sidebar-foreground/70">{codice}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", aperto && "rotate-180", compresso && "md:hidden")} />
      </button>

      {aperto && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full min-w-64 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
            compresso && "md:left-full md:top-0 md:mt-0 md:ml-2",
          )}
        >
          {profili.length > SOGLIA_RICERCA && (
            <label className="mb-1 flex items-center gap-2 rounded-md border px-2 py-1.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                placeholder="Cerca cliente o codice"
                className="w-full bg-transparent text-sm outline-none"
              />
            </label>
          )}
          <ul role="listbox" aria-label="Profili cliente" className="max-h-80 overflow-y-auto">
            {filtrati.map((p) => {
              const scelto = p.code === corrente;
              return (
                <li key={p.code} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={scelto}
                    aria-label={`${p.name} · ${p.code}`}
                    onClick={() => scegli(p.code, p.name)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left hover:bg-muted",
                      scelto ? "border-primary bg-selezione" : "border-transparent",
                    )}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{scelto && <Check className="h-4 w-4" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", scelto && "font-bold")}>{p.name}</span>
                      <span className="block font-mono text-[13px] text-muted-foreground">{p.code}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filtrati.length === 0 && (
              <li className="px-2 py-2 text-[13px] text-muted-foreground">
                {profili.length === 0 ? "Nessun profilo: creane uno da «Gestisci profili»." : "Nessun profilo corrisponde."}
              </li>
            )}
          </ul>
          <div className="mt-1 border-t pt-1">
            {isSuperadmin && (
              <button
                type="button"
                onClick={() => scegli(VISTA_TUTTE, "Tutti i profili")}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                  corrente === VISTA_TUTTE ? "border-primary bg-selezione font-bold" : "border-transparent",
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{corrente === VISTA_TUTTE && <Check className="h-4 w-4" />}</span>
                Tutti i profili (sola lettura)
              </button>
            )}
            {isSuperadmin && (
              <Link
                href="/tenants"
                onClick={() => { setAperto(false); onNavigate?.(); }}
                className="block rounded-md px-2 py-1.5 text-[13px] font-medium text-cian-testo hover:bg-muted"
              >
                Gestisci profili →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fascia in cima a ogni pagina: su quale cliente si sta scrivendo. Navy col profilo scelto;
 * gialla piena col segno ▲ per la vista di tutti i profili o se manca la scelta (si distingue
 * per luminanza e segno, non solo per tinta: Riccardo è daltonico).
 */
export function FasciaProfilo() {
  const { corrente, attuale } = useProfili();
  if (corrente && corrente !== VISTA_TUTTE && attuale) {
    return (
      <div className="sticky top-0 z-30 flex h-8 shrink-0 items-center gap-2 bg-[#0D2537] pl-14 pr-4 text-[13px] text-white md:px-4">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Profilo: <strong>{attuale.name}</strong> · <span className="font-mono">{attuale.code}</span>
        </span>
      </div>
    );
  }
  const testo = corrente === VISTA_TUTTE
    ? "Vista di tutti i profili: sola lettura"
    : "Nessun profilo scelto: sceglilo in cima alla barra";
  return (
    <div className="sticky top-0 z-30 flex h-8 shrink-0 items-center gap-2 border-b border-[#C9A800] bg-[#FFD400] pl-14 pr-4 text-[13px] font-semibold text-[#0D2537] md:px-4">
      <span aria-hidden>▲</span>
      <span className="truncate">{testo}</span>
    </div>
  );
}
