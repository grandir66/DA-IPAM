---
scope: Pagine e componenti dell'interfaccia
paths:
  - "src/app/**/*.tsx"
  - "src/components/**"
  - "src/app/globals.css"
---

# Interfaccia — stile Domarc (vincolante, anche se la richiesta non parla di aspetto)

Prima di scrivere o cambiare una pagina: leggere **[docs/STILE-UI.md](../../docs/STILE-UI.md)**.
Riccardo (25/10/2026): lo stile vale sempre, non solo quando lo chiede.

In breve, quello che si sbaglia di più:

1. **Una cosa si dice una volta**: niente dati, elenchi o pulsanti ripetuti in più punti.
2. **L'elenco degli oggetti è il centro**: tabella completa e filtrabile; mappe e grafici sono in più.
3. **Mattoni pronti** in `src/components/shared/console.tsx` (`IntestazionePagina`, `BarraStato`,
   `TesseraNumero`, `Pannello`, `VoceSelezionabile`, `Etichetta`, `Legenda`, `SchedaDettaglio`,
   `Vuoto`, `InCorso`): si usano, non si ridisegnano.
4. **Colori**: token Domarc; mai `bg-green-500`/`text-sky-400` & co.; ciano come testo solo
   `text-cian-testo`; stati con segno (`STILE_STATO`) e legenda accanto a ogni colore.
5. **Testo ≥ 13 px**: mai `text-[10px]`, `text-[11px]`, `text-[0.6rem]`.
6. **Vuoto, errore, caricamento** hanno il loro riquadro (`Vuoto`, `LoadError`, `SkeletonTable`).
7. Se c'è un modello di Riccardo, la pagina finita si confronta col modello voce per voce prima della PR.
