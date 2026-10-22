# Pagina Opzioni e job di serie — piano di esecuzione

> Si esegue in linea (una sessione nuova che esegue i task in ordine) oppure con la skill
> `subagent-driven-development`. Le caselle `- [ ]` tengono il conto.

**Obiettivo:** un solo posto, `/settings/opzioni`, dove si vede e si cambia ogni funzione che si accende o si spegne,
e quattro job che nascono da soli su ogni appliance.
**Architettura:** un catalogo server (`src/lib/opzioni/`) dichiara ogni opzione una volta riusando le funzioni di
lettura e scrittura che esistono; due rotte (`GET /api/opzioni`, `PUT /api/opzioni/[id]`) lo espongono; la pagina e i
rimandi nelle pagine vecchie lo usano; il seme dei job sta in `applyTenantSchedulerDefaults`.
**Spec:** `docs/superpowers/specs/2026-10-22-pagina-opzioni-design.md` · **Tavola:** https://claude.ai/artifact/MFg8HqVhyS4dEzwiDoo1LX
**Livello di controllo:** leggero (deciso da Riccardo il 22/10/2026).
**Stato:** in esecuzione (sessione del 22/10 sera, worktree `.worktrees/da-ipam-opzioni`) · **Ultimo aggiornamento:** 2026-10-22 16:20 (aggiunti i Task 8 e 9 su richiesta di Riccardo)

## Vincoli globali

