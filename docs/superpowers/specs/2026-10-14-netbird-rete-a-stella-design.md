# Da Tailscale a NetBird: una rete a stella fra centrali Domarc e oggetti remoti

**Stato:** disegno approvato a voce da Riccardo il 2026-10-14; documento da rileggere
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Decisione architetturale:** [ADR 0011](../../adr/0011-netbird-rete-a-stella.md)
**Livello di controllo:** completo (si toccano appliance in esercizio presso i clienti)

Riguarda quattro progetti. Ognuno lo cita con una riga dal proprio `CONTEXT.md`, senza
ricopiarlo:

- **DA-IPAM** (`~/Progetti/Domarc/DA-IPAM`): gestisce le chiavi; questo documento vive qui.
- **DA-Vul-can** (`~/Progetti/Domarc/DA-Vul-can`): hub, e Scanner-Edge in `infra/scanner-edge/`.
- **Deploy-Appliance** (`~/Progetti/Domarc/Deploy-Appliance`): l'installatore delle appliance.
- **DA-Zabbix** (`~/Progetti/DA-Zabbix`): i proxy Zabbix e il client NetBird da cui si parte.

Il server NetBird (`netbird.domarc.it`, self-hosted) è di **DA-Infra**
(`~/Progetti/DA-Infra`, `docs/servizi/netbird.md`). Cosa fa e com'è messo ognuno sta in
`MAPPA-PROGETTI.html`.

---

## 1. Cos'è e cosa non è

**È** il passaggio del collegamento fra i sistemi centrali Domarc e gli oggetti installati
presso i clienti da Tailscale a NetBird, con tre proprietà:

1. **A stella.** Un oggetto remoto parla solo con i centrali che gli servono, e solo sulle
   porte del suo mestiere.
2. **Remoti ciechi fra loro.** Due oggetti remoti non si raggiungono mai, nemmeno se sono
   dello stesso cliente.
3. **Sempre connessi, ognuno con la sua chiave.** Ogni oggetto entra con una chiave d'ingresso
   monouso emessa solo per lui; una volta dentro resta connesso senza scadenza, finché
   qualcuno non lo revoca.

**Non è:**

- un cambio del dialogo fra edge e hub (API, token, formati): cambia la strada, non quello che
  ci passa sopra. La tappa 7 del [piano di miglioramento](2026-10-12-piano-miglioramento-design.md)
  protegge quel dialogo, e qui non si tocca;
- un modo per raggiungere la LAN del cliente: da Domarc si raggiunge **solo l'appliance**
  (decisione 1, §2);
- il cambio della rete dei colleghi: NetBird per chi lavora da fuori resta com'è. Cambia solo
  quello che serve a tenere i remoti fuori dalle sue policy (§6.2).

## 2. Decisioni prese (Riccardo, 2026-10-14 — non riaprire senza chiedere)

| # | Decisione | Scartate |
|---|---|---|
| 1 | Da NetBird si raggiunge **solo l'oggetto remoto**. Scansioni, SNMP e inventario partono da lui. Nessuna rotta verso la LAN del cliente. | rotta LAN solo per gli admin; rotta LAN anche ai centrali |
| 2 | **Chiave d'ingresso monouso per oggetto**, legata ai gruppi giusti, che non scade una volta dentro. In più resta il token applicativo che edge e hub usano già. | una chiave riusabile per cliente; chiave + controlli di postura |
| 3 | **DA-IPAM centrale crea gruppi, chiavi e policy via API**, sul modello di `zbximport/netbird.py` di DA-Zabbix, con regole di nome comuni a DA-Zabbix. | a mano dalla console; un servizio unico separato |
| 4 | **Doppio binario cliente per cliente, pilota DTS**: NetBird accanto a Tailscale, verifica, poi si toglie Tailscale. Si finisce coi centrali e si spegne la tailnet. | solo i nuovi su NetBird; taglio netto |
| 5 | **Gruppi per ruolo, più un gruppo per cliente.** Le policy sono poche e fisse e si scrivono per ruolo; il gruppo del cliente non apre niente: serve a sapere di chi è un nodo e a revocarlo. | una policy per oggetto; centrali come «risorse» dietro un nodo di instradamento |

