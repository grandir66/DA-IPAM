# ADR 0035 — Vault: i segreti dalla pagina vanno subito in OpenBao (scrittura sincrona), poi si svuotano le colonne cifrate

**Stato:** Accepted (lavoro approvato da Riccardo la notte del 24-25/10, da confermare in revisione; il lancio sull'hub lo chiede l'orchestratore)
**Data:** 2026-10-25
**Autore:** Claude (sessione locale, ramo `claude/da-vault-svuota`)
**Modifica:** ADR 0034, sezione «Hub e OpenBao» (un segreto cambiato dalla pagina NON toglie più il riferimento) e il punto «letture dirette» delle conseguenze negative.

## Contesto

Dal 24/10 l'hub legge le credenziali dei device da OpenBao (`DA_VAULT_OPENBAO=1`, doppia lettura): le colonne cifrate di
`credentials` restano piene, e un segreto cambiato dalla pagina toglieva il riferimento (la voce tornava alla colonna e la
migrazione la riportava in OpenBao). Per finire il lavoro servono due cose: (1) che i segreti nuovi non entrino più nelle
colonne, (2) che le colonne si possano svuotare, con prova, e il file del database non conservi i valori vecchi.

Vincolo di struttura: la scrittura di una voce passa da `creaVoceDb` / `modificaVoceDb`, e queste sono chiamate da una
ventina di funzioni **sincrone**, molte dentro una `db.transaction()` di better-sqlite3 (apparati, binding, integrazioni AD,
controller UniFi/Omada). Una transazione di better-sqlite3 non può contenere un `await`. OpenBao è HTTP.

## Decisione

**La scrittura in OpenBao è sincrona (worker thread + `Atomics.wait`), dentro `creaVoceDb`/`modificaVoceDb`, solo con
`DA_VAULT_OPENBAO=1`; lo svuotamento è un comando a parte, a vuoto di serie, tutto o niente.**

- **Scrittura** (`credentials/scrittura-openbao.ts`, `archivio.ts`, `OpenBaoStore.putSync/getSync`, `vault/fetch-sync.ts`):
  - con l'interruttore acceso i segreti restano in chiaro in memoria, si controllano come sempre (campi richiesti,
    cosa cambia, cambio di forma) e vanno in OpenBao (`clienti/<codcli>/da-ipam/<nome>-<id>`, come la migrazione); la riga
    prende `credential_ref` e le **sei colonne restano vuote**. Si riscrive il segreto intero (KV v2 sostituisce): per una
    modifica si uniscono i segreti attuali — letti **ora** da OpenBao, non dalla cache — alle modifiche. Se i segreti non
    cambiano davvero (la pagina rimanda lo username precompilato) non si scrive e non nasce una versione nuova;
  - dopo `put` si rilegge e si confronta; la cache vede subito il valore (e un giro in corso non lo cancella);
  - **OpenBao spento, non configurato, che rifiuta o che rilegge un valore diverso = `503` con il motivo e niente
    scritto**, in una creazione la riga appena inserita si toglie. Mai un ripiego sulla colonna;
  - un **guardiano** in `creaCredenzialeDb`/`aggiornaCredenzialeDb` rifiuta un valore che non sia nel formato di `encrypt()`
    in una colonna segreta, con l'interruttore acceso;
  - interruttore spento: il codice di sempre (stessi valori nelle colonne, nessuna richiesta, nessun riferimento).
- **Letture** sul lettore unico (`segreti.ts`): `colonneChiareDb` (un valore: utente nel modulo di modifica, prova Windows,
  utente del controller), `utentiDelleVociDb` (gli account propri, una query), `presenzaSegretiDb` (i `ha_…` della maschera:
  dalle colonne di serie, da OpenBao col riferimento). Dopo lo svuotamento nessun'altra parte del codice legge le colonne
  cifrate di `credentials`.
- **Svuotamento** (`vault/svuota-colonne.ts`, `scripts/da-vault-svuota-colonne.ts`):
  - **a vuoto di serie**; `--applica` esplicito; `--verifica` dopo;
  - svuota **solo** le righe con riferimento il cui segreto in OpenBao (letto ora) è uguale alle colonne decifrate. Una riga
    con colonne piene e senza riferimento, un segreto mancante o diverso, una colonna illeggibile, OpenBao giù = **esce 2 e
    non tocca niente, in nessun cliente** (prima si confrontano tutti, poi si scrive);
  - per ogni cliente: copia in `<dati>/backups/` (API di backup di SQLite, `quick_check`), **una transazione** che ricontrolla
    ogni riga e porta a NULL le sei colonne, `wal_checkpoint(TRUNCATE)` e `VACUUM` (i valori non restano nelle pagine
    libere), `quick_check` finale. Il rapporto ha solo numeri, id e nomi di riga.