- Lavorare in un worktree staccato da `origin/dev` (sull'albero di DA-IPAM lavorano altre sessioni); push solo su
  `dev`; `main` solo con conferma di Riccardo (promote: `merge --no-ff origin/dev`, messaggio «promote: dev → main (vX)»).
- Ogni rotta: `requireAuth` (GET) / `requireAdmin` (PUT), `withTenantFromSession`; Zod v4 (`.issues`).
- `db-tenant` importato solo staticamente (regola 14 del CLAUDE.md).
- Job di serie, valori esatti: `arp_poll` 30 min rete NULL · `hypervisor_sync` via `setHypervisorSyncSchedule(true)`
  (03:00) · `dns_resolve` 1440 min · `fast_scan` 720 min per ogni rete, spalmati come `known_host_check`.
- Lapide: chiave `opzioni.job_di_serie.<tipo>` in `tenant_settings`, valore `{"acceso":false,"da":"<utente>","il":"<UTC>"}`.
- Interfaccia: colonne separate, levetta ACCESA navy pieno + testo bianco / SPENTA bianca bordo `#5B6B77`, esiti a
  tinta piena con segno ✓ ▲ ✕ ●, testo ≥ 13 px, ciano mai per il testo (link `#006C96`). Da scrivania: 1920 e 1280.
- Ogni task chiude con prove verdi del suo ambito; il cancello completo (`npm run lint && npx tsc --noEmit && npm test
  && npm run build`) a fine lavoro (Task 7).

## Casi da non dimenticare

1. Cliente senza reti: `fast_scan` non crea niente, gli altri tre sì → Task 2.
2. Job già esistente con intervallo scelto da un admin: il seme non lo tocca → Task 2.
3. Job cancellato dalla pagina dei job: scrive la lapide, al riavvio non torna → Task 2 e Task 5.
4. `leggi` che lancia: riga «✕ stato illeggibile (codice)», la pagina regge → Task 1 e Task 3.
5. Utente non admin: GET sì, PUT 403, pagina con levette ferme → Task 3 e Task 4.

### [x] Task 1 — Catalogo delle opzioni e prova di completezza

**File:** crea `src/lib/opzioni/tipi.ts`, `src/lib/opzioni/catalogo.ts`, `src/lib/opzioni/fuori-catalogo.ts`;
prova `src/lib/opzioni/__tests__/catalogo.test.ts`.
**Interfacce prodotte:** i tipi `Gruppo`, `Forma`, `TipoEsito`, `Opzione`, `StatoOpzione` esattamente come nella spec
§3.1; `export function catalogo(): Opzione[]` (statiche + una per ogni `scheduled_jobs` del cliente + le quattro di
serie anche se mancano); `export function leggiTutte(): Array<{ opzione: Opzione; stato: StatoOpzione }>` che cattura
l'eccezione di ogni `leggi` e restituisce `{ acceso: null, da: null, il: null, esito: { tipo: "errore", testo:
"stato illeggibile (<code o nome dell'errore>)" } }`.
**Cosa fare:** una voce per ogni riga del censimento della spec §1 (tabelle «Interruttori» e «Interruttori da
ambiente»), con `leggi`/`cambia` che chiamano le funzioni esistenti indicate nel censimento (es. letture →
`leggiInterruttore`/`scriviInterruttore`; hypervisor → `getHypervisorSyncSchedule`/`setHypervisorSyncSchedule`; pulizia →
`getPuliziaHostSchedule`/`setPuliziaHostSchedule`; moduli → le funzioni di `feature.ts` di ciascuno; notifiche →
`src/lib/notifications/config.ts`; DA-Link livello → la funzione dietro `/api/dalink/livello`). Esiti: letture da
`leggiEsiti`; job da `scheduled_jobs.last_run`; moduli dal registry. Le voci da file (`forma: "file"`) leggono
`process.env` e non hanno `cambia`. `fuori-catalogo.ts` esporta l'elenco con motivo della spec §3.6.
**Prove (prima del codice):** (a) ogni chiave `topologia.lettura.*` di `LETTURE`, `topologia.mappa.cavi`, ogni chiave
del censimento, ogni modulo di `tenant_features` e ogni tipo di `SCHEDULED_JOB_TYPES` è nel catalogo o in
`fuori-catalogo` con motivo; (b) id unici e stabili; (c) `leggiTutte` con una `leggi` che lancia restituisce la riga
d'errore e non lancia; (d) su un tenant vuoto le sei letture risultano accese di serie, la mappa spenta.
**Verifica:** `node --import tsx --test src/lib/opzioni/__tests__/catalogo.test.ts` → tutte verdi (viste fallire prima).
**Commit:** «Opzioni: catalogo unico degli interruttori».
**Fatto (22/10 sera):** `node --import tsx --test src/lib/opzioni/__tests__/catalogo.test.ts` → 7/7, viste fallire 5/7 col
catalogo rotto apposta (mappa tolta, lettura `host` tolta, cattura degli errori tolta). In più la (d) prova ogni `leggi`
su un cliente appena nato: nessuna riga «stato illeggibile». Scostamenti: `leggi`/`cambia` possono essere asincrone
(lo stato dei moduli in `tenant_features` si legge con `getFeatureStatus`, che è async) e quindi `leggiTutte` è async;
installa/disinstalla dei moduli estratti in `lib/modules/installa.ts` (le rotte /api/features e Opzioni fanno la stessa
cosa); etichette dei job spostate in `ETICHETTE_JOB` (`scheduled-job-types.ts`); due prove di MeshCentral che leggevano il
testo della rotta d'installazione ora leggono `installa.ts`.

### [x] Task 2 — Job di serie con lapide

**File:** crea `src/lib/opzioni/job-di-serie.ts`; modifica `src/lib/db-tenant.ts` (`applyTenantSchedulerDefaults`,
riga ~7028: nuovo passo (3) dopo il seme di `known_host_check`); modifica `DELETE /api/jobs` in
`src/app/api/jobs/route.ts` (scrive la lapide se il tipo è di serie); prova `src/lib/opzioni/__tests__/job-di-serie.test.ts`.
**Interfacce prodotte:** `export const JOB_DI_SERIE: ReadonlyArray<{ tipo: "arp_poll"|"hypervisor_sync"|"dns_resolve"|"fast_scan"; intervalloMinuti: number; perRete: boolean }>`;
`export function lapide(tipo): StatoInterruttore | null`; `export function scriviLapide(tipo, chi: string, adesso?: Date): void`;
`export function togliLapide(tipo): void`; `export function seminaJobDiSerie(): { creati: number }` (chiamata da
`applyTenantSchedulerDefaults`, che restituisce anche `jobsSeeded` sommati).
**Cosa fare:** crea solo i job mancanti e senza lapide; `fast_scan` uno per rete con `next_run` spalmato su 60 minuti
come `known_host_check`; `hypervisor_sync` passando da `setHypervisorSyncSchedule(true)`.
**Prove:** crea i quattro su un tenant con una rete; zero `fast_scan` senza reti; non tocca un `arp_poll` esistente a
15 minuti né uno spento senza lapide; con la lapide non crea; dopo `togliLapide` crea; il passo (1) del freno /22 non
spegne i `fast_scan` a 720.
**Verifica:** `node --import tsx --test src/lib/opzioni/__tests__/job-di-serie.test.ts` → verdi; `npm test` intero verde.
**Commit:** «Opzioni: quattro job di serie, con la lapide per chi li spegne».
**Fatto (22/10 sera):** `node --import tsx --test src/lib/opzioni/__tests__/job-di-serie.test.ts` → 7/7 (vista fallire: modulo assente).
Scostamento: il seme si chiama da `applySchedulerBootMigration` (`cron/scheduler-defaults.ts`) e non da dentro
`applyTenantSchedulerDefaults`, perché `db-tenant.ts` non può importare `opzioni/job-di-serie.ts` (ciclo d'import, lo
stesso motivo per cui esiste `scheduler-defaults.ts`). Fatto prima del Task 1, che ne usa la lapide.

### [x] Task 3 — Rotte `GET /api/opzioni` e `PUT /api/opzioni/[id]`

**File:** crea `src/app/api/opzioni/route.ts`, `src/app/api/opzioni/[id]/route.ts`; prova
`src/app/api/opzioni/__tests__/route.test.ts`.
**Interfacce:** GET → `{ puoCambiare: boolean, opzioni: Array<{ id, gruppo, nome, cosa, valePer, forma, diSerie,
scelte?, configura?, stato: StatoOpzione }> }`. PUT corpo `z.object({ acceso: z.boolean().optional(), valore:
z.string().max(64).optional() }).refine(almeno uno)` → 200 `{ stato }`; 404 id sconosciuto; 405 forma `file`; 403 non
admin; 403 opzione `valePer: "hub"` per un admin senza diritti sull'hub (stessa regola di `requireAdminOrOnboarding`
di `/api/settings`). Per i job: spegnere = `enabled=0` + `scriviLapide`; accendere = `togliLapide` + riaccende o crea;
poi `reloadTenantScheduler(tenant)`. Audit col canale audit del progetto (chi, opzione, prima → dopo).
**Verifica:** `node --import tsx --test src/app/api/opzioni/__tests__/route.test.ts` → verdi; aggiungere le due rotte
a `scripts/verifica-permessi.sh` / `api-auth-guards.test.ts` come le altre.
**Commit:** «Opzioni: rotte di lettura e cambio».
**Fatto (22/10 sera):** `node --import tsx --test src/app/api/opzioni/__tests__/route.test.ts src/lib/__tests__/api-auth-guards.test.ts`
→ 75/75; viste fallire 3 prove con le regole rotte apposta (tutti admin, nessun 405). Scostamenti: la logica sta in
`lib/opzioni/cambio.ts` (provabile senza sessione: `mock.module` non gira con tsx), le rotte sono sottili; la regola
dell'hub è quella di `/api/settings`, cioè admin o superadmin: oggi coincide con «admin», il ramo 403 vale per gli altri
ruoli. `scripts/verifica-permessi.sh` non va toccato: ricava i casi dal censimento delle rotte. Registro su journald
(`[opzioni] audit {utente: id, opzione, prima, dopo}`): il progetto non ha un canale di audit su file.

### [x] Task 4 — Pagina `/settings/opzioni` e voce di menu

**File:** crea `src/app/(dashboard)/settings/opzioni/page.tsx` (server: legge e passa), `src/components/opzioni/pagina-opzioni.tsx`
(client), `src/components/opzioni/levetta-opzione.tsx`, `src/components/opzioni/dialogo-spegni.tsx`; modifica
`src/components/shared/sidebar.tsx` (voce «Opzioni» dopo «Impostazioni», riga ~543, `active` su `/settings/opzioni`;
escludere `/settings/opzioni` dall'`active` di «Impostazioni» come già per `/settings/cosa-esce`).
**Cosa fare:** gli oggetti 2-10 e 13 della tavola, colonne e stili dei vincoli globali; filtri lato client;
ancoraggio `#<id>` che scorre alla riga e la evidenzia; dialogo di spegnimento col testo «Si ferma / Resta / Dopo gli
aggiornamenti: resta spento»; mutazioni con `fetch` + `router.refresh()`.
**Verifica:** Playwright sulla pagina resa in locale (`npm run dev:server`, dati finti di prova) a 1920 e 1280:
schermate in scratchpad, guardate; un non admin vede le levette ferme.
**Commit:** «Opzioni: la pagina».
**Fatto (22/10 sera):** app accesa in locale (porta 3111, dati nuovi nello scratchpad, cliente 70151 finto con due reti
/24 e /22). Al riavvio il seme vero ha creato 5 job (ARP, hypervisor, DNS, due scansioni veloci; la /22 non frenata).
Pagina guardata a 1920 (intera) e 1280 (niente scorrimento orizzontale); spento il giro ARP: dialogo con «Si ferma / Resta /
Dopo gli aggiornamenti», riga «spenta da prova il 22/10 alle 16:18» (ora italiana); `#job.arp_poll` scorre alla riga e la
evidenzia. Da viewer: scritta «Solo un amministratore può cambiarle», tutte le levette ferme, PUT → 403. Corretto in
corsa: «dopo gli aggiornamenti» ripetuto due volte nel dialogo dei job di serie. Scostamento: la pagina server passa solo
il nome del cliente e il componente legge `GET /api/opzioni` (la vista aggregata «tutti i clienti» la risolve la rotta);
dopo un cambio rilegge l'elenco invece di `router.refresh()`, che non rileggerebbe i dati del client.

