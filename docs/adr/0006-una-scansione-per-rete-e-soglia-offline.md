# ADR 0006 — Una scansione per rete, lucchetto in memoria, soglia offline con conferma per intersezione

**Stato:** Accepted
**Data:** 2026-10-13
**Autore:** riccardo.grandi@domarc.it
**Deriva da:** tappa 3 del piano di miglioramento
(`docs/superpowers/specs/2026-10-12-piano-miglioramento-design.md`), parte «scansioni»,
codici INV-1 e INV-2. Le singole correzioni sono nel `CHANGELOG.md` (T3-17…T3-22);
qui ci sono le scelte che le tengono insieme e il loro perché.

## Contesto

Lo stato online/offline degli host lo decide la fine di un giro di discovery: chi non ha
risposto passa offline. Fino alla v0.3.273 questa decisione si poteva sbagliare in tre modi.

- **Lo scheduler non aspettava il giro.** `discoverNetwork` tornava appena il giro era
  partito, il job risultava riuscito subito e `last_run` segnava la partenza. Il tick
  successivo poteva far partire un altro giro sulla stessa rete mentre il primo scriveva
  ancora: 21 accavallamenti nella storia di un'installazione. Un giro fallito risultava
  riuscito.
- **Più strade, nessun controllo comune.** Scheduler, «Esegui ora», pulsanti della pagina
  rete e l'aggiornamento automatico della pagina (un giro ogni due minuti) partivano senza
  sapere degli altri. Il giro partito prima spegneva, alla sua fine, host che il secondo
  giro o il controllo degli host noti avevano appena visto.
- **Un giro guasto spegneva tutta la rete.** Un ping che non esce, un apparato che filtra o
  un esecutore remoto che risponde male davano «nessuno risponde», e tutti gli host della
  rete passavano offline in un colpo.

Vincoli: l'applicazione gira in **un solo processo** (`server.ts`: Next e scheduler insieme);
il modulo `db-tenant` può essere caricato **due volte** nello stesso processo (vedi ADR 0002);
`dev` arriva da solo alle installazioni in 15 minuti, quindi un freno nuovo deve poter nascere
in sola osservazione.

## Decisione

**Un giro alla volta per rete e per tenant, tenuto da un lucchetto in memoria che si libera
solo a giro chiuso; a fine giro passano offline solo gli host non visti dopo la partenza, e
uno spegnimento in massa aspetta la conferma del giro dopo, per intersezione.**

1. **`last_run` vuol dire fine del giro.** I job di scansione attendono la promessa `done`
   di `discoverNetwork`, che si risolve sempre (mai rifiutata) con l'esito letto a giro
   finito. Un giro fallito fa fallire il job; un job su tutte le reti le scansiona una dopo
   l'altra.
2. **Il lucchetto vive in memoria**, in una mappa su `globalThis` con chiave
   `Symbol.for('da-ipam.scanner.network-lock')` e chiave «tenant:rete»
   (`src/lib/scanner/network-scan-lock.ts`). Sta in `discoverNetwork` perché è il punto da
   cui passano tutte le partenze. `globalThis` e `Symbol.for` fanno sì che due copie del
   modulo vedano lo stesso lucchetto; l'errore si riconosce con `isScanInCorso()` e non con
   `instanceof`, perché con due copie le classi sono due. In memoria basta perché il
   processo è uno solo, e un lucchetto in memoria non sopravvive a un crash: non c'è niente
   da ripulire dopo un riavvio.
3. **Nessun timeout libera il lucchetto.** Un giro che scrive ancora non deve trovarsi
   accanto un secondo giro. Oltre una soglia (100 minuti, il doppio del giro più lungo
   misurato; `scan_lock_alarm_minutes` per tenant) si scrive **una** riga d'allarme e il
   lucchetto resta preso. Un job che trova la rete occupata è «saltato»: non scrive
   `last_run` e non conta né come riuscito né come fallito; se salta per tre intervalli il
   controllo di salute lo vede fermo, ed è voluto.
4. **Il passaggio a offline guarda l'ora di partenza del giro.** La partenza si prende da
   `datetime('now')` del database, nella stessa forma e nello stesso fuso di `last_seen`;
   passano offline solo gli host con stato diverso da `offline` (gli `unknown` restano
   dentro) e `last_seen` nullo o anteriore alla partenza. Lettura dei candidati e scrittura
   usano lo stesso filtro, così il conteggio della soglia è esattamente ciò che si
   scriverebbe.
5. **La soglia applica per intersezione.** Se un giro spegnerebbe più di `offline_guard_pct`
   (50) degli host non offline fra gli indirizzi scansionati, e almeno `offline_guard_min`
   (5), in modo `applica` non scrive; il giro dopo manda offline solo i candidati presenti
   in **tutti e due** i giri. Ogni host spento davvero è candidato in due giri di fila,
   quindi la guardia non resta mai bloccata; un host tornato vivo esce dall'insieme da solo.
   I candidati in sospeso stanno in `tenant_settings` (una chiave per rete): un riavvio per
   aggiornamento non azzera la conferma. Il modo predefinito è `registra`: si spegne come
   prima e si scrive «qui avrei bloccato N»; il passaggio ad `applica` si fa per tenant,
   contando quelle righe.