## 3. Da dove si parte (verificato nel codice il 2026-10-14)

La tailnet Tailscale di oggi è intestata all'account **personale**
`riccardo.grandi@gmail.com`. La policy versionata sta in
[`infra/tailscale/policy.json`](../../../infra/tailscale/policy.json): tag `da-hub`,
`da-bridge`, `da-admin`. I bridge già non si parlano fra loro.

Tailscale è cablato in questi punti:

| Dove | Cosa fa | File |
|---|---|---|
| DA-IPAM, procedura guidata agenti | chiede «Hostname Tailscale (MagicDNS short)» e un'auth-key `tskey-auth-…`, che finisce nel comando d'installazione | `src/app/(dashboard)/agents/page.tsx`, `src/app/(dashboard)/tenants/[id]/agent/page.tsx` |
| DA-IPAM, credenziali di sistema | tipo `tailscale` fra le credenziali | `src/app/api/system-credentials/**` |
| DA-IPAM, URL dell'hub | ripiego `https://<hostname>` MagicDNS | `src/app/api/settings/hub-url/route.ts` |
| Agente Python di DA-IPAM | accetta solo chiamate dalla fascia `100.64.0.0/10`, porta 8443 | `agent/da_invent_agent/auth.py`, `agent/scripts/install.sh` |
| Scanner-Edge, heartbeat | manda `tailscale_ip` letto da `tailscale ip -4` | `DA-Vul-can/infra/scanner-edge/app/scanner_edge/services/heartbeat.py` |
| Scanner-Edge, primo avvio | `tailscale up --advertise-tags=tag:da-bridge`, `ufw allow in on tailscale0` | `…/firstboot/scanner-edge-firstboot.sh`, `…/scripts/install.sh`, `harden.sh` |
| Bridge-node (Ansible) | ruolo `tailscale`, SSH a regime solo dalla fascia Tailscale | `DA-Vul-can/infra/bridge-node/**` |
| Nomi | DA-Vul-can si raggiunge «sempre per nome `da-vulcan`», risolto da MagicDNS; DA-VA-OVH su `100.89.234.89` | `Domarc/README.md`, `DA-Vul-can/CONTEXT.md` |

NetBird invece c'è già:

- I colleghi lo usano per lavorare da fuori.
- I gruppi oggi sono `users`, `admins`, `exit` e il predefinito `All`. L'accesso di base dei
  colleghi poggia su **`All`** (DA-Infra).
- DA-Zabbix fa entrare i proxy con setup key per cliente, nel gruppo `zabbix-proxy`, con
  **una sola policy** verso `zabbix-server:10051`. Il suo client
  (`DA-Zabbix/zbximport/netbird.py`) sa già creare gruppi e chiavi, revocare chiavi non
  usate, scrivere una policy «quel gruppo verso quella porta», dire se `Default` è accesa e
  a chi va una rotta.

## 4. L'architettura

### 4.1 I nodi

| Lato | Nodo | Gruppo di ruolo |
|---|---|---|
| Centro | DA-IPAM centrale (VM 533, `192.168.4.8`) | `centro-ipam` |
| Centro | DA-Vul-can hub (`da-vulcan`) | `centro-vulcan` |
| Centro | DA-VA-OVH (Greenbone cloud, OVH) | `centro-va` |
| Centro | server Zabbix (`da-zabbix`) | `centro-zabbix` |
| Remoto | appliance DA-IPAM del cliente | `remoto-ipam` |
| Remoto | Scanner-Edge del cliente | `remoto-edge` |
| Remoto | proxy Zabbix del cliente | `zabbix-proxy` (esiste già) |
| Persone | tecnici Domarc | `admins` (esiste già) |
| Persone | colleghi | `users` (esiste già) |

