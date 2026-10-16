# DA-IPAM — passaggio di consegne

Leggilo per primo, poi [CLAUDE.md](CLAUDE.md) (stack e schema; su «multi-tenant» vale il §1). Ecosistema → `~/Progetti/Domarc/README.md`. Accessi: hub → skill `deploy-prod`; appliance dei clienti → vault `~/Documents/da-appliance-credentials/`, un file per appliance (repo pubblico: niente nomi di clienti, IP, MAC).
> **Manutenzione**: voci datate, tetto ~10k caratteri (`wc -c`); il dettaglio in ADR, spec e piani (`specs/…`, `plans/…` = `docs/superpowers/…`). Numeri di sezione fissi (altri file citano §6, §7). Il CHANGELOG lascia «[Non rilasciato]» anche dopo il rilascio: fa fede `git log origin/dev`.

## 1. Cos'è

> **Decisione 2026-10-12 (Riccardo) — non riaprire: la logica multi-tenant è morta, un'installazione = un cliente.** Il codice resta a tenant (hub + un DB per tenant) e `withTenantFromSession` resta obbligatorio (§7). Il tenant **non è un confine di sicurezza**: dati di un cliente visibili a un altro non sono difetti.

**DA-INVENT** (alias DA-IPAM): IPAM/inventario per appliance cliente + hub di moduli (`MODULE_DESCRIPTORS` in `src/lib/modules/registry.ts`, `access: native|external`). `agent/` = pacchetto Python, da togliere (C1b, §6).

> **Regola di Riccardo (12/10) — non riaprire:** le appliance dei clienti **non** si integrano in DA-Auth: niente `DAAUTH_URL` né pulsante Domarc. L'accesso Domarc vale solo per l'hub. Codice di T3-29 annullato: `git revert fbca510` per rimetterlo.

## 3. Flusso di rilascio (CRITICO)

- **Hub raggiungibile anche diretto** (`ssh root@192.168.4.8`): il salto via `192.168.40.4` cade a metà dei comandi lunghi (16/10, due volte). I lavori lunghi sul server (copie, prove a vuoto) si lanciano in sottofondo con `nohup` e log su file, e si legge il log.
- Branch: **`dev`** (unico pushabile). `main` avanza SOLO via promote in-app; le appliance cliente pullano `main`. Ogni modifica: `npm run version:release` + `git push origin dev`.
- L'hub (VM 533, `/opt/da-invent`) segue **`dev`**; dopo `git pull` sempre `npm run build`. **Mai `npm run build` senza riavviare subito**: il processo acceso carica i file a richiesta e si rompe.
- **ATTENZIONE: `dev` arriva anche all'appliance del cliente A** (`da-ipam-update.timer` ogni 15 minuti: pull + build + restart). Un push di codice su `dev` è un rilascio al cliente: su `dev` solo codice pronto. Un commit di soli `docs/` o `.md` non riavvia.
- `/api/version` cambia col pull, **prima del riavvio**: «gira davvero» = `ActiveEnterTimestamp` o riga d'avvio nel journal.
- `scheduler-defaults` spegne `fast_scan`/`ping_sweep` sotto i 720 minuti sulle reti ≥1024 indirizzi: riaccesi a mano, non reggono al riavvio.

## 5. Tooling

