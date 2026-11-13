"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, EyeOff, GripVertical, Minus, MoveHorizontal, MoveVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pannello } from "@/components/shared/console";
import {
  ALTEZZA_MAX, ALTEZZA_MIN, LARGHEZZE, RIGA_PX, allarga, alza, disposizionePredefinita, sposta, spostaPrima,
  type RiquadroCasa, type VoceDisposizione,
} from "@/lib/cliente/casa";

export interface ContenutoRiquadro {
  id: string;
  titolo: string;
  azioni: ReactNode;
  /** null = oggi per questo cliente non c'è niente da mostrare. */
  contenuto: ReactNode | null;
  /** Senza cornice né titolo fuori dalla modifica: per le fasce alte una riga (i numeri e la sicurezza). */
  nudo?: boolean;
}

/**
 * La griglia dei riquadri della casa, sul modello della home di Entra: 12 colonne, righe di altezza
 * fissa, ogni riquadro largo e alto un certo numero di celle e pieno fino ai bordi.
 *
 * Con `modifica` (solo amministratore) ogni riquadro si trascina sopra un altro per cambiargli posto,
 * si allarga e si alza a scatti, si nasconde; i nascosti stanno nel cassetto in fondo e si rimettono
 * da lì. La griglia dispone da sola i riquadri nell'ordine dato e riempie i buchi: due riquadri non
 * si sovrappongono mai, quindi non c'è un «lì non c'è posto».
 */
