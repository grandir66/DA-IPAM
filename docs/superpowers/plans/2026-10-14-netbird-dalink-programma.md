# NetBird a stella e DA-Link — piano generale (programma delle tappe)

> **Per gli agenti:** questo è il piano **generale**: dice le tappe, l'ordine, le dipendenze,
> chi le esegue e dove ci si ferma per una conferma. Ogni tappa di codice ha il **suo** piano
> dettagliato (TDD, file per file), scritto all'inizio della tappa nella sessione che la
> esegue, con la skill superpowers:writing-plans, e salvato **nel repo che la tappa tocca**.
> Il piano dettagliato della fase 0 è già scritto:
> [`2026-10-14-netbird-fase0-preparazione.md`](2026-10-14-netbird-fase0-preparazione.md).

**Obiettivo:** portare gli oggetti dei clienti dalla VPN precedente a NetBird in una rete a stella
governata da DA-Link, con licenza, CA interna e resilienza della flotta.

**Architettura:** DA-Link, un progetto nuovo in sede, fa entrare gli oggetti in NetBird da
solo. Emette e rinnova licenza, segreto e certificato. Riceve lo stato delle istanze e lo dà
al CRM. Le istanze DA-IPAM e gli edge cambiano rete, mandano lo stato e applicano licenza e
privacy.

**Spec:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../specs/2026-10-14-netbird-rete-a-stella-design.md),
ADR [0011](../../adr/0011-netbird-rete-a-stella.md) e [0013](../../adr/0013-licenza-e-segreto-degli-oggetti.md).

## Vincoli globali (valgono per ogni tappa)

- Livello di controllo **completo** (spec, intestazione). Il cancello completo precede ogni
  commit nelle zone rosse: licenza, chiavi, firewall, NetBird.
- Il cliente si identifica con **`codcli`** del gestionale (decisione 12). Gruppi
  `cli-<codcli>`, nodi `<codcli>-edge|-zbx|-ipam`.
- **Nessun segreto in chiaro**, né in git, né nei log, né a schermo dopo la prima consegna.
  I segreti si passano solo da stdin, mai come argomento (lezione del parco 13/10).
- **Verifica TLS sempre accesa** verso NetBird e fra i servizi. Il client NetBird di
  DA-Zabbix la spegne (`CERT_NONE`): non si copia così.
- **Ogni automatismo che ferma o scrive nasce col freno**: riallineamento delle policy
  (§6.1) e arresto per licenza (§8.2). Prima segnala soltanto, poi si accende contando.
- **Dal centro non si cambia mai la configurazione di un'istanza** (§5.3, §9.5), e un
  rinnovo non accorcia la licenza in corso (§8.2).
- **`dev` di DA-IPAM arriva al cliente A ogni 15 minuti con build e riavvio.** Su `dev` solo codice
  pronto per la produzione. Le tappe di DA-IPAM lavorano in un ramo proprio e arrivano su
  `dev` a tappa finita e verde.
- Ogni scrittura su NetBird di produzione, su macchine dei clienti o sui centrali in
  esercizio **chiede conferma**. Le conferme di una fase si chiedono **tutte insieme**
  all'inizio della fase.

## Le tappe

