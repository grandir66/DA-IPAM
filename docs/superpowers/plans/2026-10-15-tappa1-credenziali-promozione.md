# Tappa 1 — bug di credenziali, promozione e wizard + porta sulle credenziali — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** chiudere i bug confermati il 15/10 su promozione IP → apparato, credenziali e
wizard, e aggiungere la porta facoltativa sulle credenziali, in un rilascio piccolo; poi
Apple/macOS con una migrazione a parte.
**Architettura:** una colonna nuova (`credentials.port`), una regola unica tipo ↔ protocollo
in `src/lib/credential-protocol-map.ts`, una proposta d'apparato pura in
`src/lib/devices/proposta-apparato.ts` usata dalle quattro finestre di promozione; il resto
sono correzioni puntuali. La tappa 1b ricostruisce `network_devices` partendo dalla sua
definizione in `sqlite_master`.
**Spec:** `docs/superpowers/specs/2026-10-15-credenziali-promozione-wizard-design.md`
**Livello di controllo:** leggero (Riccardo, 15/10); il task 10 (migrazione) e la
conversione di dati del task 6 seguono il completo (backup, prova a vuoto sul dato vero,
conteggi prima/dopo), come dice la sua regola sulle zone rosse.

## Vincoli globali

- Si lavora in un worktree da `origin/dev`:
  `git -C ~/Progetti/Domarc/DA-IPAM fetch origin && git -C ~/Progetti/Domarc/DA-IPAM worktree add .claude/worktrees/credenziali-t1 -b credenziali/tappa1 origin/dev`.
  L'albero principale è condiviso con altre sessioni: mai `git add -A`.
- **`dev` arriva da solo all'appliance del cliente A** (pull + build + restart ogni 15
  minuti): si fonde in `dev` solo al task 9, dopo il cancello completo verde.
- Ogni funzione DB toccata va cambiata in **`src/lib/db-tenant.ts` e nella gemella di
  `src/lib/db.ts`** (regola `db-access`).
- `db-tenant` si importa solo staticamente (CONTEXT §7, prova `no-dynamic-db-tenant-import`).
- Una prova sola: `DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test <file>`.
  `credential-chains.test.ts` cade a caso nella suite intera e da solo passa (CONTEXT §6).
- Il cancello si legge dal codice di uscita (`cmd; ESITO=$?`), log nello scratchpad, mai in `/tmp` con nome fisso.
- Testi visibili in italiano; date del DB con `parseDbDate`; caricamenti con `fetchJson` + `LoadError`
  (regola `client-components`), mai `catch { setX([]) }`.
- Regola tipo ↔ protocollo (task 2), valori esatti:
  `ssh → ["ssh","linux"]`, `winrm → ["windows"]`, `snmp_v2|snmp_v3|snmp → ["snmp"]`,
  `api → ["api","ssh"]`, `redfish|onvif → ["api"]`.
- Porte standard: SSH 22, SNMP 161, WinRM 5985, API 443, Redfish 443, ONVIF 80
  (`DEFAULT_PORTS` in `src/lib/credentials/resolve.ts:63`).
- CHANGELOG.md (Keep a Changelog, italiano, **il perché**) si aggiorna nel task 9, prima del commit di rilascio.

## Casi da non dimenticare

1. Credenziale con porta propria in una catena di rete → il motore la propone su quella porta (task 1).
2. Host con `classification_manual = 1` → la proposta tiene la sua classificazione (task 3).
3. Apparato Proxmox (protocollo `api`) con credenziale di tipo `ssh` → resta sceglibile (task 2).
4. Tenant vecchio che passa prima dalle ricostruzioni «firewall» e «access_point» e poi da quella Apple → nessuna colonna persa (task 10).
5. Wizard ricaricato dopo il passo del router → il wizard ricompare (task 8).

---

## Task 1 — Porta facoltativa sulla credenziale

