# DA-IPAM — passaggio di consegne

Leggilo per primo, poi [CLAUDE.md](CLAUDE.md) (stack e schema; su «multi-tenant» vale il §1). Ecosistema → `~/Progetti/Domarc/README.md`. Accessi: hub → skill `deploy-prod`; appliance dei clienti → vault `~/Documents/da-appliance-credentials/`, un file per appliance (repo pubblico: niente nomi di clienti, IP, MAC).
> **Manutenzione**: voci datate, tetto ~10k caratteri (`wc -c`); il dettaglio in ADR, spec e piani (`specs/…`, `plans/…` = `docs/superpowers/…`), la storia in [`docs/storia/`](docs/storia/CONTEXT-diario-ottobre-2026.md). Numeri di sezione fissi (altri file citano §6, §7). Il CHANGELOG lascia «[Non rilasciato]» anche dopo il rilascio: fa fede `git log origin/dev`. Cose aperte: `TASKS.md`.

## 1. Cos'è

> **Decisione 2026-10-12 (Riccardo) — non riaprire: la logica multi-tenant è morta, un'installazione = un cliente.** Il codice resta a tenant (hub + un DB per tenant) e `withTenantFromSession` resta obbligatorio (§7). Il tenant **non è un confine di sicurezza**.

**DA-INVENT** (alias DA-IPAM): IPAM/inventario per appliance cliente + hub di moduli (`MODULE_DESCRIPTORS` in `src/lib/modules/registry.ts`, `access: native|external`). L'agente Python remoto è tolto (20/10).

> **Regola di Riccardo (12/10) — non riaprire:** le appliance dei clienti **non** si integrano in DA-Auth (niente `DAAUTH_URL` né pulsante Domarc); l'accesso Domarc vale solo per l'hub. `git revert fbca510` per rimetterlo.

> **Vincoli di Riccardo (16/10) — non riaprire:** Zabbix è modulo opzionale commerciale; DA-Zabbix genera il profilo cliente e ne resta titolare, DA-IPAM lo riusa; LibreNMS solo locale integrato.

## 3. Flusso di rilascio (CRITICO)

- Branch **`dev`** (unico pushabile). `main` avanza SOLO via promote, da una copia del repo (il pulsante dell'hub lascia l'app su `main`); le appliance cliente pullano `main`. Ogni modifica: `npm run version:release` + `git push origin dev`.
- **`dev` arriva anche all'appliance del cliente A** (`da-ipam-update.timer`, 15 min: pull + build + restart): un push di codice su `dev` è un rilascio. Un commit di soli `.md` non riavvia.
- Hub: VM 533 `/opt/da-invent`, segue `dev`, `ssh root@192.168.4.8` diretto (il salto via `.40.4` cade nei comandi lunghi: lavori lunghi con `nohup` e log). **Mai `npm run build` senza riavviare subito.** Aggiornamento a due cartelle (`.next-a`/`.next-b`, `.next-attiva`, `data/aggiornamento.json`, 3 tentativi per commit).
- «Aggiorna ora» e `scripts/update.sh` a mano si rompono a vicenda (niente lucchetto): prima `ps -eo pid,args | grep -E "[u]pdate\.sh|[n]ext build"` in una chiamata ssh a parte.
- **Togliere una rotta API**: un `update.sh` < v0.9.805 legge i tipi della build attiva che la citano e la build nuova cade: prima si verifica la versione di tutte le installazioni (lasciarla ferma a 410 per un giro).
- `/api/version` cambia col pull, prima del riavvio: «gira davvero» = `ActiveEnterTimestamp` o riga d'avvio nel journal. «Non vedo le modifiche» = prima l'hub (`DA_COMMIT`, grep nei chunk), poi Cmd+Shift+R.
- `scheduler-defaults` spegne `fast_scan`/`ping_sweep` sotto i 720 minuti sulle reti ≥1024 indirizzi: riaccesi a mano, non reggono al riavvio.

## 5. Tooling