| Tappa | Cosa | Repo | Dipende da | Conferme |
|---|---|---|---|---|
| **0** | Preparazione: censimento, prova di convivenza, `All` fuori dalle policy dei colleghi, centrali in NetBird (YubiKey tolte: decisione 28) | nessun codice | — | sì: NetBird, da-vulcan, VM di prova |
| **A** | DA-Link nucleo: progetto, client NetBird, oggetti per `codcli`, setup key, revoca, R1–R5, riallineamento col freno, interfaccia ristretta, segnale di vita, lettura per il CRM | **DA-Link** (nuovo) | 0 | sì: deploy della VM, utente di servizio NetBird |
| **C1** | DA-IPAM, rete e privacy: segnale di vita con i due livelli, pagina «Cosa esce», installatore con setup key, firewall su `wt0` | DA-IPAM | A (contratto del segnale) | no, fino al pilota |
| **D1** | Scanner-Edge, rete: heartbeat `overlay`, installatore NetBird, firewall per porta, SAN; hub D15 | DA-Vul-can | 0 | no, fino al pilota |
| **E** | DA-Zabbix: nomi `cli-<codcli>`, nessuna seconda chiave sulle appliance, verifica R1–R5 indipendente | DA-Zabbix | A (regole di nome) | no |
| **G1** | Deploy-Appliance: setup key e token DA-Link, livello di privacy al `/setup`, Wazuh mai in NetBird | Deploy-Appliance | C1 | no |
| **F** | DA-CRM: riquadro «quadro DA-Link» nella linguetta Tecnica (interfaccia proposta prima) | DA-CRM | A (lettura §7.3) | no |
| **2** | **Pilota cliente A, rete** (doppio binario) | — | A, C1, D1, E | **sì, ogni passo** |
| **B** | DA-Link licenza e chiavi: portachiavi con sblocco, sessione delle chiavi (file cifrati in due copie, decisione 28), `step-ca` a un livello, licenze firmate, segreti, rinnovo, bollettini di emergenza | DA-Link | A | sì: sessione delle chiavi |
| **C2** | DA-IPAM, licenza: rinnovo, licenza col freno, sola lettura a scadenza, busta dei dati, certificato della CA, bollettini, modalità autonoma | DA-IPAM | B | no, fino al pilota |
| **D2** | Scanner-Edge, licenza: rinnovo via P7, licenza col freno, certificato della CA, bollettini | DA-Vul-can | B | no, fino al pilota |
| **G2** | Deploy-Appliance e centrali: radici della CA, chiave di emergenza, chiave di recupero all'installazione | Deploy-Appliance + centrali | B | sì: deploy sui centrali |
| **2b** | **Pilota cliente A, licenza** (col freno: solo segnalazioni) e **prova di compromissione** sulla VM di prova | — | C2, D2, G2 | **sì** |
| **3** | Gli altri clienti, uno per volta (lista dalla fase 0) | — | 2 (e 2b per la licenza) | **sì, per cliente** |
| **4** | Spegnimento della VPN precedente e pulizia del codice | tutti | 3 | **sì** |

## Ordine e parallelo, per andare veloci

```
0 ──► A ──┬──► C1 ──► G1 ─┐
          ├──► D1 (può partire già dopo 0) ──┤
          ├──► E ──────────┼──► 2 (pilota rete cliente A) ──► 3 (clienti, rete)
          └──► F           │
          A ──► B ──┬──► C2 ─┐
                    ├──► D2 ─┼──► 2b (pilota licenza) ──► licenza accesa contando
                    └──► G2 ─┘
                                                     3 + 2b ──► 4
```

- **La rete non aspetta la licenza.** Il passaggio a NetBird (A, C1, D1, E, G1, poi 2 e 3)
  procede da solo. La licenza (B, C2, D2, G2) arriva in parallelo e si accende col freno.
