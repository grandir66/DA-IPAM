"use client";

/**
 * I rilievi di un host (giri, trunk, CVE): gli stessi di «Findings», filtrati sull'oggetto.
 * Riccardo, 10/11/2026: «tutti i rilievi devono finire nel profilo degli oggetti delle subnet
 * e della discovery». Prima si vedevano solo nell'elenco generale.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeGravita } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { ElencoRilievi, RilievoUnito } from "@/lib/rilievi/tipi";

const TETTO = 100;

export function RilieviHost({ hostId, compatto = false }: { hostId: number; compatto?: boolean }) {
  const [righe, setRighe] = useState<RilievoUnito[] | null>(null);
  const [totale, setTotale] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setRighe(null);
    setErrore(null);
    void (async () => {
      const r = await fetchJson<ElencoRilievi>(`/api/rilievi?host_id=${hostId}&pageSize=${TETTO}`);
      if (!vivo) return;
      if (r.ok) {
        setRighe(r.data.data);
        setTotale(r.data.total);
      } else setErrore(r.message);
    })();
    return () => {
      vivo = false;
    };
  }, [hostId]);

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold">Rilievi{righe ? ` (${totale})` : ""}</p>
      {errore ? (
        <p className="text-[13px] text-muted-foreground">Rilievi non letti: {errore}</p>
      ) : righe === null ? (
        <p className="text-[13px] text-muted-foreground">Caricamento…</p>
      ) : righe.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nessun rilievo su questo oggetto dai giri fatti finora.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {righe.map((r) => (
            <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-[13px]">
              <BadgeGravita gravita={r.gravita} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.titolo}</span>
                <span className={`block break-words text-muted-foreground ${compatto ? "line-clamp-2" : ""}`}>{r.prova}</span>
                {!compatto && r.rimedio ? <span className="mt-0.5 block">{r.rimedio}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {righe && totale > righe.length ? (
        <p className="mt-1 text-[13px] text-muted-foreground">
          Mostrati {righe.length} di {totale}. <Link href="/vulnerabilities" className="underline">Tutti in Findings</Link>
        </p>
      ) : null}
    </div>
  );
}