- `npm test` con `DA_INVENT_DATA_DIR` su una cartella temporanea (`pass`/`fail` in fondo al log); `npx tsc --noEmit` (dopo aver tolto rotte, `.next/types` vecchio dà errori finti: `npm run build` li rigenera); lint 0 errori. Permessi API: `src/lib/permessi/rotte.ts`, `scripts/verifica-permessi.sh`.
- **Cadono a caso** nella suite intera: `credential-chains`, `parita-gruppo0`, `ssh-connessione-caduta`, `ssh-chiave`, `chiave-ssh-percorsi`.
- Sul Mac `grep` è ugrep e salta i file ignorati: `rg --no-ignore`. Le prove che usano `flock` vogliono `brew install flock`.
- In sviluppo `agentation` (note visive degli agenti, `localhost:4747`) è montato in `layout.tsx` solo con `NODE_ENV=development` (21/10). Dopo una modifica a `globals.css` il `next dev` può servire il CSS vecchio: `rm -rf .next/dev`.

## 6. Stato e trappole per area (2026-10-21)

- **Collector modulari (21/10, solo locale, ADR 0024)**: `lib/acquisition/`, CLI `scripts/acquire-device.ts`, adapter senza DB; QNAP QSS, HP ProCurve/ArubaOS-Switch anche modulare, Comware IRF VMware ESXi e NetApp ONTAP/MetroCluster. Manuale `docs/modules/acquisition.md`, piani/TASKS; input/output nel vault `collectors/`. 87 test/SNMP, lint (0 errori), typecheck/build verdi; JSON precedenti compatibili. Nessun push/deploy/UI/scheduler; persistenza da approvare. Trappole: QSS solo shell, IP/ARP in errore e PVID ignoti; pager HP Enter/Return incolla righe, 49-Trk3 resta porta 49, PoE=PD Draw, STP solo CIST; HP 5406R: `module_observed=false` non prova assenza. Comware 5700 IRF: exec per comando, CPU/memoria per membro; SNMP ifTable/ifXTable/ENTITY ancora parziali entro 15 s anche a blocchi 50, non dichiarare inventario completo. VMware diretto ESXi 8.0.3 HPE DL380 Gen11: API HostAgent, CA o fingerprint prima delle credenziali, no vCenter; 18 VM/8 datastore, snapshot `vmware-esxi-snapshot-validated-20261021.json`. XML type e xsi:type distinti, LogoutResponse vuoto valido; pNIC per key, guest network è nome, byte stringhe esatte. Virtualizzazione ok, globale parziale (ARP/membership VLAN fisica non acquisite); guest IP dai Tools può essere vecchio, VLAN 4095 è trunk. Rinviati LLDP/CDP/ARP, ruoli VMkernel, policy vDS/cluster, altri firmware e aggancio persistente. Tutti i limiti e modelli collaudati nel manuale. NetApp AFF A70 9.16.1P11: storage ok, globale partial, 2 controller locali/4 nodi MetroCluster noti; dischi 36 locali+36 remoti. vCenter acquisito solo con prova locale per analisi (13 host/431 VM/38 datastore), non profilo di prodotto. Consegna all’agente e modello: `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`, ADR 0026; nessuna migrazione/importazione. SOAP risposte grandi corretto (DTD vietati, entità standard una sola decodifica); NFS4.1 mantiene remote_hosts.