Un nodo remoto sta sempre in **un gruppo di ruolo o più, e nel gruppo del suo cliente**
`cli-<codice>`, dove il codice è quello del cliente in DA-IPAM (es. `cli-71734`). Quando
più ruoli vivono sulla stessa macchina (appliance consolidata con IPAM, edge e proxy) il
nodo è uno solo e sta in tutti quei gruppi.

**Nomi nella rete NetBird**: `<codice>-<ruolo>`, per esempio `71734-edge` →
`71734-edge.netbird.selfhosted`. Per la macchina consolidata il ruolo è `app`.

### 4.2 Le policy

Tutte **a senso unico**, protocollo TCP, porte esplicite. Le risposte tornano indietro da sole
(NetBird tiene lo stato della connessione); non serve la policy inversa.

| # | Sorgente | Destinazione | Porte | Perché |
|---|---|---|---|---|
| P1 | `centro-ipam` | `remoto-ipam` | 8443 (agente) + porta HTTPS dell'appliance, *da misurare in fase 0* | DA-IPAM centrale raccoglie gli oggetti remoti |
| P2 | `remoto-ipam` | `centro-ipam` | porta HTTPS dell'hub, *da misurare* | richiamate e aggiornamenti verso il centro |
| P3 | `centro-vulcan` | `remoto-edge` | 6443 (8443 sugli edge vecchi) | l'hub comanda gli scan |
| P4 | `remoto-edge` | `centro-vulcan` | 443 | heartbeat, upload dei risultati, tarball degli aggiornamenti |
| P5 | `centro-ipam` | `remoto-edge` | 6443 | sincronizzazione vulnerabilità (`vuln_scanners`, pin SPKI) |
| P6 | `centro-vulcan` | `centro-va` | 22 + porta gvmd, *da misurare* | lo scan esterno che oggi passa da SSH |
| P7 | `zabbix-proxy` | `centro-zabbix` | 10051 | esiste già in DA-Zabbix: si tiene |
| P8 | `admins` | `remoto-ipam`, `remoto-edge`, `zabbix-proxy` | 22, 443, 6443 | assistenza tecnica |
| P9 | `admins` | gruppi `centro-*` | 22, 443 | amministrazione dei centrali |

Le porte «da misurare» si leggono in fase 0 sul traffico vero (§7, fase 0). La regola è
quella del parco: «non c'è» e «serve» si dimostrano alla fonte, non dal codice.

### 4.3 Le regole che tengono ciechi i remoti

L'isolamento non dipende da una policy che vieta: in NetBird **senza policy non passa
niente**. Dipende dal fatto che nessuna policy apra un varco. I varchi possibili sono quattro,
e ognuno diventa una regola verificata (§6.1):

- **R1. Nessuna policy collega due gruppi remoti.** Sono remoti `remoto-*`, `zabbix-proxy`
  e `cli-*`.
- **R2. La policy `Default` (tutti con tutti) è spenta.**
- **R3. Il gruppo `All` non compare in nessuna policy, rotta o gruppo di nameserver.**
  Ogni nodo sta in `All` e non lo si può togliere. Una policy da `All` verso il Manager, una
  rotta d'uscita `0.0.0.0/0` distribuita ad `All`, o i DNS interni distribuiti ad `All`
  arriverebbero anche alle appliance dei clienti. Vuol dire uscire su Internet da Domarc,
  vedere il Manager, avere il DNS del cliente sovrascritto dal nostro. DA-Zabbix ha già
  incontrato il caso della rotta d'uscita: «mai ai proxy Zabbix».
- **R4. Nessuna rotta di rete è pubblicata da un nodo remoto** (decisione 1).

## 5. La vita di un oggetto remoto

### 5.1 Ingresso

1. Il tecnico apre in DA-IPAM centrale la procedura guidata dell'oggetto: cliente, ruolo o
   ruoli, nome.
