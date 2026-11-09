"use client";

/**
 * Triage di un rilievo in riga (09/11/2026, dall'engagement di Nety): badge dello stato +,
 * quando lo si apre, i pochi stati da scegliere e una nota «cosa ho provato, cosa ho trovato».
 * Gli stati sono quattro, coi segni di `STILE_STATO` (Riccardo è daltonico: segno + colore).
 * Scrive su `/api/triage`; il badge compatto si usa anche da solo, in sola lettura.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { STATI_TRIAGE, type StatoTriage } from "@/lib/triage/db";
import { cn } from "@/lib/utils";

export const TRIAGE_UI: Record<StatoTriage, { parola: string; tono: ToniStato }> = {
  da_fare: { parola: "Da rivedere", tono: "da_verificare" },
  in_corso: { parola: "In corso", tono: "attenzione" },
  fatto: { parola: "Rivisto", tono: "ok" },
  ignorato: { parola: "Ignorato", tono: "grigio" },
};

/** Badge compatto dello stato: segno + parola, colore di `STILE_STATO`. */
export function BadgeTriage({ stato, className }: { stato: StatoTriage; className?: string }) {
  const u = TRIAGE_UI[stato];
  const s = STILE_STATO[u.tono];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold leading-none whitespace-nowrap", s.classi, className)}>
      <span aria-hidden>{s.segno}</span>
      {u.parola}
    </span>
  );
}

function quando(s: string | null): string {
  if (!s) return "";
  const d = parseDbDate(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export interface TriageIniziale {
  stato: StatoTriage;
  nota: string;
  aggiornato_il: string | null;
  aggiornato_da: string | null;
}

/**
 * Editor del triage (nel dettaglio della riga). `admin` falso = sola lettura. `onCambio` tiene
 * aggiornata la lista senza ricaricare. Scrive al cambio di stato e al salvataggio della nota.
 */
export function EditorTriage({
  chiave,
  iniziale,
  admin,
  onCambio,
}: {
  chiave: string;
  iniziale?: TriageIniziale;
  admin: boolean;
  onCambio?: (t: { stato: StatoTriage; nota: string }) => void;
}) {
  const [stato, setStato] = useState<StatoTriage>(iniziale?.stato ?? "da_fare");
  const [nota, setNota] = useState(iniziale?.nota ?? "");
  const [notaSalvata, setNotaSalvata] = useState(iniziale?.nota ?? "");
  const [meta, setMeta] = useState<{ il: string | null; da: string | null }>({ il: iniziale?.aggiornato_il ?? null, da: iniziale?.aggiornato_da ?? null });
  const [salvando, setSalvando] = useState(false);

  async function salva(nuovoStato: StatoTriage, nuovaNota: string) {
    setSalvando(true);
    const r = await fetchJson<{ ok: boolean }>("/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chiave, stato: nuovoStato, nota: nuovaNota }),
    });
    setSalvando(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setNotaSalvata(nuovaNota);
    setMeta({ il: new Date().toISOString(), da: meta.da });
    onCambio?.({ stato: nuovoStato, nota: nuovaNota });
  }

  if (!admin) {
    return (
      <div className="space-y-1 text-[13px]">
        <div className="flex items-center gap-2">
          <BadgeTriage stato={stato} />
          {meta.il && <span className="text-muted-foreground">{quando(meta.il)}{meta.da ? ` · ${meta.da}` : ""}</span>}
        </div>
        {notaSalvata && <p className="whitespace-pre-wrap text-muted-foreground">{notaSalvata}</p>}
      </div>
    );
  }

  const notaCambiata = nota.trim() !== notaSalvata.trim();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATI_TRIAGE.map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={s === stato ? "default" : "outline"}
            disabled={salvando}
            onClick={() => {
              setStato(s);
              void salva(s, nota);
            }}
          >
            <span aria-hidden className="mr-1">{STILE_STATO[TRIAGE_UI[s].tono].segno}</span>
            {TRIAGE_UI[s].parola}
          </Button>
        ))}
        {meta.il && <span className="text-[13px] text-muted-foreground">{quando(meta.il)}{meta.da ? ` · ${meta.da}` : ""}</span>}
      </div>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Cosa hai provato, cosa hai trovato"
        rows={2}
        className="w-full resize-y rounded-lg border bg-card p-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {notaCambiata && (
        <Button type="button" size="sm" disabled={salvando} onClick={() => void salva(stato, nota)}>
          Salva la nota
        </Button>
      )}
    </div>
  );
}
