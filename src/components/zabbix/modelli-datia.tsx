"use client";

/**
 * «Modelli» di DatIA Mon (26/11/2026, tappa 2 del punto d'ingresso): i modelli di Zabbix che il centro lascia
 * collegare, famiglia per famiglia, e quanti apparati li hanno. Una riga = un modello in una famiglia; da qui si va
 * agli apparati che lo hanno, dove si aggiunge e si toglie. Sola lettura.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pannello, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { ApparatoElenco } from "@/lib/zabbix-lettura/apparati";

interface Risposta {
  letto: boolean;
  motivo?: string;
  famiglie?: Array<{ codice: string; etichetta: string }>;
  apparati?: ApparatoElenco[];
  modelliAdatti?: Record<string, string[]> | null;
}

interface Riga { famiglia: string; etichetta: string; modello: string; quanti: number; adatto: boolean }

/** Le righe: i modelli adatti a ogni famiglia, più quelli in uso che il centro non elenca per quella famiglia. */
export function righeModelli(d: Pick<Risposta, "famiglie" | "apparati" | "modelliAdatti">): Riga[] {
  const etichetta = new Map((d.famiglie ?? []).map((f) => [f.codice, f.etichetta]));
  const conta = new Map<string, number>();
  for (const a of d.apparati ?? []) for (const m of a.modelli) conta.set(`${a.famiglia}\n${m}`, (conta.get(`${a.famiglia}\n${m}`) ?? 0) + 1);
  const righe = new Map<string, Riga>();
  for (const [famiglia, modelli] of Object.entries(d.modelliAdatti ?? {})) {
    for (const modello of modelli) righe.set(`${famiglia}\n${modello}`, { famiglia, etichetta: etichetta.get(famiglia) ?? famiglia, modello, quanti: 0, adatto: true });
  }
  for (const [k, quanti] of conta) {
    const [famiglia, modello] = k.split("\n");
    const r = righe.get(k) ?? { famiglia, etichetta: etichetta.get(famiglia) ?? famiglia, modello, quanti: 0, adatto: false };
    righe.set(k, { ...r, quanti });
  }
  return [...righe.values()].sort((x, y) => x.etichetta.localeCompare(y.etichetta, "it") || x.modello.localeCompare(y.modello, "it"));
}

export function ModelliDatia() {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [soloInUso, setSoloInUso] = useState(false);
  const carica = useCallback(async () => {
    const r = await fetchJson<Risposta>("/api/zabbix/apparati", { cache: "no-store" });
    if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
  }, []);
  useEffect(() => { void carica(); }, [carica]);
  const righe = useMemo(() => (dati ? righeModelli(dati) : []), [dati]);

  if (errore) return <LoadError what="i modelli" message={errore} onRetry={() => void carica()} />;
  if (!dati) return <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Carico…</p>;
  if (!dati.letto) return <Vuoto titolo="Il centro non si legge" testo={dati.motivo} />;
  const t = cerca.trim().toLowerCase();
  const viste = righe.filter((r) => (!soloInUso || r.quanti > 0) && (!t || `${r.modello} ${r.etichetta}`.toLowerCase().includes(t)));
  return (
    <Pannello
      titolo="Modelli di Zabbix"
      conteggio={viste.length}
      sottotitolo={dati.modelliAdatti ? "Quelli che il centro lascia collegare, per famiglia" : "Il centro non dà l'elenco dei modelli adatti: si vedono solo quelli in uso"}
      azioni={
        <>
          <Input className="h-8 w-64" placeholder="Cerca modello o famiglia" value={cerca} onChange={(e) => setCerca(e.target.value)} />
          <Button size="sm" variant={soloInUso ? "outline" : "default"} aria-pressed={!soloInUso} onClick={() => setSoloInUso(false)}>Tutti</Button>
          <Button size="sm" variant={soloInUso ? "default" : "outline"} aria-pressed={soloInUso} onClick={() => setSoloInUso(true)}>Solo in uso</Button>
        </>
      }
    >
      {viste.length === 0 ? (
        <Vuoto titolo="Nessun modello" testo={t || soloInUso ? "Nessuno corrisponde alla ricerca." : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 text-left text-[13px] text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Famiglia</th>
                <th className="px-2 py-1.5 font-semibold">Modello</th>
                <th className="px-2 py-1.5 font-semibold">Nell&apos;elenco del centro</th>
                <th className="px-2 py-1.5 text-right font-semibold">Apparati che lo hanno</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {viste.map((r) => (
                <tr key={`${r.famiglia}-${r.modello}`} className="border-t">
                  <td className="px-2 py-1.5">{r.etichetta}</td>
                  <td className="px-2 py-1.5 font-semibold">{r.modello}</td>
                  <td className="px-2 py-1.5">{r.adatto ? "● sì" : <span title="Collegato a mano o da DA-Zabbix: il centro non lo propone per questa famiglia">▲ no, fuori elenco</span>}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${r.quanti ? "font-semibold" : "text-muted-foreground"}`}>{r.quanti}</td>
                  <td className="px-2 py-1.5 text-right">
                    {r.quanti > 0 && (
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/zabbix/apparati?modello=${encodeURIComponent(r.modello)}&famiglia=${encodeURIComponent(r.famiglia)}`} />}>
                        Vedi gli apparati
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Pannello>
  );
}
