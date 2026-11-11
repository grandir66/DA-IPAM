/**
 * Le voci di un `<select>` nativo per scegliere una categoria intera o una sua classe (11/11/2026, filtri a due
 * livelli). Il valore di una categoria intera è `gruppo:<categoria>`: lo capisce `passaFiltroCategoria`.
 */
import { gruppiScelta, PREFISSO_GRUPPO } from "@/lib/classification/scelta-categoria";

export function OpzioniCategorie() {
  return (
    <>
      {gruppiScelta().map((g) => (
        <optgroup key={g.gruppo} label={g.titolo}>
          <option value={`${PREFISSO_GRUPPO}${g.gruppo}`}>{g.titolo}: tutte</option>
          {g.voci.map((v) => (
            <option key={v.slug} value={v.slug}>{v.etichetta}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