2. DA-IPAM, via API NetBird:
   - crea se manca il gruppo `cli-<codice>` (idempotente);
   - emette una **setup key monouso**: un solo utilizzo, valida 24 ore, non effimera,
     gruppi automatici `cli-<codice>` + i ruoli. Il nome è `<codice>-<ruolo>-<AAAAMMGG>`,
     così si riconosce chi l'ha emessa.
3. La chiave compare **una volta**, dentro il comando d'installazione. Non si salva in chiaro,
   non va nei log, non torna più a schermo. Se si perde se ne emette un'altra, e la prima si
   revoca da sola se non usata.
4. L'installatore (edge, agente, Deploy-Appliance, in futuro il `/setup` dell'immagine della
   tappa 8) fa `netbird up --management-url https://netbird.domarc.it --setup-key … --hostname <codice>-<ruolo>`.
   Il servizio `netbird` resta abilitato all'avvio.
5. DA-IPAM controlla che il nodo sia comparso connesso nei gruppi giusti. Se non compare
   entro il tempo d'installazione lo dice; non lo dà per fatto.

I nodi entrati con setup key non hanno scadenza del login: è il comportamento di NetBird
per i nodi non legati a una persona. Si verifica sulla versione installata in fase 0.

### 5.2 A regime

- La connessione è sempre accesa: NetBird si ricollega da solo dopo riavvii e cambi di rete.
- L'heartbeat dell'edge e la pagina di DA-IPAM dicono **su quale rete** passa il
  collegamento (§6.3).
- Il token applicativo resta com'era: il bearer dell'agente con i suoi scope, il token
  dell'edge verso l'hub, il pin SPKI di DA-IPAM sul certificato dell'edge. NetBird decide
  chi può arrivare alla porta; il token decide che cosa può fare chi ci arriva.

### 5.3 Revoca

- **Un oggetto**: DA-IPAM cancella il nodo in NetBird e revoca le sue chiavi non usate. Il
  tunnel cade subito.
- **Un cliente intero**: si cancellano tutti i nodi del gruppo `cli-<codice>`. Si legge prima
  l'**elenco dei nomi** e lo si conferma (regola 10 del parco: i nomi, non i totali).
- Ogni revoca resta nel registro di audit di DA-IPAM, con chi l'ha fatta e quando.

### 5.4 Chi scrive in NetBird

Ci sono due scrittori, con una divisione netta:

- **DA-IPAM centrale** gestisce i nodi delle appliance e degli edge, e i gruppi `cli-*`,
  `remoto-*`, `centro-*`.
- **La procedura guidata di DA-Zabbix** gestisce i proxy che vivono da soli, nel gruppo
  `zabbix-proxy` e nello stesso gruppo `cli-<codice>`.

Nessuno dei due cancella ciò che non ha creato: si riconosce dal prefisso del nome della chiave
e del nodo. Le policy le scrive solo chi le possiede: P1–P6, P8, P9 DA-IPAM, P7 DA-Zabbix.

## 6. Controlli e visibilità

### 6.1 Verifica dell'isolamento

Un controllo in **sola lettura** in DA-IPAM centrale legge da NetBird policy, rotte e gruppi
di nameserver e verifica R1–R4. Gira:

- a ogni emissione di chiave;
- una volta all'ora;
- a richiesta, dalla pagina.

Se una regola salta, la pagina diventa rossa e dice **quale** policy o rotta apre il varco,
per nome. Va anche nel monitoraggio: un controllo che fallisce in silenzio non serve
(regola 6 del parco). Le quattro regole sono anche **prove automatiche**: con policy finte
nella forma vera dell'API NetBird, ogni prova va vista fallire prima di passare.

### 6.2 Prerequisito: tirare fuori `All` dalle policy dei colleghi

Oggi l'accesso di base dei colleghi poggia su `All`, quindi R2 e R3 sono rosse appena il
primo cliente entra. Prima di qualunque oggetto remoto:

