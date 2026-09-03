# ADR 0002 — `db-tenant` si importa staticamente, e le difese stanno nello scheduler

- **Stato**: Accettato
- **Data**: 2026-09-03

## Contesto

L'appliance Domarc (VM 533) esegue il servizio con `ExecStart=tsx server.ts`,
cioè **dai sorgenti**. Le altre installazioni (DTS, appliance cliente) girano il
build di Next, dove il bundler deduplica i moduli.

Il 2026-09-02, alle 18:00:01, `librenms-sync.ts` ha eseguito
`await import("../db-tenant")`. Riproduzione sull'appliance (Node 20.20.2 + tsx
4.21.0, quattro prove): quell'import restituisce una **seconda istanza** del
modulo, con la propria `AsyncLocalStorage` vuota — e da quel momento anche il
`require("./db-tenant")` del facade `db.ts` risolve **su quella**. Il contesto
tenant risulta perso per **tutto il processo**, fino al riavvio.

Il danno è stato duplice, e nessuna delle due parti era leggibile dal messaggio
d'errore:

- **340 job falliti in 4h40** con `Job #N non trovato`. Fuorviante: i job erano
  regolarmente a tabella, ma senza contesto `getDb()` ripiegava in silenzio sul
  tenant `DEFAULT`, che non li ha. L'indagine parte a cercare job mancanti.
- **179 host del tenant 70791 scritti dentro `DEFAULT.db`** fra le 18:00:02 e le
  18:00:06, dai `fast_scan` partiti prima dell'avvelenamento: dati finiti nel
  database di un altro tenant.

In cinque ore nessun allarme è scattato: il processo rispondeva e il DB era sano.

Regola precisa, misurata e non dedotta: è rotto **solo** l'import dinamico di
`db-tenant` stesso. Importare dinamicamente **altri** moduli è sano, anche
quando quelli importano `db-tenant` staticamente (verificato: nessuna seconda
istanza). I `require()` di `db-tenant` sono sani.

## Decisione

**`db-tenant` si importa staticamente, sempre**, e la verifica del contesto
tenant si fa interrogando la risoluzione del **facade**, non un import proprio.

Il primo perché è che l'import dinamico è invisibile sui build Next: senza un
presidio automatico il difetto non si scoprirebbe più in sviluppo, ma solo su
un'appliance, mesi dopo. Da qui il test invariante
`src/lib/__tests__/no-dynamic-db-tenant-import.test.ts`, che fallisce al rientro
di una delle forme incriminate e verifica anche di saper ancora riconoscere il
difetto (un invariante che non riconosce più il bug passa sempre, e rassicura a
torto).

Il secondo perché riguarda **dove** va la guardia. La prima versione confrontava
il contesto letto da `getCurrentTenantCode()` importato staticamente nello
scheduler: sbagliata, e sarebbe passata inosservata. `withTenant()` apre il
contesto **su quella** istanza, che quindi vede sempre il codice giusto —
l'istanza duplicata è l'altra, quella su cui risolve il facade, ed è da `getDb()`
che passano le scritture. Il controllo guardava il lato sano. Di conseguenza
`currentFacadeTenant()` vive **dentro `db.ts`**, accanto a `getDb()`: deve usare
la risoluzione di quel modulo, e un controllo ricostruito dal chiamante rischia
di interrogare l'istanza sbagliata.

Lo scheduler è il punto giusto per la guardia perché è il solo che **sa** quale
tenant ha aperto: `assertTenantContext()` gira dentro `withTenant` e prima del
job, e se la risoluzione diverge, il job **non parte** — così un contesto perso
costa un job non eseguito, non una scrittura nel database sbagliato.

Terzo: l'allarme legge dal **database**, non dalla memoria.
`scheduler-health-notify.ts` valuta `scheduled_jobs.last_run` (un job che
fallisce non lo aggiorna, quindi la stessa lettura copre sia i job che non
partono sia quelli che falliscono) e riusa l'anti-rumore di
`appliance-health-notify.ts`.

## Alternative scartate

- **Lasciare gli import dinamici e "stare attenti"**. È lo stato che ha prodotto
  l'incidente: due punti su tutta la base di codice, entrambi scritti in buona
  fede, invisibili in sviluppo.
- **Rimuovere il fallback silenzioso a `DEFAULT` in `db.ts`**. È la causa
  prossima dell'errore fuorviante, ma serve alle installazioni legacy
  single-tenant: trasformarlo in `throw` romperebbe l'esistente per correggere
  il nuovo. Si aggiusta il nuovo (guardia a monte), non il vecchio.
- **Esporre lo stato dei fallimenti a `/api/health`**. Lo stato in memoria vive
  nel processo dello scheduler; le route Next girano in un bundle separato e ne
  vedrebbero una copia sempre vuota — la stessa trappola delle istanze
  duplicate. Verso l'esterno resta `/api/health?strict=1`, che legge da DB.
- **Un timer systemd che interroga `/api/health?strict=1`**. Funzionerebbe, ma
  duplicherebbe un meccanismo che il progetto ha già (`appliance-health-notify`,
  cron interno + anti-rumore + fan-out SMTP/webhook) e vivrebbe fuori dal repo,
  su una macchina non-git.
- **Uniformare l'appliance al build di Next** per eliminare la classe di
  difetto. Più invasivo e cambia il modello di esercizio: da valutare a parte,
  non sotto incidente.

## Conseguenze

Positive: il contesto perso non produce più scritture fuori tenant; il messaggio
d'errore nomina la causa vera e dice che il processo va riavviato; un blocco
totale delle sincronizzazioni viene notificato entro 30 minuti invece di restare
muto per ore; il difetto non può rientrare in silenzio.

**Cosa diventa difficile in futuro:**

- **Il lazy-loading di `db-tenant` è precluso.** Se un domani servisse spezzare
  il modulo o caricarlo su richiesta (avvio più rapido, code-splitting lato
  server), il test invariante si opporrà: va cambiato consapevolmente, con un
  nuovo ADR, non aggirato con un commento.
- **La guardia costa una risoluzione del facade a ogni esecuzione di job.** È
  trascurabile oggi (23 job, una lettura di `AsyncLocalStorage`), ma è un
  controllo sul percorso caldo dello scheduler: chi lo renderà più ricco deve
  tenerlo O(1).
- **`currentFacadeTenant()` lega lo scheduler al facade `db.ts`.** Se un domani
  si volesse dismettere il facade in favore del solo `db-tenant.ts` (direzione
  già presa con la rimozione di `db-legacy.ts`, [ADR 0001](0001-remove-db-legacy.md)),
  questa guardia va riportata sul nuovo punto di accesso — altrimenti torna a
  controllare il lato sano, che è l'errore corretto qui.
- **L'allarme dipende dalla configurazione delle notifiche del tenant.** Se
  SMTP/webhook non sono configurati, `dispatchNotification` non spedisce e
  l'unico canale resta `/api/health?strict=1`: la copertura dell'allarme è buona
  quanto quella configurazione, e questo va detto a chi installa.