## Alternative scartate

- **Rendere asincrone `creaVoceDb`/`modificaVoceDb` e i venti chiamanti** — scartata: è il riscrivere le transazioni di
  apparati, binding, AD e controller in una zona rossa, per una scrittura rara.
- **Scrivere in OpenBao dopo il commit (coda/«outbox»)** — scartata: per un attimo il segreto non sarebbe da nessuna parte (o
  sarebbe nella colonna: il ripiego vietato), e un errore di OpenBao arriverebbe a transazione già chiusa.
- **Lasciare il segreto nella colonna e copiarlo in OpenBao** — scartata: è la doppia lettura che si vuole finire.
- **Un riferimento tolto a ogni modifica (la regola di ADR 0034)** — scartata: rimette il segreto nella colonna a ogni modifica
  e riempie di nuovo ciò che lo svuotamento ha appena vuotato.
- **Leggere la presenza dei segreti con una query SQL su OpenBao** — non esiste: la cache è in memoria; per la CTE delle
  pagine patch, che è SQL, la presenza è il riferimento.

## Conseguenze

### Positive

- Un solo punto scrive i segreti (`archivio.ts`), e nessuno li mette più in una colonna con l'interruttore acceso.
- Lo svuotamento è provato riga per riga, ripetibile, con il punto di ritorno (la copia) e senza residui nel file.
- Spento (appliance dei clienti) non cambia niente.

### Negative

- **Il thread del server si ferma** per la durata della richiesta di scrittura (millisecondi sulla rete interna; al massimo 5 s
  se OpenBao non risponde). Va bene per un'azione rara di un amministratore; non va usata per un percorso caldo. Le letture
  restano asincrone e dalla cache.
- Una scrittura riuscita seguita da un errore **più avanti nella stessa transazione** (es. la creazione di un apparato che
  fallisce dopo la voce) annulla la riga del database ma lascia il segreto in OpenBao: un percorso **orfano**, che
  `da-vault-migra-openbao --verifica` elenca. Ogni modifica dalla pagina crea una versione nuova del KV: servono
  `max_versions`/`delete_version_after` sul mount (già segnalato in ADR 0034).
- Le conversioni one-off (`converti-*.ts`, `normalizza-tipi.ts`, la migrazione UniFi `creaVoceControllerCifrataDb`) scrivono
  ancora nelle colonne (sono dati vecchi già cifrati, sotto un segno «fatto»): se una girasse dopo lo svuotamento, la riga
  avrebbe colonne piene e nessun riferimento, e `da-vault-svuota-colonne` la segnala (SENZA RIFERIMENTO).
- La policy `app-da-ipam` basta: `create`/`update`/`read` su `data/clienti/+/da-ipam/*` e `delete` sui metadata. Non serve
  cambiarla.

### Cosa diventa difficile in futuro

- Togliere la scrittura sincrona vuole rendere asincroni i chiamanti di `creaVoceDb`/`modificaVoceDb`.
- Una seconda app con la stessa esigenza (DA-Vul-can ha il suo lettore) non può riusare questo modulo senza il `better-sqlite3`
  e la tabella `credentials` di DA-IPAM.
- Le tabelle che cifrano senza riferimento (binding con segreto inline, integrazioni, AD, `system_credentials`) restano fuori
  dallo svuotamento: un passo a parte, se si vorrà.

## Riferimenti

- ADR 0034 (chiave degli slot, interruttori, doppia lettura); piano `docs/superpowers/plans/2026-10-23-da-vault.md`.
- Contratto: DA-Link `docs/context/SHARED.md` (percorsi, policy `app-da-ipam`, cache, doppia lettura).
- Codice: `src/lib/credentials/{archivio,scrittura-openbao,segreti,aggiornamenti,maschera}.ts`, `src/lib/vault/{openbao,fetch-sync,svuota-colonne}.ts`,
  `scripts/da-vault-svuota-colonne.ts`; prove in `src/lib/credentials/__tests__/{scrittura-openbao,letture-senza-colonne}.test.ts` e
  `src/lib/vault/__tests__/{fetch-sync,svuota-colonne,svuota-colonne-cli}.test.ts`.