1. si fotografano policy, rotte e nameserver attuali (export JSON nel vault di DA-Infra);
2. ogni policy, rotta o nameserver con `All` passa a `users` e/o `admins`, e `users` diventa
   gruppo automatico di ogni persona (`assegna_gruppo_automatico` del client DA-Zabbix fa già
   questo);
3. si verifica da un client di un collega, fuori sede, che si raggiunga ancora quello che si
   raggiungeva prima: Manager, RDP, DMZ, DNS interni (`dig +short manager.domarc.it` →
   `192.168.4.42`);
4. solo allora si spegne `Default`.

È una scrittura sul servizio NetBird di produzione: serve la conferma di Riccardo.

### 6.3 Si vede nell'interfaccia

- **DA-IPAM**: per ogni oggetto remoto, rete (NetBird / Tailscale / nessuna), nome e IP
  NetBird, connesso o no, ultimo contatto, versione del client. Accanto, l'esito della verifica
  isolamento e la **scadenza del token API** di DA-IPAM verso NetBird: un token scaduto
  fermerebbe in silenzio ogni nuova installazione.
- **DA-Vul-can**: sulla pagina delle sonde, la rete da cui arriva l'heartbeat. È l'indicatore
  D15 del suo BACKLOG, generalizzato.

## 7. Il passaggio

Ogni fase si chiude da sola. Ci si può fermare dopo qualunque fase senza lasciare niente a metà.

**Fase 0 — Preparazione. Niente codice, niente clienti.**

- Censimento dei nodi Tailscale (`tailscale status` da un centrale): quali clienti, quali
  ruoli, quale macchina. L'elenco diventa la lista della fase 3.
- Misura dei flussi reali verso e dai remoti, per chiudere le porte «da misurare» in §4.2.
- **Prova di convivenza su una VM di prova** con Tailscale e NetBird accesi insieme (§8,
  rischio 1). Se non passa, si decide il rimedio prima di toccare DTS.
- Versione del server NetBird; comportamento di scadenza dei nodi entrati con setup key;
  quali permessi servono al token API.
- Utente di servizio NetBird per DA-IPAM, token nel vault (`secret_ref` in `ACCESSI.md`).
- §6.2: `All` fuori dalle policy dei colleghi, `Default` spenta.
- Gruppi `centro-*` e `remoto-*` e policy P1–P9 creati. I centrali entrano in NetBird
  **senza lasciare Tailscale**.

Esce quando: i centrali sono connessi in NetBird, la verifica R1–R4 fatta a mano è verde e i
colleghi raggiungono ciò che raggiungevano prima.

**Fase 1 — Codice, sul dev.** Le modifiche del §9, con Tailscale ancora supportato accanto.

Esce quando: i cancelli dei repo sono verdi, e una chiave emessa sul NetBird vero da DA-IPAM di
sviluppo fa entrare una VM di prova nei gruppi giusti. La chiave e la VM si tolgono subito dopo.

**Fase 2 — Pilota DTS**, appliance `172.16.0.2`, edge `172.16.1.141`, `proxy-dts`.

1. NetBird accanto a Tailscale sulle macchine di DTS, con chiavi emesse da DA-IPAM.
2. Gli indirizzi con cui centrali e DTS si cercano passano ai nomi NetBird.
3. Si verifica **dal di fuori**, flusso per flusso, come lo usa chi lo usa:
   - heartbeat arrivato con rete = NetBird;
   - «Test connessione» dell'agente da DA-IPAM centrale;
   - sincronizzazione delle vulnerabilità;
   - ultimo contatto di `proxy-dts` in Zabbix.
4. Prova d'isolamento in negativo: da un nodo DTS non si raggiunge nessun altro remoto né
   un centrale fuori dalle porte previste.
5. Una settimana a doppio binario, poi si toglie Tailscale da DTS.

DTS è un cliente in esercizio: ogni passo su quelle macchine chiede conferma.