### [x] Task 5 — Rimandi nelle pagine vecchie

**File:** crea `src/components/opzioni/riga-rimando.tsx` (`{ id: string; nome: string; stato: StatoOpzione }` → riga
dell'oggetto 11); modifica le pagine della spec §3.5: `src/app/(dashboard)/topology/dati/letture-card.tsx`,
`mappa-card.tsx`, `hypervisor-sync-card.tsx`; la scheda moduli in `src/app/(dashboard)/settings/page.tsx` e
`src/app/(dashboard)/settings/moduli/[key]`; notifiche, jobs (levetta di riga), sistema (pulizia), scansione (Naabu)
in `settings/page.tsx`; `src/app/(dashboard)/settings/mdm`; `src/app/(dashboard)/settings/cosa-esce`; il dettaglio
del controller in `src/components/controllers/`; `src/app/(dashboard)/networks/[id]`.
**Cosa fare:** togliere le levette di funzione (i moduli dei dati restano); al loro posto `RigaRimando`. Le prove
che cliccavano quelle levette passano alle rotte di Opzioni o vengono tolte col motivo nel commit.
**Verifica:** `npm test` verde; Playwright su `/topology/dati` e `/settings?tab=moduli` a 1920: rimandi resi, link
che porta alla riga giusta.
**Commit:** «Opzioni: le pagine vecchie rimandano qui».
**Fatto (22/10 sera):** `npm test` intero (DA_INVENT_DATA_DIR nello scratchpad) → 5393 passate, 0 fallite, exit 0.
Playwright a 1920: `/topology/dati` 8 rimandi (6 letture, mappa, hypervisor), il clic porta a
`/settings/opzioni#job.hypervisor_sync` con la riga evidenziata; `/settings/moduli/{patch_management,nis2_inventory,meshcentral}`
con i rimandi e nessuna levetta (`[role=switch]` = 0). Scelte fatte strada facendo:
- `GET /api/opzioni?ids=a,b` e `RigheRimando({ ids })`: ogni scheda legge solo le sue righe;
- moduli: «Installa» di Patch e Inventory porta a Opzioni; l'**assistente di MeshCentral resta** nella scheda (crea il server:
  accendere il solo flag, come faceva la vecchia rotta, lasciava il modulo inservibile) e da Opzioni MeshCentral si disinstalla
  ma non si installa (409 col motivo); «Disinstalla…» delle schede diventa «Disinstalla e cancella i dati…» (casella già
  spuntata): la disinstallazione semplice sta in Opzioni, cancellare i dati è un'operazione sui dati;
