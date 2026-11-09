# Prompt per il Claude Code di sviluppo di DA-IPAM: importare il JSON del tecnico e farne un collector

> Riccardo (09/11/2026): «servirebbe un prompt per inghiottire sia il json che inserire il collector centralizzato delle
> installazioni dei tecnici». Si usa nel repo DA-IPAM, ramo `dev`, ogni volta che un tecnico consegna il pacchetto descritto
> nel §4.1 di `src/lib/estrazione/prompt-tecnico.md`. La parte A si fa una volta sola, la parte B a ogni consegna.
> Il testo da incollare è fra le due righe `---`; le parti fra `<…>` le compila chi lo lancia.

---

# Compito

Sei nel repo DA-IPAM, ramo `dev` (**mai `main`**: le appliance dei clienti lo scaricano). Un tecnico ha letto un apparato
che DA-IPAM non sapeva leggere. Il suo Claude Code ha prodotto due cose:
- il **JSON d'estrazione** (busta `da-ipam-estrazione` 1.0 più snapshot 1.0);
- il **pacchetto di consegna**, in `<percorso del pacchetto>`, con dentro:
  - `<collector>.py`;
  - `campione/` (output grezzi anonimizzati);
  - `atteso.json` (lo script sul campione);
  - `LEGGIMI.md`.

Hai due compiti:
- **A. Una volta sola:** DA-IPAM deve saper **importare** il JSON d'estrazione. Se l'import c'è già, salti A.
- **B. A ogni consegna:** lo script del tecnico diventa un **collector del catalogo**. Da lì lo usano tutte le installazioni:
  nel giro dei parser, dal pulsante «Aggiorna» e dalla pagina del tecnico.

Leggi solo ciò che serve:
- `CONTEXT.md`, sezione «Mappa porte» e quelle sotto;
- `docs/modules/acquisition.md`, sezioni «Contratto JSON 1.0», «Aggancio all'app» e «Aggiungere una famiglia»;
- `src/lib/acquisition/schema.ts`;
- `src/lib/estrazione/prompt-tecnico.md`, §3 e §4.1;
- i file del §A.2 quando li tocchi.

Il resto lo cerchi con `rg` quando serve.

# Dati: cosa non deve mai arrivare a te

- **Il JSON d'estrazione vero non lo apri.** Contiene IP, MAC e nomi del cliente. Lo importa una persona dall'interfaccia
  (§A.3). Tu lavori solo su `campione/`, `atteso.json`, `LEGGIMI.md` e lo script.
- Prima di usare il pacchetto, controlla che non contenga dati veri. Gli IP devono stare in `192.0.2.0/24`,
  `198.51.100.0/24` o `203.0.113.0/24`. I MAC devono cominciare per `02:00:00`. Non devono esserci nomi di aziende, seriali
  plausibili o email. Se trovi qualcosa che sembra vero, **ti fermi e lo dici**, senza ricopiarlo in nessun file. Il repo è
  pubblico.
- Niente credenziali, mai: né nel codice né nei test.

# A. Import del JSON d'estrazione (una volta)

## A.1 Prima controlla se c'è già

```
rg -n "da-ipam-estrazione|importa" src/lib/estrazione src/app/api/devices
```

Se esiste una rotta d'import che valida la busta, passi alla parte B.

## A.2 Cosa scrivere

1. **Schema della busta** in `src/lib/estrazione/busta.ts`, con Zod v4. I campi sono quelli del §3.1 di `prompt-tecnico.md`:
   `formato`, `versione`, `origine`, `provenienza`, `comandi[]`, `snapshot`.
2. **Sezione `routes`** nello snapshot (`src/lib/acquisition/schema.ts`):
   - opzionale, così gli snapshot già salvati restano validi e `schema_version` resta `1.0`;
   - ogni elemento ha `destination`, `prefix_len`, `gateway`, `interface`, `protocol`, `metric`, `distance`, `active`, `vrf`;
   - il manuale va aggiornato.