- **Dopo A, cinque tappe in parallelo** su repo diversi: C1, D1, E, F, B. Si eseguono con un
  agente a contesto pulito **per repo** (memoria del parco), **solo con l'ok di Riccardo**
  (REGOLA #2: niente agenti a raffica senza ok).
- **D1 può partire subito dopo la fase 0**: non dipende da DA-Link.

## Come parte ogni tappa

1. **Sessione nuova**, nel repo della tappa. Per A, prima `bin/nuovo-progetto DA-Link`
   sotto `~/Progetti/Domarc/`, poi la procedura di `AVVIO-PROGETTO.md`.
2. Si leggono questo piano, la spec (le sezioni indicate sotto) e il `CONTEXT.md` del repo.
3. Si scrive il **piano dettagliato della tappa** con superpowers:writing-plans, nel repo
   della tappa, e lo si fa approvare.
4. Si esegue. A tappa finita: CHANGELOG, CONTEXT, scheda nel censimento; una riga di stato
   qui sotto, in «Avanzamento».

| Tappa | Sezioni della spec da leggere |
|---|---|
| A | §1, §2, §4, §5 (tranne licenza), §6, §7, §9.1, §12 «DA-Link» |
| B | §8, §9 |
| C1 | §4.3 (R5), §5.2, §5.3, §12 «DA-IPAM» |
| C2 | §8, §9.5, §12 «DA-IPAM» |
| D1, D2 | §4.2, §8, §9.5, §12 «DA-Vul-can» |
| E | §4.2 (P4, P4b), §5.5, §6.1, §12 «DA-Zabbix» |
| F | §6.3, §7.3, §12 «DA-CRM» |
| G1, G2 | §5.1, §5.3, §8.4, §12 «Deploy-Appliance» |

## Avanzamento

- 2026-10-14: spec, ADR 0011 e 0013, questo piano e il piano della fase 0 scritti.
  Nessuna tappa iniziata.
- 2026-10-14 sera: **fase 0 chiusa**. Fatti: censimento (spec, appendice A) e
  decisioni 24-27; convivenza misurata, con rimedio `--netfilter-mode=off` (rischio 1).
  `All` è uscito dalle 5 policy accese e dai 2 nameserver, con la fotografia nel vault, e
  `users` è diventato gruppo automatico di tutte le persone. `Default` era già spenta.
  Gruppi `centro-vulcan`, `centro-zabbix` e `centro-link` creati; DA-ZABBIX è in
  `centro-zabbix`; da-vulcan è in NetBird (`da-vulcan.netbird.selfhosted`, VPN precedente
  acceso con `netfilter-mode=off`). R1–R4 sono verdi a mano.
  Restano aperti:
  - ~~la verifica di un collega che sta solo in `users`, da fuori sede~~: fatta da Riccardo il 14/10
    (INTEGRA, Manager, RDP, DMZ, uscita);
  - ~~le YubiKey da ordinare (Task 6)~~: niente YubiKey per ora (decisione 28, ADR 0014);
  - il nodo `prova-convivenza` da togliere dalla console della VPN precedente.
- 2026-10-14 notte: **tappa A avviata, non eseguita.** Progetto DA-Link aperto in
  `~/Progetti/Domarc/DA-Link` (remote privato `grandir66/DA-Link`, censito, cancello verde).
  Piano dettagliato in `DA-Link/docs/superpowers/plans/2026-10-14-tappa-a-nucleo.md`, da
  approvare ed eseguire in una sessione nuova. Decisioni dell'apertura (Riccardo, «tutto come
  proponi»; dettaglio in `DA-Link/CONTEXT.md` §5): Python/FastAPI + SQLite; login **Entra
  diretto** con MFA e ruolo `LinkAdmin`, non DA-Auth; VM dedicata `DA-LINK` (proposta
  `192.168.4.44`) con dati e configurazione su volume LUKS; interfaccia `:443`, **API per le
  macchine `:8443`**: P1 e P7 passano a 8443 (spec §4.2 corretta); nome del cliente da un ruolo
  `link_ro` sul Postgres della `.42`. Da confermare con Riccardo: la revoca di un cliente tocca
  solo i nodi creati da DA-Link (§5.5), non tutto `cli-<codcli>` (§5.4).
- 2026-10-14 ~23:00: **tappa A chiusa.** In esercizio: VM `DA-LINK` (VMID 109, `192.168.4.44`,
  NetBird `100.107.174.252`, gruppo `centro-link`, zona rossa, volume LUKS sbloccato a mano),
  utente di servizio NetBird `da-link` (token 365 giorni dal 14/10/2026), gruppi e policy
  `dalink-P1`, `P2`, `P3`, `P5`, `P6a`, `P6b`, ruolo `link_ro` sul Postgres della `.42`, ingresso
  Graylog GELF UDP 12201, voce `dalink` in DA-Auth (solo Microsoft, `sso` False). **Freno acceso**:
  il riallineamento delle policy segnala soltanto. Prima verifica R1–R5 sulla rete vera: verde,
  nessuna violazione altrui. Rosso altrui visto: il cancello di DA-Infra segnala macchine non
  documentate (DA-PRESIDIO, DA-PX-DTCNTER) e DA-IPAM `:4443` non raggiungibile. Aperti: record DNS
  `link.domarc.it` (a mano, i DC non hanno credenziali nel vault); certificato 8443 auto-firmato
  fino alla CA della tappa B. Prossimo: tappe C1, D1, E, F in parallelo; contare le segnalazioni
  del riallineamento prima di togliere il freno.