- la pulizia degli host chiede conferma anche ad **accendere** (campo `accendendo` del catalogo), come faceva la sua scheda;
- notifiche, MDM, Zabbix: i salvataggi dei moduli non toccano più l'acceso/spento (notifiche) o lo conservano com'è letto
  (MDM, Zabbix configurati; alla prima configurazione la casella resta);
- `/networks/[id]`: tolta la levetta acceso/sospeso della scansione periodica (vale per tutte le reti, da Opzioni); restano
  intervallo, crea e cancella della singola rete, che sono dati della rete; la frequenza degli apparati UniFi resta nella
  finestra del controller (è un campo del controller alla creazione);
- tabella dei job: la levetta di riga diventa lo stato con il link alla riga di Opzioni (`lib/opzioni/ancore.ts`, provato
  contro il catalogo in `ancore.test.ts`);
- `Cosa esce`: la scelta del livello diventa il rimando, le due descrizioni restano.

### [x] Task 6 — Documenti

**File:** crea `docs/adr/0032-pagina-opzioni-e-job-di-serie.md` (contesto 70151, decisioni della spec §2, cosa
diventa difficile); modifica `docs/MANUALE-UTENTE.md` (sezione «Opzioni»), `CHANGELOG.md` (il perché), `CONTEXT.md`
(fatto + trappola: «un interruttore nuovo va nel catalogo, o la prova fallisce»), `TASKS.md`, `docs/scheda-mappa.md`
se cambia lo stato.
**Verifica:** rilettura; nessun «spenta di default» residuo per le letture nei documenti (`rg -n "spenta di default"`).
**Commit:** «Opzioni: ADR 0032, manuale, changelog».
**Fatto (22/10 sera):** riletti; `rg -n "spenta di default" docs/MANUALE-* CONTEXT.md` → nessuna riga (restano solo negli
ADR 0029 e 0031, che sono storia). In più: il censimento del §1 messo nella spec (mancava); nel manuale corretto il
consiglio «fast_scan a 15 min su tutte le subnet», che contraddiceva freno /22 e job di serie. `scheda-mappa` invariata
(lo stato del progetto non cambia).