3. **Collector che il catalogo non ha ancora.** `snapshotSchema` vuole un `collector` del catalogo, ma il JSON di un tecnico
   arriva prima che il collector esista.
   - Con `origine: "tecnico"` si valida con una variante che accetta `collector` come stringa (`^[a-z0-9-]{3,40}$`).
   - Vanno protetti i punti che oggi presumono un id del catalogo: `archivio.ts` (`salvaSnapshot`, `leggiPayload`, che la
     Mappa porte usa per l'ultimo snapshot), `riquadro-server.ts`, `scheda.ts` e ogni `descrittore(...)` raggiunto da uno
     snapshot salvato.
   - Un id sconosciuto si mostra come «collector del tecnico, non ancora nel prodotto», non come errore.
4. **Rotta** `POST /api/devices/[id]/acquisizione/importa`:
   - prima riga `requireAdmin()`, poi `withTenantFromSession()`;
   - corpo al massimo 4 MB, `JSON.parse` in try-catch;
   - in quest'ordine:
     1. valida la busta, e restituisce gli errori dalle `.issues`;
     2. **controlla l'identità**: se l'apparato ha un seriale o un MAC e la busta ne porta uno diverso, risponde 409 con
        «l'estrazione è di un altro apparato?»;
     3. `contieneSegreto` con le credenziali dell'apparato: se trova un segreto, rifiuta senza dire quale;
     4. `salvaSnapshot(..., { trigger: "import_tecnico" })`;
     5. `applicaSnapshot`;
     6. `routes`, se `ok` o `partial`, in `routing_table` per quell'apparato: DELETE più INSERT dentro `db.transaction`
        (regola 7). Il registro `mappa_porte_rotte` le accumula da solo.
   - La Mappa porte prende lo strato «parser» dall'ultimo snapshot, quindi non serve altro.
   - **`is_uplink` non si scrive mai** (CONTEXT, «Mappa porte»).
5. **Interfaccia**: nella scheda dell'apparato, tab Gestione, riquadro «Acquisizione», il pulsante «Importa estrazione».
   - Sceglie un file `.json` e mostra l'esito per sezione con `sezioniPerScheda`.
   - Usa i mattoni di `src/components/shared/console.tsx` e segue `docs/STILE-UI.md`: testo ≥13 px, colori Domarc, stati
     con doppio segnale.
   - Prima di scriverla, proponi a Riccardo l'interfaccia oggetto per oggetto.

## A.3 Prove della parte A

- Una prova della rotta, o della funzione pura sotto la rotta, con una **busta inventata**: IP di documentazione e MAC
  `02:00:00:…`. Copre quattro casi:
  - una busta valida viene salvata e proiettata;
  - una busta con seriale diverso dà 409;
  - una busta con dentro un segreto viene rifiutata;
  - un collector sconosciuto con `origine: "tecnico"` viene accettato, e la scheda non si rompe.
- Poi `npx eslint` sui file toccati e `npx tsc --noEmit`.

# B. Dallo script del tecnico al collector del catalogo (a ogni consegna)

Segui i nove passi di `docs/modules/acquisition.md` §«Aggiungere una famiglia». Per prima cosa guarda se nel catalogo esiste
già una famiglia dello stesso vendor: in quel caso **la estendi**, non ne scrivi una seconda.

1. **Voce nel catalogo** (`src/lib/acquisition/catalogo.ts`), con lo stesso `id` che il tecnico ha messo in
   `provenienza.parser.id`, così gli snapshot già importati si riconoscono.
   - `famiglia`, `prodotti`, `credenziali` e `sezioni` vengono da `LEGGIMI.md`.
   - `comandi` è l'allowlist: **solo i comandi di lettura** del piano del tecnico, ricontrollati uno per uno contro l'elenco
     dei vietati del §1 di `prompt-tecnico.md`. Se ne trovi uno vietato, lo togli e lo scrivi nella PR.
   - `ssh_modo` e `limiti`, se servono.
   - `collaudo: "collaudato"` e `collaudati: [{ modello, firmware }]`, presi da `LEGGIMI.md`: l'apparato vero l'ha letto il
     tecnico.
   - `versione: "1.0.0"`.
2. **Allowlist** in `src/lib/acquisition/comandi.ts`, se è una CLI.
3. **Parser puri** in `src/lib/acquisition/<id>-parsers.ts`: la logica dello script Python portata in TypeScript strict,
   senza `any`.
   - Colonne lette per nome.
   - `null` = ignoto.
   - Contatori come stringhe decimali.
4. **Collector** `src/lib/acquisition/<id>.ts`:
   - una `section` per ogni parte dello snapshot;
   - `redactSnapshot`, poi `snapshotSchema.parse`;
   - `versioneCollector('<id>')`.
5. **Registrazione** in `src/lib/acquisition/index.ts` (`IMPLEMENTAZIONI`), e in `riconosci.ts` se l'apparato si riconosce da
   sysDescr o sysObjectID.
6. **Fixture** `FIXTURE['<id>']` in `__tests__/contratto-fixture.ts`, presa da `campione/`. Gli id dei file (`c1.txt`, …)
   corrispondono a `comandi[]` di `atteso.json`. Nel nome host metti un segreto di prova finto, così la prova vede la
   redazione.
7. **Prova d'oro**, in `__tests__/<id>-parsers.test.ts`: il collector TypeScript sul campione deve dare le stesse sezioni di
   `atteso.json`.
   - Stessi `status`.
   - Stesse righe per sezione.
   - Gli stessi valori campo per campo, escluse date e durate.
   - Una differenza si spiega nella PR, oppure si corregge il parser. La soglia della prova non si cambia.
8. **Manuale**: una sezione in `docs/modules/acquisition.md` con modello e firmware collaudati, comandi, cosa non si legge e
   perché, e la riga «nato da un'estrazione del tecnico, <AAAA-MM-GG>».
9. **Righe nella documentazione**:
   - `CHANGELOG.md` sotto «[Non rilasciato]», col perché;
   - `TASKS.md`, una riga con «Riccardo:» e la data.

## B.1 Prove della parte B (tetto 2 minuti, REGOLA #3)

```
node --import tsx --test src/lib/acquisition/__tests__/<id>-parsers.test.ts src/lib/acquisition/__tests__/contratto.test.ts src/lib/acquisition/__tests__/catalogo.test.ts
npx eslint src/lib/acquisition/<id>*.ts src/lib/acquisition/catalogo.ts src/lib/acquisition/comandi.ts
npx tsc --noEmit
```

Non lanciare suite intere, il build o revisori. Una prova più lunga di 2 minuti non si lancia: la scrivi come «non
verificato: X».

# Consegna (vale per A e per B)

1. Lavora su un ramo `claude/<id>-collector` (o `claude/import-estrazione` per A) partito da `origin/dev`.
2. `git add` dei soli file tuoi, mai `git add -A`. Poi `npm run version:release -- --staged-only` e `git push`.
3. PR verso **`dev`**. Nella descrizione metti:
   - modello e firmware;
   - le sezioni lette;
   - le differenze con `atteso.json`;
   - i comandi tolti dall'allowlist;
   - le prove lanciate e il loro esito.

   **Nessun IP, nome o seriale veri.**
4. A Riccardo, in italiano e del «tu»: cosa è fatto, come l'hai provato, cosa resta.

Da `dev` a `main` si passa solo col promote dall'interfaccia, deciso da Riccardo.

---

## Note per chi mantiene questo prompt

- La parte A è da fare una volta: quando è su `dev`, il §A.1 la fa saltare da solo. Il §A.2 si può allora accorciare a un
  rimando.
- Analisi e scelte di fondo: `docs/revisione/2026-11-09-estrazione-device-tecnico.md`.