**Fase 3 — Gli altri clienti**, uno per volta, nello stesso modo, dalla lista della fase 0.
Dove la tappa 7e del piano di miglioramento migra lo stesso edge, si fanno insieme: una sola
finestra per cliente.

**Fase 4 — Spegnimento.**

- Tailscale si toglie dai centrali.
- Tutti i riferimenti a `da-vulcan` risolto da MagicDNS e all'IP Tailscale di DA-VA passano
  al nome nuovo (§8, rischio 3).
- Si toglie il codice Tailscale: campo della procedura guidata, tipo di credenziale,
  `tailscale_ip` nell'heartbeat, ruolo Ansible, `infra/tailscale/`.
- La tailnet personale si cancella.

## 8. Rischi e trappole note in anticipo

1. **Tailscale e NetBird nella stessa fascia di indirizzi.** Entrambi usano `100.64.0.0/10`.
   Sui nodi Linux Tailscale mette una regola firewall che scarta il traffico da quella fascia
   non arrivato dalla propria interfaccia: a doppio binario potrebbe scartare proprio il
   traffico NetBird. Si prova in fase 0. Rimedi possibili, da scegliere dopo la prova:
   - Tailscale con le regole firewall disattivate sui remoti durante il doppio binario;
   - una fascia NetBird diversa nelle impostazioni dell'account.
2. **Spegnere `Default` o togliere `All` taglia i colleghi** se le loro policy non esistono
   già a parte. Per questo §6.2 viene prima di tutto, con la fotografia per tornare indietro.
3. **Il nome `da-vulcan` lo risolve Tailscale**, ed è scritto in documenti, script e regole
   («sempre per nome»). Serve un nome stabile che non dipenda dalla rete:
   `da-vulcan.netbird.selfhosted` o un nome nel DNS interno. Si sceglie in fase 0 e si
   sostituisce prima della fase 4, con una grep che deve tornare vuota.
4. **Il server NetBird è un punto unico.** Se `netbird.domarc.it` cade, i tunnel già aperti
   reggono per un po', ma i nodi nuovi non entrano e quelli che si ricollegano no.
   - Va monitorato da Zabbix.
   - Va ricordata la trappola di DA-Infra: Traefik v3 taglia gli stream a 60 secondi,
     `readTimeout: 0` non è opzionale.
5. **Il token API di DA-IPAM verso NetBird scade.** Senza avviso, le installazioni smettono di
   funzionare il giorno dopo. Per questo la scadenza si vede in pagina (§6.3), con un avviso
   30 giorni prima.
6. **L'agente accetta la fascia `100.64.0.0/10`.** Con NetBird quel controllo passa ancora
   ma non distingue più nulla. Diventa: fonte ammessa = la rete NetBird dell'account, letta
   all'installazione, più bearer e scope come oggi. La barriera vera è la policy;
   l'agente è la seconda linea.
7. **Il firewall dell'edge si fida di tutta l'interfaccia Tailscale** (`ufw allow in on tailscale0`).
   Su NetBird si aprono solo le porte delle policy (6443, 22). Anche qui la barriera vera è la
   policy, e il firewall è la seconda linea.
8. **Il certificato dell'edge** contiene oggi nome DNS e IP della LAN. Il pin SPKI di DA-IPAM
   non dipende dal nome, ma i client che verificano il nome sì: si aggiunge il nome NetBird ai
   SAN (`tls_extra_sans`) e si verifica in fase 2 chi controlla cosa.
9. **Il firewall del cliente in uscita.** NetBird prova la via diretta in UDP e ripiega sul
   relay in 443 TCP. Su un cliente che chiude tutto in uscita si verifica che il relay passi,
   prima di togliere Tailscale.

## 9. Cosa cambia, repo per repo

**DA-IPAM**

- Modulo `src/lib/netbird/`: client API (gruppi, chiavi, revoca, nodi, policy in lettura),
  portato da `DA-Zabbix/zbximport/netbird.py`; verifica R1–R4; stato dei nodi.
