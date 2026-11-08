# Installazione «tecnico» con più profili cliente — piano di esecuzione

> Si esegue in linea (una sessione che esegue i task in ordine) oppure con la skill
> `subagent-driven-development`. Le caselle tengono il conto.

**Obiettivo:** il tecnico usa DA-IPAM sul suo PC con più profili cliente, superadmin e cambio di profilo, dati cifrati a riposo; le installazioni dai clienti non cambiano.
**Architettura:** un tipo d'installazione dichiarato da `DA_PROFILO` (assente = `installazione`, com'è oggi; `tecnico`). Il codice a tenant esistente fa da contenitore dei profili; `tecnico` aggiunge il freno della cifratura, un profilo nuovo pronto senza riavvio e un ingresso senza `DEFAULT`. L'invio al centrale arriva con le tappe 2-3 del piano del 07/11.
**Spec:** [ADR 0037](../../adr/0037-installazione-tecnico-multi-profilo.md); decisioni di Riccardo dell'08/11 in `TASKS.md`, sezione «2026-11-08 — Installer pulito su Debian e modalità tecnico multi-profilo».
**Livello di controllo:** completo (deciso da Riccardo l'08/11: tocca accesso e tenant).
**Stato:** in corso (approvato da Riccardo l'08/11, D1 com'è oggi) · **Ultimo aggiornamento:** 2026-11-08

## Vincoli globali

- `DA_PROFILO` assente o vuoto = `installazione`: nessuna differenza di comportamento da oggi, provata.
- Valori ammessi in questo piano: `installazione`, `tecnico`. Ogni altro valore (anche `centrale`, finché non lo aggiunge il Task 7 del piano 07/11) = l'app non parte, con un messaggio che dice il valore letto e quelli ammessi.
- `DA_PROFILO` si legge in un solo file, `src/lib/profilo.ts`; nessuna impostazione nel DB può cambiarlo.
- `tecnico`: l'app non parte se la cartella dati (`resolveDataDir()`) non sta su un volume cifrato; controllo che non sa rispondere = non parte.
- Codice del profilo in `tecnico` = `codcli` del gestionale, regola `CODCLI` di `src/lib/dalink/config.ts` (`/^[0-9]{3,8}$/`).
- `db-tenant` solo import statico (ADR 0002); ogni rotta con guardia e `withTenantFromSession`; schema con `ALTER TABLE` idempotente; niente `any`; testo dell'interfaccia in italiano, ≥ 13 px, palette Domarc, stati con doppio segnale.
- Mai push su `main`; rilascio con `npm run version:release -- --staged-only` e `git push origin dev`, solo a cancello verde (`npm run lint && npx tsc --noEmit && npm test && npm run build`, letto dal codice di uscita).

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
|---|---|---|---|---|---|---|
| S1 | [x] | Interruttore `DA_PROFILO` | in linea | — | senza variabile nulla cambia; valore sconosciuto blocca l'avvio | prova `profilo.test.ts` vista fallire + cancello |
| S2 | [x] | Freno della cifratura | in linea | S1 | `tecnico` non parte su disco in chiaro | prova con comandi finti + misura su una VM Debian con LUKS |
| S3 | [x] | Profilo nuovo pronto senza riavvio | in linea | S1 | in `tecnico` un profilo creato ha i job di serie e lo scheduler li carica subito | prova vista fallire |
| S4 | [x] | Ingresso del tecnico senza `DEFAULT` | in linea, reviewer | S1 | in `tecnico` nessuna sessione ricade su `DEFAULT`; ingresso sull'ultimo profilo | prove viste fallire + revisione |
| S5 | [x] | Selettore e pagina dei profili | in linea | S3, S4, proposta approvata | interfaccia approvata oggetto per oggetto, resa a 1280 | Playwright con dati finti |
| S6 | [x] | Deploy-Appliance: profilo e volume cifrato | sessione di Deploy-Appliance | S1, S2 | `config.yaml` `profilo: tecnico` scrive la variabile e prepara il contenitore LUKS | installazione su VM Debian di prova |
| S7 | [!] | Invio di ogni profilo al suo centrale | — | tappe 2-3 piano 07/11 | ogni profilo va al centrale del suo `codcli` | da scrivere con le tappe 2-3 |

## Casi da non dimenticare

1. Un'installazione cliente che ha già `DA_PROFILO` nell'ambiente per errore con un valore strano: non parte e lo dice (S1).
2. Il contenitore LUKS non aperto al riavvio: la cartella dati esiste ma è vuota; l'app non deve creare un hub nuovo in chiaro sotto il punto di montaggio (S2: il controllo gira prima di aprire l'hub).
3. Il superadmin con più profili che entra: oggi va su `__ALL__` e ogni pagina tenant fa 409 (S4).
4. Un profilo creato con un codice che non è un `codcli`: il centrale non lo riconoscerebbe (S3).
5. L'utente di servizio `DOMARC_USERNAME` su un'installazione `tecnico`: id 0, niente ultima istanza (S4).

