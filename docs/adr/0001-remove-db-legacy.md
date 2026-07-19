# ADR 0001 — Rimozione di `db-legacy.ts`

- **Stato**: Accettato
- **Data**: 2026-07-19
- **Contesto intervento**: WAVE 4 del `PIANO-INTERVENTO-2026-07-19`

## Contesto

`src/lib/db-legacy.ts` (6656 righe) era il facade di backward-compat storico. La regola
anti-regressione #12 imponeva di mantenerlo coerente con `db.ts` e `db-tenant.ts` ("triplica
le funzioni DB"). Verifiche (audit `verify-bug-report.ts` H10 + `grep`): **zero import** in
tutto `src` e negli script. Il file era **codice morto**, e la regola #12 imponeva di
sincronizzare a vuoto un file che nessuno usa → rischio di drift silenzioso e lavoro sprecato.

## Decisione

Rimuovere `src/lib/db-legacy.ts`. La coerenza DB passa da **tripla** (`db-tenant` + `db` +
`db-legacy`) a **doppia**: sorgente per-tenant in `db-tenant.ts` (+ `db-hub.ts` per l'hub),
con `db.ts` come facade con fallback al tenant DEFAULT. Regola #12 aggiornata di conseguenza.

## Conseguenze

- **-6656 righe** di codice morto; niente più drift a vuoto.
- Nessun impatto runtime: zero import da rimuovere, `tsc`/`build`/test invariati.
- L'audit `verify-bug-report.ts` H10 aggiornato per riportare "risolto" quando il file non esiste.
- Rollback banale: `git revert` (il file torna, ma resterebbe non importato).

## Note

Prerequisito NON toccato da questo ADR: la riduzione di `db.ts` (7186 righe) a thin facade
(WAVE 5) è separata e va fatta **dopo** aver chiuso il tenant-leak `getDb()` DEFAULT
(audit H1/H2), su branch dedicato con test su lab.
