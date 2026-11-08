# ADR 0037 — Installazione «tecnico»: più profili cliente sulla stessa installazione

**Stato:** Proposed
**Data:** 2026-11-08
**Autore:** Riccardo Grandi, con Claude

## Contesto

Riccardo, 08/11: «la possibilità di usare il sistema come tecnico memorizzando localmente più profili cliente, pensando alla modalità superadmin e multitenant». Il tecnico porta DA-IPAM sul suo portatile o su una VM Debian (installer pulito di Deploy-Appliance, sessione parallela) e lavora da più clienti, uno alla volta.

La decisione del 12/10 (`CONTEXT.md` §1) dice che un'installazione è un cliente e che il tenant non è un confine di sicurezza. L'ADR 0035 la conferma per le installazioni dai clienti e fa del tenant un confine solo nel centrale.

Misura dell'08/11 sul codice (prova nel worktree, cartella dati isolata) e sull'hub (VM 533, sola lettura):

- Il codice a tenant funziona: `createTenant` scrive la riga nell'hub, il DB `tenants/<codice>.db` nasce alla prima apertura, una rete scritta in A non si vede da B (`withTenant`).
- Un tenant creato **non ha job finché il servizio non riparte**: il seme dei job di serie (`applySchedulerBootMigration`) e il caricamento dello scheduler (`initializeScheduler`) girano solo all'avvio. Misurato: 0 job dopo la creazione, 5 dopo il passaggio d'avvio.
- Il superadmin con più di un tenant entra sulla vista `__ALL__`, dove ogni rotta tenant risponde 409; una sessione senza tenant scelto ricade su `DEFAULT`.
- **Creare e cambiare tenant oggi è già acceso ovunque per il superadmin**, compreso l'utente di servizio `DOMARC_USERNAME`: voce «Istanze» nel menu, `POST /api/tenants` con `requireSuperAdmin`, scelta in Impostazioni → Istanza. Sull'hub 533 ci sono 2 tenant attivi.
- Restano **comuni a tutti i tenant**: `settings`, `system_credentials` (credenziali di sistema), la chiave `ENCRYPTION_KEY` e il collegamento a DA-Link (`DALINK_CODCLI`, uno per installazione).

## Decisione

**Un terzo tipo di installazione, «tecnico», dichiarato dalla variabile del servizio `DA_PROFILO=tecnico`.** Solo lì si tengono più profili cliente (un tenant per `codcli`), col superadmin e il cambio di profilo. Le installazioni dai clienti restano a un cliente: la decisione del 12/10 non si riscrive, questa è un'eccezione voluta e limitata al tipo «tecnico».

1. **Interruttore: `DA_PROFILO` nell'ambiente del servizio.** È la stessa variabile che il piano del 07/11 prevede per il profilo «centrale» (Task 7): un solo posto dice che tipo di installazione è. Assente = `installazione`, cioè com'è oggi, bit per bit. Valore sconosciuto = l'app non parte. Deploy-Appliance la scrive nell'unità systemd dal suo `config.yaml`.
   Perché non un'impostazione nel DB: la cambierebbe dall'interfaccia un superadmin, anche l'utente di servizio su un'appliance di cliente. La variabile richiede root sulla macchina, e si legge prima di aprire i DB, che serve al freno della cifratura.
2. **Cifratura a riposo: disco cifrato, non DB cifrato.** Sul PC del tecnico la cartella dati (`DA_INVENT_DATA_DIR`) sta in un volume LUKS: la partizione cifrata se Debian è stata installata così, altrimenti un contenitore LUKS a file montato sulla cartella dati, che il tecnico apre con la sua passphrase all'avvio. La chiave non sta sullo stesso disco. Con `DA_PROFILO=tecnico` l'app **non parte** se la cartella dati non sta su un volume cifrato (`findmnt` + `lsblk -s`: un antenato di tipo `crypt`); su macOS vale FileVault acceso (`fdesetup status`). Freno chiuso: se il controllo non sa rispondere, l'app non parte e lo dice.
3. **Invio al centrale: previsto, non costruito.** Ogni profilo andrà al centrale del suo `codcli`, col suo gettone, quando esisteranno le tappe 2-3 del piano `2026-11-07-installazione-snella-e-collegamento.md` (coda, fotografia completa, ricezione per `codcli`). Il codice del profilo è il `codcli` del gestionale (stessa regola `CODCLI` di `lib/dalink/config.ts`), così il centrale lo riconosce senza tabelle di traduzione.