## Decisione aperta (per Riccardo)

**D1 — Creazione e cambio di tenant sulle installazioni non «tecnico».** Riccardo, 08/11: «com'è oggi». Oggi sono accesi per il superadmin ovunque, utente di servizio compreso (misura dell'08/11); sull'hub 533 ci sono 2 tenant. Il piano li lascia così (spento = com'è oggi). Chiuderli sulle installazioni dai clienti è un passo a parte, dopo aver dichiarato il profilo dell'hub 533.

---

### [x] Task 1 — Interruttore `DA_PROFILO`

- **File:** crea `src/lib/profilo.ts`, `src/lib/__tests__/profilo.test.ts`; modifica `server.ts` (controllo all'avvio, prima di aprire l'hub).
- **Interfacce:**
  ```ts
  export type Profilo = "installazione" | "tecnico";
  export const PROFILI: readonly Profilo[];
  export function leggiProfilo(env?: NodeJS.ProcessEnv): { ok: true; profilo: Profilo } | { ok: false; letto: string };
  export function profilo(): Profilo;          // lancia se il valore non è ammesso
  export function isTecnico(): boolean;
  ```
- **Cosa fare:** `leggiProfilo` legge `DA_PROFILO`, toglie gli spazi; vuoto o assente = `installazione`. `server.ts` chiama `leggiProfilo()` per prima cosa: con `ok: false` scrive `console.error` col valore e i valori ammessi ed esce con `process.exit(1)`; con `tecnico` scrive una riga d'avvio `[Profilo] tecnico`. Nessun altro file legge `process.env.DA_PROFILO`.
- **Prova vista fallire:** assente/vuoto/spazi → `installazione`; `tecnico` → `tecnico`; `centrale`, `TECNICO`, `pippo` → `ok: false`; una prova che scorre `src/` e `server.ts` e fallisce se `DA_PROFILO` compare fuori da `profilo.ts` (stile `no-dynamic-db-tenant-import.test.ts`): è la prova di equivalenza, perché senza lettori nessun comportamento può cambiare.

Verifica: `node --import tsx --test src/lib/__tests__/profilo.test.ts` vista rossa prima di `profilo.ts` (esito 1), verde dopo; `DA_PROFILO=pippo npx tsx server.ts` → esito 1, nessun file creato; cancello `lint=0 tsc=0 test=0 build=0` (7636 prove, 0 fallite), 08/11.

### [x] Task 2 — Freno della cifratura

- **File:** crea `src/lib/profilo-cifratura.ts`, `src/lib/__tests__/profilo-cifratura.test.ts`; modifica `server.ts`.
- **Interfacce:**
  ```ts
  export type EsitoCifratura = { stato: "cifrato"; come: string } | { stato: "in_chiaro"; come: string } | { stato: "non_so"; motivo: string };
  export function cifraturaCartella(dir: string, esegui?: (cmd: string, args: string[]) => string): EsitoCifratura;
  ```
- **Cosa fare:** Linux: `findmnt -no SOURCE --target <dir>`, poi `lsblk -s -no TYPE <sorgente>`; un `crypt` fra le righe = cifrato. macOS: `fdesetup status` contiene `FileVault is On`. Comando assente, uscita non zero, sorgente vuota = `non_so`. In `server.ts`, con `isTecnico()`, prima di ogni import che apre l'hub: `cifrato` → riga d'avvio; altrimenti `console.error` col motivo ed esce. Con `installazione` il controllo non gira.
- **Prova vista fallire:** uscite finte con la forma vera di `findmnt`/`lsblk` (partizione LUKS, contenitore a file `loop` sotto `crypt`, disco in chiaro, comando che fallisce), `fdesetup` acceso e spento.
- **Misura:** su una VM Debian 13 di prova con contenitore LUKS a file montato sulla cartella dati: parte; smontato: non parte e non crea `hub.db`.