### [ ] Task 7 — Cancello, rilascio su dev, verifica su 70151

**Cosa fare:** cancello completo col codice di uscita letto (`cmd; ESITO=$?`, log nello scratchpad);
`npm run version:release`; riallineare su `origin/dev`; `git push origin HEAD:dev`. Sull'appliance di 70151 (VM 104
su PX01 172.20.40.191, `qm guest exec`): `systemctl start da-ipam-update`, versione nuova in `/api/version`; nel DB
`data/tenants/DEFAULT.db`: i job `arp_poll` (uno solo: il job 4 esisteva), `hypervisor_sync`, `dns_resolve`,
`fast_scan` per ogni rete; pagina `/settings/opzioni` aperta da Riccardo. Promote su `main` solo se Riccardo lo
conferma.
**Verifica:** esiti scritti qui sotto nel Registro.
**Commit:** la release.

### [~] Task 8 — L'aggiornamento non torna mai indietro, e l'installatore dichiara il ramo giusto

Incidente del 22/10 (70151): l'installatore aveva messo il commit `f2207f44` di `dev` (v0.9.813) chiamando «main» il
ramo locale; il primo giro di `da-ipam-update` puntava a `origin/main`, allora fermo a v0.3.322, e stava
**retrocedendo** l'appliance: l'ha salvata solo una compilazione fallita. `main` è stato riallineato il 22/10
(promote v0.9.873), ma la causa resta in due posti.

