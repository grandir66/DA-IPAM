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

1. [ ] `lib/assegnatari/abbinamenti.ts`: elenco per gruppi (proposto, da rivedere, già abbinato, pochi dati, escluso)
   con UNA lettura degli accessi e delle persone per tutti gli host; conferma in transazione che ricalcola ogni voce.
   Prova `__tests__/abbinamenti.test.ts`.
2. [ ] Rotta `GET/POST /api/assegnatari/abbinamenti` (auth, admin in scrittura, Zod, schema presente).
3. [ ] Pagina `inventory/abbinamenti`, voce nel menu, riga ㉕ nella pagina Assegnatari.
4. [ ] Cancello, rilascio sul dev, verifica sull'hub .8 a 1440 (lettura come `prova-claude`; conferma di UNA voce
   come `prova-claude-admin` solo con l'ok di Riccardo: scrive su dati veri).
5. [ ] CHANGELOG, CONTEXT, TASKS.
