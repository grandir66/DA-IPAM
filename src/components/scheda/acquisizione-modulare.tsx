"use client";

/**
 * Carica il riquadro «Acquisizione modulare (anteprima)» (GET /api/devices/[id]/acquisizione) e la finestra del caso
 * dubbio (PUT .../acquisizione/fonte, solo admin; tavola C1, oggetto 15 corretto dalla decisione 4: si apre solo quando
 * serve una scelta). Errore di caricamento = `LoadError`, mai un riquadro vuoto.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { Riquadro } from "./riquadro";
import { VistaAcquisizioneModulare, type StatoAcquisizione } from "./acquisizione-modulare-vista";

export function FinestraFonte({ aperta, onChiudi, possibili, attuale, nomeApparato, onSalva }: {
  aperta: boolean;
  onChiudi: () => void;
  possibili: string[];
  attuale: string | null;
  nomeApparato: string;
  onSalva: (scelta: string) => Promise<void>;
}) {
  const [scelta, setScelta] = useState<string | null>(attuale);
  const [salvo, setSalvo] = useState(false);
  useEffect(() => { if (aperta) setScelta(attuale); }, [aperta, attuale]);
  const voci = [...possibili.map((p) => ({ valore: p, nome: p, nota: "collector del catalogo", mono: true })), { valore: "classica", nome: "Acquisizione di sempre", nota: "come prima dei collector", mono: false }];
  return (
    <Dialog open={aperta} onOpenChange={(o) => { if (!o && !salvo) onChiudi(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scegli la fonte — {nomeApparato}</DialogTitle>
          <DialogDescription>
            Il prodotto riconosciuto non basta a decidere. Le credenziali restano quelle già assegnate all&apos;apparato: nessuna credenziale nuova, nessuna ricerca.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="sr-only">Fonte dell&apos;acquisizione</legend>
          {voci.map((v) => (
            <label key={v.valore} className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-[#0D2537] has-[:checked]:bg-muted/40">
              <input type="radio" name="fonte" value={v.valore} checked={scelta === v.valore} onChange={() => setScelta(v.valore)} />
              <span className={`font-semibold ${v.mono ? "font-mono" : ""}`}>{v.nome}</span>
              <span className="text-muted-foreground">{v.nota}</span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={onChiudi} disabled={salvo}>Annulla</Button>
          <Button disabled={!scelta || salvo} onClick={async () => { if (!scelta) return; setSalvo(true); try { await onSalva(scelta); } finally { setSalvo(false); } }}>
            Salva la fonte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RiquadroAcquisizioneModulare({ deviceId, nomeApparato, isAdmin }: { deviceId: number; nomeApparato: string; isAdmin: boolean }) {
  const [stato, setStato] = useState<StatoAcquisizione | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [vista, setVista] = useState<{ snapshot: number | null; pagina: number }>({ snapshot: null, pagina: 1 });
  const [finestra, setFinestra] = useState(false);

  const carica = useCallback(async () => {
    const q = new URLSearchParams({ pagina: String(vista.pagina) });
    if (vista.snapshot !== null) q.set("snapshot", String(vista.snapshot));
    const r = await fetchJson<StatoAcquisizione>(`/api/devices/${deviceId}/acquisizione?${q}`, { cache: "no-store" });
    if (!r.ok) { setErrore(r.message); return; }
    setErrore(null);
    setStato(r.data);
  }, [deviceId, vista]);

  useEffect(() => { void carica(); }, [carica]);

  const salvaFonte = async (scelta: string) => {
    const r = await fetchJson<{ ok: boolean }>(`/api/devices/${deviceId}/acquisizione/fonte`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scelta }),
    });
    if (!r.ok) { toast.error(`Errore: ${r.message}`); return; }
    toast.success(scelta === "classica" ? "Si userà l'acquisizione di sempre" : `Fonte salvata: ${scelta}`);
    setFinestra(false);
    await carica();
  };

  return (
    <div className="rounded-xl ring-2 ring-[#00A7E7]/70">
      <Riquadro titolo="Acquisizione modulare (anteprima)">
        {errore ? (
          <LoadError what="l'acquisizione modulare" message={errore} onRetry={() => void carica()} />
        ) : !stato ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <>
            <VistaAcquisizioneModulare
              stato={stato}
              isAdmin={isAdmin}
              onVedi={(id) => setVista((v) => ({ ...v, snapshot: id }))}
              onPagina={(n) => setVista({ snapshot: null, pagina: n })}
              onScegliFonte={() => setFinestra(true)}
              urlScarica={(id) => `/api/devices/${deviceId}/acquisizione/snapshot/${id}/scarica`}
            />
            {isAdmin && (
              <FinestraFonte aperta={finestra} onChiudi={() => setFinestra(false)} possibili={stato.fonte.possibili}
                attuale={stato.fonte.scelta} nomeApparato={nomeApparato} onSalva={salvaFonte} />
            )}
          </>
        )}
      </Riquadro>
    </div>
  );
}
