# DA-IPAM — Context per onboarding agente / sviluppatore

Documento di **passaggio di consegne**: leggilo per primo, poi [CLAUDE.md](CLAUDE.md). Mappa ecosistema → `~/Progetti/Domarc/README.md`. Versione: vedi `package.json` / ultimo commit `release: vX.Y.Z` (non scriverla qui). Accessi, IP e utenze: `ACCESSI.md` + vault (repo pubblico: niente nomi di clienti, IP, MAC).
> **Manutenzione**: aggiorna quando cambia architettura, moduli, rilascio o stato prod. Le voci datate portano la data. Tetto ~10k caratteri: il dettaglio storico va negli ADR.

## 1. Cos'è

> **Decisione 2026-10-12 (Riccardo) — non riaprire: la logica multi-tenant è morta, un'installazione = un cliente.** Il codice resta a tenant (hub + un DB per tenant) e `withTenantFromSession` resta obbligatorio (senza contesto si scrive in `DEFAULT.db`). Il tenant **non è un confine di sicurezza**: dati di un cliente visibili a un altro non sono difetti.

**DA-INVENT** (alias DA-IPAM): IPAM/inventario per appliance cliente + hub di **9 moduli** security/network (`src/lib/modules/registry.ts`, `access: native|external`). Next.js 16 + React 19 + TS strict, custom server `server.ts` (tsx) con scheduler node-cron. better-sqlite3 WAL, NextAuth v5 beta, Tailwind v4 + shadcn v4 (`@base-ui/react`), Zod v4. Facade `src/lib/db.ts` → `db-tenant.ts` / `db-hub.ts`. Nessun framework migrazioni: `ALTER TABLE` idempotente inline. `agent/` = pacchetto Python con versioning proprio.

> **Regola di Riccardo (12/10) — non riaprire:** le appliance dei clienti **non** si integrano in DA-Auth: niente `DAAUTH_URL` né pulsante Domarc. L'accesso Domarc vale solo per l'hub. Il codice di T3-29 è annullato (`fbca510`): per rimetterlo `git revert fbca510`.

## 3. Flusso di rilascio (CRITICO)

- Branch: **`dev`** (unico pushabile). `main` avanza SOLO via promote in-app; le appliance cliente pullano `main`. Ogni modifica: `npm run version:release` + `git push origin dev`.
- L'hub (VM 533, `/opt/da-invent`) segue **`dev`**; dopo `git pull` sempre `npm run build`. **Mai `npm run build` senza riavviare subito**: Next carica i file a richiesta e il processo acceso smette di funzionare.
- **ATTENZIONE: `dev` arriva anche all'appliance del cliente A** (`da-ipam-update.timer` ogni 15 minuti: pull + build + restart). Un push di codice su `dev` è un rilascio al cliente: su `dev` solo codice pronto. Un commit di soli `docs/` o `.md` non riavvia.
- Integrazioni: DA-Vul-can / Scanner-Edge (`vuln_scanners`, pin SPKI), Deploy-Appliance (installa via git `main`). Vedi README del padre.

## 5. Tooling

- `npm test` (node test runner; **~2.030 test verdi** il 14/10, ultimo cancello completo). Con `DA_INVENT_DATA_DIR` su una cartella temporanea. `npx tsc --noEmit`; lint 0 errori. CI: Node 22, type-check, test, build, pytest agente. Permessi API: `src/lib/permessi/rotte.ts`, `scripts/verifica-permessi.sh` (solo in locale).
- `.claude/`: hook tsc + blocco force-push main; skill `release`, `deploy-prod`, `winrm-kerberos`; rules `api-routes`, `client-components`, `db-access`.

## 6. Stato e igiene (fotografia 2026-10-14)

