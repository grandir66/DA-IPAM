"use client";

/**
 * Pulsante «Importa estrazione» del riquadro Acquisizione (Riccardo, 09/11/2026, oggetti 1-5 approvati: «Sì, scrivila»).
 * Sceglie un file `.json` (busta `da-ipam-estrazione` 1.0 del PC del tecnico) e lo manda a
 * POST /api/devices/[id]/acquisizione/importa. Esito: avviso e riquadro ricaricato; apparato diverso (409) o file non
 * conforme (422) restano scritti nel riquadro, senza un modo per forzare l'import.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";

export type EsitoImportVisto = { tipo: "diverso" | "non_valido" | "errore"; testo: string; dettagli: string[] } | null;

interface RispostaImport {
  ok?: boolean;
  error?: string;
  dettagli?: string[];
  applicazione?: { scritte: number };
  rotte?: number | null;
}

export function PulsanteImportaEstrazione({ deviceId, onFatto, onEsito }: { deviceId: number; onFatto: () => Promise<void> | void; onEsito: (e: EsitoImportVisto) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [invio, setInvio] = useState(false);

  async function manda(file: File) {
    setInvio(true);
    onEsito(null);
    try {
      const r = await fetch(`/api/devices/${deviceId}/acquisizione/importa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      let d: RispostaImport = {};
      try { d = (await r.json()) as RispostaImport; } catch { /* risposta senza JSON: resta il codice HTTP */ }
      if (r.ok && d.ok) {
        const rotte = d.rotte != null ? `, ${d.rotte} rotte` : "";
        toast.success(`Estrazione importata: ${d.applicazione?.scritte ?? 0} modifiche${rotte}`);
        await onFatto();
        return;
      }
      const testo = d.error ?? `Errore ${r.status}`;
      onEsito({ tipo: r.status === 409 ? "diverso" : r.status === 422 || r.status === 400 ? "non_valido" : "errore", testo, dettagli: (d.dettagli ?? []).slice(0, 10) });
    } catch {
      onEsito({ tipo: "errore", testo: "Errore: invio non riuscito, controlla la connessione e riprova", dettagli: [] });
    } finally {
      setInvio(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void manda(f); }} />
      <Button variant="outline" size="sm" disabled={invio} onClick={() => input.current?.click()}>
        <FileUp />
        {invio ? "Importo…" : "Importa estrazione"}
      </Button>
    </>
  );
}

/** Esito non riuscito, dentro il riquadro: segno e fondo pieno (Riccardo è daltonico), primi errori in elenco. */
export function EsitoImportEstrazione({ esito, onChiudi }: { esito: NonNullable<EsitoImportVisto>; onChiudi: () => void }) {
  const stile = esito.tipo === "diverso" ? STILE_STATO.attenzione : STILE_STATO.guasto;
  const titolo = esito.tipo === "diverso" ? "Apparato diverso" : esito.tipo === "non_valido" ? "Estrazione non valida" : "Import non riuscito";
  return (
    <div className="mb-4 rounded-lg border">
      <div className={`flex items-center justify-between gap-2 rounded-t-lg border-b px-3 py-2 text-[13px] font-semibold ${stile.classi}`}>
        <span><span aria-hidden>{stile.segno}</span> {titolo}</span>
        <button type="button" onClick={onChiudi} className="underline">Chiudi</button>
      </div>
      <div className="space-y-2 px-3 py-2 text-sm">
        <p>{esito.testo}</p>
        {esito.dettagli.length > 0 && (
          <ul className="space-y-0.5 font-mono text-[13px] text-muted-foreground">
            {esito.dettagli.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