- **Rami su origin**: `dev`, `main`, `tappa3b/nucleo` (non potare), `sonde-integrate-20261020` (già in `dev` col merge `8c00134e`: si può togliere).
- **NetBird e DA-Link** (ADR 0011, 0013, 0014; `plans/2026-10-15-tappa-c1-netbird.md`). Blocco `edge` del segnale in `dev` (`lib/dalink/edge-segnale.ts`, `edge-sonda.ts`; il quadro di «Cosa esce» ha `altri_flussi.edge`). **Trappole**:
  - configurazione = `/etc/dalink/oggetto.env` (assente = niente rete; permessi ≠ 600 = rifiutata); nodo `<codcli>-ipam`, poi `<codcli>-ipam-<n>` (2..99) per sede, stessa forma in `config.ts` e `prepara-netbird.sh`; livello in `dalink_livello_registro` (hub), non in `settings`; a DA-Link solo `ok`|`degraded`|`fail` dei moduli accesi;
  - la tabella nft `inet dalink` sta sul **prerouting** e restringe soltanto: con UFW serve anche `ufw allow in on wt0`. La scrive `dalink-firewall.service` **solo se c'è `/etc/dalink/firewall.env`**, che scrive `scripts/dalink/prepara-netbird.sh`;
  - **(21/10) il primo avvio dell'immagine dell'appliance** (Deploy-Appliance, `primo-avvio/fasi/netbird.sh`) fa solo `netbird up` e non chiama `prepara-netbird.sh`: niente `firewall.env`, servizio saltato, tutte le porte aperte su `wt0` e R5 rosso in `dalink verifica`. L'installatore classico (`lib/netbird.sh`) lo chiama. Così è nata la 79993-ipam-2 (VM 103 del PVE di casa, tolta il 21/10). Da correggere nel ramo dell'immagine;
  - agente remoto tolto: restano `tenant_agents` e `tenants.agent_*` senza uso; `agent_mode='remote'` non scansiona finché non torna `local` (DB dell'hub);
  - le policy NetBird verso le risorse hanno destinazione vuota: si leggono con `/api/networks`.
- **Credenziali, «Rendi apparato», classificazione** (spec `specs/2026-10-15-credenziali-promozione-wizard-design.md`, ADR 0017, piano `plans/2026-10-21-tappe-3-5-rendi-apparato.md`): tappe 1-5 fatte (21/10, v0.9.815-820). Finestra unica `components/devices/rendi-apparato-*.tsx` (un host o fino a 50) in scheda, Discovery, rete, lista; ricerca credenziale `lib/credentials/trova.ts` (validate host → lista rete → archivio; rifiutata su quell'host = esclusa; WinRM 3 tentativi per host e per account nel giro; host irraggiungibile non esclude). Classificazione: catalogo canonico `lib/classification/canonico.ts` (slug vecchi convertiti alla scrittura, segno `classificazioni_v21`), ruoli in `server_roles`, scrittura unica `lib/classification/scrivi.ts` (host + apparato, `classification_manual` su entrambi). **Trappole**:
  - una classificazione nuova si scrive **solo** con `scriviClassificazione` (manuale) o passa dalle funzioni di scrittura che canonicalizzano; i classificatori possono emettere slug vecchi, non i menu;
  - `ruoli` passato = sostituisce; le scritture automatiche uniscono (`unisciRuoli`);
  - `/devices/[id]` rimanda a `/objects/[id]` quando l'apparato ha un host: ciò che l'utente deve vedere va in `objects/[id]` (il 21/10 due riquadri erano finiti nella pagina invisibile);
  - `network_devices` si ricostruisce da `sqlite_master` (`devices/migra-apple-macos.ts`); `credentials/resolve.ts` carica `db-tenant` (i client usano `credentials/porte.ts`); SNMPv3 senza community; segreti vuoti nel PUT = non modificare; il codice SNMP legge la porta 22 come 161.
- **SNMP (ADR 0016)**: `createSession` senza `version` = v1, `version: 1` = v2c; sessioni solo da `protocols/snmp-sessione.ts`. airFiber del cliente A solo v1 (`snmp-get-tollerante.ts`).
- **Mappa topologia** (spec `specs/2026-10-14-topologia-collegamenti-reali-design.md` §13, ADR 0008-0021): T3 accesa su hub e cliente A, si spegne da «Dati della mappa»; unioni a mano solo admin con anteprima. **Trappole**: spento = T1 bit per bit (`misura-cavi`); un campo nuovo di T1 va anche in `cavi/mappa.ts` e `TIPI_SOSPETTI`; T1 legge solo `source IN ('device','unifi')`, un «non so» non scrive mai un vuoto; T1 indietro = revert + `scripts/ripristina-vicini-router.ts`; ritocchi in coordinate assolute; Proxmox: `network_devices.port` è la porta dell'API; spegnere l'LLDP del firmware X710 fa cadere la porta ~3 s.
- **Pulizia host assenti** (ADR 0022): archivio `hosts_archivio`, job `pulizia_host` acceso solo dall'interruttore in Impostazioni → Sistema. **Trappole**: una scansione col lucchetto bloccato rimanda per sempre gli host della sua rete; ARP e UniFi scrivono senza lucchetto; uno script `tsx` fuori dal servizio non vede i lucchetti (in memoria): «Applica» dal pulsante. Cambio IP solo su coppie (rete, MAC).
- **Accesso** (ADR 0023): verifica in due passaggi per utente, la chiede l'admin; login locale tutto da `lib/accesso/accesso-locale.ts`; recupero `scripts/seconda-verifica.ts`; JWT 30 giorni.
- **Interfaccia**: `useUrlPerBrowser()` per ogni link/iframe verso un servizio dell'appliance (mai l'URL nudo); `DropdownMenuLabel` senza `DropdownMenuGroup` fa cadere la pagina; `<Table fissa>`/`ScorrimentoTabella` per le liste lunghe; colori di stato in `--host-*`/`--alert-cat-*` e `stile-stato-modulo.ts` (validati per daltonici); l'ordine delle 19 colonne di Discovery è di Riccardo (le viste filtrano, non riordinano). Si guarda in locale su una copia del DB dell'hub (`sqlite3 .backup`; utente con riga in `user_tenant_access`).
- **Chocolatey automatico** (21/10): `lib/patch/choco-automatico.ts`, acceso di default (`patch.choco_automatico`); operazioni automatiche con `user_id = 0`.
- **Zabbix in sola lettura**: `src/lib/zabbix-lettura/`, `/zabbix`. **Controller di rete** (ADR 0005, 0007): `unifi_sync` spento.
- **DB dell'hub**: `systemctl stop` lascia `failed` (normale); niente `.recover` sul sqlite3 di Ubuntu; snapshot `pre-dalink-20261019` della VM 533 e `data/tenants/.db` di 0 byte: via solo con l'ok di Riccardo.
- **Piano di miglioramento**: `specs/2026-10-12-piano-miglioramento-design.md`, ADR 0004, bacheca `lavori piano-miglioramento-da-ipam`.
- **da-invent scarica male da internet** (21/10): se `update.sh` o `npm ci` si piantano sull'hub, la causa può essere la rete (dettaglio in `DA-Vul-can/TASKS.md`).

## 7. Trappola: `db-tenant` e le due istanze sotto `tsx` (2026-09-02)

Sotto `tsx` **`await import()` di `db-tenant` dà una SECONDA istanza** con `AsyncLocalStorage` vuota: il tenant si perde e si scrive in `DEFAULT.db`, in silenzio. **Import solo statico** (prova `no-dynamic-db-tenant-import.test.ts`); [ADR 0002](docs/adr/0002-static-db-tenant-import.md).

## 8. Analisi di sistema (2026-10-12) e del 19/10

`docs/analisi-sistema.md` è **solo locale** (`.git/info/exclude`): sta sul MacBook, non nei worktree. Analisi del 19/10 in `docs/revisione/2026-10-19-analisi.md` (F01-F11 corretti, dettaglio nel diario). Da non reintrodurre:

- `Select` ricava `items` dalle `SelectItem`; date del DB con `parseDbDate`; pagine con `timeZone: FUSO_UTENTI`; un caricamento usa `fetchJson` + `LoadError`; admin solo con `eAdmin`/`useEAdmin`.
- **`db.ts` e `db-tenant.ts` divergono**: guarda da quale importa il chiamante.
- Scansioni (ADR 0006): `last_run` = fine del giro; lucchetto in memoria. Niente retention sugli storici (il più grosso è `mac_ip_history`).
