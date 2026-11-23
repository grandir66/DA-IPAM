"use client";

/**
 * Colonna «Utente abituale» di Apparati (Riccardo, 23/11/2026): la cella e la finestra di scelta.
 * Gli stati si distinguono per forma, non per colore (Riccardo è daltonico): «auto» in riquadro = calcolato dagli
 * accessi; lucchetto e grassetto = scelto a mano; triangolo = il calcolo indica un'altra persona; barrato = da riassegnare.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Lock, RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SceltaAbituale, UtenteAbituale } from "@/lib/assegnatari/abituale";

/** Il testo della cella per ordinamento, filtri del tasto destro, ricerca e CSV. */
export function testoUtenteAbituale(v: UtenteAbituale | null | undefined): string {
  if (!v) return "";
  if (v.origine === "condiviso") return "condiviso";
  return v.nome ?? v.account ?? "";
}

function dettaglioCalcolo(c: NonNullable<UtenteAbituale["calcolo"]>, giorni: number | null): string {
  if (c.fonte === "ad") {
    const il = c.il ? c.il.split("-").reverse().join("/") : "data ignota";
    return `ultimo accesso scritto in AD il ${il}${c.computer ? ` (descrizione del computer ${c.computer})` : ""}`;
  }
  const base = c.base === "tastiera" ? "alla tastiera" : c.base === "rete" ? "di rete" : "";
  return `${c.accessi} accessi su ${c.totale}${giorni ? `, ultimi ${giorni} giorni` : ""}${base ? `, ${base}` : ""}`;
}

export function titoloUtenteAbituale(v: UtenteAbituale, giorni: number | null): string {
  const righe: string[] = [];
  if (v.origine === "calcolato" && v.calcolo) righe.push(`${v.calcolo.fonte === "ad" ? "Calcolato da AD" : "Calcolato dagli accessi"}: ${dettaglioCalcolo(v.calcolo, giorni)}`);
  if (v.origine === "manuale") righe.push("Scelto a mano: il ricalcolo non lo cambia");
  if (v.origine === "condiviso") righe.push(v.aMano ? "Segnato a mano come postazione condivisa" : "Condiviso: nessuna persona supera la soglia degli accessi");
  if (v.account) righe.push(`Account: ${v.account}`);
  if (v.disattivato) righe.push("Utente disattivato in AD: da riassegnare");
  if (v.diverso && v.calcolo) righe.push(`Il calcolo dice ${v.calcolo.nome} (${dettaglioCalcolo(v.calcolo, giorni)})`);
  return righe.join("\n");
}

export function CellaUtenteAbituale({ valore, giorni, onModifica }: { valore: UtenteAbituale | null | undefined; giorni: number | null; onModifica?: () => void }) {
  const contenuto = !valore ? (
    <span className="text-muted-foreground text-xs">—</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs max-w-[220px]" title={titoloUtenteAbituale(valore, giorni)}>
      {valore.aMano
        ? <Lock className="h-3 w-3 shrink-0" aria-label="scelto a mano" />
        : valore.origine === "calcolato" && <span className="shrink-0 rounded border border-dashed px-1 text-muted-foreground">auto</span>}
      {valore.origine === "condiviso" ? (
        <span className="text-muted-foreground italic">condiviso</span>
      ) : (
        <span className={`truncate ${valore.aMano ? "font-semibold" : ""} ${valore.disattivato ? "line-through" : ""}`}>{valore.nome ?? valore.account}</span>
      )}
      {valore.disattivato && <span className="shrink-0 rounded border px-1">da riassegnare</span>}
      {valore.diverso && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-label="il calcolo indica un'altra persona" />}
    </span>
  );
  if (!onModifica) return contenuto;
  return (
    <button type="button" className="min-h-8 w-full text-left rounded px-1 hover:bg-muted/60 cursor-pointer" onClick={(e) => { e.stopPropagation(); onModifica(); }}
      title={valore ? titoloUtenteAbituale(valore, giorni) : "Scegli l'utente abituale"}>
      {contenuto}
    </button>
  );
}

interface UtenteAd { account: string; nome: string; reparto: string | null }

export interface BersaglioUtenteAbituale {
  hostIds: number[];
  /** Cosa si sta cambiando, a parole («PC-MIARI», «12 host selezionati»). */
  etichetta: string;
  /** Solo con un host: il valore di adesso. */
  attuale: UtenteAbituale | null;
}