Cosa accende `tecnico` lo dice il piano `docs/superpowers/plans/2026-11-08-installazione-tecnico.md`; questo ADR fissa il tipo, l'interruttore e la cifratura.

## Alternative scartate

- **Un'installazione per cliente sul PC del tecnico** (N VM o N servizi) — confine più forte, ma N copie da aggiornare e da avviare su un portatile; il codice a tenant esiste già e funziona.
- **DB cifrato** (`better-sqlite3-multiple-ciphers` / SQLCipher) — cambia il modulo nativo per tutte le installazioni, clienti compresi; ogni apertura vuole la chiave; `sqlite3` da riga di comando, usato per la diagnosi, non legge più i file; e non copre log, salvataggi, `.env.local` e file temporanei, che restano in chiaro. Il disco cifrato copre tutto senza toccare il codice.
- **Interruttore in `settings` dell'hub o in `config.yaml` letto dall'app** — il primo si cambia dall'interfaccia (vedi sopra); il secondo è un file di Deploy-Appliance che l'app non legge oggi: lo traduce l'installer nella variabile.
- **Chiudere subito creazione e cambio di tenant sulle installazioni non «tecnico»** — cambierebbe il comportamento di oggi (l'hub 533 ha 2 tenant) e va deciso a parte: vedi «Cosa diventa difficile».

## Conseguenze

### Positive

- Nessun cambiamento sulle installazioni esistenti: senza variabile tutto resta com'è, con una prova che lo dice.
- I dati dei clienti sul portatile restano chiusi se il portatile si perde.
- Un solo interruttore per i tre tipi (installazione, tecnico, centrale).

### Negative

- Sul PC del tecnico `settings`, `system_credentials`, `ENCRYPTION_KEY` e collegamento DA-Link restano comuni ai profili: chi entra vede tutto. Va bene perché il tecnico è uno solo e superadmin; non va bene per più persone sulla stessa installazione «tecnico».
- Il tecnico deve aprire il volume cifrato a ogni avvio, o l'app non parte.

## Cosa diventa difficile in futuro

- Il tenant non è un confine di sicurezza (12/10): sul PC del tecnico l'isolamento fra profili è di comodo, non di sicurezza. Se un giorno un'installazione «tecnico» servisse più persone con clienti diversi, servono i muri del Task 8 del piano 07/11 (niente `DEFAULT`, chiave per cliente con HKDF).
- Creazione e cambio di tenant restano accesi per il superadmin anche sulle installazioni dai clienti, come oggi. Chiuderli lì richiede prima di dichiarare il profilo dell'hub 533, che ne usa 2.
- Un portatile che lavora offline accumula dati di più clienti: l'invio al centrale deve sapere da quale profilo viene ogni riga, e una cancellazione locale va propagata (già scritto nell'ADR 0035).
- Su Debian installata senza LUKS il contenitore a file è l'unica via: la sua dimensione si sceglie all'installazione e ingrandirlo è un'operazione da root.

## Riferimenti

- Decisione del 12/10 (`CONTEXT.md` §1), ADR 0035, piano `docs/superpowers/plans/2026-11-07-installazione-snella-e-collegamento.md` (Task 7, 8, tappe 2-3)
- `TASKS.md`, sezione «2026-11-08 — Installer pulito su Debian e modalità tecnico multi-profilo»
- Piano `docs/superpowers/plans/2026-11-08-installazione-tecnico.md`
