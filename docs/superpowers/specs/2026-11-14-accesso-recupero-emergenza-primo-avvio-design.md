# Accesso: primo avvio, recupero ed emergenza — disegno (P0-2, tappa D)

**Data:** 2026-11-14 · **Stato:** proposta, da discutere con Riccardo. Niente codice finché non è approvata.
**Piano:** `TASKS.md`, «2026-11-14 — Piano di sicurezza: appliance autonoma», passo P0-2.
**Zona rossa:** autenticazione. Tocca anche Deploy-Appliance (primo avvio).

## Obiettivo

Il cliente entra, recupera l'accesso e gestisce un'emergenza **senza DA-Link, senza DA-Auth e senza Internet**, e
ogni via d'ingresso straordinaria è nominativa, tracciata e si può chiudere.

## Cosa c'è oggi (letto nel codice il 14/11)

| Cosa | Com'è | Dove |
|---|---|---|
| Primo avvio | `POST /api/setup` crea il primo utente finché la tabella utenti è vuota. Non chiede niente: chi raggiunge l'appliance per primo diventa superadmin. Deploy-Appliance lo chiama subito da `127.0.0.1`, quindi la finestra dura pochi secondi, ma solo se l'installatore arriva in fondo. | `src/app/api/setup/route.ts`, `Deploy-Appliance/core/ipam-installer.sh` |
| Utenza di servizio Domarc | Nome e password nel file delle chiavi (`DOMARC_USERNAME`/`DOMARC_PASSWORD`), generati dall'installatore. Entra come superadmin, senza codice, senza riga fra gli utenti: non si vede nell'elenco, non si revoca dalla pagina, non ha un nome di persona. Scelta di Riccardo del 20/10. | `src/lib/accesso/accesso-locale.ts`, `scripts/install.sh` |
| Password persa | Un altro admin la reimposta dalla pagina. Se è l'unico: `node scripts/reset-admin-password.cjs <utente> <password>` sul server. La password passa come argomento (resta nella storia della shell) e l'uso non lascia traccia nel registro degli accessi. | `scripts/reset-admin-password.cjs` |
| Telefono perso | `npx tsx scripts/seconda-verifica.ts azzera <utente>` sul server; lascia una riga nel registro degli accessi. | `scripts/seconda-verifica.ts` |
| Revoca | Dal 14/11 lo stato dell'utente si rilegge a ogni richiesta (tappa A). | `src/lib/accesso/sessione.ts` |

Tutte le vie di recupero di oggi chiedono **una shell sull'appliance**: le ha Domarc, non il cliente.

## Cosa manca rispetto all'obiettivo

1. **Primo avvio non protetto**: nessun segreto monouso lega il primo utente a chi ha installato.
2. **Il cliente non ha una via sua**: se perde password o telefono dell'unico admin, deve chiamare Domarc.
3. **L'utenza di servizio non è un accesso d'emergenza**: è permanente, condivisa, senza codice, invisibile al cliente.
4. **Il recupero della password non è tracciato** e mette la password nella storia della shell.

## Proposta, oggetto per oggetto

### 1. Codice di primo avvio (monouso)

- All'installazione Deploy-Appliance genera un codice casuale e lo scrive in un file 600 accanto alle chiavi
  (`primo-avvio.codice`). `POST /api/setup` lo chiede e, creato il primo utente, il file si cancella.
- Senza il file (installazioni vecchie già configurate) non cambia niente: il setup è già chiuso perché un utente c'è.
- Senza il file **e** senza utenti (caso anomalo): il setup risponde solo da `127.0.0.1`.
- Il tecnico lo legge dall'esito dell'installatore; la configurazione guidata dal browser lo chiede come primo campo.

### 2. Codici di recupero dell'amministratore (la via del cliente)

- Quando un admin attiva la verifica in due passaggi riceve **8 codici monouso**, da stampare. Nel database sta solo
  l'impronta (bcrypt), come per le password.