- [ ] **File**
  - modifica `src/lib/db-tenant-schema.ts:130-146` (colonna `port INTEGER` in `credentials`);
  - modifica `src/lib/db-tenant.ts:1343-1355` (aggiungi `{ name: "port", sql: "ALTER TABLE credentials ADD COLUMN port INTEGER" }` all'elenco `credV3Cols`, rinominalo `credColsNuove`);
  - modifica `createCredential` / `updateCredential` in `src/lib/db-tenant.ts:3816-3870` e `src/lib/db.ts:3733-3790` (campo `port` nell'INSERT e nell'elenco `keys`);
  - modifica `src/types/index.ts:201` (`port: number | null` in `Credential`);
  - modifica `src/lib/validators.ts` `CredentialSchema` (`port: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional().nullable())`);
  - modifica `src/app/api/credentials/route.ts` (POST passa `port`) e `src/app/api/credentials/[id]/route.ts` (PUT: `port` presente → aggiorna, `null` → torna standard);
  - modifica `src/app/(dashboard)/credentials/page.tsx` (campo «Porta» con segnaposto «standard (22)» secondo il tipo, colonna «Porta» in tabella che mostra «standard» se `null`);
  - modifica `src/lib/credentials/resolve.ts:254-287` (catena di rete e catene vecchie: porta `c.port ?? DEFAULT_PORTS[protocol]`, con JOIN su `credentials` anche nelle catene vecchie);
  - modifica `src/lib/scanner/discovery.ts:1619`, `:1924` (SSH: porta della credenziale, poi 22), `:2460` (validazione SSH: porta della credenziale se impostata, altrimenti quella rilevata), `:2492-2537` (validazione SNMP: `cred.port ?? 161` al posto di `161`);
  - prova `src/lib/credentials/__tests__/resolve.test.ts` (casi nuovi).
- [ ] **Interfacce prodotte:** `Credential.port: number | null`; una funzione `portaCredenziale(cred: Pick<Credential,"port">, protocol: CredProtocol): number` esportata da `src/lib/credentials/resolve.ts` (restituisce `cred.port ?? DEFAULT_PORTS[protocol]`), usata dai task 3 e 4.
- [ ] **Prova prima del codice:** in `resolve.test.ts`, una rete con una credenziale SSH `port = 2022` nella catena v2 e una nelle catene vecchie → il motore restituisce `port: 2022` per entrambe; senza porta → 22. La prova va vista fallire prima della modifica.
- [ ] **Verifica:** la prova sopra verde; `npx tsc --noEmit` senza errori.
- [ ] **Commit:** `feat(credenziali): porta facoltativa sulla credenziale (SSH 2022, SNMP fuori standard)`.

## Task 2 — Una regola sola tipo di credenziale ↔ protocollo

- [ ] **File**
  - modifica `src/lib/credential-protocol-map.ts`: nuova `export function tipiCredenzialePerProtocollo(protocollo: string | null | undefined): string[]` con i valori dei vincoli globali; `credTypeForProtocol(...).allowedPrimary` ne deriva (stesso valore), `CRED_TYPE_OPTIONS` resta;
  - modifica `src/components/shared/credential-assignment-fields.tsx:112-125` (il filtro della principale usa `tipiCredenzialePerProtocollo(protocol)`; serve la prop `protocol: string` passata da `src/components/shared/device-form-fields.tsx:616`; il vecchio `sshFilter` resta solo se serve ad altro, altrimenti si toglie);
  - modifica `src/components/shared/device-credentials-table.tsx:263-268` (`filteredCreds` usa la stessa funzione; per `redfish`/`onvif` vale `["api"]`);
  - modifica `src/app/(dashboard)/networks/[id]/network-detail-client.tsx:1526` (`primaryOpts` filtrate con la funzione);
  - crea `src/lib/__tests__/credential-protocol-map.test.ts`.
- [ ] **Interfacce prodotte:** `tipiCredenzialePerProtocollo` (usata dai task 3, 4, 5).
- [ ] **Prova prima del codice:** la tabella dei valori esatti; e che per `ssh`, `winrm`, `snmp` la regola contenga i tipi che accettano davvero `getSshLinuxCredentialPair` (`db-tenant.ts:3937`), la prova WinRM (`windows`) e `getCredentialCommunityString` (`snmp`).
- [ ] **Verifica:** prova verde; a schermo nel task 9.
- [ ] **Commit:** `fix(credenziali): una regola sola su quale credenziale vale per quale protocollo (Linux sceglibile per SSH)`.

## Task 3 — Proposta dell'apparato da un host, e dialog di promozione singola

- [ ] **File**
  - crea `src/lib/devices/proposta-apparato.ts`;
  - crea `src/lib/devices/__tests__/proposta-apparato.test.ts`;
  - modifica `src/components/devices/promote-host-dialog.tsx` (`buildInitialForm` 94-179 delega alla proposta; `onProtocolChange` 342; campi Modello/Seriale/Firmware 355-358 tolti: stanno già sull'host; `handleSubmit` 202-252);
  - modifica `src/components/shared/device-form-fields.tsx` (prop `senzaCredenzialiInline?: boolean` che spegne `showInlineCreds` e `showPortAndCommunity`, righe 627-630) e `src/components/shared/credential-assignment-fields.tsx` (porta controllata: props `port?: number` e `onPortChange?: (p: number) => void`; se presenti, il campo «Porta» è controllato e resta visibile anche quando l'inline è spento);
  - modifica `src/types/index.ts` (`classification_manual?: number` in `HostDetail`, dopo aver verificato che la GET dell'host la restituisca).
- [ ] **Interfacce prodotte:**
  ```ts
  export interface HostPerProposta {
    ip: string; hostname: string | null; custom_name: string | null;
    classification: string | null; classification_manual?: number | null;
    inferred_vendor: string | null; inferred_os_family: string | null;
    inferred_protocol: string | null; inferred_device_type: string | null;
    inferred_scan_target: string | null; device_manufacturer: string | null;
    os_info: string | null; model: string | null; vendor: string | null;
    snmp_data: string | null;
    host_credentials?: Array<{ credential_id: number; protocol_type: string; port: number; validated: number }>;
  }
  export interface CredenzialeArchivio { id: number; name: string; credential_type: string; port: number | null }
  export interface PropostaApparato {
    name: string; vendor: string; protocol: "ssh" | "snmp_v2" | "snmp_v3" | "winrm" | "api";
    classification: string;            // "" = da scegliere: il salvataggio è bloccato
    productProfile: string | null; scanTarget: string | null; port: number;
    credentialId: string | null; snmpCredentialId: string | null; useForArpPoll: boolean;
  }
  export function proponiApparato(host: HostPerProposta, archivio: CredenzialeArchivio[]): PropostaApparato;
  export function piattaformaDaHost(host: HostPerProposta): string;          // valore ammesso da network_devices.vendor
  export function classificazioneValida(valore: string | null | undefined): string; // slug di DEVICE_CLASSIFICATIONS o ""
  export function riallineaAlProtocollo(p: PropostaApparato, protocollo: PropostaApparato["protocol"], archivio: CredenzialeArchivio[], host?: HostPerProposta): PropostaApparato;
  ```
  Regole:
  - **piattaforma**: famiglia SO dedotta `windows` → `windows`, `linux` → `linux` (salvo marca di rete riconosciuta: `mikrotik`, `ubiquiti`, `cisco`, `hp` con classificazione switch/router/firewall/access_point), `macos` → `apple`; altrimenti `inferred_vendor` se è fra i valori della tabella (`src/lib/db-tenant-schema.ts:153`, più `apple`); altrimenti `inferVendorFromManufacturer`; ciò che non è ammesso diventa `other`. Mai `microsoft`, `dell`, `lenovo`, `juniper`, `fortinet`, `sonicwall`, `draytek`.
  - **protocollo**: `coerceProtocolForVendor(piattaforma, inferred_protocol ?? da SNMP)` (stessa funzione usata da `device-form-fields.tsx:302-309`); Windows → `winrm`, Linux/Apple → `ssh`.
  - **classificazione**: `classification_manual = 1` → `host.classification`; poi suggerimento endpoint Mac (`suggestEndpointClassification`), poi `inferred_device_type`, poi `host.classification`; tutto passa da `classificazioneValida` (alias `printer` → `stampante`, `macos` → `notebook`; ciò che non è in `DEVICE_CLASSIFICATIONS` diventa `""`).
  - **credenziale**: la prima `host_credentials` validata con protocollo compatibile **e** tipo in `tipiCredenzialePerProtocollo`; **porta** = porta di quella riga, poi `portaCredenziale` della voce d'archivio, poi lo standard.
  - **ARP**: `useForArpPoll` vero solo per `router` e `firewall`.
  - `riallineaAlProtocollo`: azzera `credentialId` se il tipo non è compatibile, ricalcola la porta; con SNMP mette in `credentialId` la credenziale SNMP e svuota `snmpCredentialId`.
- [ ] **Nel dialog:** il corpo del POST non manda più `community_string`, `model`, `serial_number`, `firmware`, `sysname`, `sysdescr`; manda `use_for_arp_poll: form.useForArpPoll ? 1 : 0` (0 esplicito); «Crea» è disattivato finché la classificazione è vuota, con la scritta «Scegli la classificazione»; la lista credenziali si carica con `fetchJson` e, se fallisce, mostra l'errore (non lista vuota).
- [ ] **Prova prima del codice** (host con la forma vera, presi dai campi di `hosts`): server Windows su hardware HP (`inferred_vendor: "hp"`, famiglia `windows`) → `windows` + `winrm` + 5985, profilo non ProCurve; PC con `inferred_vendor: "microsoft"` → `windows`; server Dell Linux → `linux` + `ssh`; MikroTik con SNMP → `mikrotik`; stampante con `inferred_device_type: "printer"` → classificazione `stampante`; host con `classification_manual: 1` e `classification: "nas"` → `nas`; host sconosciuto → classificazione `""`; credenziale SSH validata sulla 2222 → porta 2222; credenziale Windows validata e protocollo poi cambiato in SNMP → `credentialId` azzerato.
- [ ] **Verifica:** prove verdi; `npx tsc --noEmit`.
- [ ] **Commit:** `fix(promozione): proposta dell'apparato dal sistema operativo, credenziale e porta coerenti, niente campi finti`.

## Task 4 — API di creazione apparato, singola e in blocco

- [ ] **File**
  - modifica `src/lib/validators.ts:101-127` (`classification`: `z.enum(DEVICE_CLASSIFICATIONS)` facoltativa, come in `src/app/api/devices/bulk/route.ts:36`);
  - modifica `src/app/api/devices/route.ts:155-157` (`deviceClassification = data.classification ?? data.device_type`, niente più `"hypervisor"` di ripiego), `:201-218` (porta del binding SNMP da archivio = `portaCredenziale(cred, "snmp")`, non 161 fisso);
  - modifica `src/app/api/devices/bulk/route.ts:195-198` (stessa porta), `:202-220` (eredità dalle `host_credentials`: solo tipi compatibili con `tipiCredenzialePerProtocollo`);
  - prova: estendi la prova esistente delle rotte apparati se c'è (`rg -l "api/devices/route" src`), altrimenti crea `src/app/api/devices/__tests__/crea-apparato.test.ts` che chiama la funzione della rotta con un DB temporaneo.
- [ ] **Prova prima del codice:** POST senza classificazione e `device_type: "server"` → apparato e host salvati come `server` (oggi `hypervisor`); POST con `classification: "printer"` → 400 con messaggio italiano; binding SNMP da una credenziale con `port = 1161` → binding sulla 1161.
- [ ] **Verifica:** prove verdi.
- [ ] **Commit:** `fix(apparati): classificazione senza ripiego su hypervisor e porta SNMP dalla credenziale`.

## Task 5 — Le altre tre finestre di promozione

- [ ] **File**
  - modifica `src/app/(dashboard)/networks/[id]/network-detail-client.tsx`: stato iniziale 215-227 non più `server` + `other` + `ssh`; all'apertura (`setBulkAddOpen(true)`, riga 1340) si calcola `proponiApparato` per ogni host selezionato: se tutti danno la stessa piattaforma/protocollo/classificazione si usano, altrimenti classificazione `""` e «Aggiungi dispositivi» disattivato finché non si sceglie; con protocollo SNMP la tendina principale elenca le credenziali SNMP e la seconda (1555-1569) non si mostra; al cambio protocollo si chiama `riallineaAlProtocollo`; «Prova connessione» dice su quale host ha provato;
  - modifica `src/app/(dashboard)/discovery/page.tsx:1031-1053` (vendor e classificazione da `piattaformaDaHost` / `classificazioneValida`, via `dtMap printer→"printer"` e `hypervisor→"server"` per Proxmox);
  - modifica `src/app/(dashboard)/devices/device-list-by-classification.tsx:1067-1070` («Configura»: proposta invece di `vendor: "hp"`), `:319-345` (aggiunta in blocco: proposta per host), `:146-150` (stato azzerato alla chiusura).
- [ ] **Interfacce usate:** `proponiApparato`, `riallineaAlProtocollo`, `piattaformaDaHost`, `classificazioneValida` (task 3), `tipiCredenzialePerProtocollo` (task 2).
- [ ] **Verifica:** a schermo nel task 9 (la finestra dello screenshot di Riccardo: un host Windows selezionato deve aprire con `windows` + WinRM, non «server + Altro + UPS + SNMP v2»).
- [ ] **Commit:** `fix(promozione): le finestre in blocco partono dagli host selezionati, non da server+Altro+UPS`.

## Task 6 — Credenziali: pagina, API, binding

- [ ] **File**
  - modifica `src/app/(dashboard)/credentials/page.tsx:109` (in modifica la password non è obbligatoria; all'apertura in modifica il campo è vuoto con «lascia vuoto per non modificare»); campo «Username SNMPv3» visibile per `snmp` quando `security_level` è impostato (oggi il testo a 390-393 rimanda a un campo che non c'è);
  - modifica `src/app/api/credentials/[id]/route.ts:61-68`: `password`, `auth_key`, `priv_key` vuoti o assenti = **non modificare** (oggi `""` cancella); `username` resta com'è (la pagina lo manda precompilato);
  - modifica `src/components/shared/device-credentials-table.tsx:138-146` (binding inline SNMP: la community va in `inline_password`, `inline_username` resta `null`) e `:379-385` (pulsante «Test» nascosto per `api`, `redfish`, `onvif`);
  - modifica `src/app/api/devices/[id]/credentials/route.ts:155-156` (esito «non disponibile» → nessun `updateBindingTestStatus`, risposta con messaggio «Test non disponibile per questo protocollo»), `:241-245` (SNMP senza community → esito fallito «Community mancante», non `public`), `:32` (`inline_username_display` non mostrato ai viewer);
  - modifica `src/lib/db-tenant.ts` (conversione idempotente all'apertura del tenant, accanto alle altre migrazioni runtime: binding `protocol_type='snmp'`, `credential_id IS NULL`, `inline_username IS NOT NULL`, `inline_encrypted_password IS NULL` → `inline_encrypted_password = encrypt(inline_username)`, `inline_username = NULL`, in transazione, con conteggio nel log).
- [ ] **Controlli completi per la conversione** (scrive dati dei clienti): prima del rilascio, conteggio in sola lettura delle righe interessate sull'hub (il 15/10 erano 0) **e** sull'appliance del cliente A (accesso in `ACCESSI.md` + vault); se il cliente A ne ha, copia `.bak-YYYYMMDD-HHMMSS` del suo DB prima del rilascio e conteggio dopo.
- [ ] **Prova prima del codice:** PUT con `password: ""` → `encrypted_password` invariato; conversione su un DB temporaneo con una riga vecchia → community cifrata nel campo giusto, seconda esecuzione senza effetti; prova SNMP di un binding senza community → fallita con «Community mancante».
- [ ] **Verifica:** prove verdi.
- [ ] **Commit:** `fix(credenziali): modifica senza perdere il segreto, username SNMPv3, community inline al posto giusto, test senza ripieghi`.

## Task 7 — Le scansioni non cambiano la porta SNMP

- [ ] **File:** modifica `syncNetworkDeviceFromHostScan` in `src/lib/db-tenant.ts:3746-3800` e `src/lib/db.ts:6399` (con protocollo `snmp_v2`/`snmp_v3` la porta non si tocca: la 161 è UDP e non compare mai fra le porte TCP aperte); prova nuova accanto alle prove di `db-tenant`.
- [ ] **Prova prima del codice:** MikroTik con `protocol: "snmp_v2"`, `port: 161`, porte TCP aperte `[8291, 22]` → la porta resta 161 (oggi diventa 8291); con `protocol: "ssh"` e porta 22 chiusa ma 2222 aperta il comportamento di oggi non cambia.
- [ ] **Verifica:** prova verde.
- [ ] **Commit:** `fix(apparati): le scansioni non spostano la porta degli apparati letti in SNMP`.

## Task 8 — Wizard: i tre guasti

- [ ] **File**
  - modifica `src/app/onboarding/page.tsx:24-36`: se il flag `onboarding_completed:<tenant>` è assente **e** il tenant non ha dati, scrivi `setTenantOnboardingCompleted(tenantCode, false)` (da `@/lib/db-hub`) prima di mostrare il wizard; così il router creato al primo passo non lo fa più sparire alla ricarica;
  - modifica `src/app/onboarding/onboarding-wizard.tsx:255-266`: la rete manda `credential_ids` (lista nuova, quella che mostra la pagina della rete e che legge la validazione) con gli id spuntati, nell'ordine SNMP, SSH, Windows, Linux, al posto delle quattro catene vecchie;
  - modifica `src/app/onboarding/onboarding-wizard.tsx:82` (`useState("")`; il segnaposto «192.168.1.0/24» resta come suggerimento grigio a riga 587) e `:279` (controlla `res.ok` del completamento, come `finishAndExit`).
- [ ] **Rete a 192.168.0.0/24 (punto 4 di Riccardo):** sull'appliance dove ha fatto il wizard (chiederlo se non è scritto nel CONTEXT), in sola lettura: `SELECT id, cidr, name, created_at FROM networks ORDER BY id` e il registro d'audit della creazione; scrivere l'esito nel CONTEXT. Se non si riproduce, chiudere con «valore precompilato tolto, non riprodotto».
- [ ] **Verifica:** a schermo nel task 9 (wizard su un tenant vuoto: dopo il router, ricarica → il wizard c'è ancora; rete creata → la pagina della rete mostra le credenziali collegate).
- [ ] **Commit:** `fix(wizard): non sparisce alla ricarica, la rete mostra le sue credenziali, niente rete precompilata`.

## Task 9 — Verifica a schermo, cancello e rilascio della tappa 1

- [ ] **A schermo**, una volta, in locale coi dati finti (Playwright), a 1280 e 1920 (pagine da scrivania):
  la promozione singola di un host Windows e di un MikroTik; la finestra «Aggiungi dispositivi»
  della rete con un host Windows selezionato (confronto con lo screenshot di Riccardo); la
  pagina Credenziali con il campo Porta e lo username SNMPv3; il wizard su un tenant vuoto.
- [ ] **Una revisione** del diff complessivo (una sola, alla fine).
- [ ] **Cancello completo una volta**, perché `dev` arriva al cliente A:
  `npm run lint; L=$?; npx tsc --noEmit; T=$?; DA_INVENT_DATA_DIR=... npm test > "$SCRATCH/test.log" 2>&1; S=$?; npm run build; B=$?` e si va avanti solo con tutti a 0.
- [ ] **CHANGELOG.md** con il perché di ogni correzione; **CONTEXT.md** §6 con una voce datata
  (cosa è uscito, la trappola delle ricostruzioni a elenco fisso, l'esito della rete 192.168.0.0/24).
- [ ] **Rilascio:** si fonde `credenziali/tappa1` in `dev` dal worktree, `npm run version:release`,
  `git push origin dev`; hub con la skill `deploy-prod` (pull, `npm run build`, riavvio subito
  dopo); «gira davvero» si legge da `ActiveEnterTimestamp` o dalla riga d'avvio nel journal,
  non da `/api/version`. Sul cliente A il timer fa da solo: verificare il riavvio dopo ≤15 minuti.

## Task 10 — Tappa 1b: Apple e macOS (migrazione, controlli completi)

- [ ] **File**
  - modifica `src/lib/db-tenant-schema.ts:153` (`'apple'` in `vendor`) e `:177` (`'macos'` in `scan_target`);
  - modifica `src/lib/db-tenant.ts`: migrazione runtime nuova, **dopo** le ricostruzioni esistenti (righe ~998 e ~1395) e dopo quelle che aggiungono colonne a `network_devices`:
    1. legge `sql` di `network_devices` da `sqlite_master`; se contiene già `'apple'` e `'macos'` non fa niente;
    2. salva gli `sql` degli indici e dei trigger di `network_devices` (`sqlite_master WHERE tbl_name='network_devices' AND type IN ('index','trigger') AND sql IS NOT NULL`);
    3. costruisce il CREATE della tabella nuova **dalla definizione attuale**, sostituendo solo i due elenchi del CHECK e il nome della tabella (`network_devices__apple_new`), così nessuna colonna si perde;
    4. `foreign_keys = OFF`; in una transazione: CREATE, `INSERT … SELECT` di tutte le colonne, DROP, RENAME, ricreazione di indici e trigger; `foreign_keys = ON`; poi `PRAGMA foreign_key_check` e confronto del numero di righe, con log;
  - modifica, se contiene la tabella, `src/lib/db-schema.ts` (modello del DB vuoto) per coerenza;
  - crea `src/lib/__tests__/migrazione-apple-macos.test.ts`.
- [ ] **Prova prima del codice:** un DB costruito con la definizione **vecchia completa** (comprese `snmp_version`, `snmp_version_fissata` e le colonne della topologia), alcune righe e un `device_credential_bindings` collegato → dopo la migrazione stesse righe, stesse colonne, binding ancora collegati, `foreign_key_check` vuoto, un INSERT con `vendor='apple'` e `scan_target='macos'` riesce; seconda esecuzione senza effetti.
- [ ] **Prova a vuoto sul dato vero:** sull'hub, copia di ogni DB tenant in una cartella temporanea **sul server** (mai sul Mac: dati dei clienti), migrazione eseguita sulla copia con uno script `tsx`, conteggi prima/dopo e `foreign_key_check`; esito scritto nel CONTEXT con data e fonte.
- [ ] **Backup** `.bak-YYYYMMDD-HHMMSS` dei DB tenant dell'hub e del cliente A prima del rilascio (`du`/`df` prima di copiare).
- [ ] **Rilascio** come al task 9 (cancello completo, CHANGELOG, `version:release`, push `dev`, hub). Verifica: promozione di un Mac sull'hub che si salva.
- [ ] **Commit:** `feat(apparati): Apple e macOS accettati dalla tabella degli apparati (ricostruzione dalla definizione attuale)`.