Verifica: prova verde, misura scritta in «Misure». — 08/11: `profilo-cifratura.test.ts` 12 verdi (3 casi aggiunti dopo la revisione visti rossi: più dischi, collegamento spezzato, macOS fuori dal volume di sistema); avvio `tecnico` su questo Mac con FileVault: parte. Misura sul vero, 08/11, PX-NAS VM 110 (Debian 13 con la ridotta), col contenitore del Task 6: `cifraturaCartella` (copiata dal ramo dev) dà «cifrato» sul volume aperto (`/dev/mapper/da-ipam-tecnico (crypt → loop)`, forma vera di `lsblk -s`), «in chiaro» su `/opt/da-ipam/data` e sulla cartella col volume chiuso (`/dev/sda1 (part → disk)`). L'avvio di `server.ts` con `tecnico` su quella VM non è provato: lì gira la 0.9.1011 di `main`.

### [x] Task 3 — Profilo nuovo pronto senza riavvio

- **File:** modifica `src/app/api/tenants/route.ts` (POST), `src/lib/cron/scheduler.ts` (esporta la ricarica di un tenant, oggi alle righe ~255-273); crea `src/lib/profili/nuovo-profilo.ts` e prova.
- **Interfacce:** `preparaProfilo(codice: string): { jobSeminati: number; jobCaricati: number }` — apre il DB del tenant, applica `applyTenantSchedulerDefaults` e `seminaJobDiSerie` dentro `withTenant`, poi ricarica lo scheduler di quel tenant.
- **Cosa fare:** in `tecnico` il POST valida `codice_cliente` con `CODCLI` (400 con frase italiana se no) e chiama `preparaProfilo`. In `installazione` il POST resta com'è (equivalenza: la prova chiama il POST senza variabile e confronta con il comportamento di oggi: niente job dopo la creazione).
- **Prova vista fallire:** in `tecnico`, dopo il POST il DB del profilo ha i 5 job di serie (misura dell'08/11) e lo scheduler ha le chiavi del tenant.

Verifica: prova e cancello. — 08/11: `nuovo-profilo.test.ts` vista rossa poi 4 verdi; a schermo (server `tecnico`, dati finti) profilo 70001 creato dalla finestra, log «Tenant 70001: 3 job ricaricati» senza riavvio; `CLIENTE-A` → 400 con la frase.

### [x] Task 4 — Ingresso del tecnico senza `DEFAULT`

- **File:** `src/lib/accesso/sessione.ts` (`istanzaIniziale`), `src/lib/api-tenant.ts` (`resolveSessionTenant`, `getServerTenantCode`), prove in `src/lib/accesso/__tests__/`.
- **Cosa fare:** solo con `isTecnico()`: all'ingresso il superadmin va sull'ultimo profilo usato, poi sul primo; mai `__ALL__` di serie (la vista aggregata resta sceglibile). Sessione senza tenant → 409 «Scegli un profilo», non `DEFAULT`. Con `installazione` le funzioni rispondono come oggi: la prova le chiama con gli stessi ingressi e confronta.
- **Prove viste fallire:** superadmin con due profili e ultima istanza vuota → primo profilo in `tecnico`, `__ALL__` in `installazione`; `resolveSessionTenant(null)` → errore in `tecnico`, `DEFAULT` in `installazione`.

Verifica: prove, cancello, revisione `reviewer` del passo. — 08/11: `ingresso-tecnico.test.ts` vista rossa poi 8 verdi; prove esistenti `sessione.test.ts` e `resolve-session-tenant.test.ts` verdi senza modifiche. Revisione: nessuna differenza col profilo `installazione`; corretti i tre difetti medi (ripiego su `DEFAULT` in `getTenantMode`/`getServerTenantCode`, falso «cifrato» su più dischi, FileVault del volume sbagliato) e i minori (collegamento spezzato, commento sull'ordine in `server.ts`, note nell'ADR).

### [x] Task 5 — Selettore e pagina dei profili

- **Prima di scrivere:** proposta oggetto per oggetto a Riccardo (regola 15, `docs/STILE-UI.md`); si scrive solo la proposta approvata.
- **File (previsti):** `src/components/shared/tenant-switcher.tsx`, `src/components/shared/sidebar.tsx`, `src/app/(dashboard)/tenants/page.tsx`; mattoni da `src/components/shared/console.tsx`.
- **Cosa fare:** in `tecnico` il selettore del profilo sta in alto nella barra e cambia profilo con un clic; la pagina «Profili» elenca i profili. In `installazione` barra e pagina «Istanze» restano come oggi.

Verifica: Playwright con dati finti a 1280 px, in `tecnico` e senza variabile. — 08/11, browser dell'app a 1280×800, tema chiaro, server locale con cartella dati finta: senza profilo la dashboard rimanda a «Profili» con la fascia gialla «Nessun profilo scelto»; codice `70A` → ▲ e pulsante spento; profilo creato e aperto (fascia navy); cambio dal selettore con messaggio; profilo creato da un'altra scheda compare riaprendo il selettore; «Tutti i profili» → fascia gialla, `/networks` rimanda a «Profili». Stesso server **senza** variabile: «Istanze» e barra come oggi, nessuna fascia. Tema scuro non guardato.

**Proposta dell'08/11, approvata da Riccardo l'08/11 («Sì, tutta»); solo in `tecnico`:**

1. **Selettore del profilo, in cima alla barra** sotto il nome utente, al posto della riga «Istanza» di oggi: un pulsante a tutta larghezza alto 40 px, fondo `bg-primary/10` e bordo `border-primary/25`, icona edificio, ragione sociale in grassetto 14 px e sotto il `codcli` in monospazio 13 px, freccia ▾. Il clic apre un elenco a discesa con i profili (ragione sociale + `codcli`), il corrente col segno ✓ e il fondo `bg-selezione`, una casella «Cerca cliente» se sono più di 8, in fondo «Gestisci profili →». Il cambio è immediato, poi `toast` «Ora lavori su <ragione sociale>». Barra compressa: solo l'icona con il `codcli` nel `title`.
2. **Fascia del profilo in cima a ogni pagina** (alta 32 px, fondo navy, testo bianco 13 px): «Profilo: <ragione sociale> · <codcli>». Serve a non scrivere sul cliente sbagliato; si distingue per posizione e luminanza, non per colore.
3. **Vista «Tutti i profili»** (oggi `__ALL__`): resta sceglibile in fondo all'elenco, ma la fascia diventa gialla piena con testo navy e il segno ▲ «Vista di tutti i profili: sola lettura».
4. **Pagina «Profili»** (la voce «Istanze» si chiama così in `tecnico`): `IntestazionePagina` «Profili cliente» con «Nuovo profilo» (pulsante pieno); tre `TesseraNumero` (profili, host in tutti i profili, ultimo invio al centrale «—» finché non c'è il Task 7); un `Pannello` con la tabella: `codcli` (mono, grassetto), ragione sociale, host, ultima scansione, stato invio (● «non ancora previsto» grigio), azioni a destra «Apri» e «Modifica».
5. **Nuovo profilo**: finestra con due campi soli, `codcli` (solo cifre, 3-8, controllato mentre si scrive con la frase «Il codice cliente del gestionale») e ragione sociale. Alla conferma il profilo è pronto (job di serie, Task 3) e si apre.
6. **Cancellare un profilo**: non in questa tappa. Cancella un DB intero di un cliente sul PC del tecnico: si decide dopo, con l'invio al centrale.

### [x] Task 6 — Deploy-Appliance: profilo e volume cifrato

- **Dove:** repo Deploy-Appliance, coordinato con la sessione dell'installer Debian (nota nella cartella condivisa).
- **Cosa fare:** `config.yaml` con `profilo: tecnico` → `DA_PROFILO=tecnico` nell'ambiente dell'unità systemd; se la Debian non ha la radice cifrata, crea il contenitore LUKS a file (dimensione da `config.yaml`), lo monta sulla cartella dati, e l'unità dipende dal montaggio (`RequiresMountsFor=`). La passphrase la sceglie il tecnico, non si salva sul disco.

Verifica: installazione su una VM Debian 13 di prova; riavvio senza aprire il volume → DA-IPAM non parte. — 08/11: `primo-avvio/tecnico.sh` (`da-appliance tecnico attiva|apri|chiudi|stato`), [Deploy-Appliance#80](https://github.com/grandir66/Deploy-Appliance/pull/80). Scelte: contenitore LUKS2 a file sempre (anche con radice cifrata: un solo percorso), montato su `/var/lib/da-ipam-tecnico`, drop-in `40-tecnico.conf` con `ConditionPathIsMountPoint` al posto di `RequiresMountsFor` (senza voce in fstab non darebbe dipendenza), apertura esplicita dopo il riavvio invece di `crypttab` (una VM senza console non resta ferma all'avvio). Misura sulla VM 110: chiuso → systemd salta DA-IPAM, nessun file nella cartella; aperto → health 200. Aperti: `azzera` col contenitore, scelta «tecnico» in DA-Link.

### [!] Task 7 — Invio di ogni profilo al suo centrale

Bloccato dalle tappe 2-3 del piano `2026-11-07-installazione-snella-e-collegamento.md` (coda comune, fotografia completa, ricezione per `codcli`). Quando esistono: un gettone per profilo nel DB del profilo (non nell'hub), la fotografia costruita dentro `withTenant(profilo)`, il `codcli` dal gettone.

---

## Registro
- 2026-11-08 Piano approvato da Riccardo («Sì, D1 com'è oggi»)
- 2026-11-08 Task 1 → [x] (verifica: profilo.test.ts rossa poi verde; cancello verde)
- 2026-11-08 Task 5: proposta d'interfaccia approvata da Riccardo («Sì, tutta»)
- 2026-11-08 Task 2 → [x] e Task 6 → [x] (misura sulla VM 110 del PX-NAS, Deploy-Appliance#80); tema scuro guardato, fascia corretta
- 2026-11-08 Task 2 → [~], Task 3 → [x], Task 4 → [x] (revisione fatta, difetti corretti), Task 5 → [x] (resa a 1280)

## Misure

### Ricognizione — 2026-11-08 (worktree, cartella dati isolata; hub VM 533 in sola lettura)

- `createTenant` ×2 → nessun file finché non si apre; `AAA.db`, `BBB.db` alla prima `getTenantDb`.
- Rete scritta in AAA: 1 in AAA, 0 in BBB.
- Job in AAA dopo la creazione: 0; dopo `applySchedulerBootMigration`: 5 (8 seminati sui due tenant).
- `istanzaIniziale` per un superadmin con due tenant: `__ALL__`. `resolveSessionTenant(null)`: `DEFAULT`.
- Hub 533: 2 tenant attivi, 3 file in `tenants/`; utenti: 2 superadmin, 1 admin, 3 viewer; disco non cifrato.

## Consuntivo
### Fatto
Task 1-6.
### Mancante
Task 7 bloccato dalle tappe 2-3 del 07/11. Prova completa (DA-IPAM `dev` con `tecnico` su Debian con contenitore): quando il profilo arriva su `main` o con un DA-IPAM di `dev` sulla VM di prova. In Deploy-Appliance: `azzera` col contenitore e scelta «tecnico» in DA-Link.
### Scostamenti dal piano
- Task 4 tocca anche `getTenantMode` e `getServerTenantCode` (revisione): in `tecnico` senza profilo le liste mostrano l'aggregato e le pagine di un profilo rimandano a «Profili».
- Il selettore, all'apertura, fa ricaricare all'hub l'elenco dei profili: un profilo creato altrove non compariva fino al cambio.
- Ogni profilo nuovo passa dalla configurazione guidata (`onboarding_completed:<codice>`, comportamento già esistente per tenant).
### Consigli di sviluppo
- `/api/setup` in modalità `multi` crea il superadmin senza profili: va bene per `tecnico`; la modalità `single` accetta qualsiasi codice, da limitare a `CODCLI` quando l'installer Debian userà `tecnico`.
- Tema scuro guardato l'08/11: la fascia navy spariva nel fondo, ora è chiara col testo navy.