## Alternative scartate

- **Lucchetto sul database** (riga per rete con proprietario e battito) — scartato per ora:
  il processo è uno solo, e un lucchetto su DB lasciato da un processo morto va riconosciuto
  e tolto, cioè serve proprio il timeout che qui si vuole evitare. Torna giusto il giorno
  in cui le partenze vengono da più processi (vedi sotto).
- **Timeout che libera il lucchetto** e **colonna `missed_scans`** — scartati: liberare la
  rete a un giro che scrive ancora ricrea l'accavallamento. Al loro posto l'allarme di
  durata e la soglia con conferma.
- **«Candidati diversi: si ricomincia a contare»** — scartato: con una rete che cambia
  davvero gli insiemi non coincidono mai e la guardia bloccherebbe per sempre.
- **Candidati in sospeso solo in memoria, o nelle impostazioni globali dell'hub** — scartato:
  un aggiornamento (che su `dev` arriva da solo) azzererebbe la conferma, e la decisione è
  per tenant.
- **`status = 'online'` nel filtro** — scartato: gli host `unknown` non passerebbero mai
  offline.
- **Lucchetto anche su letture ARP e DHCP** — scartato: non sono giri di discovery e non
  spengono host.

## Conseguenze

### Positive

- Due giri sulla stessa rete non scrivono più insieme; un giro vecchio non spegne host visti
  dopo la sua partenza. Sulla copia di un database vero (rete con 155 host, 25 online,
  T3-22): col codice di prima il secondo giro partiva, 5 host visti dopo venivano spenti e
  un giro senza risposte spegneva i 20 rimasti; col codice nuovo il secondo giro è
  rifiutato, 0 host visti dopo spenti, 0 scritture di stato nel giro senza risposte
  (soglia in `applica`).
- `last_run` e il tracker dei fallimenti dicono il vero: un giro fallito si vede.
- Il freno si toglie contando: in `registra` ogni scatto mancato lascia una riga
  `[SogliaOffline]`. Rigiocando la storia di un'installazione (2.172 giri) la soglia
  sarebbe scattata 11 volte, sempre confermata al giro dopo.

### Negative

- Con la soglia in `applica` un calo vero oltre soglia arriva con un giro di ritardo (un
  intervallo del job: 60 minuti sul job di scansione di un'installazione).
- Un giro appeso tiene la rete fino al riavvio del processo: l'allarme lo dice, ma non lo
  risolve.
- Un job che salta sempre (rete tenuta da un altro job allo stesso minuto) fa diventare rosso
  il controllo di salute: è voluto, ma va letto come «due job in conflitto», non come
  scheduler rotto.
- `last_run` cambia significato: chi lo leggeva come «partenza» ora legge «fine».

### Cosa diventa difficile in futuro

- **Scheduler in un processo a parte**, o più istanze dell'applicazione sullo stesso
  database: il lucchetto in memoria non vede le partenze dell'altro processo. Prima di
  separare lo scheduler serve un lucchetto sul database, con un proprietario, un battito e
  una regola scritta su quando un lucchetto orfano si può togliere.
- **Più edge per tenant** che scansionano la stessa rete scrivendo nello stesso tenant: il
  lucchetto è per processo e i candidati in sospeso sono per rete, con l'idea implicita che
  una rete abbia **uno** scrittore. Con più scrittori la conferma per intersezione
  mescolerebbe insiemi visti da punti diversi; servirebbe una chiave per rete **e**
  sorgente, o un solo coordinatore.
- **Nuove strade di partenza** di una scansione restano coperte solo se passano da
  `discoverNetwork`. Una scansione che scrive lo stato degli host per un'altra via è fuori
  dal lucchetto e dalla soglia.

## Questione aperta: la scansione veloce segna offline?

I commenti dicevano che la scansione veloce (`fast`) non manda offline i non rispondenti; il
codice lo fa, dopo ICMP e il secondo passaggio TCP, come la discovery completa (scelta
«rigorosa»). Quale delle due debba valere non è ancora deciso. Fino alla decisione **il
codice resta com'è** e i commenti in `jobs.ts` e `discovery.ts` descrivono ciò che il codice
fa. Con questo ADR la scansione veloce passa comunque dal filtro sulla partenza e dalla
soglia.

## Riferimenti

- `src/lib/scanner/network-scan-lock.ts`, `src/lib/scanner/offline-guard.ts`,
  `src/lib/scanner/discovery.ts` (fase finale), `src/lib/cron/jobs.ts`,
  `src/lib/cron/scheduler.ts`, `src/lib/health/scheduler-freshness.ts`,
  `src/lib/db-tenant.ts` (`selectOfflineCandidates`, `markHostsOffline`).
- Prove: `scansione-attesa.test.ts`, `network-scan-lock.test.ts`,
  `mark-hosts-offline.test.ts`, `offline-guard.test.ts`, `giri-sovrapposti.test.ts`;
  sul dato vero `scripts/prova-giri-sovrapposti.ts`.
- [ADR 0002](0002-static-db-tenant-import.md) — perché il modulo può esistere in due copie.