- 2026-10-15 mattina: **tappe C1, D1, E, F eseguite in parallelo, ciascuna sul suo ramo, nessuna in
  esercizio.** C1 DA-IPAM `netbird-c1` (segnale ogni 5 min, «Cosa esce», firewall `wt0`,
  installatore; 2235 prove); D1 DA-Vul-can `netbird-d1` (heartbeat con la rete, installatore
  `--netbird`, firewall per porta, colonna «Rete» nell'hub; sistemata anche la CI rossa su
  `main` dalla v0.8.87); E DA-Zabbix `netbird-e` (TLS acceso verso NetBird, nomi `cli-<codcli>`,
  policy `dazabbix-P4/P4b`, R1–R5 indipendente verde sulla rete vera, rinomina col freno; le
  prove uscivano verso la produzione: bloccate); F DA-CRM `netbird-f` (client verso DA-Link per
  impronta; riquadro **in attesa dell'ok all'interfaccia**). Ogni ramo ha «scelte da
  confermare» nel suo piano. Prossimo: conferme di Riccardo, merge con le release, poi G1 e il
  pilota DTS. Aperti: C1b (rimozione dell'agente Python, decisione 26), R5 di DA-Link che deve
  leggere `salute.firewall_wt0 = non_so`.
- 2026-10-15 pomeriggio: **scelte di C1, D1, E, F confermate da Riccardo** (dettaglio nei piani di
  ciascun repo; riepilogo completo da consegnare a fine pilota). Rilasciati: **DA-Link** `8ba6d86`
  (comando d'ingresso con `--disable-client-routes --disable-server-routes`; R5 dà «non so» con
  `salute.firewall_wt0 = non_so`); **DA-Zabbix** `75ce703` sul ramo pubblicato, con timer orario
  `zbx-netbird` e allarme alto in Zabbix, rinomina dei proxy solo a vuoto; **DA-Vul-can** v0.8.88
  (rete sotto «Ultimo contatto»); **DA-IPAM** C1 su `dev` (spento senza `oggetto.env`; il segnale
  dice anche `salute.zbx` del proxy). DA-CRM tappa F: dev poi live. Le 182 sessioni admin delle
  prove di DA-Zabbix: solo login, nessuna scrittura (audit). Prossimo: G1 (Deploy-Appliance), poi
  pilota in **tre gradini**: VM sul laboratorio DA-PX-05 `192.168.40.5` → VM su PX-NAS
  `192.168.99.1` → DTS; dopo il pilota C1b e la rinomina dei proxy. Aperti: Stefano Soragni non è
  ancora utente NetBird.
- 2026-10-15 sera: **pilota, primo gradino sul PX-NAS di casa** (scelto da Riccardo al posto del
  laboratorio): VM 150 `192.168.99.51` installata con Deploy-Appliance `netbird-g1`, oggetto
  `70175-ipam` connesso, segnale ricevuto. Trovati e corretti sul vero: NetBird scavalca i filtri
  sull'input (firewall `wt0` spostato sul prerouting, v0.3.287) e l'appliance ha solo il cliente
  `DEFAULT` (regola «appliance a cliente singolo», v0.3.288). Le sonde autonome di Vul-can hanno
  lo stesso difetto di firewall: si corregge prima del gradino DTS. Riepilogo di tutte le scelte:
  https://claude.ai/artifact/MWmQ9zBv5bYygrEwSB1EUY
- 2026-10-15 notte: **pilota, gradini 2 e 3** (risposte di Riccardo in un'unica raffica, livello leggero).
  - Deploy-Appliance: `netbird-g1` unito in `main` (`8fcf2b3`) con l'attesa dei ruoli di LibreNMS e la
    frase corretta sul livello; poi `8a8893d`: al rilancio la «scan-NIC» poteva essere **`wt0`** (IP tolto,
    netplan su `wt0`, casa senza segnale per 20 minuti), ora solo schede vere.
  - Codice di casa: **70175** (DOTT. GRANDI RICCARDO); la procedura di Zabbix e il tag dei 12 host allineati
    da 707911. Aperto: «Domarc-OVH» 707912, anch'esso inventato.
  - Vul-can: sonda di casa iscritta all'hub (id 6), vecchia «PX-NAS» revocata; **firewall delle sonde
    autonome corretto** (prerouting, v0.8.89 su `main`), provato su una sonda vera nel laboratorio DA-PX-05
    (VM 545, oggetto `70791-edge`) con NetBird collegato: senza filtro la 443 era aperta. Pubblicazione sul
    server in attesa della conferma.
  - **DTS in NetBird**: `71734-ipam`, snapshot di Riccardo prima; solo 22/443/6443 raggiungibili, R1–R5 verde,
    livello «solo stato». VPN precedente con `--netfilter-mode=off` dopo aver messo in UFW le sue regole equivalenti.
  - Prossimo: prova del livello abbassato (Riccardo, pagina «Cosa esce» del server di prova), revoca di
    `70791-edge` e della VM 545, poi C1b e la rinomina dei proxy cliente per cliente.

- 2026-10-15 notte, dopo: **Vul-can 0.8.89 in esercizio** (filtro delle sonde autonome). Domarc-OVH a
  70791 nella procedura di Zabbix. **Proxy Zabbix dentro l'appliance** (decisione di Riccardo: meno VM e
  meno client NetBird; i clienti con solo Zabbix restano col proxy a parte): a casa `70175-ipam` riemesso
  con `edge`+`zbx`, `dazabbix-P4/P4b` scritte, `proxy-casa` spento; segnale `zbx: ok`, R1–R5 verde da
  DA-Link e da DA-Zabbix. Trovati e corretti nello script del proxy di DA-Zabbix (non ancora sulla .15):
  versione di Ubuntu e `PidFile`. Proposta da approvare: DA-Link prepara l'intero kit d'installazione
  quando si crea un cliente. Prossimo: «cambia moduli» in DA-Link, poi il proxy di DTS dentro
  `71734-ipam`.
- 2026-10-15 notte, PX-NAS: **appliance reinstallata da capo dal Proxmox** (VM 150 + 151, base + servizi
  di rete, IPAM dev 0.3.293, NetBird `70175-ipam` con sonda e proxy Zabbix, sonda hub id 7). Collaudo
  superato (tre giri, nessun [ERR], interfacce aperte con l'admin, segnale tutto «ok», R1–R5 verde).
  Corretti in Deploy-Appliance: sorgente IPAM dal ramo e non dalla copia del PVE (`e895eae`), chiave
  `network_services` (`f869c9e`), dipendenze WinRM (`486bef5`), doppioni della pagina dei servizi
  (`ac5b955`). Spec e piano di «cambia moduli» e kit d'installazione in DA-Link, da approvare.
- 2026-10-16 pomeriggio: **la fase 0 aveva lasciato fuori DA-TRAEFIK** (`da-traefik`, .40 in DMZ).
  Togliendo `All` dalle policy `DA-sns`/`AD01`/`AD02 Access` e dai nameserver `da-dc01`/`da-dc02`
  (14/10 15:40 UTC), il .40 ha perso la strada verso `192.168.4.42` e il DNS di `domarc.it`: stava solo
  in `All` e `server-interni`, e la verifica di quel giorno guardava i colleghi, non i server con chiave.
  Effetto: dal 14/10 l'accesso con Entra di portale Proxmox, Fibertest e DA-GEO (e il relè d'identità
  della survey) rispondeva «Accesso non riuscito». Rimedio, con conferma di Riccardo e fotografia
  `netbird-backup-20261016-161933-prima-di-traefik.json` nel vault: gruppo **`dmz-traefik`** (solo
  `da-traefik`; non `centro-*`, che sono di DA-Link), cinque policy `DA-TRAEFIK → DA-sns (DA-Auth)` tcp 443 e
  `→ AD01/AD02 DNS` udp/tcp 53, gruppo aggiunto ai due nameserver. Niente `All`: R3 resta verde. Verificato
  dal .40: `Nameservers 2/2`, `entra.domarc.it` → .42, `/whoami` 200 dai tre container. Controllati gli
  altri peer fuori da `users`/`admins`: o stanno sulla LAN (non usano le risorse) o sono remoti, che
  devono restare ciechi. **Regola per i prossimi passi che stringono policy o nameserver**: prima
  l'elenco dei peer con chiave che usano quell'oggetto, non solo la prova da un collega.
