/**
 * Le funzioni di un apparato in una riga di elenco, e le voci di un `<select>` per filtrarle (11/11/2026).
 * Catalogo in `lib/classification/funzioni.ts`.
 */
import { etichettaFunzione, gruppiFunzioni } from "@/lib/classification/funzioni";

export interface FunzioneInRiga { funzione: string; origine: string; a_mano: boolean }

/** Le funzioni come piccole etichette; il suggerimento dice da dove viene ognuna. Senza funzioni non disegna niente. */
export function PilloleFunzioni({ funzioni }: { funzioni: readonly FunzioneInRiga[] | undefined }) {
  if (!funzioni || funzioni.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {funzioni.map((f) => (
        <span
          key={f.funzione}
          title={f.a_mano ? "messa a mano" : f.origine}
          className="rounded border px-1 text-[13px] leading-5 text-foreground"
        >
          {etichettaFunzione(f.funzione)}
        </span>
      ))}
    </span>
  );
}

/** Le voci di un `<select>` nativo, a gruppi. Il valore è lo slug della funzione. */
export function OpzioniFunzioni() {
  return (
    <>
      {gruppiFunzioni().map((g) => (
        <optgroup key={g.gruppo} label={g.titolo}>
          {g.voci.map((v) => <option key={v.slug} value={v.slug}>{v.etichetta}</option>)}
        </optgroup>
      ))}
    </>
  );
}
