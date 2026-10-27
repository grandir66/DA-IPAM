# Prompt per la sessione cloud — LibreNMS come fonte di dati (DA-IPAM)

Data: 22/10/2026. Ramo **`librenms-fonte`** (nato da `dev`). Il piano è approvato: si esegue, non si ripianifica.
Lavora in parallelo alla sessione dei collector modulari (ramo `collector-modulari`): non toccare quel ramo.

## Regole (nel cloud non arrivano da sole)

- Italiano col tu verso Riccardo, nei documenti e nei commit; codice e simboli in inglese, interfaccia in italiano.
- **Solo il ramo `librenms-fonte`**. Mai push su `dev` o `main` (`dev` arriva da solo all'appliance di un cliente
  col timer). L'unione in `dev` la fa Riccardo in locale.
- Niente prove a caso: due fallimenti di fila senza causa chiara → ci si ferma, si legge il log intero, un fix.
- Il cancello si legge dal codice di uscita (`cmd; ESITO=$?`), mai dall'output; log in una cartella temporanea.
- Una prova vale se l'hai vista fallire; niente `catch` larghi che trasformano un guasto in lista vuota.
- Repo pubblico: nessun IP, MAC, nome o seriale vero. Le fixture vere sono già anonimizzate in
  `src/lib/integrations/__tests__/fixtures/librenms/` (leggi il loro `LEGGIMI.md`).
- `TASKS.md`, sezione «2026-10-22 — LibreNMS come fonte di dati degli apparati SNMP»: si spunta ogni punto appena
  fatto e si aggiunge ciò che si scopre. Nel piano gli stati dei passi si aggiornano al cambio di stato.
- Schermate: prima la tavola grafica (oggetti numerati, brand Domarc, stati per luminanza e forma: Riccardo è
  daltonico), poi il codice.

## Da leggere

`CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`; la spec
`docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md` e il piano
`docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md`, compreso il **Registro** con le risposte di Riccardo
del 22/10: livello **leggero** (ma le regole delle zone rosse restano: prova a vuoto prima di scrivere in LibreNMS,
migrazione provata su DB nuovo, mappa dietro interruttore con T1 bit per bit); **vicini aggiunti in automatico se
l'SNMP risponde**; i 5 server mai interrogati si mostrano come «SNMP non risponde» e si propone di toglierli, mai da
soli; container LibreNMS già aggiornato.

## Cosa fare in questo giro

0. Merge di `origin/dev` in `librenms-fonte` (merge, niente rebase). Altre sessioni toccano le stesse zone
   (`topology/letture/interruttori.ts`, migrazioni in `db-tenant.ts`, `transfer/table-registry.ts`, numero dell'ADR):
   rileggi `origin/dev` prima di ogni passo e tieni il lavoro di tutti.
1. **S1** codice e prove (la prova sull'hub con un IP muto resta alla sessione locale).
2. **S2** migrazione, provata su DB nuovo e su un DB fatto con lo schema di oggi (la prova sulla copia dell'hub resta
   locale).
3. **S3** client e lettori puri sulle fixture vere già nel repo; una fixture di forma sconosciuta per parte.
4. **S4** scrittura e giro nel job `librenms_sync`, dietro l'interruttore spento; prova con un'API finta che
   restituisce le fixture. La prova a vuoto con l'API vera resta locale.
5. **S5** rotte, censite in `permessi/rotte.ts`.
6. **S6** solo la tavola grafica: `docs/proposte/2026-10-22-librenms-interfaccia.html` (scheda: Sensori, Porte e
   Vicini con fonte; pagina del modulo: non interrogati, rifiutati, candidati). Niente schermate scritte.

Fermati a S6. Cancello completo (`npm run lint`, `npx tsc --noEmit`, `npm test` con `DA_INVENT_DATA_DIR` temporanea,
`npm run build`), TASKS aggiornato con cosa resta da fare in locale (S1 sull'hub, S2 sulla copia, S4 a vuoto).
Commit in italiano terminati da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push su `librenms-fonte`.
Rapporto finale in italiano semplice: commit, fatto e verificato (comandi ed exit code), non fatto e perché,
cosa deve provare o decidere Riccardo.

## Giro 2 (22/10): le schermate S7 e S8

La tavola S6 è approvata con le risposte nel Registro del piano («tavola S6 approvata»). Le prove locali S2 (copia del DB
vero) e S4 (a vuoto con l'API vera) sono verdi: numeri nel Registro. Prima di tutto merge di `origin/dev`.

1. **S7** scheda dell'oggetto: tab «Sensori» (L1, gruppi per classe, stato dai limiti di avviso di LibreNMS dove ci sono,
   altrimenti 10% dal limite), colonna «Fonte» e «Alias» (solo se presente) nelle Porte (L2), vicini con le due fonti e il
   disaccordo su due righe (L3), voce LibreNMS nella riga «Dati da:» (L4). Componenti esistenti di `src/components/scheda/`.
2. **S8** pagina del modulo: sezione «Apparati e lettura dei dati» nella pagina del modulo LibreNMS (L5).
3. Resa con Playwright e dati finti a 1440 e 1920, nessuno scorrimento orizzontale; interruttore spento = schede come oggi.

Fermati a fine S8 (S9 mappa e S10 accensione restano fuori). Cancello completo, TASKS e piano aggiornati.
