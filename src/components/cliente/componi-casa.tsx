"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pannello } from "@/components/shared/console";
import { disposizionePredefinita, sposta, type MisuraRiquadro, type RiquadroCasa, type VoceDisposizione } from "@/lib/cliente/casa";

/**
 * «Componi la casa»: l'amministratore decide per questo cliente quali riquadri si vedono, in che
 * ordine e in che misura (mezza riga o riga intera). Niente trascinamento: frecce e interruttori.
 * `senzaDati` sono i riquadri che per questo cliente oggi non hanno niente da mostrare.
 */
export function ComponiCasa({
  iniziale,
  libreria,
  senzaDati,
}: {
  iniziale: VoceDisposizione[];
  libreria: readonly RiquadroCasa[];
  senzaDati: string[];
}) {
  const router = useRouter();
  const [voci, setVoci] = useState<VoceDisposizione[]>(iniziale);
  const [salvo, setSalvo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  function cambia(id: string, parte: Partial<VoceDisposizione>) {
    setVoci((prima) => prima.map((v) => (v.id === id ? { ...v, ...parte } : v)));
  }

  async function salva() {
    setSalvo(true);
    setErrore(null);
    try {
      const res = await fetch("/api/vista-cliente/casa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voci }),
      });
      if (!res.ok) {
        const dati = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrore(dati?.error ?? "Disposizione non salvata");
        return;
      }
      router.push("/cliente");
      router.refresh();
    } catch {
      setErrore("Disposizione non salvata: il server non risponde");
    } finally {
      setSalvo(false);
    }
  }

  const misure: Array<{ valore: MisuraRiquadro; testo: string }> = [
    { valore: "mezza", testo: "Mezza riga" },
    { valore: "intera", testo: "Riga intera" },
  ];

  return (
    <Pannello
      titolo="Componi la casa"
      sottotitolo="Vale per questo cliente. L'ordine è quello dell'elenco; due riquadri a mezza riga stanno affiancati."
      className="nascosto-stampa"
    >
      <ul>
        {voci.map((voce, i) => {
          const r = libreria.find((x) => x.id === voce.id);
          if (!r) return null;
          return (
            <li key={voce.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
              <span className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="icon" aria-label={`Sposta su ${r.titolo}`} disabled={i === 0} onClick={() => setVoci((p) => sposta(p, voce.id, "su"))}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label={`Sposta giù ${r.titolo}`} disabled={i === voci.length - 1} onClick={() => setVoci((p) => sposta(p, voce.id, "giu"))}>
                  <ArrowDown aria-hidden />
                </Button>
              </span>
              <span className={`min-w-0 flex-1 ${voce.visibile ? "" : "text-muted-foreground"}`}>
                <span className="block text-sm font-semibold">{r.titolo}</span>
                <span className="block text-[13px] text-muted-foreground">
                  {r.cosa}
                  {senzaDati.includes(voce.id) && " · oggi senza dati per questo cliente: non compare"}
                </span>
              </span>
              <span className="flex shrink-0 gap-1" role="group" aria-label={`Misura di ${r.titolo}`}>
                {misure.map((m) => (
                  <Button key={m.valore} type="button" variant={voce.misura === m.valore ? "default" : "outline"} aria-pressed={voce.misura === m.valore} onClick={() => cambia(voce.id, { misura: m.valore })}>
                    {m.testo}
                  </Button>
                ))}
              </span>
              <Button type="button" variant="outline" className="w-32 shrink-0" aria-pressed={voce.visibile} onClick={() => cambia(voce.id, { visibile: !voce.visibile })}>
                {voce.visibile ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                {voce.visibile ? "Mostrato" : "Nascosto"}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-3">
        <Button type="button" disabled={salvo} onClick={() => void salva()}>
          {salvo ? "Salvo…" : "Salva la disposizione"}
        </Button>
        <Button type="button" variant="outline" disabled={salvo} onClick={() => setVoci(disposizionePredefinita())}>
          Torna a quella predefinita
        </Button>
        <Button type="button" variant="outline" disabled={salvo} onClick={() => router.push("/cliente")}>
          Annulla
        </Button>
        {errore && <p role="alert" className="text-sm font-semibold">{errore}</p>}
      </div>
    </Pannello>
  );
}
