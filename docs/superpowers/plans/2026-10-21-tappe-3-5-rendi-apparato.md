# Tappe 3-5: «Rendi apparato», classificazione unica, voci pulite — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` (un agente per task, una revisione alla fine).
> Le caselle `- [ ]` tengono il conto.

**Obiettivo:** una finestra sola per trasformare uno o più IP in apparati, con prova e ricerca della
credenziale dentro; classificazione scritta in un punto solo, su host e apparato; voci dei menu senza doppioni.
**Architettura:** prima i dati (catalogo delle classificazioni canonico + migrazione + ruoli), poi la
scrittura unica della classificazione, poi il motore di prova/ricerca credenziali, infine l'interfaccia
(finestra, scheda, liste) e la verifica del wizard.
**Spec:** `docs/superpowers/specs/2026-10-15-credenziali-promozione-wizard-design.md` §3 (tappe 3-5) +
`docs/proposte/2026-10-21-tappe-3-5-interfaccia.md` (decisioni e controllo voci V1-V6). Tavola grafica
approvata: https://claude.ai/artifact/Bau7xtUrykchk2EsNQLPXZ
**Livello di controllo:** leggero (Riccardo, 21/10). Conversioni dei dati senza cautele speciali: le due
installazioni reali (hub 70791, DTS) sono di prova (Riccardo, 21/10).

## Vincoli globali