- Credenziale di sistema di tipo `netbird` (URL + token cifrato a riposo), accanto a
  `tailscale` fino alla fase 4.
- Procedura guidata agenti/oggetti remoti: «Nome NetBird» al posto di «Hostname Tailscale»;
  la chiave la emette DA-IPAM, non la incolla il tecnico.
- Pagina dello stato rete degli oggetti remoti + verifica isolamento + scadenza del token
  (§6.3).
- Agente Python: fonte ammessa configurabile (rischio 6); `install.sh` con `NETBIRD_SETUP_KEY`.
- Audit: emissione, revoca, cancellazione di nodi.

**DA-Vul-can / Scanner-Edge**

- Heartbeat: campi `overlay` (`netbird`/`tailscale`/`nessuno`), `overlay_ip`,
  `overlay_name`; `tailscale_ip` resta fino alla fase 4 per gli hub non aggiornati.
- Hub: salva e mostra la rete dell'heartbeat (D15).
- Primo avvio, `install.sh`, `harden.sh`: setup key NetBird; firewall per porta su `wt0`;
  nome NetBird nei SAN.
- Bridge-node Ansible: ruolo `netbird` accanto a `tailscale`, poi al suo posto.

**Deploy-Appliance**

- Parametro setup key NetBird nell'installatore, al posto dell'auth-key Tailscale; il comando
  `netbird up` uguale a quello di §5.1.

**DA-Zabbix**

- La procedura guidata dei proxy mette il nodo anche in `cli-<codice>` e usa le stesse regole
  di nome.
- Quando il proxy sta su un'appliance già in NetBird, non emette un'altra chiave: chiede a
  DA-IPAM di aggiungere il nodo esistente a `zabbix-proxy`, o lo fa con lo stesso client.
  Si sceglie nel piano.

**DA-Infra** — solo documentazione: `docs/servizi/netbird.md` aggiornato con gruppi, policy
e la regola «`All` mai».

## 10. Rapporto col piano di miglioramento di DA-IPAM

- **Tappa 7** (edge guidato da DA-IPAM): non si tocca il contratto con l'hub; si cambia la
  rete sotto. La migrazione edge per edge (7e) e la fase 3 si fanno insieme dove coincidono.
- **Tappa 8** (installazione dall'immagine): il `/setup` del primo avvio chiede la setup key
  NetBird, non quella Tailscale. Se la tappa 8 parte prima, nasce già così.
- Questo lavoro non dipende dalle tappe 1–6, e quelle non dipendono da lui.

## 11. Come si verifica che funziona

- **Prove automatiche**:
  - R1–R4 su policy finte nella forma vera dell'API;
  - emissione chiave con gruppi giusti e nome giusto;
  - revoca che tocca solo ciò che DA-IPAM ha creato;
  - heartbeat con i campi nuovi e quelli vecchi;
  - agente che rifiuta una fonte fuori dalla rete NetBird.
- **Sul vero, dal di fuori**, in fase 2 e per ogni cliente in fase 3:
  - i quattro flussi della fase 2, punto 3;
  - la prova d'isolamento in negativo;
  - un riavvio dell'oggetto remoto, dopo il quale torna connesso da solo.
- **Verifica isolamento** verde nella pagina di DA-IPAM, con la data e la fonte della lettura.

## 12. Cosa resta da decidere nel piano operativo

- Il nome stabile per DA-Vul-can (rischio 3).
- Il rimedio alla convivenza in `100.64.0.0/10`, se la prova della fase 0 lo richiede.
- Proxy Zabbix su appliance: chi aggiunge il nodo a `zabbix-proxy` (§9, DA-Zabbix).
- Se DA-VA-OVH entra in NetBird o si spegne prima, col passaggio allo Scanner-Edge
  `external_va` (DA-Vul-can, ADR 0011 di quel repo).
