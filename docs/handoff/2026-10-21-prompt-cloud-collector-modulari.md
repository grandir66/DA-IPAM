# Prompt per la sessione cloud — collector modulari (DA-IPAM)

Data: 21/10/2026. Da incollare (o da far leggere) a una sessione Claude Code nel cloud aperta sul repository
`grandir66/DA-IPAM`, ramo **`collector-modulari`**. Il piano è approvato: si esegue, non si ripianifica.

## Regole che nel cloud non arrivano da sole

Le regole dell'utente e dell'area (`~/.claude/AGENTS.md`, `~/Progetti/AGENTS.md`) qui non ci sono. Valgono
queste, riassunte:

- Si scrive a Riccardo **in italiano, dandogli del tu**: risposte, documenti, messaggi di commit. Codice e
  nomi di simboli restano in inglese, i testi dell'interfaccia in italiano.
- **Rami.** Si lavora solo su `collector-modulari` (o su rami nati da lì) e si pubblica solo lì. **Mai push
  su `dev` né su `main`**: `dev` arriva da solo all'appliance di un cliente (timer ogni 15 minuti), `main`
  alle appliance dei clienti. L'unione in `dev` la fa Riccardo in locale, quando lo decide.
- **Niente prove a caso.** Un comando che fallisce due volte senza causa chiara: ci si ferma, si legge una
  volta il log completo e il codice, un fix mirato, una prova; se non è chiaro si chiede.
- **Il cancello si legge dal codice di uscita**, mai dall'output (`cmd; ESITO=$?`, niente `| tail` prima di
  leggere l'esito). Log in una cartella temporanea della sessione.
- **Una prova vale se l'ho vista fallire**: esegue il codice e usa dati finti con la forma vera.
- **Niente ripieghi muti**: nessun `catch` largo che trasforma un guasto in «lista vuota» o «ok».
- **Repo pubblico**: nessuna credenziale, IP, MAC, hostname, seriale o nome di cliente in codice, fixture,
  commit o log. Le fixture sono uscite anonimizzate (IP di documentazione 192.0.2.0/24, 198.51.100.0/24; MAC
  `02:00:00:…`).
- **Checklist in `TASKS.md`** (sezione «2026-10-21 — recupero da DADude3 e DA-MKNET»): si spunta ogni punto
  appena è fatto e si aggiunge ciò che si scopre, con una riga sul perché. `TASKS.md` va nei commit.
- **Schermate**: prima la proposta degli oggetti (tavola grafica resa, oggetti numerati, mai schemi ASCII),
  poi il codice. Brand Domarc: navy `#0D2537`, cian `#00A7E7` (mai per il testo), giallo `#FFD400` solo come
  fondo, Signika; Riccardo è daltonico: stati distinti per luminanza e forma, non solo per tinta.
- Report finale in linguaggio semplice: fatto, funziona, come è verificato, aperto.

## Da leggere prima di toccare il codice

1. `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/rules/` del repo.
2. Il piano: `docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md` (v2, decisioni in §7).
3. La consegna dei collector: `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`,
   ADR 0024-0026, manuale `docs/modules/acquisition.md`.
4. Donatori, solo da consultare (mai copiati interi): `github.com/grandir66/dadude-native` (DADude3) e
   `github.com/grandir66/DA-MKNET` (privato). Le righe citate nel piano valgono per i commit `569b416` e
   `812b1ad`; il codice su `origin/main` è lo stesso.

## Ambiente

Node 22 LTS (Node ≥25 rompe `better-sqlite3`), `npm ci`. Prove: `npm test` con `DA_INVENT_DATA_DIR` su una
cartella temporanea; `npx tsc --noEmit`; `npm run lint`; `npm run build`. Prove del modulo:
`node --import tsx --test src/lib/acquisition/__tests__/*.test.ts` (79 verdi il 21/10). Nella suite intera
cadono a caso `credential-chains`, `parita-gruppo0`, `ssh-connessione-caduta`, `ssh-chiave`,
`chiave-ssh-percorsi`: se rosse, si rilanciano da sole prima di indagare.

Nel cloud **non** ci sono: il DB dell'hub, le appliance, il vault delle credenziali, gli apparati. Ciò che
richiede quelle cose si prepara e si lascia a Riccardo, scritto in `TASKS.md` come «da fare in locale».

## Cosa fare, in ordine

0. **Riallineare** `collector-modulari` con `origin/dev` con un **merge** (niente rebase né force-push sul
   ramo pubblicato). I conflitti probabili sono in `TASKS.md`, `CONTEXT.md` e nel registry dei moduli: si
   tiene il lavoro di entrambi. Dopo il merge le prove del modulo e `tsc` devono essere verdi.
1. **S1** Export MikroTik solo admin (piano §5, controllo completo: revisione dopo il task).
2. **S2** Firmware QNAP nel percorso storico (leggero).
3. **C0** Framework pronto a crescere (leggero; lo schema è un contratto pubblico).
4. **C1** Aggancio manuale in sviluppo (completo): proposta d'interfaccia prima della schermata.
5. **C2** Proiezioni, anteprima, applicazione (completo).
6. **C3** Collector nuovi nell'ordine del §7 D6, uno alla volta, ognuno «non collaudato» finché Riccardo non
   lo prova su un apparato.

**S3** (MAC virtuali) solo dopo che in `origin/dev` è arrivato il lavoro della sessione «tappe 3-5», che
modifica `src/lib/topology/identity.ts`; la sua misura su copia del DB dell'hub resta da fare in locale.

Ci si ferma e si chiede solo per: un cambio di scope, un'azione distruttiva non prevista, un conflitto di
merge che tocca lavoro altrui in modo non ovvio. A fine di ogni blocco: commit e push su
`collector-modulari`, `TASKS.md` aggiornato, una riga a Riccardo su cosa è pronto da provare in locale.

## Da lasciare a Riccardo in locale

- Misure su copia del DB dell'hub (S3; differenze dell'anteprima in C2).
- Collaudo dei collector HP nella sede nuova (Comware, ProCurve, ArubaOS) e capire se «ArubaOS» è
  ArubaOS-Switch o AOS-CX (`sysDescr`).
- La resa delle schermate coi dati veri; nel cloud si guardano coi dati finti.
- L'unione in `dev` e il rilascio.