- `npm test` con `DA_INVENT_DATA_DIR` su una cartella temporanea (conteggio: `pass`/`fail` in fondo al log); `npx tsc --noEmit`; lint 0 errori. Permessi API: `src/lib/permessi/rotte.ts`, `scripts/verifica-permessi.sh` (solo locale).
- `credential-chains.test.ts` **cade a caso** nella suite intera (corsa sui profili SNMP dell'hub): da sola passa.
- Sul Mac `grep` è ugrep e salta i file ignorati da git: per contare, `rg --no-ignore`.

## 6. Stato e trappole per area (2026-10-15)

- **Rami aperti su origin**: `tappa3b/nucleo` (30 commit fuori da `dev`, rebase dal 20/10: non potare); gli altri sono già in `dev`.
- **NetBird e DA-Link** (ADR 0011, 0013, 0014; spec `specs/2026-10-14-netbird-rete-a-stella-design.md`; diario `plans/2026-10-14-netbird-dalink-programma.md`). Niente YubiKey (decisione 28). **C1** su `dev` dalla v0.3.282 (scelte in `plans/2026-10-15-tappa-c1-netbird.md`, pilota nel diario). Da fare: **C1b = togliere l'agente Python `agent/`** (decisione 26), dopo il pilota. **Trappole**:
  - Tailscale col firewall acceso scarta NetBird appena `tailscaled` riparte: nodi a doppio binario con `tailscale set --netfilter-mode=off`;
  - le policy NetBird verso le risorse hanno destinazione vuota: si leggono con `/api/networks`;
  - configurazione = `/etc/dalink/oggetto.env` (assente = niente rete; permessi ≠ 600 = rifiutata); il livello sta in `dalink_livello_registro` (hub), **non** in `settings`; la salute nel segnale conta solo i moduli accesi (le sonde dei moduli spenti dicono `fail`: normale);
  - la tabella nft `inet dalink` sta sul **prerouting** (sull'input NetBird mette `iifname "wt0" accept` e la scavalca) e restringe soltanto: con UFW serve anche `ufw allow in on wt0` (tappa G1).
- **Credenziali, promozione IP → apparato, wizard** (spec `specs/2026-10-15-credenziali-promozione-wizard-design.md`): tappe 1 e 1b il 15/10; 3-5 da fare (3 e 4: interfaccia proposta prima). Tappa 2 (piano `plans/2026-10-15-tappa2-archivio-credenziali.md`, rilasci 2c-2f autorizzati se prova a vuoto e conteggi tornano): 2a-2e su `dev` (v0.3.298-307, 16/10; backup `.bak-20261016-*`). 2e: H1 `parziale:` con 2 apparati lasciati (binding fallito verso la voce della colonna: «da-invent» SSH, «matteo_pc» WinRM), colonne intatte fino alla 2g. Prossima 2f (un `udm` ha chiave **o** utente, ADR 0019). Aperti: import per **unione** rotto su `tenant_settings.key` (c'era già: chi vince?); voce scelta già fallita su un apparato: resta esclusa e lo si dice (o «non provata»? Riccardo). Punti unici: tipo ↔ protocollo `credential-protocol-map.ts`, proposta d'apparato `devices/proposta-apparato.ts`. Backup `.bak-20261015-1540*` (hub ~2 GB): via dal 22/10 con l'ok di Riccardo. **Trappole**:
  - ricostruire `network_devices` partendo da `sqlite_master` (`devices/migra-apple-macos.ts`), in fondo a `getTenantDb`: le vecchie riscrivono un elenco fisso di colonne e perdono le altre;
  - un tenant più vecchio di `product_profile`/`physical_device_id` già non si apre (lo schema crea gli indici su quelle colonne prima delle migrazioni): non simularlo;
  - `credentials/resolve.ts` carica `db-tenant`: i componenti client usano `credentials/porte.ts`;
  - SNMPv3 non ha community (niente ripiego sullo username); segreti vuoti nel PUT = non modificare (`credentials/aggiornamenti.ts`); campi inline dei binding solo in modalità inline (`devices/aggiornamenti-binding.ts`);
  - il codice SNMP legge la porta 22 (default della colonna) come 161 e ogni altra come porta SNMP (`switch-client.ts`); 15/10: hub 6 SNMP sulla 22, nessuno su porte TCP. `SELECT port, count(*) FROM network_devices WHERE protocol LIKE 'snmp%' GROUP BY port` deve dare solo 161, 22 o vuota;
- **Piano di miglioramento (12/10)**: tappe in `specs/2026-10-12-piano-miglioramento-design.md`, decisioni in ADR 0004; bacheca `lavori piano-miglioramento-da-ipam`.
- **Controller di rete (ADR 0005, 0007)**: righe di `network_controllers` nel DB del cliente, `unifi_sync` spento di default; LLDP sull'apparato, mai nelle porte.
- **Mappa topologia** (spec `specs/2026-10-14-topologia-collegamenti-reali-design.md` §13): codice in `src/lib/topology/`; su `dev` fino a T2.5 (v0.3.299); letture accese il 15-16/10 (MikroTik e controller su hub e cliente A, host solo sull'hub, SNMP spento); T3 in corso (`plans/2026-10-15-topologia-collegamenti-T3.md`). Nodo 1 dell'hub: `lldpd` + servizio `i40e-fw-lldp-off` (indietro: spegnerli e `disable-fw-lldp off`, un porto alla volta). Mappa vecchia (ADR 0003) superata. **Trappole**:
  - fasi 1-2, 2b, verticale: in fondo ad ADR 0008, 0009, 0010, 0012 (prime: i vicini invecchiano in 90 giorni, non si cancellano; `is_uplink = 0` non vuol dire «non uplink»);
  - T1 (ADR 0015, altre trappole lì): modello **e** attribuzione leggono solo `source IN ('device','unifi')`; le fixture del modello non hanno VM (ADR 0010 n. 8): non coprono le VM; tornare indietro = revert **più** `scripts/ripristina-vicini-router.ts` (con l'ok di Riccardo);
  - T1b (spec §13.8.2): switch/router/AP nell'albero solo con una prova (`cavi/ruolo.ts`); dati finti con la prova di ruolo del dato vero; il disegno legge la classe della mappa, non `nodeClass`;
  - T2 (ADR 0018, altre trappole lì): letture in più **spente per cliente** (`topologia.lettura.*` in `tenant_settings`, da «Dati della mappa»); una fonte nuova non cambia né pota righe `device`/`unifi` (I33, R7); un «non so» non scrive mai un vuoto; la traccia solo admin, a richiesta; MSTP non disponibile (manca T2-a); colonne nuove di una riga `device`/`unifi` riempite anche da una fonte nuova (voluto: le legge solo il modello per cavo); esito in `topologia.lettura.<l>.esito`; «la mappa non cambia» si misura con le impronte di `misura-cavi` (da rifare se T1 cambia apposta); regola nuova di T1 = anche nel modello per cavo;
  - ritocchi (v0.3.285): **coordinate assolute** coi ritocchi degli antenati già applicati; `finish` li applica per profondità e `dragTweaks` deve risalvare anche i discendenti ritoccati, se no il ramo si spezza;
  - VM (v0.3.285): l'abbinamento per nome del nodo fra letture diverse vale **solo** per letture di cluster, perché «pve» è il nome di fabbrica; Proxmox: `network_devices.port` è la porta dell'**API**, l'SSH usa il binding SSH o 22.
- **SNMP, versioni (ADR 0016)**: net-snmp `createSession` **senza** `version` parla **v1**, `version: 1` è **v2c**. Sessioni a community **solo** da `protocols/snmp-sessione.ts`, versione esplicita (la sua prova fallisce se nasce un `createSession(` altrove). `snmp_version` NULL = ogni punto come prima, non una versione sola: lettura dati/client/sonda/STP/test binding v1, profilo vendor e walk NAS v2c; `snmp_version_fissata` = scelta a mano. airFiber del cliente A **solo v1**; in v1 un GET di più OID è tutto o niente (`snmp-get-tollerante.ts`).
- **DB dell'hub**: 4 pagine «never used» (`quick_check`): `VACUUM` a servizio fermo (`systemctl stop` lascia `failed`: normale). Il sqlite3 di Ubuntu non ha `.recover`: `.dump`. `DEFAULT.db` ricostruito il 13/10 (originale `.bak-20261013-*`). `data/tenants/.db` (0 byte, dall'11/06): innocuo, via solo con l'ok di Riccardo.
- Doc superata: `docs/audit*`, `docs/WAVE-0-report.md`, `ROADMAP-EVOLUZIONE.md`.

## 7. Trappola: `db-tenant` e le due istanze sotto `tsx` (2026-09-02)

L'appliance gira da sorgenti (`tsx server.ts`): **`await import()` di `db-tenant` dà una SECONDA istanza** con `AsyncLocalStorage` vuota: il contesto tenant si perde per tutto il processo e si scrive in `DEFAULT.db`, in silenzio. **Import solo statico** (prova `no-dynamic-db-tenant-import.test.ts`; leciti `require` e `typeof import`); difese e dettaglio in [ADR 0002](docs/adr/0002-static-db-tenant-import.md).

## 8. Analisi di sistema (2026-10-12)

`docs/analisi-sistema.md` è **solo locale** (`.git/info/exclude`: dettagli di sicurezza): sta in `~/Progetti/Domarc/DA-IPAM/docs/` sul MacBook, non nei worktree. Da non reintrodurre:

- `Select` ricava `items` dalle `SelectItem`; **date del DB con `parseDbDate`**, mai `new Date(x)`; pagine sul server con `timeZone: FUSO_UTENTI`; **un caricamento usa `fetchJson` + `LoadError`**.
- **`db.ts` e `db-tenant.ts` divergono**: guarda da quale importa il chiamante.
- **Scansioni (ADR 0006)**: `last_run` = **fine** del giro; lucchetto **in memoria** (separare lo scheduler vuole prima un lucchetto sul DB); la scansione veloce **manda** offline: da decidere.
- **Crescita del DB**: niente retention sugli storici; il più grosso è `mac_ip_history`.