- Un codice vale al posto del codice dell'app, una volta sola. Usarlo lascia una riga nel registro degli accessi e
  mostra all'admin quanti ne restano.
- Copre il telefono perso senza chiamare nessuno. La password persa resta: un altro admin, oppure il punto 3.

### 3. Accesso d'emergenza del cliente (busta chiusa)

- Un'utenza apposta, **spenta di serie**, che l'admin crea dalla pagina Utenti: «Accesso d'emergenza». Alla creazione
  la pagina mostra **una volta sola** una frase lunga da stampare e chiudere in busta.
- Con quella frase si entra come admin **per 60 minuti**, senza codice. Ogni uso: riga nel registro degli accessi,
  avviso in cima alla pagina a tutti gli admin finché uno non lo prende in carico, e la frase **si consuma**: per
  riaverla va rigenerata.
- Si revoca dalla pagina Utenti come ogni altro utente (la tappa A la rende effettiva alla richiesta dopo).
- È l'unica via d'ingresso senza secondo fattore, per questo è monouso, a tempo e rumorosa.

### 4. Utenza di servizio Domarc

Tre strade, da scegliere:

- **A. Resta com'è** (scelta del 20/10). Nessun lavoro. Resta il punto più debole dell'accesso.
- **B. Diventa un utente vero** (consigliata): riga fra gli utenti, visibile al cliente come «Assistenza Domarc»,
  revocabile da lui, con la verifica in due passaggi come gli altri admin e ogni ingresso nel registro. La password
  esce dal file delle chiavi. Per Domarc cambia che serve il codice dell'app (un seme per appliance, nel vault).
- **C. Si toglie**: Domarc entra solo con l'accesso d'emergenza del punto 3, quando il cliente apre la busta.
  È la più pulita per il cliente e la più scomoda per l'assistenza.

### 5. Recupero dal server, tracciato

- `reset-admin-password.cjs` legge la password dallo **stdin** e non più dall'argomento, scrive nel registro degli
  accessi «riga di comando (<utente del sistema>)» come già fa `seconda-verifica.ts`, e chiude le sessioni di
  quell'utente (lo fa già la tappa A, perché cambia la password).
- Resta la via di Domarc quando il cliente ha perso tutto, busta compresa.

## Cosa non entra

- Domande di sicurezza, recupero per posta o SMS: vogliono Internet o sono deboli.
- Chiavi fisiche (FIDO2/passkey): buone, ma sono un lavoro a parte; il disegno non le impedisce.
- Il volume cifrato e dove stanno le chiavi: P0-3.

## Ordine proposto

1. Punto 5 (script tracciato): piccolo, nessuna interfaccia.
2. Punto 2 (codici di recupero): tocca la pagina dell'attivazione; tavola grafica prima.
3. Punto 1 (codice di primo avvio): insieme a Deploy-Appliance, da provare su un'installazione di prova.
4. Punto 3 (busta d'emergenza): pagina Utenti e avviso; tavola grafica prima.
5. Punto 4, secondo la strada scelta.

## Come si verifica («fatto quando»)

- Con la rete staccata: accesso, codice dell'app, codice di recupero e busta d'emergenza funzionano.
- Un `POST /api/setup` senza codice, da un'altra macchina, su un'appliance appena installata è rifiutato.
- Ogni uso di recupero o emergenza si legge nel registro degli accessi col nome di chi l'ha fatto.
- Revocata la busta o l'utenza di assistenza, un ingresso già aperto cade alla richiesta dopo.

## Domande per Riccardo

1. Utenza di servizio Domarc: strada A, B o C? **Riccardo, 14/11: B, «utente vero».**
2. Accesso d'emergenza: 60 minuti e ruolo admin vanno bene, o lo vuoi in sola lettura?
3. Codici di recupero: 8 monouso stampabili, sì o no?
4. Codice di primo avvio: va bene che lo generi Deploy-Appliance e lo mostri al tecnico a fine installazione?
5. Le appliance già installate: l'utenza di servizio si cambia con un aggiornamento o solo sulle nuove?