export function FinestraUtenteAbituale({ bersaglio, onChiudi, onSalvato }: { bersaglio: BersaglioUtenteAbituale | null; onChiudi: () => void; onSalvato: () => void }) {
  const [utenti, setUtenti] = useState<UtenteAd[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [salvo, setSalvo] = useState(false);
  const aperta = bersaglio !== null;

  useEffect(() => {
    if (!aperta) return;
    setCerca("");
    setErrore(null);
    void fetch("/api/hosts/utente-abituale", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json() as { utenti?: UtenteAd[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Errore nella lettura degli utenti di AD");
        setUtenti(d.utenti ?? []);
      })
      .catch((e: unknown) => setErrore(e instanceof Error ? e.message : String(e)));
  }, [aperta]);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    const tutti = utenti ?? [];
    return (q ? tutti.filter((u) => u.nome.toLowerCase().includes(q) || u.account.includes(q) || (u.reparto ?? "").toLowerCase().includes(q)) : tutti).slice(0, 200);
  }, [utenti, cerca]);

  async function salva(scelta: SceltaAbituale) {
    if (!bersaglio || salvo) return;
    setSalvo(true);
    try {
      const r = await fetch("/api/hosts/utente-abituale", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostIds: bersaglio.hostIds, scelta }),
      });
      const d = await r.json() as { scritti?: number; assetAllineati?: number; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Scelta non salvata");
      toast.success(`Utente abituale salvato su ${d.scritti} host${d.assetAllineati ? ` (${d.assetAllineati} asset NIS2 allineati)` : ""}`);
      onSalvato();
      onChiudi();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvo(false);
    }
  }

  const att = bersaglio?.attuale ?? null;
  return (
    <Dialog open={aperta} onOpenChange={(o) => { if (!o) onChiudi(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Utente abituale — {bersaglio?.etichetta}</DialogTitle>
        </DialogHeader>
        {att?.calcolo && (att.diverso || att.origine === "condiviso") && (
          <div className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">Il calcolo dice <strong>{att.calcolo.nome}</strong> ({att.calcolo.fonte === "ad" ? "ultimo accesso scritto in AD" : `${att.calcolo.accessi} accessi su ${att.calcolo.totale}`}).</span>
            <Button size="sm" variant="outline" disabled={salvo} onClick={() => void salva({ modo: "manuale", account: att.calcolo!.account })}>Usa questo</Button>
          </div>
        )}
        <Input autoFocus placeholder="Cerca per nome, account o reparto…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <div className="max-h-72 overflow-y-auto rounded border">
          {errore ? <p className="p-3 text-sm">{errore}</p>
            : utenti === null ? <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Leggo gli utenti di AD…</p>
            : filtrati.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{utenti.length === 0 ? "Nessun utente di AD: serve una sincronizzazione di Active Directory." : "Nessun utente con questo nome."}</p>
            : filtrati.map((u) => (
              <button key={u.account} type="button" disabled={salvo} onClick={() => void salva({ modo: "manuale", account: u.account })}
                className={`flex min-h-8 w-full items-center gap-2 border-b px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-muted/60 ${att?.aMano && att.account === u.account ? "font-semibold bg-muted/40" : ""}`}>
                {att?.aMano && att.account === u.account && <Lock className="h-3.5 w-3.5 shrink-0" />}
                <span className="flex-1 truncate">{u.nome}</span>
                <span className="text-xs text-muted-foreground truncate">{u.account}{u.reparto ? ` · ${u.reparto}` : ""}</span>
              </button>
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1.5" disabled={salvo} onClick={() => void salva({ modo: "condiviso" })}>
            <Users className="h-4 w-4" /> Postazione condivisa
          </Button>
          <Button variant="outline" className="gap-1.5" disabled={salvo} onClick={() => void salva({ modo: "auto" })}>
            <RotateCcw className="h-4 w-4" /> Torna al calcolo automatico
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          La scelta a mano resiste al ricalcolo. Se l&apos;host ha un asset NIS2, il suo assegnatario viene allineato; «Torna al calcolo automatico» toglie anche quello.
        </p>
      </DialogContent>
    </Dialog>
  );
}