**File (DA-IPAM):** modifica `scripts/auto-update.sh` (prima del `checkout -B`, riga ~81, e prima di delegare a
`update.sh`); prova `src/lib/__tests__/auto-update-retrocessione.test.ts` che crea in una cartella temporanea un repo
«origin» con due rami (`main` a 0.3.0, `dev` a 0.9.0) e un clone a 0.9.0, ed esegue lo script con
`DA_INVENT_DIR`/`DA_INVENT_BRANCH` puntati lì (nessuna rete, nessun systemctl: lo script va reso eseguibile in prova con
una variabile `DA_INVENT_UPDATE_PROVA=1` che salta build e restart, oppure si estrae la guardia in
`scripts/lib/guardia-versione.sh` e si prova quella).
**Cosa fare:** confronto di versione semver fra `package.json` dell'albero e `git show origin/$BRANCH:package.json`;
se il ramo bersaglio è **più vecchio**: nessun checkout, riga `ERRORE: retrocessione rifiutata: installata vX, origin/<ramo>
vY — scegli il canale giusto da Opzioni o allinea <ramo>`, uscita 1 (il servizio resta «failed» e l'allarme sui job
fermi lo vede). Uguale o più nuovo: come oggi.
**File (Deploy-Appliance, repo separato `~/Progetti/Domarc/Deploy-Appliance`):** `core/consolidated-installer.sh`
righe ~185-225 e `lib/secrets.sh:137`: `DA_INVENT_BRANCH` si scrive dalla **stessa** variabile `branch` usata per il
clone; nelle due strade `rsync` (sorgenti da `DA_IPAM_SRC` o da `/opt/da-ipam` del PVE) il ramo si legge dalla sorgente
(`git -C <sorgente> rev-parse --abbrev-ref HEAD`, e se il commit non è contenuto in `origin/<quel ramo>` → `die` col
motivo); niente più valore di ripiego «main» silenzioso. Prova in `tests/` col modello di `tests/test_app_stack.sh`.
Push di Deploy-Appliance: chiedere a Riccardo (è ciò che scaricano i tecnici).
**Verifica:** la prova di DA-IPAM vista fallire sullo script di oggi (retrocede) e passare dopo; `bash tests/<nuova>.sh`
in Deploy-Appliance → exit 0; su 70151 `systemctl start da-ipam-update` con canale `dev` resta «Aggiornamento completato».
**Commit:** «auto-update: rifiuta la retrocessione» (DA-IPAM) · «installatore: DA_INVENT_BRANCH dal ramo installato» (Deploy-Appliance).

### [ ] Task 9 — Errore SSH che dice la causa vera

Incidente del 22/10 (70151): il router MikroTik chiudeva la connessione prima di presentarsi (servizio SSH limitato
ad altri indirizzi) e la pagina diceva «handshake SSH fallito… algoritmi crittografici legacy»: in
`classifySshError` (`src/lib/devices/ssh-transport.ts`, ~righe 500-525) qualunque messaggio con «handshake» diventa
`protocol_error` con quel suggerimento. Le credenziali erano giuste; si è perso tempo sulla pista sbagliata.

**File:** modifica `src/lib/devices/ssh-transport.ts` (tipo `SshErrorKind`, riga ~102: aggiungere `"closed_by_remote"`;
classificazione); il componente che mostra «Diagnostica SSH binding» / «dettagli» del test della credenziale (cercarlo
con `rg -n "Diagnostica SSH" src`); prova `src/lib/devices/__tests__/ssh-transport-classifica.test.ts` (o il file di
prova esistente di `classifySshError`, se c'è).
**Cosa fare**, testi esatti (italiano, con l'indirizzo `target` come oggi):
- `Connection lost before handshake` (e `kex_exchange_identification` / «closed by remote») → `closed_by_remote`:
  «<target>: il dispositivo chiude la connessione prima di presentarsi.» · suggerimento «Controlla gli indirizzi
  ammessi al servizio SSH del dispositivo (MikroTik: IP › Services › ssh › Available From) e il firewall in ingresso.»
- `Timed out while waiting for handshake` → `connect_timeout`: «<target>: nessuna risposta SSH entro il tempo.» ·
  «Porta 22 filtrata dal firewall, oppure il servizio SSH è spento.»
- `Handshake failed: no matching …` → resta `protocol_error` con il suggerimento sugli algoritmi di oggi.
- `raw` (testo grezzo della libreria, già in `SshErrorInfo`) visibile nei «dettagli» del test della credenziale, a
  carattere piccolo, mai IP o utenti oltre a quelli che la riga mostra già.
**Prove (prima del codice):** i tre messaggi grezzi danno i tre `kind` e i testi sopra; un messaggio sconosciuto resta
`unknown` col grezzo.
**Verifica:** la prova vista fallire sui due primi casi e poi verde; `npm test` verde.
**Commit:** «SSH: il rifiuto del dispositivo non è più "algoritmi legacy"».

## Registro

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo
