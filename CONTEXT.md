# DA-IPAM — passaggio di consegne

Leggilo per primo, poi [CLAUDE.md](CLAUDE.md) (stack e schema; su «multi-tenant» vale il §1). Ecosistema → `~/Progetti/Domarc/README.md`. Accessi: hub → skill `deploy-prod`; appliance dei clienti → vault `~/Documents/da-appliance-credentials/`, un file per appliance (repo pubblico: niente nomi di clienti, IP, MAC).
> **Manutenzione**: voci datate, tetto ~10k caratteri (`wc -c`); il dettaglio in ADR, spec e piani (`specs/…`, `plans/…` = `docs/superpowers/…`). Numeri di sezione fissi (altri file citano §6, §7). Il CHANGELOG lascia «[Non rilasciato]» anche dopo il rilascio: fa fede `git log origin/dev`.

## 1. Cos'è

> **Decisione 2026-10-12 (Riccardo) — non riaprire: la logica multi-tenant è morta, un'installazione = un cliente.** Il codice resta a tenant (hub + un DB per tenant) e `withTenantFromSession` resta obbligatorio (§7). Il tenant **non è un confine di sicurezza**: dati di un cliente visibili a un altro non sono difetti.

**DA-INVENT** (alias DA-IPAM): IPAM/inventario per appliance cliente + hub di moduli (`MODULE_DESCRIPTORS` in `src/lib/modules/registry.ts`, `access: native|external`). `agent/` = pacchetto Python, da togliere (C1b, §6).

> **Regola di Riccardo (12/10) — non riaprire:** le appliance dei clienti **non** si integrano in DA-Auth: niente `DAAUTH_URL` né pulsante Domarc. L'accesso Domarc vale solo per l'hub. Codice di T3-29 annullato: `git revert fbca510` per rimetterlo.

## 3. Flusso di rilascio (CRITICO)

- **Hub raggiungibile anche diretto** (`ssh root@192.168.4.8`): il salto via `192.168.40.4` cade a metà dei comandi lunghi (16/10, due volte). I lavori lunghi sul server (copie, prove a vuoto) si lanciano in sottofondo con `nohup` e log su file, e si legge il log.
- Branch: **`dev`** (unico pushabile). `main` avanza SOLO via promote (il pulsante dell'hub lascia l'app su `main`: si promuove da una copia del repo; v0.3.311 dal 16/10 pomeriggio, `dev` e `main` con gli stessi file); le appliance cliente pullano `main`. Ogni modifica: `npm run version:release` + `git push origin dev`.
- L'hub (VM 533, `/opt/da-invent`) segue **`dev`**; dopo `git pull` sempre `npm run build`. **Mai `npm run build` senza riavviare subito**: il processo acceso carica i file a richiesta e si rompe. A mano: `scripts/update.sh --restart`.
- **Aggiornamento a due cartelle (16/10)**: build in `.next-a`/`.next-b`, nome in `.next-attiva`, scambio solo a build riuscita e salute buona, se no si torna indietro; stato in `data/aggiornamento.json`, al massimo 3 tentativi per commit. Dettaglio: CHANGELOG. Un `npm run build` a mano scrive nella cartella attiva.
- **ATTENZIONE: `dev` arriva anche all'appliance del cliente A** (`da-ipam-update.timer` ogni 15 minuti: pull + build + restart). Un push di codice su `dev` è un rilascio al cliente: su `dev` solo codice pronto. Un commit di soli `docs/` o `.md` non riavvia.
- `/api/version` cambia col pull, **prima del riavvio**: «gira davvero» = `ActiveEnterTimestamp` o riga d'avvio nel journal.
- «Aggiornato ma non vedo modifiche» (20/10): prima si controlla l'hub (commit, `DA_COMMIT` della build attiva, grep nei chunk); se il codice c'è, è la scheda del browser che tiene l'interfaccia vecchia → Cmd+Shift+R.
- `scheduler-defaults` spegne `fast_scan`/`ping_sweep` sotto i 720 minuti sulle reti ≥1024 indirizzi: riaccesi a mano, non reggono al riavvio.

## 5. Tooling

- `npm test` con `DA_INVENT_DATA_DIR` su una cartella temporanea (conteggio: `pass`/`fail` in fondo al log); `npx tsc --noEmit`; lint 0 errori. Permessi API: `src/lib/permessi/rotte.ts`, `scripts/verifica-permessi.sh` (solo locale).
- **Cadono a caso** nella suite intera e da sole passano: `credential-chains`, `parita-gruppo0` (orari a 2 s), `ssh-connessione-caduta`, `ssh-chiave` e `chiave-ssh-percorsi` (chiavi SSH casuali, ed25519 rotte ~1 su 200).
- Sul Mac `grep` è ugrep e salta i file ignorati da git: per contare, `rg --no-ignore`.

## 6. Stato e trappole per area (2026-10-15)

- **Rami su origin** (pulizia del 16/10): solo `dev`, `main` e `tappa3b/nucleo` (30 commit fuori da `dev`, rebase dal 20/10: non potare).
- **Blocco `edge` del segnale** (20/10, ramo `sonde-integrate-20261020`, v0.3.332, non ancora in `dev`): stato della sonda locale da `/api/v1/health` a lista bianca (`lib/dalink/edge-segnale.ts`, `edge-sonda.ts`); DA-Link lo ignora finché non lo conosce (`extra="ignore"`). La pagina «Cosa esce» non lo mostra ancora.
- **NetBird e DA-Link** (ADR 0011, 0013, 0014; spec e diario del 14/10 in `specs/`/`plans/`). Niente YubiKey (decisione 28). **C1** su `dev` dalla v0.3.282 (`plans/2026-10-15-tappa-c1-netbird.md`). Da fare: **C1b = togliere l'agente Python `agent/`** (decisione 26), dopo il pilota. **Trappole**:
  - Tailscale col firewall acceso scarta NetBird appena `tailscaled` riparte: nodi a doppio binario con `tailscale set --netfilter-mode=off`;
  - le policy NetBird verso le risorse hanno destinazione vuota: si leggono con `/api/networks`;
  - configurazione = `/etc/dalink/oggetto.env` (assente = niente rete; permessi ≠ 600 = rifiutata); nodo `<codcli>-ipam` per la prima sede, `<codcli>-ipam-<n>` (n 2..99, senza zeri) dalla seconda (un'appliance per sede, 18/10), stessa forma in `config.ts` e `prepara-netbird.sh`; il livello sta in `dalink_livello_registro` (hub), **non** in `settings`; la salute nel segnale conta solo i moduli accesi (dal 16/10 i moduli spenti dicono `off`; a DA-Link solo `ok`|`degraded`|`fail`, `verdettoPerDaLink`);
  - la tabella nft `inet dalink` sta sul **prerouting** (sull'input NetBird mette `iifname "wt0" accept` e la scavalca) e restringe soltanto: con UFW serve anche `ufw allow in on wt0` (tappa G1).
- **Credenziali, promozione IP → apparato, wizard** (spec `specs/2026-10-15-credenziali-promozione-wizard-design.md`): tappe 1 e 1b il 15/10; 3-5 da fare (interfaccia proposta prima). **Tappa 2 chiusa il 16/10** (piano `plans/2026-10-15-tappa2-archivio-credenziali.md`, ADR 0017): 2a-2g su `dev` (v0.3.298-310); il motore legge solo l'archivio; colonne e tabelle vecchie svuotate (`scripts/credenziali/pulizia-t2.ts`) su hub, A e pilota il 16/10 (backup `.bak-20261016-14*`); i 2 lasciati accettati dell'hub senza credenziale finché una Prova non riesce; il DEFAULT dell'hub escluso. Aperto: voce scelta già fallita: esclusa e detta, o «non provata»? (Riccardo). Unione e reset corretti il 19/10 (§9). Punti unici: tipo ↔ protocollo `credential-protocol-map.ts`, proposta d'apparato `devices/proposta-apparato.ts`. Backup `.bak-2026101[56]-*` (hub ~2 GB l'uno): via dal 22/10 con l'ok di Riccardo. **Trappole**:
  - ricostruire `network_devices` partendo da `sqlite_master` (`devices/migra-apple-macos.ts`), in fondo a `getTenantDb`: le vecchie riscrivono un elenco fisso di colonne e perdono le altre;
  - un tenant più vecchio di `product_profile`/`physical_device_id` già non si apre (lo schema crea gli indici su quelle colonne prima delle migrazioni): non simularlo;
  - `credentials/resolve.ts` carica `db-tenant`: i componenti client usano `credentials/porte.ts`;
  - SNMPv3 non ha community (niente ripiego sullo username); segreti vuoti nel PUT = non modificare (`credentials/aggiornamenti.ts`); campi inline dei binding solo in modalità inline (`devices/aggiornamenti-binding.ts`);
  - il codice SNMP legge la porta 22 (default della colonna) come 161 e ogni altra come porta SNMP (`switch-client.ts`);
- **Pannello Zabbix in sola lettura (passo 7.4, 16/10)**: `src/lib/zabbix-lettura/`, pagina `/zabbix`; tabelle `zabbix_lettura_config`/`zabbix_abbinamenti` nel DB del cliente; API del centro solo progettata in DA-Zabbix (decisioni provvisorie nel CHANGELOG).
- **Piano di miglioramento (12/10)**: tappe in `specs/2026-10-12-piano-miglioramento-design.md`, decisioni in ADR 0004; bacheca `lavori piano-miglioramento-da-ipam`.
- **Controller di rete (ADR 0005, 0007)**: righe di `network_controllers` nel DB del cliente, `unifi_sync` spento di default; LLDP sull'apparato, mai nelle porte.
- **Mappa topologia** (spec `specs/2026-10-14-topologia-collegamenti-reali-design.md` §13, codice `src/lib/topology/`): **T3 (ADR 0020) dalla v0.3.308, accesa il 16/10 su hub e cliente A**, si spegne da «Dati della mappa» (`topologia.mappa.cavi`). **Unioni a mano** (ADR 0021, v0.3.311): «Unisci con…»/«Separa…» in mappa, scheda e Discovery, solo admin, anteprima obbligatoria; niente righe = mappa di prima; il NAS dell'hub unito il 16/10 (3 oggetti → 1). Letture in più (ADR 0018): MikroTik (con MSTP) e controller su tutti e due, host solo sull'hub, SNMP spento. `lldpd` + `i40e-fw-lldp-off` sui nodi Proxmox dell'hub (spegnere l'LLDP del firmware X710 fa cadere la porta per ~3 s). **Trappole** (le altre negli ADR 0008-0020):
  - spento = T1 bit per bit, misurato con le impronte di `misura-cavi` (da rifare se T1 cambia apposta); l'indice dei nodi fuori da `node-index.ts` solo con `indiceDeiNodi` (unioni comprese), e un campo nuovo di T1 va passato anche in `cavi/mappa.ts`; `model.cavi` decide la strada nuova in ogni modulo comune; una regola nuova di T1 va anche nel modello per cavo (`TIPI_SOSPETTI` copia di `SUSPICIOUS_TYPES`);
  - T1 e attribuzione leggono solo `source IN ('device','unifi')`; una fonte nuova non cambia né pota quelle righe; un «non so» non scrive mai un vuoto; T1 indietro = revert **più** `scripts/ripristina-vicini-router.ts` (ok di Riccardo);
  - id `seg:` dagli alias di `canonical` (`ID_SEGMENTO`); ★ per collegamento (porte mai NULL); «dalle VM» nei dettagli; radio nascosta = contratta in pagina, due radici nella traccia;
  - ritocchi in **coordinate assolute** (`dragTweaks` risalva i discendenti); VM abbinate per nome del nodo **solo** fra letture di cluster («pve» è di fabbrica); Proxmox: `network_devices.port` è la porta dell'**API**.
- **SNMP (ADR 0016)**: `createSession` **senza** `version` = **v1**, `version: 1` = **v2c**; sessioni a community **solo** da `protocols/snmp-sessione.ts` con versione esplicita (lo prova una prova). `snmp_version` NULL = come prima; `snmp_version_fissata` = a mano. airFiber del cliente A **solo v1**; in v1 un GET di più OID è tutto o niente (`snmp-get-tollerante.ts`).
- **DB dell'hub**: le 4 pagine «never used» tolte col `VACUUM` del 16/10 (12 s a servizio fermo; i backup della pulizia vogliono `quick_check` «ok»); `systemctl stop` lascia `failed`: normale; niente `.recover` sul sqlite3 di Ubuntu (`.dump`); `data/tenants/.db` di 0 byte: via solo con l'ok di Riccardo.
- Doc superata: `docs/audit*`, `docs/WAVE-0-report.md`, `ROADMAP-EVOLUZIONE.md`.

## 7. Trappola: `db-tenant` e le due istanze sotto `tsx` (2026-09-02)

Sotto `tsx` **`await import()` di `db-tenant` dà una SECONDA istanza** con `AsyncLocalStorage` vuota: il tenant si perde e si scrive in `DEFAULT.db`, in silenzio. **Import solo statico** (prova `no-dynamic-db-tenant-import.test.ts`); dettaglio in [ADR 0002](docs/adr/0002-static-db-tenant-import.md).

## 8. Analisi di sistema (2026-10-12)

`docs/analisi-sistema.md` è **solo locale** (`.git/info/exclude`: dettagli di sicurezza): sta in `~/Progetti/Domarc/DA-IPAM/docs/` sul MacBook, non nei worktree. Da non reintrodurre:

- `Select` ricava `items` dalle `SelectItem`; **date del DB con `parseDbDate`**, mai `new Date(x)`; pagine sul server con `timeZone: FUSO_UTENTI`; **un caricamento usa `fetchJson` + `LoadError`**.
- **`db.ts` e `db-tenant.ts` divergono**: guarda da quale importa il chiamante.
- **Scansioni (ADR 0006)**: `last_run` = **fine** del giro; lucchetto **in memoria** (separare lo scheduler vuole prima un lucchetto sul DB); la scansione veloce **manda** offline: da decidere.
- **Crescita del DB**: niente retention sugli storici; il più grosso è `mac_ip_history`.

## 9. Analisi del 19/10 e correzioni (v0.3.322)

Analisi in `docs/revisione/2026-10-19-analisi.md` (F01-F11). **Corretti e provati** (CHANGELOG 19/10):
F01 unione (vince la destinazione, decisione di Riccardo; id già presenti fermano l'import), F02 reset
(restano solo `TABELLE_TENUTE` di `lab-config-reset.ts`, decisione di Riccardo: impostazioni e utenti),
F03 esito `pronto_non_avviato` (verso DA-Link «interrotto»; `DA_COMMIT` nella cartella della build),
F04 «riuscito, con avvisi», F06 menu compatto da tastiera, F07 regola unica `eAdmin`/`useEAdmin`,
F08 «non riesco a leggere» con Riprova. F05 chiuso: l'hub era già aggiornato. F09-F11 fatti dopo
l'approvazione della proposta: Moduli = elenco + `/settings/moduli/<chiave>` (`ModulesTab solo=`),
interruttore RDP senza agente nel tenant (`meshcentral.senza_agente`; la env vince), MDM nel catalogo,
Discovery con viste/glossario/filtri (`lib/discovery/viste-filtri.ts`). L'ordine delle 19 colonne di
Discovery è una decisione di Riccardo (v0.2.500, 23/05): le viste lo filtrano, non lo cambiano. Menu (19/10 sera, Riccardo): niente
più Launchpad a tessere; gruppi **Sicurezza** (Vulnerabilità, Alert, Health AD `?tab=health`) e **Applicativi**
(`lib/modules/voci-applicativi.ts`: moduli opzionali + console esterne); Controller di rete in Network sotto
«Credenziali». Network Services resta un gruppo a sé (scelta di Riccardo). Tabelle (20/10): `<Table fissa>` /
`ScorrimentoTabella` per le liste lunghe (intestazioni ferme, altezza dallo schermo); accese sulle pagine
principali, le altre da fare quando si toccano. Testate di Discovery e dettaglio subnet compattate. Dashboard (20/10): una
schermata, riquadri dei moduli coi colori dei token (✓ #1F7A4D, ▲ #FFD400, ✕ #8E1B20, ● #5B6B77,
`components/shared/stile-stato-modulo.ts`), riga Sicurezza (`lib/security/kpi-dashboard.ts`: alert Wazuh
raggruppati ripartiti sulla durata). **Ridisegnata il 20/10 sera** (piano `plans/2026-10-20-dashboard-e-alert-estetica.md`): tre colonne, card di Sicurezza bianche con striscia, subnet proporzionali, moduli compatti, accessi dall'indexer (`lib/security/accessi-indexer.ts`, cache 5 min, ripiego «stima»); Alert sicurezza in una schermata (coda a sinistra, analisi a destra). Colori dello stato host e delle categorie in `--host-*`/`--alert-cat-*` di `globals.css` (validati per daltonici). **Trappola** (20/10): togliere una rotta API fa fallire l'aggiornamento di chi ha ancora `update.sh` vecchio (i tipi della build attiva la citano): si lascia la rotta ferma per un giro; `update.sh` dalla v0.9.805 svuota quei tipi. **Trappola**: dopo una modifica a `globals.css` il `next dev` può servire il CSS vecchio dalla sua cache: `rm -rf .next/dev` e riavvio. Si guarda in locale su una copia del DB dell'hub (`sqlite3 .backup` sull'hub; utente di prova con riga in `user_tenant_access`, sennò si legge `DEFAULT`). «Offline» = visti negli ultimi 7 giorni, «assenti» a parte
(`lib/hosts/assenti.ts`); `markHostsOffline` scrive lo storico. **Pulizia degli host assenti** (20/10,
ADR 0022, piano `plans/2026-10-20-pulizia-host-assenti.md`): archivio `hosts_archivio` (istantanea + `DELETE`
diretto, niente `excluded_ips`), regole in `lib/hosts/pulizia*.ts`, registro `data/audit/pulizia-host-*.jsonl`;
job `pulizia_host` spento, si accende **solo** dall'interruttore in Impostazioni → Sistema; il vecchio `cleanup`
non tocca più gli host. **Trappole**: una scansione con il lucchetto bloccato rimanda per sempre gli host della sua
rete (si vede solo nel motivo del job, «N rinviati»); ARP e UniFi scrivono host senza lucchetto; un'esclusione nuova
va nel `CASE` di `pulizia-candidati.ts` e fra le tabelle che controlla. **Hub 70791, 20/10**: primo «Applica»
di Riccardo dall'interfaccia, 19 archiviati (5 alle 13:01, 14 rimandati dalle scansioni delle 13:00 e archiviati alle
13:08), backup `data/tenants/70791.db.bak-20261020-105852` (via con l'ok di Riccardo), job notturno spento,
recupero non provato sul vero (scelta di Riccardo). Cambio IP solo su **coppie** (rete, MAC) con nomi coerenti: il
MAC di un MikroTik in proxy ARP stava su 14 host diversi. **Trappole dell'aggiornamento dell'hub** (20/10, tre build
cadute con `ENOENT …/_buildManifest.js.tmp`): «Aggiorna ora» dell'interfaccia e `scripts/update.sh` lanciato a mano
costruiscono nella stessa cartella e si rompono a vicenda (lo script non ha un lucchetto): prima di lanciarlo,
`ps -eo pid,args | grep -E "[u]pdate\.sh|[n]ext build"` in una chiamata ssh a parte (nella stessa riga si trova da
sé). Uno script `tsx` fuori dal servizio non vede i lucchetti di scansione (in memoria): «Applica» si fa dal pulsante.

- **Trappola**: le 9 prove «rosse per `flock`» del Mac erano `stato-aggiornamento.mjs` che non partiva
  da cartelle dietro symlink (`/var/folders`): ora `realpathSync`. Sul Mac serve comunque `flock` (brew).
- **Hub (19/10)**: RDP senza agente acceso dall'interruttore del tenant (`meshcentral.senza_agente=1`
  in 70791 e 70791a); la riga `MESHCENTRAL_SENZA_AGENTE` tolta da `.env.local` (backup
  `.env.local.bak-20261019-180952`). Entrato in DA-Link come `70791-ipam` (edge); snapshot
  `pre-dalink-20261019` della VM 533 (da togliere con l'ok di Riccardo), che **ora sta su DA-PX-03**.
- **Vincoli di Riccardo del 16/10 (non riaprire)**: Zabbix è modulo opzionale commerciale; DA-Zabbix
  genera il profilo cliente e ne resta titolare; DA-IPAM lo riusa, niente onboarding doppio; LibreNMS
  solo locale integrato. Proposta: `docs/proposte/2026-10-16-solidita-interfaccia-moduli-deploy.md`.
