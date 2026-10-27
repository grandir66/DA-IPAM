# Piano — pagina «Abbinamenti» (chi usa i PC → asset e assegnatari)

**Livello: leggero.** Approvato da Riccardo il 2026-10-23 (risposte alle domande + tavola 4, oggetti ⑲-㉕, sullo
stesso canvas: https://claude.ai/artifact/64gZcjsoZQmrcoXJkV6eFf). Si appoggia al modulo `lib/assegnatari/` (piano
`2026-10-23-assegnatari-da-ad.md`). Stati: `[ ]` `[~]` `[x]` (con la verifica) `[!]` `[-]`.

## Decisioni (non riaprire)

- Tutti gli host con accessi, anche senza asset: la conferma crea l'asset (categoria dalla classificazione:
  workstation → Desktop, notebook → Laptop; altrimenti si sceglie nella riga).
- Conferma tutto in un clic, a spunte: assegnatario da AD se manca, asset se manca, assegnazione; diario sull'asset.
- Asset assegnati a un altro: «Da rivedere», senza spunta di serie.
- Inventario › Abbinamenti, con rimando dalla pagina Assegnatari.
- Host classificati server/apparati/NAS/stampanti esclusi anche senza asset (scelta mostrata nella tavola).

## Passi

1. [x] `lib/assegnatari/abbinamenti.ts`: elenco per gruppi (proposto, da rivedere, già abbinato, pochi dati, escluso)
   con UNA lettura degli accessi e delle persone per tutti gli host; conferma in transazione che ricalcola ogni voce.
   Prova `__tests__/abbinamenti.test.ts`.
2. [x] Rotta `GET/POST /api/assegnatari/abbinamenti` (auth, admin in scrittura, Zod, schema presente).
3. [x] Pagina `inventory/abbinamenti`, voce nel menu, riga ㉕ nella pagina Assegnatari.
4. [x] Cancello, rilascio sul dev, verifica sull'hub .8 a 1440 (lettura come `prova-claude`; conferma di UNA voce
   come `prova-claude-admin` solo con l'ok di Riccardo: scrive su dati veri).
5. [x] CHANGELOG, CONTEXT, TASKS.

## Consuntivo (23/10)

- **Fatto**: passi 1-5; v0.9.895 sull'hub .8; pagina vista a 1440 come `prova-claude` coi dati veri: 13 proposti
  (5 con asset, 8 da creare), 0 da rivedere, 8 pochi dati, 11 esclusi; 2 righe con la categoria da scegliere (Mac
  «voip», Air-di-Riccardo «unknown»); la conferma resta ferma finché non si sceglie. Riga ㉕ in Assegnatari: «13 PC».
- **Prove**: `abbinamenti.test.ts` 3/3; cancello 5885 prove / 0 rosse, lint e build verdi.
- **Mancante**: nessuna conferma eseguita sull'hub (scriverebbe asset e assegnazioni veri): la fa Riccardo, o io con
  `prova-claude-admin` col suo ok.
- **Scostamento**: l'asset preferito è quello legato direttamente all'host (`ORDER BY a.host_id IS NULL`): SQLite non
  accetta il riferimento all'host esterno nell'ORDER BY della sottoquery.