- **Da Tailscale a NetBird, rete a stella, e DA-Link (14/10, disegno approvato a voce e rivisto, documento da rileggere)**: al centro da-vulcan, DA-ZABBIX e **DA-Link** (progetto nuovo in `Domarc/DA-Link`, inizio della tappa 9): fa entrare gli oggetti in NetBird da solo (chiavi monouso), riceve dalle istanze lo stato e, solo se l'istanza lo consente, i numeri d'inventario (privacy decisa sull'istanza, default solo stato), dà il quadro a DA-CRM. Dai clienti edge, proxy Zabbix e istanze IPAM, ciechi fra loro; Wazuh e DA-VA-OVH fuori; cliente = `codcli` del gestionale. Licenza con segreto ruotato ogni 4 settimane (+2 di tolleranza) che firma gli scambi e protegge i dati a busta, CA interna a un livello in DA-Link, DA-Link con accesso ristretto e sblocco a mano all'avvio. Spec `docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`, ADR 0011 e 0013. **Fase 0 eseguita il 14/10** (conferme di Riccardo: Task 3, 4 e 5 sì). Fatti:
  - `All` è fuori dalle policy accese e dai nameserver di NetBird; `users` è gruppo automatico
    di ogni persona; `Default` era già spenta;
  - da-vulcan e DA-ZABBIX sono nei gruppi `centro-*`, e Tailscale resta acceso;
  - censimento nell'appendice A della spec, decisioni 24-27.

  La verifica da un collega che sta solo in `users` è fatta (14/10): **fase 0 chiusa**.
  **Niente YubiKey** (14/10 sera, decisione 28, ADR 0014): chiavi in file `age` in due
  copie, CA a un livello in DA-Link.

  **Trappole nuove:**
  - Tailscale col firewall acceso scarta il traffico NetBird appena `tailscaled` si
    riavvia. Ogni nodo a doppio binario va con `tailscale set --netfilter-mode=off` (spec,
    rischio 1).
  - Su questo Mac `grep` è ugrep e rispetta i `.gitignore`: per contare in `~/Progetti` si
    usa `rg --no-ignore`.
  - Le policy NetBird verso le risorse hanno destinazione vuota: si leggono con
    `/api/networks`.
- **Tappa C1 NetBird (15/10, ramo `netbird-c1`, non su `dev`)**: segnale di vita verso
  DA-Link (`src/lib/dalink/`, timer in `server.ts`), pagina `/settings/cosa-esce`, livello al
  `/setup`, `scripts/dalink/{firewall-wt0,prepara-netbird}.sh`. Piano e scelte da
  confermare in `docs/superpowers/plans/2026-10-15-tappa-c1-netbird.md`. **Trappole**: la
  configurazione è `/etc/dalink/oggetto.env` di DA-Link (assente = niente rete; permessi
  diversi da 600 = rifiutata); il livello sta in `dalink_livello_registro` (hub), **non** in
  `settings`; la salute nel segnale riguarda solo i moduli accesi (le sonde dei moduli spenti
  dicono `fail`); la tabella nft `inet dalink` restringe soltanto: con UFW acceso serve anche
  `ufw allow in on wt0` (tappa G1). L'agente Python (decisione 26) non è ancora tolto.
- **Piano di miglioramento (12/10)**: nove tappe in `docs/superpowers/specs/2026-10-12-piano-miglioramento-design.md`; decisioni in ADR 0004. Bacheca: `lavori piano-miglioramento-da-ipam`.
- **Controller di rete (ADR 0005, 0007)**: UniFi (Omada dopo) = righe di `network_controllers` nel DB del cliente, pagina `/controllers`, job `unifi_sync` spento di default; UniFi OS con chiave API (`X-API-KEY`). Il controller della rete Domarc è un UDM sull'hub; Omada dei clienti non si legge dall'hub. LLDP sta sull'apparato, mai nelle porte.
- **Mappa topologia, fasi 1-2 (ADR 0008, 0009)**: modello in `src/lib/topology/` (`model.ts`, `identity.ts`, `attach.ts`, `tree.ts`, `tree-layout.ts`), pagina `src/components/topology/map/`, rotte `/api/topology/maps*`, misure `scripts/misura-topologia.ts`, `misura-mac-porta.ts`. **Trappole**: i vicini non si cancellano (invecchiano, pota a 90 giorni); `switch_ports.is_uplink = 0` non vuol dire «non uplink»; MAC virtuali (VRRP/HSRP) e seriale degli host non identificano nessuno; nomi di fabbrica o corti non fondono; il job dei client UniFi è spento di default e legge solo 7:00-19:59; l'abbinamento richiede apparati già letti con `controller_mac`; la mappa automatica di una rete grande è larghissima in orizzontale: si usa il verticale (ADR 0012) o «passo passo». La migrazione sta in fondo a `getTenantDb`.
- **Mappa topologia, fase 2b (ADR 0010, v0.3.279-280, spec §11)**: collegamenti a mano col principale, VM dentro gli hypervisor, tasto destro, router con le sue porte fisiche. Rilasciata il 14/10 (cliente A e hub). **Trappole nuove**:
  - le righe MAC dei router vengono **solo dalla bridge host** sulle porte `ether`/`bond`; l'ARP non scrive più le porte (lo faceva su bridge/VLAN/VRRP). MNDP non conferma dai due lati: solo LLDP/CDP;
  - `arp_poll` **senza rete legge tutti gli apparati**, router compresi: è il job con cui si leggono i router (acceso sul cliente A). `hypervisor_sync` acceso su cliente A e hub; si spegne cancellando il job;
  - la regola d'avvio `scheduler-defaults` (incidente 25/05) **spegne `fast_scan`/`ping_sweep` sotto i 720 minuti sulle reti da 1024 indirizzi in su**: riaccenderli non regge al riavvio;
  - sull'appliance del cliente A `/api/version` dà la versione nuova appena fatto il pull, **prima del riavvio**: per sapere se gira davvero si guarda `MainPID`/`ActiveEnterTimestamp` o la riga della migrazione nel journal;
  - un INSERT diretto in `scheduled_jobs` vuole un riavvio perché lo scheduler lo veda;
  - l'id `vm:<apparato>:<vmid>` viene dall'apparato con l'id **più basso** del cluster (anche «Aggiorna VM» rilegge quello);
  - le VM spente ora si leggono, e i **template Proxmox contano come spente** (aperto: gonfiano «N VM»);
  - aperti minori: principale che cade per coppia, `ether1-gateway` non più fisica per MNDP, collegamento principale `DELETE` sempre `ok`, apparato+host stessa macchina in «Da sistemare», «Aggiorna VM» mai provata con un server vero. Elenco in ADR 0010.
- **Mappa topologia, verticale e stampa (ADR 0012, v0.3.281, spec §12)**: orientamento per mappa (`lr` verticale predefinito, `tb` orizzontale), stampa `/topology/stampa` in SVG a tasselli, ridondanze a richiesta («⇄ N»), hypervisor dalle VM sulla porta, nome dal Proxmox. Rilasciata il 14/10 (cliente A e hub). **Trappole nuove**:
  - i ritocchi hanno l'orientamento (`topology_position.orientation`, **NULL = orizzontale**) e la rotta dei ritocchi lo **esige**: 400 senza. Una pagina aperta prima del rilascio va ricaricata;
  - «Riordina» **senza** orientamento toglie i ritocchi di tutti e due (solo una pagina vecchia lo manda così);
  - `vm_mac`: una porta da cui passano solo VM accese di un hypervisor è il suo cavo; ogni MAC di VM su una porta sola, solo l'ultimo giro (**finestra di 6 ore**, tarata su letture orarie: uno switch letto più di rado la rompe); «Ignora» vale anche per `vm_mac` e `mac_table`;
  - nome dal Proxmox solo da scansioni di **≤ 30 giorni**;
  - la prova `credential-chains.test.ts` **cade a caso** nella suite intera (`UNIQUE` sui profili SNMP dell'hub: corsa fra file di prova, estranea alla topologia, da sistemare); da sola passa.
- **DB dell'hub**: tenant con 4 pagine «never used» (`quick_check`): `VACUUM` in una finestra tranquilla (servizio fermo; `systemctl stop da-invent` lascia `failed`, normale). Il sqlite3 di Ubuntu non ha `.recover`: si usa `.dump`. `DEFAULT.db` orfano ricostruito il 13/10 (originale `.bak-20261013-*`); un `.db` di 0 byte senza nome.
- **Mappa vecchia (`/topology`, ADR 0003)** superata dalla fase 2. Rami remoti già in `dev` da potare: `auth/accesso-domarc`, `feat/ad-health-native`, `feature/attribution-fase-3-probe`, `fix/probe-real-world`; `claude/project-thread-7swirj` ha 18 commit non in `dev`.
- Doc superata: audit maggio-luglio (`docs/audit*`, `WAVE-0-report.md`), `ROADMAP-EVOLUZIONE.md`, `docs/CLAUDE-legacy-20260511.md` (storico intenzionale).

## 7. Trappola: `db-tenant` e le due istanze sotto `tsx` (2026-09-02)

L'appliance gira da sorgenti (`tsx server.ts`): **`await import()` di `db-tenant` dà una SECONDA istanza** con `AsyncLocalStorage` vuota, e il contesto tenant si perde per tutto il processo (340 job falliti in 4h40, 179 host scritti in `DEFAULT.db`). **Regola**: `db-tenant` si importa **staticamente** (prova `no-dynamic-db-tenant-import.test.ts`; restano leciti `require` e `typeof import`). Difese: `assertTenantContext()` nello scheduler, tracker `job-failure-tracker.ts`. Dettaglio: [ADR 0002](docs/adr/0002-static-db-tenant-import.md). `DEFAULT` non è un tenant registrato: il fallback silenzioso di `db.ts` è il motivo per cui una scrittura fuori contesto non fa rumore.

## 8. Analisi di sistema (2026-10-12)

`docs/analisi-sistema.md` è **solo locale** (esclusa da git: dettagli di sicurezza, repo pubblico); se manca, chiederla sul MacBook. Trappole da non reintrodurre:

- `Select` (`components/ui/select.tsx`) ricava `items` dalle `SelectItem`; **date del DB con `parseDbDate`**, mai `new Date(x)`; pagine sul server con `timeZone: FUSO_UTENTI`; **un caricamento usa `fetchJson` + `LoadError`**.
- **`db.ts` e `db-tenant.ts` divergono** (~43 funzioni): guarda da quale dei due importa il chiamante.
- **Scansioni (ADR 0006)**: `last_run` = **fine** del giro; un giro alla volta per tenant e rete con lucchetto **in memoria** (separare lo scheduler richiede prima un lucchetto sul DB); la soglia offline decide solo per gli host scansionati dal giro (`passaggioOfflineConSoglia`). La scansione veloce **manda** offline: se debba farlo è da decidere.
- **Crescita del DB**: niente retention sugli storici; `mac_ip_history` ~31.000 righe/giorno sull'hub (2,1 GB).