export function GrigliaCasa({
  iniziale,
  riquadri,
  libreria,
  modifica,
  endpoint = "/api/vista-cliente/casa",
  uscita = "/cliente",
}: {
  iniziale: VoceDisposizione[];
  riquadri: ContenutoRiquadro[];
  libreria: readonly RiquadroCasa[];
  modifica: boolean;
  /** Dove si salva la disposizione (13/11/2026: anche DATIA MONITORING è componibile). */
  endpoint?: string;
  /** Dove si torna dopo «Salva» o «Annulla». */
  uscita?: string;
}) {
  const router = useRouter();
  const [voci, setVoci] = useState<VoceDisposizione[]>(iniziale);
  const [trascinato, setTrascinato] = useState<string | null>(null);
  const [sopra, setSopra] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const perId = new Map(riquadri.map((r) => [r.id, r]));
  const nomeDi = (id: string) => libreria.find((r) => r.id === id)?.titolo ?? id;
  // Fuori dalla modifica si vedono solo i riquadri mostrati che hanno qualcosa da dire.
  const inGriglia = voci.filter((v) => v.visibile && (modifica || perId.get(v.id)?.contenuto != null));
  const nascosti = voci.filter((v) => !v.visibile);

  async function salva() {
    setSalvo(true);
    setErrore(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voci }),
      });
      if (!res.ok) {
        const dati = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrore(dati?.error ?? "Disposizione non salvata");
        return;
      }
      router.push(uscita);
      router.refresh();
    } catch {
      setErrore("Disposizione non salvata: il server non risponde");
    } finally {
      setSalvo(false);
    }
  }

  return (
    <div className="space-y-4">
      {modifica && (
        <div className="nascosto-stampa flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-selezione px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Stai componendo la casa di questo cliente.</span>{" "}
            Trascina un riquadro sopra un altro per cambiargli posto. Sopra ogni riquadro: le frecce lo spostano, ↔ ne cambia la larghezza, ↕ l&apos;altezza, l&apos;occhio barrato lo nasconde.
          </p>
          <Button type="button" disabled={salvo} onClick={() => void salva()}>
            {salvo ? "Salvo…" : "Salva la disposizione"}
          </Button>
          <Button type="button" variant="outline" disabled={salvo} onClick={() => setVoci(disposizionePredefinita(libreria))}>
            Torna a quella predefinita
          </Button>
          <Button type="button" variant="outline" disabled={salvo} onClick={() => router.push(uscita)}>
            Annulla
          </Button>
          {errore && <p role="alert" className="w-full text-sm font-semibold">{errore}</p>}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4 [grid-auto-flow:dense]" style={{ gridAutoRows: `${RIGA_PX}px` }}>
        {inGriglia.map((v, i) => {
          const r = perId.get(v.id);
          const stile = { "--l": v.l, gridRow: `span ${v.a}` } as CSSProperties;
          return (
            <div
              key={v.id}
              style={stile}
              className={`col-span-12 flex min-h-0 min-w-0 flex-col lg:[grid-column:span_var(--l)] ${modifica && sopra === v.id && trascinato !== v.id ? "rounded-xl outline outline-2 outline-offset-2 outline-[var(--vc-giallo)]" : ""} ${trascinato === v.id ? "opacity-50" : ""}`}
              draggable={modifica}
              onDragStart={modifica ? (e) => { setTrascinato(v.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", v.id); } : undefined}
              onDragEnd={modifica ? () => { setTrascinato(null); setSopra(null); } : undefined}
              onDragOver={modifica ? (e) => { e.preventDefault(); if (sopra !== v.id) setSopra(v.id); } : undefined}
              onDrop={modifica ? (e) => { e.preventDefault(); if (trascinato) setVoci((p) => spostaPrima(p, trascinato, v.id)); setTrascinato(null); setSopra(null); } : undefined}
            >
              {modifica && (
                <div className="nascosto-stampa mb-1 flex shrink-0 items-center gap-1 overflow-hidden text-[13px]">
                  <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
                  <Button type="button" variant="outline" size="icon" aria-label={`Sposta prima ${nomeDi(v.id)}`} disabled={i === 0} onClick={() => setVoci((p) => sposta(p, v.id, "prima"))}>
                    <ArrowLeft aria-hidden />
                  </Button>
                  <Button type="button" variant="outline" size="icon" aria-label={`Sposta dopo ${nomeDi(v.id)}`} disabled={i === inGriglia.length - 1} onClick={() => setVoci((p) => sposta(p, v.id, "dopo"))}>
                    <ArrowRight aria-hidden />
                  </Button>
                  <MoveHorizontal className="ml-1 size-4 shrink-0 text-muted-foreground" aria-label="larghezza" />
                  <Button type="button" variant="outline" size="icon" aria-label={`Stringi ${nomeDi(v.id)}`} disabled={v.l === LARGHEZZE[0]} onClick={() => setVoci((p) => allarga(p, v.id, -1))}>
                    <Minus aria-hidden />
                  </Button>
                  <Button type="button" variant="outline" size="icon" aria-label={`Allarga ${nomeDi(v.id)}`} disabled={v.l === LARGHEZZE[LARGHEZZE.length - 1]} onClick={() => setVoci((p) => allarga(p, v.id, 1))}>
                    <Plus aria-hidden />
                  </Button>
                  <MoveVertical className="ml-1 size-4 shrink-0 text-muted-foreground" aria-label="altezza" />
                  <Button type="button" variant="outline" size="icon" aria-label={`Abbassa ${nomeDi(v.id)}`} disabled={v.a === ALTEZZA_MIN} onClick={() => setVoci((p) => alza(p, v.id, -1))}>
                    <Minus aria-hidden />
                  </Button>
                  <Button type="button" variant="outline" size="icon" aria-label={`Alza ${nomeDi(v.id)}`} disabled={v.a === ALTEZZA_MAX} onClick={() => setVoci((p) => alza(p, v.id, 1))}>
                    <Plus aria-hidden />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="ml-auto" aria-label={`Nascondi ${nomeDi(v.id)}`} title="Nascondi" onClick={() => setVoci((p) => p.map((x) => (x.id === v.id ? { ...x, visibile: false } : x)))}>
                    <EyeOff aria-hidden />
                  </Button>
                </div>
              )}
              {!modifica && r?.nudo ? <div className="min-h-0 flex-1">{r.contenuto}</div> : (
              <Pannello titolo={r?.titolo ?? nomeDi(v.id)} azioni={modifica ? undefined : r?.azioni} className="min-h-0 flex-1" corpoClassName="overflow-auto p-3">
                {r?.contenuto ?? <p className="text-sm text-muted-foreground">Oggi senza dati per questo cliente: fuori dalla modifica non compare.</p>}
              </Pannello>
              )}
            </div>
          );
        })}
      </div>

      {modifica && (
        <Pannello titolo="Riquadri nascosti" conteggio={nascosti.length} sottotitolo="La libreria: da qui si rimettono nella casa." className="nascosto-stampa">
          {nascosti.length === 0 ? (
            <p className="text-sm">Sono tutti nella casa.</p>
          ) : (
            <ul>
              {nascosti.map((v) => {
                const r = libreria.find((x) => x.id === v.id);
                return (
                  <li key={v.id} className="flex items-center gap-3 border-b py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{r?.titolo ?? v.id}</span>
                      <span className="block text-[13px] text-muted-foreground">{r?.cosa}</span>
                    </span>
                    <Button type="button" variant="outline" onClick={() => setVoci((p) => p.map((x) => (x.id === v.id ? { ...x, visibile: true } : x)))}>
                      <Plus aria-hidden />
                      Aggiungi
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Pannello>
      )}
    </div>
  );
}