- Ramo `dev`, mai `main`. Ogni tappa chiusa: `npm run lint && npx tsc --noEmit && npm run build` verdi, prove
  mirate verdi, poi `npm run version:release && git push origin dev` (dev arriva da solo all'hub e a DTS).
  Albero condiviso: `git add` solo dei file toccati, mai `-A`.
- `src/lib/db.ts` ha copie gemelle di `upsertHost`, `updateHost`, `createNetworkDevice`, `updateNetworkDevice`,
  `syncNetworkDeviceFromHostScan`: ogni modifica va fatta in `db-tenant.ts` **e** in `db.ts` (CLAUDE.md regola 12).
- `db-tenant` si importa solo staticamente (ADR 0002). Rotte: `withTenantFromSession`, `requireAdmin` sulle scritture.
- Testo UI in italiano; badge a tinta piena con segno: ✓ `#1F7A4D` · ✕ `#8E1B20` · ● `#5B6B77` · ▲ `#FFD400`
  testo navy; niente colori nudi nei componenti dove esistono i token (`stile-stato-modulo.ts`, `--host-*`).
- Prove: `DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test <file>`; modello con DB tenant temporaneo
  `src/lib/devices/__tests__/crea-apparato.test.ts`, in memoria `src/lib/credentials/__tests__/apparato-archivio.test.ts`.
- Migrazioni: funzione esportata `migrateX(db)` chiamata in fondo a `getTenantDb` in `try/catch`
  (modello `migrateSnmpVersione`, `db-tenant.ts:538`); conversioni una tantum col segno in `tenant_settings`
  (`credentials/segni-t2.ts`, modello `db-tenant.ts:2035-2056`).
- Decisioni di Riccardo (21/10): Windows/AD **tetto fisso 3 tentativi per host**; credenziale **già fallita su
  quell'host = esclusa e detta** (con data), «Prova» a mano la rimette in gioco; **creazione ammessa senza
  credenziale provata**, con «▲ senza credenziale provata».

### Catalogo canonico (decisioni V3-V6, 21/10)

| Slug vecchio | Diventa | E inoltre |
|---|---|---|
| `server_windows` | `server` | piattaforma/vendor `windows` (se vuota) |
| `server_linux` | `server` | vendor `linux` (se vuoto) |
| `nas_synology` | `nas` | vendor `synology` (se vuoto) |
| `nas_qnap` | `nas` | vendor `qnap` (se vuoto) |
| `storage` | `nas` | — |
| `controller`, `controller_wifi` | `network_controller` | — |
| `fotocopiatrice` | `multifunzione` | — |
| `ont` | `modem` | — |
| `dns_server` `dhcp_server` `mail_server` `web_server` `database_server` `backup_server` `nfs_server` | `server` | ruolo `dns`/`dhcp`/`mail`/`web`/`database`/`backup`/`nfs` |

Etichette nuove: `nas` «NAS / Storage», `multifunzione` «Stampante multifunzione», `modem` «Modem / ONT»,
`network_controller` «Controller di rete», `unknown` «Non classificato»; tutte le etichette con iniziale
maiuscola e sigle giuste (Firewall, Switch, Router, IoT, VoIP, VM, PC, UPS, HMI, PLC, OT…).
Ruoli (`RUOLI_SERVER`): `dns` «DNS», `dhcp` «DHCP», `mail` «Posta», `web` «Web», `database` «Database»,
`backup` «Backup», `nfs` «NFS», `dc` «Domain controller».

## Casi da non dimenticare

1. Un produttore (classificatore, SNMP, seed dell'hub, MDM) emette ancora uno slug vecchio → la scrittura lo
   canonicalizza (T1, prova).
2. `backup_server` oggi fa scegliere il profilo `proxmox_pbs` (`proposta-apparato.ts:173`) → deve guardare il
   ruolo `backup` (T1).
3. Una scansione non deve cambiare la classificazione di un **apparato** scelta a mano (`syncNetworkDeviceFromHostScan`) (T2, prova).
4. Una prova fallita dal pulsante «Prova» oggi non lascia traccia → senza traccia non c'è «esclusa» (T3, prova).
5. Host Windows con 5 credenziali candidate → al massimo 3 tentativi, poi «fermata» (T3, prova).

---

## Task 1 — Catalogo canonico, ruoli dei server, migrazione

- [ ] fatto

**File**
- crea `src/lib/classification/canonico.ts` + prova `src/lib/classification/__tests__/canonico.test.ts`
- modifica `src/lib/device-classifications.ts` (liste, etichette, gruppi), `src/components/topology/topology-icons.tsx`
  (`TIPO`/`typeLabel` → `getClassificationLabel`), `src/lib/devices/proposta-apparato.ts:161-180` (pbs dal ruolo),
  `src/lib/db-tenant-schema.ts` (colonna), `src/lib/db-tenant.ts` + `src/lib/db.ts` (canonicalizzazione nelle
  scritture, migrazione), `src/lib/validators.ts` (accetta vecchi slug, li converte)

**Interfacce prodotte**
```ts
// canonico.ts
export const RUOLI_SERVER = ["dc","dns","dhcp","mail","web","database","backup","nfs"] as const;
export type RuoloServer = (typeof RUOLI_SERVER)[number];
export const ETICHETTE_RUOLI: Record<RuoloServer, string>;
export interface Canonica { classificazione: string; vendor: string | null; ruolo: RuoloServer | null }
export function canonicalizza(slug: string | null | undefined): Canonica; // slug sconosciuto/nullo → invariato, vendor/ruolo null
export function unisciRuoli(attuali: string | null, nuovo: RuoloServer | null): string | null; // JSON array ordinato, senza doppioni
```

**Cosa fare**
1. `canonico.ts` con la tabella del catalogo sopra. Prova: ogni riga della tabella; slug canonico invariato;
   `null`/`""` → `{classificazione: "unknown"...}` solo se così fa oggi `upsertHost` (verificare e mantenere).
2. `device-classifications.ts`: togliere gli slug vecchi da `DEVICE_CATEGORY_SLUGS`, `DEVICE_CLASSIFICATIONS`,
   `DEVICE_CLASSIFICATIONS_ORDERED` (i menu); etichette nuove e `unknown: "Non classificato"` in
   `CLASSIFICATION_LABELS`; `GROUP_BY_CLASSIFICATION` tiene anche le chiavi vecchie (dati non ancora convertiti)
   ma le nuove vanno nel gruppo giusto. `getClassificationLabel(slug)` = etichetta del canonico.
3. Colonna `server_roles TEXT` (JSON array) su `hosts` e `network_devices`: schema + `migrateServerRoles(db)`.
4. Canonicalizzazione **nelle funzioni di scrittura** (gemelle in `db.ts`): `upsertHost` (update e insert),
   `updateHost`, `createNetworkDevice`, `updateNetworkDevice`, `applyAttribution` (`attribution/persist.ts`),
   `syncNetworkDeviceFromHostScan`: lo slug passa da `canonicalizza`; se dà un ruolo lo aggiunge a
   `server_roles` (`unisciRuoli`); se dà un vendor e quello dell'apparato è vuoto/`other`, lo imposta.
   La lista `infraSpecific` (`db-tenant.ts:4253`) usa gli slug canonici.
5. Conversione una tantum `convertiClassificazioniV21(db)` col segno `classificazioni_v21` in `tenant_settings`:
   UPDATE di `hosts.classification`, `network_devices.classification`, `host_classification_history`
   escluso (storia), `device_classifications_custom` escluso; ruoli e vendor come al punto 4. Conteggi nel segno.
6. `proposta-apparato.ts`: `proxmox_pbs` quando la classificazione è `server` e i ruoli contengono `backup`
   (oltre che per il vecchio `backup_server` via canonicalizza).
7. Cercare con `rg --no-ignore` ogni uso rimasto degli slug vecchi in UI/filtri (`discovery/page.tsx:77-91`
   preset dei gruppi, `device-list-by-classification.tsx:131`, `api/devices/route.ts:28` `STORAGE_ALIASES`,
   `db-tenant.ts:3908,3942,6261-6316`, `topology/identity.ts`, `topology-icons.tsx`, `objects/[id]/page.tsx:2642`)
   e aggiornarlo al canonico; i classificatori (`device-classifier.ts`, `device-fingerprint-classification.ts`,
   `taxonomy.ts`, `legacy-projection.ts`, seed `db-hub.ts`) **possono** restare: la scrittura canonicalizza.
   Aggiornare le prove esistenti che asseriscono slug vecchi **sul valore scritto** (non quelle dei classificatori puri).

**Verifica** prova nuova (vista rossa prima) + `npm test` sui file toccati (`attribution`, `classification`,
`devices`, `topology`) + lint/tsc. Prova di migrazione: DB con host `server_windows`, `dns_server`, `nas_qnap`,
`ont` → `server`+vendor windows, `server`+ruolo dns, `nas`+qnap, `modem`; seconda apertura non rifà nulla.
**Commit** `feat(classificazione): catalogo canonico, ruoli dei server, conversione delle voci doppie`

## Task 2 — Classificazione scritta in un punto, nei due versi (tappa 5)

- [ ] fatto

**File** crea `src/lib/classification/scrivi.ts` + prova; modifica schema (`network_devices.classification_manual`),
`db-tenant.ts`/`db.ts` (`syncNetworkDeviceFromHostScan`, `updateHost`), `api/devices/[id]/route.ts:130-224`,
`api/hosts/[id]/route.ts`, `api/hosts/bulk-update/route.ts`, `api/devices/bulk/route.ts` (PATCH),
`devices/crea-apparato.ts`; crea `src/app/api/classificazione/automatica/route.ts`.

**Interfacce prodotte**
```ts
export interface Bersaglio { hostId?: number; deviceId?: number }
export function scriviClassificazione(db: Database.Database, b: Bersaglio,
  valore: string, opts: { manuale: boolean; ruoli?: RuoloServer[] | null }): { hostId: number | null; deviceId: number | null };
export function tornaAutomatica(db: Database.Database, b: Bersaglio): void; // classification_manual = 0 su entrambi
```
L'apparato ↔ host si abbina come fa oggi il codice (host dell'apparato = IP dell'host, stessa rete: riusare la
funzione esistente di abbinamento; cercarla, non scriverne una nuova). Scrive canonicalizzato (T1),
`device_type` dell'apparato ricalcolato con `resolveDeviceTypeForCreate`, `server_roles` su entrambi se passati.

**Cosa fare** colonna + migrazione; tutte le rotte sopra passano da `scriviClassificazione` (manuale = true per le
scelte dell'utente); `syncNetworkDeviceFromHostScan` salta gli apparati con `classification_manual = 1`;
rotta POST `/api/classificazione/automatica` `{hostId?|deviceId?}` (`requireAdmin`, `withTenantFromSession`).
Le scritture automatiche (scansioni, attribution) restano dove sono e rispettano il flag.

**Verifica** prove: apparato → host e host → apparato; scansione su apparato manuale non cambia; «torna
automatica» azzera entrambi; ruoli scritti su entrambi. lint/tsc.
**Commit** `feat(classificazione): un solo punto scrive su host e apparato, scelta a mano rispettata`

## Task 3 — Prova e ricerca della credenziale (motore)

- [ ] fatto

**File** crea `src/lib/credentials/trova.ts` + prova; modifica `api/credentials/[id]/test/route.ts` (su fallimento
`recordCredentialFailure`); crea `src/app/api/hosts/trova-credenziale/route.ts`.

**Interfacce prodotte**
```ts
export type EsitoTentativo = "riuscita" | "rifiutata" | "esclusa" | "fermata";
export interface Tentativo { credentialId: number; nome: string; esito: EsitoTentativo; motivo: string | null; quando: string /* ISO UTC */ }
export interface EsitoRicerca { hostId: number; trovata: { credentialId: number; nome: string } | null; tentativi: Tentativo[] }
export function candidatiPerHost(db, hostId: number, protocollo: ProtocolloApparato, porta: number):
  Array<{ credentialId: number; nome: string; esclusa: { dal: string; errore: string } | null }>;
export async function trovaCredenziale(db, hostId: number, protocollo: ProtocolloApparato, porta: number,
  prova: (credentialId: number) => Promise<{ ok: boolean; errore?: string }>): Promise<EsitoRicerca>;
export const TETTO_WINDOWS = 3;
```
Ordine dei candidati: validate sull'host (`host_credentials.validated = 1`), poi lista della rete
(`network_credentials` / `lista-rete.ts`), poi il resto dell'archivio dei tipi giusti
(`tipiCredenzialePerProtocollo`); senza doppioni. **Esclusa** = in `host_credentials` per quell'host/credenziale/
protocollo l'ultimo tentativo è fallito (`validated = 0` e `last_error` non nullo): non si prova, compare come
«esclusa» con `last_attempt_at`. Protocollo `winrm` (o tipo `windows`/`ad`): al più `TETTO_WINDOWS` tentativi
veri, poi i restanti «fermata». Ci si ferma alla prima riuscita. Ogni tentativo vero registra
`recordCredentialSuccess`/`recordCredentialFailure`. La prova vera riusa la logica di
`api/credentials/[id]/test` (estrarla in una funzione `provaCredenzialeSuHost(db, credentialId, host, porta)`
in `trova.ts` o accanto, e la rotta la chiama). Rispettare `credential-anti-lockout.ts`
(`shouldAttemptCredential`): se dice no → «fermata» col suo motivo.

Rotta POST `/api/hosts/trova-credenziale` body `{ host_ids: number[] (1..50), protocollo, porta }` →
`EsitoRicerca[]`, host in sequenza (`requireAdmin`). «Prova» a mano su una esclusa = la rotta test esistente
(che con un successo la riabilita).

**Verifica** prove con `prova` finta: ordine dei candidati; esclusa saltata e detta; tetto 3 su winrm con 5
candidati (3 rifiutate + 2 fermate); stop alla prima riuscita; fallimento registrato. lint/tsc.
**Commit** `feat(credenziali): ricerca in sequenza con esclusione delle fallite e tetto di 3 su Windows`

## Task 4 — Finestra «Rendi apparato» (un host e più host) — tappa 3

- [ ] fatto

**File** crea `src/components/devices/rendi-apparato-dialog.tsx` (e sottocomponenti nella stessa cartella se
servono); modifica `src/lib/device-product-profiles.ts` (helper varianti); sostituisce `PromoteHostDialog` in
`objects/[id]/page.tsx:16,749,2801` e i flussi di creazione in `discovery/page.tsx:1040,1094`,
`networks/[id]/network-detail-client.tsx:532,583`, `devices/device-list-by-classification.tsx:688`.
`promote-host-dialog.tsx` si toglie quando non ha più chiamanti.

**Interfacce**
```ts
export function variantiPer(vendor: string, classificazione: string): ProductProfileId[]; // profili che dicono qualcosa in più; [] o [uno] = campo nascosto
export interface RendiApparatoProps { hosts: HostDetail[] /* 1..50 */; open: boolean; onOpenChange(o: boolean): void; onCreated?(): void }
```
Usa: `proponiApparato`, `riallineaAlProtocollo`, `portaPerCredenziale` (`proposta-apparato.ts`), T3 (rotta
`trova-credenziale`, `candidatiPerHost` via una GET se serve: aggiungerla nella stessa rotta come GET con
`?host_id&protocollo&porta`), `POST /api/credentials/[id]/test`, `POST /api/credentials` (nuova voce),
creazione `POST /api/devices` (uno) / `POST /api/devices/bulk` (più).

**Cosa fare** (come la tavola, artboard «PROPOSTA»):
- Titolo «Rendi apparato — <IP>» (più host: «Rendi apparato — N host»); Nome + riga piccola «Proposto da: <fonte> · <confidenza>%».
- **1 Cos'è**: Classificazione (catalogo T1) · Piattaforma · **Variante solo se `variantiPer(...).length > 1`**.
  Niente «Tipo dispositivo», «Scan target», «Sottotipo»: dedotti (`resolveDeviceTypeForCreate`,
  `scanTargetHintFromProductProfile`, `vendorSubtypeFromProductProfile`, `applyProductProfileScanDefaults`).
  Classificazione `server` → campo **Ruoli** (scelta multipla, `RUOLI_SERVER`).
- **2 Come ci arrivo**: Protocollo + Porta con badge «● porta standard» / «▲ porta non standard».
- **3 Credenziale**: dall'archivio (filtrata per protocollo) + «Prova» con esito sulla riga; «nuova nell'archivio»
  (tipo per esteso da `CRED_TYPE_OPTIONS`, nome, utente, password → `POST /api/credentials`, poi Prova);
  «Trova in automatico» con riga viva e avviso Windows; esclusa mostrata «✕ <nome> esclusa: rifiutata il <data italiana>».
- **Più host**: blocchi 1-2 comuni, blocco 3 = tabella una riga per host (IP, nome, credenziale, esito, tentativi), «Trova in automatico su tutti».
- Piede: «▲ senza credenziale provata» (più host: «▲ N su M senza credenziale provata») se manca un successo; pulsante «Rendi apparato» sempre attivo con classificazione scelta.
- La classificazione scelta si scrive come manuale (via la creazione → T2).

**Verifica** lint/tsc/build; **una** verifica resa in locale a 1440 (Playwright, `npm run dev` su copia del DB
dell'hub come da CONTEXT §6 «Interfaccia»): finestra su un host e su 5 host da Discovery, screenshot nello
scratchpad. Prova unitaria di `variantiPer` (MikroTik switch → nascosta; HPE switch → 3; Proxmox → 2).
**Commit** `feat(apparati): finestra unica «Rendi apparato» con prova e ricerca della credenziale`; poi release + push (fine tappa 3).

## Task 5 — Scheda apparato, liste e wizard

- [ ] fatto

**File** `devices/[id]/page.tsx` (vicino a `DeviceCredentialsTable` r. 1962), `objects/[id]/page.tsx:2678-2722`,
liste Discovery e host della rete (colonna classificazione), `src/app/onboarding/onboarding-wizard.tsx` (solo se manca qualcosa).

**Cosa fare**
- Riquadro **«Credenziali assegnate»**: da `usataAdesso` (`devices/usata-adesso.ts`) + esito dell'ultimo test del
  binding (`test_status`, `tested_at` in ora italiana): «✓ <data>» / «✕» / «● non provata»; pulsanti «Prova adesso», «Cambia».
- Badge **«▲ senza credenziale provata»** sull'apparato senza nessun binding `success` (scheda + liste).
- Classificazione: badge grigio con lucchetto SVG (niente emoji) «scelta a mano» + pulsante «Torna automatica»
  (rotta T2); nelle liste un badge piccolo «a mano». Campo Ruoli visibile per i server.
- Wizard: verificare W1 (archivio unico — c'è), W3 (ripresa — c'è, `progresso`), W4 (CIDR vuoto — c'è); W2: tornare
  indietro e rifare Avanti non crea doppioni di router/DNS/AD/subnet (`goNext` r. 435): provarlo e correggere solo se duplica.

**Verifica** lint/tsc/build; una verifica resa a 1440 di scheda apparato e lista Discovery. **Commit**
`feat(apparati): credenziali assegnate e scelta a mano visibili in scheda e liste`; release + push.

## Task 6 — Chiusura

- [ ] fatto

CHANGELOG (il perché), CONTEXT §6 (catalogo canonico, ruoli, `classification_manual` sugli apparati, ricerca
credenziali, finestra nuova), TASKS.md, `docs/scheda-mappa.md`; verifica sull'hub che la versione sia arrivata
(`DA_COMMIT` della build attiva = ultimo commit, `ActiveEnterTimestamp` dopo il push) e che il segno
`classificazioni_v21` sia `done:` nel tenant 70791 (sqlite in sola lettura). Revisione unica a fine lavoro.
