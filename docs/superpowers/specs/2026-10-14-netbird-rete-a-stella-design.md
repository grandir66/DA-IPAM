# DA-Link e NetBird: una rete a stella fra centrali Domarc e oggetti dei clienti

**Stato:** disegno approvato a voce da Riccardo il 2026-10-14, rivisto sette volte lo stesso
giorno (moduli; DA-Link e DA-CRM; privacy decisa dall'istanza; licenza e custodia dei segreti;
CA interna; YubiKey al posto della macchina scollegata;
resilienza della flotta); documento da rileggere
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Decisioni architetturali:** [ADR 0011](../../adr/0011-netbird-rete-a-stella.md) (rete),
[ADR 0013](../../adr/0013-licenza-e-segreto-degli-oggetti.md) (licenza, custodia, CA interna)
**Livello di controllo:** completo (si toccano appliance in esercizio presso i clienti)

Riguarda sei progetti. Ognuno lo cita con una riga dal proprio `CONTEXT.md`, senza ricopiarlo:

- **DA-Link** (progetto nuovo, `~/Progetti/Domarc/DA-Link`): il collettore centrale. Fa
  entrare gli oggetti remoti in NetBird da solo e raccoglie i dati delle istanze IPAM.
  Quando il repo esiste, questo documento si sposta lì e qui resta un rimando.
- **DA-IPAM** (`~/Progetti/Domarc/DA-IPAM`): l'istanza che va dai clienti.
- **DA-Vul-can** (`~/Progetti/Domarc/DA-Vul-can`): hub VA in sede, e Scanner-Edge in
  `infra/scanner-edge/`.
- **DA-Zabbix** (`~/Progetti/DA-Zabbix`): server in sede, proxy dai clienti, e il client
  NetBird da cui si parte.
- **DA-CRM** (`~/Progetti/DA-CRM`): legge da DA-Link il quadro tecnico del cliente.
- **Deploy-Appliance** (`~/Progetti/Domarc/Deploy-Appliance`): l'installatore delle
  appliance.

Il server NetBird (`netbird.domarc.it`, self-hosted) è di **DA-Infra**
(`~/Progetti/DA-Infra`, `docs/servizi/netbird.md`). Cosa fa e com'è messo ognuno sta in
`MAPPA-PROGETTI.html`.

---

## 1. Cos'è e cosa non è

**È** il passaggio del collegamento fra i sistemi centrali Domarc e gli oggetti installati
presso i clienti da Tailscale a NetBird, con tre proprietà:

1. **A stella.** Un oggetto remoto parla solo col centrale del suo mestiere, e solo sulle
   porte di quel mestiere.
2. **Remoti ciechi fra loro.** Due oggetti remoti non si raggiungono mai, nemmeno se sono
   dello stesso cliente.
3. **Sempre connessi, ognuno con la sua chiave.** Ogni oggetto entra con una chiave d'ingresso
   monouso emessa solo per lui; una volta dentro resta connesso senza scadenza, finché
   qualcuno non lo revoca.

E fa nascere **DA-Link** nella sua prima forma, con quattro compiti:

- sa quali oggetti remoti ha ogni cliente;
- li fa entrare in NetBird e li revoca **da solo**: nessuno apre la console NetBird;
- dice se sono connessi e se l'isolamento regge;
- raccoglie il segnale di vita delle istanze IPAM, e i numeri dell'inventario **solo dove
  l'istanza lo consente** (decisione 13), e li dà in lettura a DA-CRM;
- emette e rinnova da solo la **licenza** e il **segreto** di ogni oggetto, che servono anche
  a firmare gli scambi e a proteggere i dati archiviati (§8). Custodisce le chiavi più
  delicate del parco, con accesso ristretto (§9);
- rilascia a ogni installazione un **certificato della CA interna** Domarc, riconosciuto in
  automatico dagli applicativi (§8.4).

**Non è:**

- un cambio del dialogo fra edge e hub (API, token, formati): cambia la strada, non quello che
  ci passa sopra. La tappa 7 del [piano di miglioramento](2026-10-12-piano-miglioramento-design.md)
  protegge quel dialogo, e qui non si tocca;
- un modo per raggiungere la LAN del cliente: da Domarc si raggiunge **solo l'oggetto**
  (decisione 1, §2);
- la console centrale completa della tappa 9 (canale d'aggiornamento, creazione di
  appliance): quella cresce dopo, **dentro DA-Link**;
- **le ricerche OSINT avviate dal CRM**: il CRM chiama DA-Vul-can direttamente. È il filo
  già aperto in DA-CRM, `docs/migrazioni/piano-e-prompt.md` punto 3: il permesso di spesa
  verso DA-Vul-can come servizio, con un ADR del CRM che lo decide. DA-Link non c'entra
  (decisione 10);
- **DA-VA-OVH**: è nel cloud di Domarc e si raggiunge con la sua VPN diretta. Resta fuori da
  NetBird; alla fine si verifica solo che da-vulcan lo raggiunga ancora senza Tailscale;
- **Wazuh**: resta isolato e non visibile, mai in NetBird (decisione 8);
- il cambio della rete dei colleghi: NetBird per chi lavora da fuori resta com'è. Cambia solo
  quello che serve a tenere i remoti fuori dalle sue policy (§6.2).

## 2. Decisioni prese (Riccardo, 2026-10-14 — non riaprire senza chiedere)

| # | Decisione | Scartate |
|---|---|---|
| 1 | Da NetBird si raggiunge **solo l'oggetto remoto**. Scansioni, SNMP e inventario partono da lui. Nessuna rotta verso la LAN del cliente. | rotta LAN solo per gli admin; rotta LAN anche ai centrali |
| 2 | **Chiave d'ingresso monouso per oggetto**, legata ai gruppi giusti, che non scade una volta dentro. In più resta il token applicativo di ciascun dialogo. | una chiave riusabile per cliente; chiave + controlli di postura |
| 3 | **DA-Link crea gruppi, chiavi e policy via API**, sul modello di `zbximport/netbird.py` di DA-Zabbix, con regole di nome comuni a DA-Zabbix. | a mano dalla console; uno strumento provvisorio; la procedura guidata di DA-Zabbix estesa a tutto |
| 4 | **Doppio binario cliente per cliente, pilota DTS**: NetBird accanto a Tailscale, verifica, poi si toglie Tailscale. Si finisce coi centrali e si spegne la tailnet. | solo i nuovi su NetBird; taglio netto |
| 5 | **Gruppi per ruolo, più un gruppo per cliente.** Le policy sono poche e fisse e si scrivono per ruolo; il gruppo del cliente non apre niente: serve a sapere di chi è un nodo e a revocarlo. | una policy per oggetto; centrali come «risorse» dietro un nodo d'instradamento |
| 6 | **DA-Link nasce subito, piccolo, come progetto separato** in `~/Progetti/Domarc/DA-Link`, installato solo in sede. È l'inizio della console centrale della tappa 9. | dentro DA-IPAM come modalità (finirebbe su ogni appliance col ramo `main`); dentro l'hub DA-Vul-can |
| 7 | **Le istanze IPAM mandano i dati a DA-Link** (443), come gli edge con da-vulcan e i proxy con Zabbix. Sul remoto non si apre nessuna porta in ingresso, tranne quelle per i tecnici. | DA-Link che va a prendere; entrambi |
| 8 | **Wazuh non entra mai in NetBird** e nessuna policy porta alle sue porte. | — |
| 9 | **DA-Link è autonomo verso NetBird.** Ha il suo utente di servizio e crea da sé gruppi, chiavi e policy al clic del tecnico. Se qualcuno modifica a mano una policy di DA-Link, la rimette com'era e lo dice. | anche l'iscrizione automatica al primo avvio (DA-Link esposto su Internet); anche la preparazione dell'oggetto chiesta dal CRM |
| 10 | **L'OSINT avviato dal CRM va dal CRM a DA-Vul-can**, senza passare da DA-Link. | tutto attraverso DA-Link |
| 11 | **Il CRM vede da DA-Link**, per cliente: oggetti e collegamento, salute e versioni, esito dell'isolamento, numeri dell'inventario **se l'istanza li condivide** (decisione 13). Solo lettura. | — |
| 12 | **Il cliente si identifica con `codcli` del gestionale** in tutti i sistemi: gruppo `cli-<codcli>`, nome dei nodi, API di DA-Link. È già la chiave di DA-Vul-can (`/api/clients/[codcli]/…`) e del CRM. | — |
| 13 | **Cosa esce dall'istanza IPAM verso il centro lo decide l'istanza.** Due livelli, impostati solo dall'amministratore dell'istanza (confermato da Riccardo): **solo stato** oppure **stato + numeri dell'inventario**. Dal centro non si cambia. Senza una scelta dichiarata esce solo lo stato. Se il cliente vuole privacy la ha: in quel caso Domarc gestisce solo lo stato. | livello deciso da DA-Link o dal CRM; inventario condiviso finché il cliente non lo blocca |
| 14 | **DA-Link può spegnere un oggetto remoto se la licenza scade**: non con un comando, ma non rinnovandogli la licenza; per tagliarlo fuori subito lo toglie anche da NetBird. | un comando di spegnimento dal centro |
| 15 | **A licenza scaduta l'oggetto smette di lavorare, ma i dati restano leggibili ed esportabili** dal cliente. | spegnimento totale coi dati illeggibili; solo avviso prolungato |
| 16 | **Un solo segreto per oggetto, generato e rinnovato da DA-Link**, da cui si ricavano tre chiavi distinte: licenza/rinnovo, firma degli scambi, protezione dei dati archiviati. Dati archiviati **cifrati a busta con copia di recupero**. | dati cifrati direttamente con la chiave della licenza; busta senza recupero; dati fuori dalla licenza |
| 17 | **Il segreto vale 4 settimane, con 2 di tolleranza**; la licenza vale per istanze IPAM ed edge. | 2+1 settimane; 12+4; solo istanze; anche il proxy con un guardiano |
| 18 | **Per ora il portachiavi di DA-Link si sblocca a mano a ogni avvio**; la YubiKey si valuta dopo. | modulo hardware subito; TPM virtuale + disco cifrato |
| 19 | **All'interfaccia di DA-Link entrano poche persone nominate, con MFA**, solo dal gruppo NetBird `link-admin`; nessuna seconda conferma. | quattro occhi sulle azioni gravi; solo Riccardo |
| 20 | **Chiavi di recupero e radici della CA vivono dentro due YubiKey in cassaforte**, generate nel dispositivo; niente macchina scollegata dedicata. DA-Link non le possiede. | nel vault delle credenziali; divisa fra persone (Shamir); macchina scollegata per la CA; radice in un file cifrato |
| 21 | **Una CA interna rilascia un certificato a ogni installazione**, riconosciuto in automatico dagli applicativi: due radici sulle YubiKey in cassaforte, intermedia in DA-Link limitata ai nomi interni, motore `step-ca`, certificati di 4 settimane rinnovati col segreto. | certificati auto-firmati con pin al primo contatto (oggi); una CA a un livello sola in DA-Link; una CA scritta a mano |
| 22 | **La flotta sopravvive a DA-Link.** Un rinnovo non accorcia mai la licenza in corso (una più restrittiva vale dalla fine di quella attuale); nessuna risposta di DA-Link cambia la configurazione dell'istanza; il firewall locale accetta solo i centrali; la verifica R1–R5 la fa anche DA-ZABBIX. | fiducia piena in DA-Link |
| 23 | **Chiave di emergenza sulle YubiKey**, più forte della firma di DA-Link: firma bollettini che ritirano la fiducia a un DA-Link compromesso, fanno lavorare la flotta in modalità autonoma fino a una data e presentano il DA-Link nuovo. Arrivano da un canale di riserva o a mano. La flotta si riconfigura senza reinstallarla. | reinstallare ogni oggetto dopo una compromissione; un DA-Link di riserva sempre acceso |

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

Altre cose che esistono già:

- **La VM 533 (`192.168.4.8`) non è DA-Link**: è l'istanza DA-IPAM di Domarc stessa. Sta in
  sede, raggiunge DA-Link in LAN e non ha bisogno di NetBird.
- **Il CRM mostra già un pezzo di quadro tecnico.** La scheda cliente ha il riquadro «Cosa
  espone su internet» da DA-Vul-can (linguetta Tecnica, R4 del piano del CRM). Il Manager ha
  un aggregatore per `codcli` col lettore Zabbix (`quadro-tecnico`, M2 dello stesso piano).
  DA-Link si affianca a quelle fonti: non le sostituisce.

## 4. L'architettura

### 4.1 I nodi

**Al centro**, in sede:

| Nodo | Gruppo NetBird |
|---|---|
| da-vulcan (hub VA) | `centro-vulcan` |
| DA-ZABBIX (server) | `centro-zabbix` |
| DA-Link (nuovo) | `centro-link` |
| DA-CRM (`.42` live, `.41` dev) | nessuno: parla con DA-Link e DA-Vul-can in LAN |

**Dai clienti**:

| Tipo | Cosa contiene | Gruppi NetBird |
|---|---|---|
| 1. Edge da solo | Scanner-Edge per le scansioni VA | `remoto-edge` |
| 2. Proxy Zabbix da solo | proxy Zabbix | `zabbix-proxy` (esiste già) |
| 3. Istanza IPAM | DA-IPAM, e può contenere edge, proxy Zabbix, LibreNMS e altri applicativi | `remoto-ipam`, più `remoto-edge` e/o `zabbix-proxy` se li contiene |
| 4. Wazuh | — | **nessuno**: non entra in NetBird |

**Persone**: `admins` (tecnici) e `users` (colleghi), esistono già.

Un nodo remoto sta sempre anche nel gruppo del suo cliente `cli-<codcli>` (es. `cli-71734`).
Un'istanza IPAM che contiene edge e proxy è **un nodo solo**, in tre gruppi di ruolo. Gli altri
applicativi dell'istanza (LibreNMS, Graylog leggero, …) non hanno policy proprie: si
raggiungono solo passando dall'interfaccia dell'istanza.

**Nomi nella rete NetBird**: `<codcli>-<tipo>`, cioè `-edge`, `-zbx`, `-ipam`; per esempio
`71734-ipam.netbird.selfhosted`.

### 4.2 Le policy

Tutte **a senso unico**, protocollo TCP, porte esplicite. Le risposte tornano indietro da sole
(NetBird tiene lo stato della connessione); non serve la policy inversa.

| # | Sorgente | Destinazione | Porte | Perché | Di chi è |
|---|---|---|---|---|---|
| P1 | `remoto-ipam` | `centro-link` | 443 | l'istanza manda segnale di vita e inventario (decisione 7) | DA-Link |
| P2 | `remoto-edge` | `centro-vulcan` | 443 | heartbeat, risultati, tarball degli aggiornamenti | DA-Link |
| P3 | `centro-vulcan` | `remoto-edge` | 6443 (8443 sugli edge vecchi) | l'hub comanda gli scan: dialogo esistente, non si cambia | DA-Link |
| P4 | `zabbix-proxy` | `centro-zabbix` | 10051 | proxy in modalità active | DA-Zabbix (esiste già) |
| P4b | `centro-zabbix` | `zabbix-proxy` | 22 | la procedura guidata di DA-Zabbix entra nel proxy per sondare le reti del cliente: è da lì che si vedono | DA-Zabbix (esiste già) |
| P5 | `admins` | `remoto-ipam`, `remoto-edge`, `zabbix-proxy` | 22, 443, 6443 | assistenza tecnica | DA-Link |
| P6 | `link-admin` per DA-Link, `admins` per gli altri | `centro-*` | 22, 443 | amministrazione dei centrali; DA-Link solo da `link-admin` (§9.1) | DA-Link |
| P7 | `remoto-edge` | `centro-link` | 443 (solo API di rinnovo) | l'edge rinnova licenza e segreto (§8.2) | DA-Link |

Non ci sono policy da DA-Link verso le istanze: è l'istanza a chiamare (decisione 7). Se in
futuro servisse un comando dal centro verso un'istanza, viaggerebbe come risposta a una sua
chiamata, non come porta aperta.

### 4.3 Le regole che tengono ciechi i remoti

L'isolamento non dipende da una policy che vieta: in NetBird **senza policy non passa
niente**. Dipende dal fatto che nessuna policy apra un varco. I varchi possibili sono cinque,
e ognuno diventa una regola verificata (§6.1):

- **R1. Nessuna policy collega due gruppi remoti.** Sono remoti `remoto-*`, `zabbix-proxy`
  e `cli-*`.
- **R2. La policy `Default` (tutti con tutti) è spenta.**
- **R3. Il gruppo `All` non compare in nessuna policy, rotta o gruppo di nameserver.**
  Ogni nodo sta in `All` e non lo si può togliere. Una policy da `All` verso il Manager, una
  rotta d'uscita `0.0.0.0/0` distribuita ad `All`, o i DNS interni distribuiti ad `All`
  arriverebbero anche agli oggetti dei clienti. Vuol dire uscire su Internet da Domarc,
  vedere il Manager, avere il DNS del cliente sovrascritto dal nostro. DA-Zabbix ha già
  incontrato il caso della rotta d'uscita: «mai ai proxy Zabbix».
- **R4. Nessuna rotta di rete è pubblicata da un nodo remoto** (decisione 1).
- **R5. Wazuh resta invisibile** (decisione 8):
  - nessun nodo NetBird ha nel nome o nei gruppi un ruolo Wazuh;
  - nessuna policy verso un remoto contiene porte Wazuh (1514, 1515, 55000, 9200 e la porta
    della dashboard);
  - sull'istanza IPAM il firewall dell'interfaccia NetBird non apre porte Wazuh. Lo dice
    l'istanza stessa nel suo segnale di vita (§5.2) e DA-Link lo confronta con l'elenco
    atteso.

## 5. La vita di un oggetto remoto

### 5.1 Ingresso

1. Il tecnico apre in DA-Link «nuovo oggetto»: cliente (`codcli`, con il nome letto dal CRM),
   tipo (edge / proxy / istanza IPAM con i moduli che contiene), nome.
2. DA-Link, da solo, via API NetBird:
   - crea se manca il gruppo `cli-<codcli>` (idempotente);
   - emette una **setup key monouso**: un solo utilizzo, valida 24 ore, non effimera,
     gruppi automatici `cli-<codcli>` + i ruoli. Il nome è `<codcli>-<tipo>-<AAAAMMGG>`,
     così si riconosce chi l'ha emessa.
   - per un'istanza IPAM, genera anche il **token** con cui l'istanza manderà i dati (P1).
3. Chiave e token compaiono **una volta**, dentro il comando d'installazione. Non si salvano in
   chiaro, non vanno nei log, non tornano più a schermo. Se si perdono se ne emettono altri,
   e la chiave non usata si revoca da sola.
4. L'installatore (edge, istanza IPAM con Deploy-Appliance, in futuro il `/setup`
   dell'immagine della tappa 8, proxy dalla procedura guidata di DA-Zabbix) fa
   `netbird up --management-url https://netbird.domarc.it --setup-key … --hostname <codcli>-<tipo>`.
   Il servizio `netbird` resta abilitato all'avvio.
5. DA-Link controlla che il nodo sia comparso connesso nei gruppi giusti e, per un'istanza
   IPAM, che sia arrivato il primo segnale di vita. Se non succede entro il tempo
   d'installazione lo dice; non lo dà per fatto.

I nodi entrati con setup key non hanno scadenza del login: è il comportamento di NetBird
per i nodi non legati a una persona. Si verifica sulla versione installata in fase 0.

### 5.2 A regime

- La connessione è sempre accesa: NetBird si ricollega da solo dopo riavvii e cambi di rete.
- **Segnale di vita dell'istanza IPAM** verso DA-Link (P1), a intervalli fissi. Il contenuto
  dipende dal livello scelto sull'istanza (decisione 13, §5.3):
  - **sempre (solo stato)**:
    - versione e moduli accesi;
    - salute dei moduli;
    - ultimo errore;
    - **porte aperte sull'interfaccia NetBird** (per R5): riguardano l'appliance, non la
      rete del cliente, e servono a dimostrare che Wazuh resta invisibile;
    - il livello scelto.
  - **solo con il livello «stato + inventario»**: numeri dell'inventario, cioè dispositivi,
    reti, ultima scansione e suo esito.
- Anche col livello più aperto passano solo numeri e stati, **mai l'inventario riga per
  riga**: il dato del cliente resta sull'istanza. Se un giorno servisse il dettaglio, è una
  decisione nuova, e passerebbe comunque dal consenso dell'istanza.
- Il contenuto crescerà con la tappa 9.
- L'heartbeat dell'edge verso da-vulcan dice su quale rete passa (§6.3).
- I token applicativi restano com'erano: il token dell'edge verso l'hub, il token
  dell'istanza verso DA-Link. NetBird decide chi può arrivare alla porta; il token decide
  che cosa può fare chi ci arriva.

### 5.3 Privacy: decide l'istanza

Il cliente sceglie cosa esce, e la scelta vale **all'origine**: è l'istanza che costruisce
il segnale di vita, quindi un dato bloccato non parte proprio, invece di essere scartato
all'arrivo.

- **Dove si sceglie**: sull'istanza DA-IPAM, in una pagina «Cosa esce da questa istanza»,
  riservata al ruolo amministratore dell'istanza. Ogni cambio finisce nel registro di audit
  locale, con chi e quando.
- **Il valore di partenza**: un'istanza che non ha dichiarato niente manda **solo lo stato**
  (regola dei freni del parco: ciò che non è dichiarato non esce). All'installazione il
  tecnico chiede al cliente e imposta il livello. La domanda sta nel `/setup` e in
  Deploy-Appliance, e non ha un valore pre-selezionato.
- **Il centro non può cambiarlo.**
  - Non esiste un'API da DA-Link, dal CRM o da altri verso l'istanza per alzare il livello.
  - Comunque non c'è una porta per arrivarci (decisione 7).
  - Una risposta di DA-Link non modifica mai la configurazione dell'istanza.
- **Quando il cliente abbassa il livello**:
  - il segnale successivo lo dichiara;
  - DA-Link **cancella i numeri dell'inventario già ricevuti** per quel cliente e risponde
    con la conferma;
  - l'istanza mostra la conferma nella pagina, con data e ora. Finché la conferma non
    arriva, la pagina dice «in attesa di conferma», non «fatto».
- **DA-Link fa da seconda linea.** Se riceve campi d'inventario da un'istanza che dichiara
  «solo stato», li scarta senza salvarli e lo segnala come anomalia (un'istanza che manda
  più di quanto dichiara è un difetto).
- **La pagina mostra tutto ciò che esce verso Domarc**, non solo DA-Link:
  - lo stato e, se consentito, i numeri verso DA-Link;
  - i risultati delle scansioni verso da-vulcan, se l'edge è acceso;
  - i dati del monitoraggio verso Zabbix, se il proxy è acceso.

  Quei due flussi sono il servizio stesso che il cliente ha chiesto, e si fermano spegnendo
  il modulo. La pagina lo dice con quelle parole.
- L'interfaccia si propone oggetto per oggetto prima di scriverla (regola grafica del parco).

### 5.4 Revoca

- **Un oggetto**: DA-Link cancella il nodo in NetBird, revoca le sue chiavi non usate e il
  token dell'istanza. Il tunnel cade subito.
- **Un cliente intero**: si cancellano tutti i nodi del gruppo `cli-<codcli>`. Si legge prima
  l'**elenco dei nomi** e lo si conferma (regola 10 del parco: i nomi, non i totali).
- Ogni revoca resta nel registro di audit di DA-Link, con chi l'ha fatta e quando.

### 5.5 Chi scrive in NetBird

Ci sono due scrittori, con una divisione netta:

- **DA-Link** gestisce i nodi edge e istanze IPAM, i gruppi `cli-*`, `remoto-*`, `centro-*`
  e le policy P1–P3, P5, P6.
- **La procedura guidata di DA-Zabbix** gestisce i proxy che vivono da soli, nel gruppo
  `zabbix-proxy` e nello stesso `cli-<codcli>`, e le policy P4 e P4b.

Nessuno dei due cancella ciò che non ha creato: si riconosce dal prefisso del nome della chiave
e del nodo. Il proxy che vive dentro un'istanza IPAM non riceve una seconda chiave: è lo stesso
nodo, e lo mette in `zabbix-proxy` DA-Link all'ingresso.

## 6. Controlli, autonomia e visibilità

### 6.1 Verifica dell'isolamento e riallineamento

Un controllo in **sola lettura** in DA-Link legge da NetBird policy, rotte, gruppi di
nameserver e nodi, insieme alle porte dichiarate dalle istanze, e verifica R1–R5. Gira:

- a ogni emissione di chiave;
- una volta all'ora;
- a richiesta, dalla pagina.

Se una regola salta, la pagina diventa rossa e dice **quale** policy, rotta o istanza apre il
varco, per nome. Va anche nel monitoraggio (DA-ZABBIX): un controllo che fallisce in silenzio
non serve (regola 6 del parco). Le cinque regole sono anche **prove automatiche**: con dati
finti nella forma vera dell'API NetBird, ogni prova va vista fallire prima di passare.

**Riallineamento** (decisione 9):
- **Le policy di DA-Link** (P1–P3, P5, P6) sono descritte nel suo codice. Se in NetBird
  risultano diverse — porte cambiate, gruppi aggiunti, spente — DA-Link le rimette come
  da descrizione e scrive nel registro cosa ha trovato e cosa ha cambiato.
- **Le policy degli altri** non le tocca mai: se rompono R1–R5, le segnala e basta.
- Il riallineamento parte con un **freno**: nasce spento, segnala soltanto («qui avrei
  rimesso X») e si accende contando, dopo che le segnalazioni si sono dimostrate giuste
  (regola dei freni del parco).

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

- **DA-Link**: un elenco degli oggetti remoti per cliente.
  - Per ogni oggetto: tipo e moduli, rete (NetBird / Tailscale / nessuna), nome e IP NetBird,
    connesso o no, ultimo contatto NetBird, ultimo segnale di vita, livello di privacy scelto dall'istanza, numeri dell'inventario se
    condivisi.
  - In cima: esito della verifica R1–R5, con data e fonte della lettura, e l'ultimo
    riallineamento.
  - La **scadenza del token API** verso NetBird, con avviso 30 giorni prima: un token scaduto
    fermerebbe in silenzio ogni nuova installazione.
- **DA-CRM**: nella scheda del cliente, linguetta Tecnica, accanto a «Cosa espone su
  internet», il quadro letto da DA-Link (§7.3). L'interfaccia si propone oggetto per oggetto
  prima di scriverla (regola grafica del parco).
- **DA-Vul-can**: sulla pagina delle sonde, la rete da cui arriva l'heartbeat. È l'indicatore
  D15 del suo BACKLOG, generalizzato.

## 7. Le interfacce di DA-Link

### 7.1 Verso NetBird

- API di `netbird.domarc.it` con un **utente di servizio dedicato** a DA-Link, che non è una
  persona. Il token sta nel vault (`secret_ref` nell'`ACCESSI.md` di DA-Link).
- I permessi sono quelli minimi che consentono gruppi, chiavi, policy e nodi. Se la versione
  di NetBird non ne ha di più fini dell'admin, si dichiara così.

### 7.2 Dalle istanze IPAM (via NetBird, P1)

- `POST` del segnale di vita (§5.2), con il token dell'istanza e il livello di privacy
  dichiarato (§5.3). La risposta conferma le cancellazioni chieste, e non porta mai
  istruzioni che cambino la configurazione dell'istanza.
- Un token vale per un'istanza sola: DA-Link rifiuta un segnale che dichiara un `codcli`
  diverso da quello del token.

### 7.3 Verso DA-CRM (in LAN, sede)

- Una lettura per cliente, `GET /api/v1/clienti/<codcli>/quadro`, solo lettura, con **chiave
  di servizio** come le altre fonti del CRM.
- Restituisce:
  - gli oggetti, con il loro collegamento;
  - salute e versioni;
  - l'esito dell'isolamento per quel cliente;
  - i numeri dell'inventario, solo se l'istanza li condivide.
- **Mai** chiavi, token, IP NetBird o nomi di policy.
- Se il cliente ha scelto «solo stato», l'inventario risulta **«non condiviso per scelta del
  cliente»** (`non_condivisi`), distinto da «non disponibile»: sono due cose diverse e il CRM
  le mostra diverse.
- Ogni parte che non ha dati lo dichiara (`non_disponibili`), come l'aggregatore del Manager:
  un quadro vuoto deve dire «non so», non «niente».

## 8. Licenza e segreto degli oggetti

Vale per le **istanze IPAM e gli edge** (decisione 17): sono codice nostro e controllano la
licenza da sé. Il proxy Zabbix che vive da solo si ferma togliendolo da NetBird.

### 8.1 Cosa riceve un oggetto

DA-Link dà a ogni oggetto, e gli rinnova da solo, un **pacchetto di licenza** con due parti:

- **il segreto dell'oggetto**: 256 bit casuali, generati da DA-Link, diversi per ogni oggetto,
  validi **4 settimane**;
- **la licenza firmata**: un documento breve firmato da DA-Link con la sua chiave di firma
  (Ed25519). Contiene codcli, oggetto, moduli consentiti, scadenza della licenza e scadenza
  del segreto. L'oggetto la verifica da sé, anche senza rete, con la chiave pubblica di
  DA-Link che riceve all'installazione.

Dal segreto non si usa mai il valore tale e quale. Se ne **ricavano tre chiavi distinte**
(HKDF, una per scopo):

| Chiave ricavata | A cosa serve |
|---|---|
| `scambio` | firma (HMAC) di ogni messaggio fra oggetto e DA-Link, con data e numero unico contro il replay: dimostra chi lo manda e che non è stato alterato |
| `archivio` | protegge la chiave dei dati archiviati dell'istanza (§8.3) |
| `rinnovo` | dimostra a DA-Link che l'oggetto possiede il segreto attuale, senza mai inviarlo |

Così si rinnova un segreto solo, e una chiave esposta per uno scopo non apre gli altri due.

Lo scambio è già cifrato due volte (tunnel NetBird e HTTPS): la chiave `scambio` **firma**, non
cifra una terza volta.

### 8.2 Rinnovo e scadenza

- **Chi chiama.** È l'oggetto a chiedere il rinnovo, nell'ultima settimana di validità; DA-Link
  non apre porte verso di lui (decisione 7). L'istanza usa P1, l'edge una policy nuova, P7
  (§4.2).
- **Il passaggio da un segreto all'altro** (ogni 4 settimane):
  1. l'oggetto dimostra di avere il segreto attuale con la chiave `rinnovo`;
  2. DA-Link controlla la licenza del cliente e risponde con il pacchetto nuovo;
  3. l'oggetto riprotegge la chiave dei dati con la nuova chiave `archivio` (§8.3) e
     conferma;
  4. solo allora DA-Link ritira il segreto vecchio. Fino alla conferma valgono tutti e due.
- **Tolleranza: 2 settimane.** Se DA-Link non risponde, l'oggetto continua a lavorare per due
  settimane oltre la scadenza del segreto e lo dice a schermo, con i giorni che restano.
  Copre ferie, guasti e DA-Link bloccato dopo un riavvio (§9.2).
- **Licenza scaduta, o tolleranza finita** (decisione 15):
  - **l'oggetto smette di lavorare**: si fermano scansioni, raccolta, invii e moduli;
  - **l'interfaccia resta aperta in sola lettura**, con l'avviso e la data;
  - **il cliente consulta ed esporta i suoi dati**;
  - al rinnovo riparte tutto da solo, senza intervento.
- **Un rinnovo non accorcia mai la licenza in corso.** Una licenza nuova più restrittiva
  (scadenza più vicina, meno moduli, dichiarata scaduta) si accetta, ma **entra in vigore
  solo quando finisce quella in corso**.
  - Le riduzioni legittime, come un modulo disdetto, avvengono al giro successivo.
  - Un DA-Link compromesso non può togliere niente prima della scadenza naturale, e quindi
    non può fermare la flotta con un colpo solo (§9.5).
- **«Spegnere» un oggetto** vuol dire non rinnovargli la licenza. Non esiste un comando di
  spegnimento: un oggetto rubato o scollegato si ferma da solo. Per tagliarlo subito fuori
  dalla rete, DA-Link lo toglie anche da NetBird (§5.4).
- **Il freno.** L'arresto per licenza è un automatismo che ferma un cliente, e nasce col
  freno. Per un primo periodo l'oggetto scrive soltanto «qui mi sarei fermato» e lo manda
  nello stato. Si accende contando, oggetto per oggetto, quando le segnalazioni si sono
  dimostrate giuste.
- **Si vede sull'oggetto**: scadenza della licenza, scadenza del segreto, ultimo rinnovo
  riuscito, giorni di tolleranza rimasti. Lo stesso vale in DA-Link, e nel CRM come parte
  dello stato.

### 8.3 Dati archiviati: cifratura a busta con recupero (decisione 16)

- **La chiave dei dati.** Ogni istanza ha una propria chiave dei dati, casuale e **fissa**, che
  cifra i dati archiviati.
- **Chi la protegge.** È conservata «in busta» due volte:
  - con la chiave `archivio` ricavata dal segreto che ruota: ogni 4 settimane si rifà solo
    la busta, i dati non si ricifrano;
  - con le **due chiavi pubbliche di recupero** di Domarc (§9.3); ne basta una per riaprirla.
    Le parti private stanno dentro due YubiKey in cassaforte.
- **Licenza scaduta.** La chiave dei dati resta utilizzabile per la sola lettura e
  l'esportazione (decisione 15). La licenza ferma il lavoro, non i dati.
- **Segreto perso** (istanza ripristinata da una copia vecchia, scollegata oltre la
  tolleranza):
  - il tecnico la fa rientrare con un codice monouso emesso da DA-Link, come all'ingresso;
  - se la vecchia busta non si apre più, la chiave dei dati si recupera con la chiave di
    recupero, con la procedura di §9.3.
- **Da cosa protegge, detto onestamente.**
  - Protegge i dati che **escono dalla macchina** (backup, esportazioni, archivi, copie del
    database fatte da sole) e chi trova il disco senza il segreto.
  - Non protegge da chi è root sull'istanza accesa: lì segreto e dati stanno sulla stessa
    macchina. Un TPM virtuale si potrà aggiungere dopo.
- **Quali dati si cifrano** si decide nel piano. Almeno le credenziali, i backup e le
  esportazioni; l'intero database solo se il costo lo regge (§15).

### 8.4 Il certificato dell'oggetto: la CA interna (decisione 21)

Oggi ogni edge si fa un certificato **auto-firmato**, e DA-IPAM si fida del primo che vede
(pin SPKI al primo «Test connessione»). Con la CA interna ogni installazione riceve un
certificato emesso da Domarc, e gli applicativi lo riconoscono da soli.

- **Il motore** è `step-ca` (Smallstep, open source), un componente esistente e collaudato:
  - ACME;
  - certificati brevi rinnovati da soli;
  - limiti sui nomi.

  Gira sulla macchina di DA-Link come servizio a sé, e **DA-Link è l'unico che lo autorizza a
  emettere**. Una CA non si scrive a mano.
- **Due livelli** (custodia in §9.4):
  - le **radici** (due, una per YubiKey) stanno in cassaforte, e servono solo a firmare
    l'intermedia;
  - l'**intermedia** sta in DA-Link e firma i certificati.
- **Limiti sui nomi.** L'intermedia porta i *name constraints*: può firmare solo nomi
  interni (`*.netbird.selfhosted` e il dominio interno scelto nel piano), mai nomi pubblici.
  Anche rubata, non serve a impersonare un sito vero.
- **La chiave privata nasce sull'oggetto e non lo lascia mai.**
  - All'ingresso l'oggetto genera la sua coppia di chiavi e manda a DA-Link solo la
    richiesta di firma.
  - DA-Link la autorizza con un permesso monouso emesso insieme alla setup key (§5.1).
- **Cosa c'è nel certificato**:
  - nome NetBird dell'oggetto, più eventuale nome e IP della LAN del cliente;
  - un identificativo con `codcli` e oggetto (URI nel SAN), che serve alle API per sapere
    chi sta chiamando.
- **Durata: 4 settimane**, rinnovato insieme al segreto (§8.2), nello stesso giro. Un
  certificato breve non ha bisogno di una lista di revoca complicata. DA-Link pubblica
  comunque la lista dei certificati revocati, e la revoca di un oggetto (§5.4) ci finisce
  subito.
- **A licenza scaduta** il certificato non si rinnova. Le chiamate verso i centrali si fermano
  da sole, coerente con «smette di lavorare» (§8.2). L'interfaccia locale in sola lettura
  resta raggiungibile dal cliente.
- **Chi si fida della radice, automaticamente.**
  - **Gli applicativi dell'ecosistema**: da-vulcan, DA-ZABBIX, DA-CRM, DA-Link, le istanze
    IPAM e gli edge. La ricevono all'installazione o al deploy, nel loro archivio di fiducia.
  - **I computer dei tecnici Domarc**: distribuita come criterio di gestione dei dispositivi,
    non a mano.
  - **I browser dei clienti** sulla LAN: si decide nel piano (§15).
- **Cosa sostituisce.**
  - Il pin SPKI di DA-IPAM sull'edge (`vuln_scanners`): si fida della radice. Il pin resta
    accettato durante il doppio binario.
  - Il certificato auto-firmato dell'edge (`tls_cert.py`): resta solo come ripiego per
    un'installazione senza DA-Link.
- **Identità reciproca.** Con un certificato per oggetto, le API per le macchine (segnale di
  vita, rinnovo, heartbeat verso da-vulcan) possono chiedere il certificato anche a chi
  chiama (**mTLS**). Il certificato dice chi è l'oggetto prima ancora del token. Come mTLS si
  combina con la firma `scambio` (§8.1), per non tenere due meccanismi che fanno la stessa
  cosa, si decide nel piano (§15).

## 9. DA-Link: accesso e custodia dei segreti

DA-Link custodisce le chiavi più delicate del parco. Il principio: **pochi accessi, ognuno
registrato, e nessun segreto che basti da solo a fare danni a tutti i clienti.**

### 9.1 Chi entra e da dove (decisione 19)

- **La macchina.**
  - VM dedicata in sede, senza altri servizi.
  - Disco cifrato.
  - SSH solo con chiave, solo dal gruppo NetBird `link-admin`.
  - Aggiornamenti di sicurezza automatici.
- **L'interfaccia.**
  - Raggiungibile **solo** dal gruppo NetBird `link-admin`: poche persone nominate, distinto
    da `admins`.
  - Login Entra con **MFA obbligatoria**.
  - Nessuna esposizione su Internet.
- **Le API per le macchine** sono separate dall'interfaccia, su un'altra porta e un altro
  percorso:
  - gli oggetti remoti arrivano solo a segnale di vita e rinnovo (P1, P7);
  - il CRM arriva solo alla lettura del quadro (§7.3), dal suo indirizzo e con la sua chiave
    di servizio.
- **Il registro.** Ogni azione — accesso, emissione, revoca, cambio di licenza, sblocco —
  finisce nel registro di audit. Una copia parte **fuori da DA-Link** in tempo reale, verso
  Graylog, così chi entra in DA-Link non può cancellare le proprie tracce.
- **Gli allarmi.** DA-ZABBIX avvisa su tre cose:
  - troppe emissioni o revoche in poco tempo;
  - accessi fuori orario;
  - DA-Link bloccato.

### 9.2 Il portachiavi di DA-Link e lo sblocco all'avvio (decisione 18)

I segreti di DA-Link stanno in un **portachiavi cifrato** su disco:

- la chiave di firma delle licenze;
- la chiave che cifra i segreti degli oggetti nel suo database;
- il token del suo utente di servizio NetBird.

Il portachiavi si apre con una **frase di sblocco**: resta solo in memoria, e da essa si
ricava la chiave con Argon2id.

- **A ogni avvio DA-Link parte bloccato.** Una persona di `link-admin` lo sblocca
  dall'interfaccia o da SSH. Finché è bloccato:
  - non emette, non rinnova, non legge segnali;
  - risponde «riprova più tardi», e gli oggetti riprovano da soli;
  - gli oggetti continuano a lavorare con la licenza e la tolleranza che hanno (§8.2);
  - DA-ZABBIX lo segnala.
- **La frase** la conoscono le persone di `link-admin`, e una copia sta in cassaforte con la
  chiave di recupero. Persa la frase senza copia, DA-Link non firma più e tutti gli oggetti
  si fermano entro sei settimane: per questo la copia non è facoltativa.
- **Più avanti, la YubiKey.** Si sostituisce la frase con una chiave hardware: lo sblocco
  resta un passo solo, cambia il «come». Il codice tiene lo sblocco dietro un'interfaccia
  sola, così il cambio non tocca il resto.
- **Il backup di DA-Link** contiene il portachiavi **ancora cifrato**, e si prova a
  ripristinarlo su una VM pulita prima di dichiararlo buono.

### 9.3 Le due YubiKey in cassaforte (decisioni 20 e 21)

Niente macchina scollegata dedicata alla CA (Riccardo, 14/10). Le chiavi che non devono mai
stare su un computer acceso vivono **dentro due YubiKey**, chiuse in cassaforte.

- **Cosa contiene ogni YubiKey** (A e B), con le chiavi **generate dentro il dispositivo**,
  che non ne escono mai:
  - una **radice della CA**;
  - una **chiave di recupero** dei dati;
  - una **chiave di emergenza**, per i bollettini (§9.5).
- **Due radici, entrambe affidabili.** Gli applicativi si fidano di tutte e due le radici
  (A e B); l'intermedia è firmata da A. È la copia di riserva fatta senza mai copiare una
  chiave: una YubiKey persa o rotta non ferma niente (§9.4).
- **Due chiavi di recupero, ne basta una.** Ogni istanza mette la chiave dei dati in busta per
  entrambe le chiavi pubbliche di recupero (§8.3): per riaprirla basta A oppure B.
- **DA-Link non le possiede.** Chi entra in DA-Link non può leggere i dati dei clienti né
  firmare una nuova intermedia.
- **Come si usano**, sempre con la procedura scritta:
  - si prende una YubiKey dalla cassaforte;
  - si inserisce in DA-Link o nel Mac di una persona di `link-admin`;
  - la si usa col PIN, per firmare l'intermedia o per riaprire la chiave dei dati di
    un'istanza;
  - si rimette in cassaforte.

  Ogni uso finisce nel registro di audit: chi, perché, quale istanza.
- **Dove stanno.** Le due YubiKey sono in due luoghi diversi, ciascuna col suo PIN in busta
  chiusa accanto alla frase di sblocco di DA-Link (§9.2).
- **La prova annuale.** Una volta all'anno si riapre con ciascuna YubiKey la chiave dei dati
  di un'istanza di prova, e si verifica che le due radici siano ancora negli archivi di
  fiducia.
- **Più avanti** le stesse YubiKey, o altre dello stesso modello, potranno sbloccare DA-Link
  all'avvio (§9.2).

### 9.4 Le chiavi della CA

- **Le radici** (A e B) nascono nelle YubiKey durante la **cerimonia iniziale**: una
  sessione con la procedura scritta, fatta su DA-Link o sul Mac di una persona di
  `link-admin`, senza una macchina dedicata. Servono solo per firmare o rinnovare
  l'intermedia, ogni qualche anno.
- **L'intermedia** sta nel portachiavi di DA-Link (§9.2). Si apre con lo stesso sblocco
  all'avvio. Finché DA-Link è bloccato non si emettono certificati: gli oggetti hanno davanti
  fino a sei settimane (validità più tolleranza).
- **Se l'intermedia viene compromessa**:
  - la radice A la revoca;
  - se ne firma una nuova;
  - gli oggetti la ricevono al rinnovo successivo.
- **Se si perde o si rompe la YubiKey A**: si firma una nuova intermedia con la B, e si
  prepara una YubiKey nuova per tornare a due.

In nessuno dei due casi si reinstalla una radice nei computer, perché le radici affidabili
restano le stesse. È il motivo dei due livelli e delle due radici.

### 9.5 Resilienza: se DA-Link si guasta o viene compromesso (decisioni 22 e 23)

Riccardo (14/10): la flotta dei servizi rivenduti non deve dipendere dalla salute di DA-Link.
Se DA-Link viene compromesso, le istanze **devono continuare a lavorare** con una chiave di
sblocco finché non si riconfigura.

#### Cosa NON può fare un DA-Link in mano a un attaccante

Il disegno limita il danno prima ancora che serva l'emergenza:

- **Non può fermare la flotta con un colpo solo.** Un rinnovo non accorcia mai la licenza
  in corso: una licenza più restrittiva entra in vigore solo quando finisce quella attuale
  (§8.2). Fermare un oggetto si può solo
  smettendo di rinnovare (§8.2), e questo lascia **almeno sei settimane** (validità più
  tolleranza) per accorgersene e reagire.
- **Non può comandare le istanze.** Non ha porte verso di loro (decisione 7), e nessuna sua
  risposta cambia la configurazione di un'istanza (§5.3). Il rinnovo consegna solo segreto,
  licenza e certificato.
- **Non può leggere i dati dei clienti.** Le chiavi dei dati stanno sulle istanze, quelle di
  recupero nelle YubiKey (§9.3).
- **Non può aprire varchi fra i clienti senza che si veda.** Col token NetBird potrebbe
  scrivere policy fra remoti. Due difese:
  - il firewall locale di ogni istanza ed edge accetta in ingresso sull'interfaccia NetBird
    **solo gli indirizzi dei centrali e di `admins`**, sulle porte previste. R1 vale anche
    sulla macchina, non solo in NetBird;
  - la verifica R1–R5 la fa **anche DA-ZABBIX**, con una lettura sua, non solo DA-Link: un
    DA-Link compromesso non può dichiararsi verde da solo.
- **Può emettere certificati falsi per nomi interni.** Il danno resta limitato ai nomi
  interni (§8.4) e finisce con la revoca dell'intermedia (sotto).

#### La chiave di emergenza

- Sulle due YubiKey (§9.3), accanto a radice e recupero, c'è una **chiave di emergenza**
  (Ed25519) generata dentro il dispositivo. Ogni oggetto ne riceve la parte pubblica
  all'installazione, e la riconosce come **più forte** della firma di DA-Link.
- **DA-Link non la possiede.** Con la chiave di emergenza si firma un solo tipo di
  documento: il **bollettino di emergenza**. Può dire quattro cose:
  1. **«Non fidarti più di questo DA-Link»**: ritira la chiave di firma delle licenze e
     l'intermedia della CA indicate. Da quel momento l'oggetto rifiuta ogni rinnovo firmato
     con quelle chiavi.
  2. **«Continua a lavorare fino al giorno X»**: prolunga licenza e tolleranza, per tutta la
     flotta o per i `codcli` elencati. È la «chiave di sblocco»: l'oggetto lavora in
     **modalità autonoma**, senza DA-Link, fino a quella data.
  3. **«Il nuovo DA-Link è questo»**: indirizzo, chiave di firma e intermedia nuove, a cui
     l'oggetto passa da solo.
  4. **«Fine dell'emergenza»**.
- **Cosa il bollettino non può fare**: leggere dati, cambiare la configurazione delle
  istanze, eseguire comandi. Anche la chiave di emergenza, se rubata, servirebbe solo a
  prolungare licenze o a indicare un DA-Link: per questo sta nelle YubiKey, mai su un
  computer.
- **Ha una data e un numero progressivo.** L'oggetto accetta solo bollettini più nuovi
  dell'ultimo visto, così un bollettino vecchio non si può ripresentare.

#### Come arriva il bollettino, senza DA-Link

È firmato, quindi **il canale non deve essere fidato**: conta la firma, non chi lo
consegna.

- **Canale automatico.** Ogni oggetto controlla una volta al giorno un indirizzo di riserva
  indipendente da DA-Link: un file statico pubblicato fuori dalla sua macchina. Quale
  indirizzo, si decide nel piano (§15).
- **Canale a mano.** Il tecnico incolla il bollettino nell'interfaccia dell'istanza o lo
  copia via SSH. Serve quando l'oggetto non raggiunge il canale automatico, o per sbloccare
  un solo cliente.
- **A ogni bollettino applicato** l'oggetto lo mostra a schermo (modalità autonoma, fino a
  quando, firmato da quale YubiKey) e lo dichiara nel segnale di vita.

#### La procedura di compromissione (scritta, provata una volta all'anno)

1. **Isolare.**
   - Un amministratore di NetBird, una persona e non DA-Link, disattiva l'utente di servizio
     di DA-Link.
   - La VM di DA-Link si spegne e si conserva per l'analisi.
2. **Sbloccare la flotta.** Con una YubiKey si firma il bollettino: «non fidarti più di
   questo DA-Link» + «continua fino al giorno X» (di norma 90 giorni). Si pubblica sul
   canale di riserva; dove serve, si incolla a mano.
3. **Revocare.** Con la radice si revoca l'intermedia compromessa. La lista di revoca
   aggiornata viaggia nel bollettino.
4. **Ricostruire.**
   - DA-Link si reinstalla su una VM nuova, da zero, con chiave di firma nuova, intermedia
     nuova firmata da una YubiKey e utente di servizio NetBird nuovo.
   - Nessun segreto del vecchio si riusa.
5. **Riconfigurare la flotta senza reinstallarla.**
   - Un secondo bollettino presenta il DA-Link nuovo.
   - Ogni oggetto rientra dimostrando di possedere la **chiave privata del proprio
     certificato** (nata sull'oggetto, mai stata su DA-Link: §8.4). I segreti vecchi si
     considerano bruciati, e l'oggetto riceve un pacchetto tutto nuovo.
   - Un oggetto che non riesce a rientrare, per esempio con il certificato scaduto, rientra
     con un codice monouso del tecnico, come all'ingresso.
6. **Chiudere.**
   - Bollettino «fine dell'emergenza».
   - Verifica R1–R5 da DA-ZABBIX.
   - Rapporto nel registro.

#### DA-Link solo guasto (non compromesso)

Si usa solo il passo 2, senza ritirare la fiducia: «continua fino al giorno X». Poi si
ripristina DA-Link dal backup (§9.2). La flotta non se ne accorge.

#### Cosa continua a funzionare in modalità autonoma

- **L'istanza fa tutto il suo lavoro locale**: scansioni, inventario, moduli, interfaccia.
- **I flussi verso i centrali** (heartbeat a da-vulcan, segnale di vita) reggono finché
  valgono il certificato e il tunnel, e riprendono alla riconfigurazione. È Domarc a vedere
  meno, non il cliente a perdere il servizio.
- **La chiave dei dati resta quella**: si riprotegge col primo segreto nuovo.

## 10. Il passaggio

Ogni fase si chiude da sola. Ci si può fermare dopo qualunque fase senza lasciare niente a metà.

**Fase 0 — Preparazione. Niente codice, niente clienti.**

- Censimento dei nodi Tailscale (`tailscale status` da un centrale): quali clienti, quale tipo
  di oggetto, quale macchina. L'elenco diventa la lista della fase 3 e il primo contenuto di
  DA-Link.
- Verifica che il codice tenant delle istanze DA-IPAM sia il `codcli` del gestionale
  (decisione 12), istanza per istanza.
- **Prova di convivenza su una VM di prova** con Tailscale e NetBird accesi insieme (§11,
  rischio 1). Se non passa, si decide il rimedio prima di toccare DTS.
- Versione del server NetBird; comportamento di scadenza dei nodi entrati con setup key;
  quali permessi servono all'utente di servizio.
- §6.2: `All` fuori dalle policy dei colleghi, `Default` spenta.
- da-vulcan e DA-ZABBIX entrano in NetBird nei gruppi `centro-*`, **senza lasciare
  Tailscale**.
- Il nome stabile per da-vulcan (§11, rischio 3).
- **La cerimonia delle chiavi** con la procedura scritta: le due YubiKey generano radici,
  chiavi di recupero e chiavi di emergenza, e vanno in cassaforte (§9.3, §9.4). L'intermedia nasce dopo, quando c'è
  la macchina di DA-Link.

Esce quando: i centrali sono connessi in NetBird, la verifica R1–R4 fatta a mano è verde e i
colleghi raggiungono ciò che raggiungevano prima.

**Fase 1 — DA-Link e il codice, sul dev.**

- Si apre DA-Link (`bin/nuovo-progetto DA-Link` sotto `Domarc/`, poi una sessione nuova come
  vuole `AVVIO-PROGETTO.md`).
- DA-Link nasce coi compiti di §1 e le interfacce di §7, sulla sua VM in sede (§9.1), in
  `centro-link`.
- Portachiavi con sblocco all'avvio (§9.2), `step-ca` con l'intermedia (§8.4), licenze e
  segreti (§8).
- Sugli oggetti l'arresto per licenza nasce **col freno**: segnala soltanto (§8.2).
- Nei repo esistenti, le modifiche del §12, con Tailscale ancora supportato accanto.

Esce quando:
- i cancelli dei repo sono verdi;
- una chiave emessa da DA-Link sul NetBird vero fa entrare una VM di prova nei gruppi giusti;
- la VM manda il segnale di vita;
- il quadro arriva al CRM di sviluppo;
- la VM riceve licenza, segreto e certificato, li rinnova a scadenza ravvicinata (prova
  con validità di minuti), e un'applicazione centrale la riconosce senza eccezioni di
  certificato;
- un riavvio di DA-Link lo lascia bloccato finché non si sblocca, e la VM nel frattempo
  continua a lavorare;
- **la prova di compromissione**, sulla VM di prova: bollettino firmato con la YubiKey,
  modalità autonoma, DA-Link nuovo, rientro con la chiave del certificato, fine
  dell'emergenza;
- chiave e VM si tolgono subito dopo.

**Fase 2 — Pilota DTS**: istanza IPAM `172.16.0.2`, edge `172.16.1.141`, `proxy-dts`.

1. NetBird accanto a Tailscale sulle macchine di DTS, con chiavi emesse da DA-Link. Il proxy,
   se vive da solo, passa dalla procedura guidata di DA-Zabbix.
2. Gli indirizzi con cui centrali e DTS si cercano passano ai nomi NetBird.
3. Si verifica **dal di fuori**, flusso per flusso, come lo usa chi lo usa:
   - heartbeat dell'edge arrivato a da-vulcan con rete = NetBird;
   - uno scan comandato da da-vulcan;
   - segnale di vita dell'istanza in DA-Link, e il quadro di DTS nel CRM;
   - ultimo contatto di `proxy-dts` in Zabbix.
4. Prova d'isolamento in negativo:
   - da un nodo DTS non si raggiunge nessun altro remoto, né un centrale fuori dalle porte
     previste;
   - le porte Wazuh non rispondono dall'interfaccia NetBird.
5. Una settimana a doppio binario, poi si toglie Tailscale da DTS.

DTS è un cliente in esercizio: ogni passo su quelle macchine chiede conferma.

**Fase 3 — Gli altri clienti**, uno per volta, nello stesso modo, dalla lista della fase 0.
Dove la tappa 7e del piano di miglioramento migra lo stesso edge, si fanno insieme: una sola
finestra per cliente.

**Fase 4 — Spegnimento.**

- Tailscale si toglie dai centrali.
- Si verifica che da-vulcan raggiunga DA-VA-OVH sulla VPN diretta.
- Tutti i riferimenti a `da-vulcan` risolto da MagicDNS e all'IP Tailscale di DA-VA passano
  al nome nuovo (§11, rischio 3).
- Si toglie il codice Tailscale: campi della procedura guidata, tipo di credenziale,
  `tailscale_ip` nell'heartbeat, ruolo Ansible, `infra/tailscale/`.
- La tailnet personale si cancella.

## 11. Rischi e trappole note in anticipo

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
   - Va monitorato da DA-ZABBIX.
   - Va ricordata la trappola di DA-Infra: Traefik v3 taglia gli stream a 60 secondi,
     `readTimeout: 0` non è opzionale.
5. **DA-Link diventa necessario per far entrare oggetti nuovi**, non per far funzionare quelli
   che ci sono: i tunnel e i dialoghi edge↔da-vulcan e proxy↔Zabbix non passano da lui. Se è
   giù si perde il segnale di vita delle istanze e il quadro nel CRM dice «non disponibile».
6. **L'utente di servizio di DA-Link ha poteri ampi su NetBird.** Probabilmente quelli di
   admin, se la versione non ne offre di più fini (§7.1). Il suo token è il segreto più
   delicato del disegno:
   - sta solo nel vault e nel `.env` della macchina di DA-Link;
   - DA-Link non lo espone in nessuna API;
   - la sua scadenza si vede in pagina (§6.3).
7. **Il riallineamento automatico può combattere con una persona.** Un tecnico che cambia a
   mano una policy di DA-Link se la vede rimettere com'era. Per questo nasce col freno (§6.1)
   e ogni rimessa a posto finisce nel registro con il prima e il dopo.
8. **Il `codcli` dell'istanza potrebbe non essere quello del gestionale** (decisione 12): i
   tenant DA-IPAM sono nati prima di questa regola. Si verifica in fase 0. Un'istanza con un
   codice diverso si corregge prima di entrare in DA-Link, non dopo.
9. **L'agente Python di DA-IPAM accetta la fascia `100.64.0.0/10`.** Con NetBird quel
   controllo passa ancora ma non distingue più nulla. Se l'agente resta (§15), la fonte
   ammessa diventa la rete NetBird dell'account letta all'installazione, più bearer e scope
   come oggi.
10. **Il firewall dell'edge si fida di tutta l'interfaccia Tailscale** (`ufw allow in on tailscale0`).
    Su NetBird si aprono solo le porte delle policy: 6443 e 22 sull'edge, 22 e 443
    sull'istanza IPAM. La barriera vera è la policy, e il firewall è la seconda linea.
11. **Il certificato dell'edge** contiene oggi nome DNS e IP della LAN. Si aggiunge il nome
    NetBird ai SAN (`tls_extra_sans`) e si verifica in fase 2 che da-vulcan lo accetti.
12. **Il firewall del cliente in uscita.** NetBird prova la via diretta in UDP e ripiega sul
    relay in 443 TCP. Su un cliente che chiude tutto in uscita si verifica che il relay passi,
    prima di togliere Tailscale.
13. **DA-Link bloccato dopo un riavvio** (§9.2). Gli oggetti reggono sei settimane, ma un
    riavvio non notato durante le ferie si somma alla tolleranza che sta finendo. Per questo
    DA-ZABBIX lo segnala subito e la frase di sblocco la conoscono più persone.
14. **La frase di sblocco o le YubiKey perse.** Senza frase DA-Link non firma più. Senza
    entrambe le YubiKey non si rinnova l'intermedia, e i computer vanno rifatti con radici
    nuove; con una sola si continua. Le copie in cassaforte non sono facoltative, e la procedura si prova una volta
    all'anno.
15. **La radice della CA va distribuita davvero**: negli applicativi, nei container e nei
    computer dei tecnici. Un applicativo che non la conosce darà errore di certificato, e la
    tentazione sarà disattivare la verifica. Non si fa: la verifica spenta è peggio del
    certificato auto-firmato di oggi. La distribuzione si controlla per ogni applicativo in
    fase 1.
16. **L'arresto per licenza ferma un cliente.** Un difetto nel calcolo delle date, un
    orologio sbagliato sull'oggetto o un DA-Link irraggiungibile non devono fermare chi è in
    regola. Per questo ci sono il freno (§8.2), la tolleranza e la licenza firmata
    verificabile senza rete. L'ora dell'oggetto si controlla nel segnale di vita.

## 12. Cosa cambia, repo per repo

**DA-Link (nuovo)**

- Client API NetBird: gruppi, chiavi, revoca, nodi, policy. Si parte da
  `DA-Zabbix/zbximport/netbird.py`, **ma con la verifica del certificato del server accesa**:
  quel client oggi la spegne (`CERT_NONE`), e con il potere che DA-Link ha su NetBird non è
  accettabile.
- Descrizione delle sue policy e riallineamento col freno (§6.1).
- Elenco degli oggetti remoti per `codcli`, con il nome del cliente letto dal CRM.
- Emissione del comando d'installazione con chiave e token.
- Ricezione del segnale di vita (§7.2).
- Verifica R1–R5 e pagina di §6.3.
- Lettura per il CRM (§7.3).
- Audit di emissione, revoca, cancellazione e riallineamento.
- Registro delle licenze per `codcli`, firma delle licenze, rinnovo di segreti e certificati
  (§8).
- Portachiavi con sblocco all'avvio; `step-ca` con l'intermedia; copia del registro di audit
  verso Graylog (§9).
- La procedura scritta per le due YubiKey: cerimonia iniziale, firma dell'intermedia,
  recupero, prova annuale (§9.3, §9.4).
- Gli standard del parco: cancello, `CONTEXT.md`, `ACCESSI.md`, scheda nel censimento.

**DA-IPAM**

- La pagina «Cosa esce da questa istanza» e il livello di privacy (§5.3); il livello
  si chiede anche al `/setup`.
- Il segnale di vita verso DA-Link, costruito secondo il livello: stato sempre, numeri
  dell'inventario solo se consentiti, porte aperte
  sull'interfaccia NetBird. URL e token vengono dalla configurazione d'installazione.
- Installatore e `/setup` con `NETBIRD_SETUP_KEY` e token di DA-Link.
- Rinnovo di licenza, segreto e certificato; arresto per licenza col freno e sola lettura a
  licenza scaduta; pagina con scadenze e tolleranza (§8.2).
- Cifratura a busta dei dati archiviati, con la busta di recupero (§8.3).
- Certificato della CA interna per l'interfaccia; radice nell'archivio di fiducia, al posto
  del pin SPKI verso l'edge (§8.4).
- Firewall sull'interfaccia NetBird: solo 22 e 443, più 6443 se l'istanza contiene l'edge.
- Tailscale tolto da procedura guidata e credenziali nella fase 4. Prima si decide che fine
  fa l'agente remoto (§15).

**DA-Vul-can / Scanner-Edge**

- Heartbeat: campi `overlay` (`netbird`/`tailscale`/`nessuno`), `overlay_ip`,
  `overlay_name`; `tailscale_ip` resta fino alla fase 4.
- Hub: salva e mostra la rete dell'heartbeat (D15).
- Primo avvio, `install.sh`, `harden.sh`: setup key NetBird; firewall per porta su `wt0`;
  nome NetBird nei SAN.
- Bridge-node Ansible: ruolo `netbird` accanto a `tailscale`, poi al suo posto.
- Edge: rinnovo di licenza, segreto e certificato, con P7; arresto per licenza col freno
  (§8.2); `tls_cert.py` usa il certificato della CA e tiene l'auto-firmato solo come
  ripiego (§8.4).
- Hub: radice della CA nell'archivio di fiducia; verifica del certificato degli edge.
- L'OSINT avviato dal CRM **non è in questo lavoro**: segue il filo del CRM (decisione 10).

**DA-Zabbix**

- La procedura guidata dei proxy mette il nodo anche in `cli-<codcli>`, usa le stesse regole
  di nome (`<codcli>-zbx`) e non tocca ciò che ha creato DA-Link.
- Per un proxy dentro un'istanza IPAM non emette chiavi: il nodo c'è già.
- DA-ZABBIX tiene d'occhio la verifica R1–R5, DA-Link e il server NetBird (§6.1, §11).

**DA-CRM**

- Una fonte nuova nella scheda cliente, linguetta Tecnica: il quadro di DA-Link (§7.3).
- La chiave di servizio di DA-Link va nel vault e nella configurazione del CRM come
  `secret_ref`.
- L'interfaccia si propone prima di scriverla.

**Deploy-Appliance**

- Parametro setup key NetBird e token di DA-Link nell'installatore, al posto dell'auth-key
  Tailscale.
- La VM Wazuh non riceve mai NetBird.
- La due radici della CA vanno nell'immagine e nell'installatore.

**Tutti gli applicativi centrali** (da-vulcan, DA-ZABBIX, DA-CRM): radice della CA
nell'archivio di fiducia, al deploy.

**DA-Infra** — solo documentazione: `docs/servizi/netbird.md` aggiornato con gruppi, policy,
l'utente di servizio di DA-Link e le regole «`All` mai» e «Wazuh mai».

## 13. Rapporto col piano di miglioramento di DA-IPAM

- **Tappa 9** (console centrale): DA-Link **è** il suo inizio. La sua spec, quando ci si
  arriva, parte da DA-Link invece che da zero, e lo fa crescere: canale d'aggiornamento,
  creazione di appliance.
- **Tappa 7** (edge guidato da DA-IPAM): non si tocca il contratto con l'hub; si cambia la
  rete sotto. La migrazione edge per edge (7e) e la fase 3 si fanno insieme dove coincidono.
- **Tappa 8** (installazione dall'immagine): il `/setup` del primo avvio chiede setup key e
  token di DA-Link, non l'auth-key Tailscale. Se la tappa 8 parte prima, nasce già così.
- Questo lavoro non dipende dalle tappe 1–6, e quelle non dipendono da lui.

## 14. Come si verifica che funziona

- **Prove automatiche**:
  - R1–R5 su dati finti nella forma vera dell'API NetBird;
  - emissione della chiave coi gruppi e il nome giusti;
  - revoca che tocca solo ciò che DA-Link ha creato;
  - riallineamento che, col freno, segnala senza scrivere, e senza freno rimette solo le
    policy sue;
  - segnale di vita accettato col token giusto, rifiutato senza token e con un `codcli` non
    suo;
  - un'istanza a «solo stato» non mette **mai** campi d'inventario nel segnale (prova sul
    costruttore del segnale, vista fallire);
  - un'istanza senza livello dichiarato si comporta come «solo stato»;
  - DA-Link scarta e segnala i campi d'inventario arrivati da un'istanza a «solo stato»;
  - abbassando il livello, DA-Link cancella i numeri già ricevuti e conferma;
  - nessuna risposta di DA-Link cambia il livello sull'istanza;
  - lettura del CRM senza segreti nella risposta, e con `non_disponibili` quando una parte
    manca;
  - heartbeat dell'edge coi campi nuovi e quelli vecchi;
  - le tre chiavi ricavate dal segreto sono diverse fra loro e cambiano col segreto;
  - una licenza con firma alterata, scaduta o di un altro oggetto viene rifiutata
    dall'oggetto, anche senza rete;
  - durante il rinnovo valgono vecchio e nuovo segreto, dopo la conferma solo il nuovo;
  - nella tolleranza l'oggetto lavora e conta i giorni; finita, col freno spento, si
    ferma, e i dati restano leggibili ed esportabili;
  - al rinnovo la busta della chiave dei dati si rifà e i dati non si ricifrano; con la sola
    chiave di recupero (di prova) la chiave dei dati si riapre;
  - DA-Link bloccato non emette, non rinnova e non legge segnali;
  - un certificato per un nome fuori dai limiti viene rifiutato dalla CA; un certificato
    revocato viene rifiutato dagli applicativi;
  - una licenza di rinnovo più restrittiva non cambia niente prima della fine di quella in
    corso, e dopo si applica;
  - un bollettino con firma non di emergenza, o più vecchio dell'ultimo visto, viene
    rifiutato;
  - dopo «non fidarti più di questo DA-Link», un rinnovo firmato da quello viene
    rifiutato;
  - in modalità autonoma l'oggetto lavora fino alla data del bollettino, e dopo si ferma
    come a licenza scaduta;
  - il rientro nel DA-Link nuovo riesce con la chiave del certificato dell'oggetto e
    fallisce col solo segreto vecchio;
  - il firewall locale rifiuta in ingresso un indirizzo NetBird che non è di un centrale
    o di `admins`.
- **Sul vero, dal di fuori**, in fase 2 e per ogni cliente in fase 3:
  - i flussi della fase 2, punto 3;
  - la prova d'isolamento in negativo, Wazuh compreso;
  - un riavvio dell'oggetto remoto, dopo il quale torna connesso da solo.
- **Verifica isolamento** verde nella pagina di DA-Link, con la data e la fonte della lettura.

## 15. Cosa resta da decidere nel piano operativo

- La macchina in sede dove gira DA-Link, e il suo stack (in linea col parco).
- Il dominio interno della CA, oltre a `*.netbird.selfhosted`, e i nomi LAN ammessi nei
  certificati.
- **I browser dei clienti sulla LAN**: si fidano della radice Domarc (distribuita dal loro
  IT), oppure l'interfaccia locale tiene un certificato a parte?
- **mTLS e firma `scambio`**: se le API per le macchine chiedono il certificato di chi
  chiama, la firma HMAC dei messaggi resta solo per il rinnovo o si toglie. Un meccanismo
  per scopo, non due.
- **Quali dati archiviati si cifrano a busta**: credenziali, backup ed esportazioni di
  sicuro; l'intero database (SQLCipher) solo se costo e prestazioni lo reggono.
- **Da dove viene la licenza.** Per ora la imposta in DA-Link una persona di `link-admin`.
  Più avanti potrebbe derivare dai contratti del CRM: è una decisione a parte.
- Quando passare dalla frase di sblocco alla YubiKey (decisione 18).
- **Il canale di riserva dei bollettini**: dove sta il file statico, indipendente da
  DA-Link (sito pubblico Domarc, altro server, entrambi), e se gli oggetti dei clienti
  senza uscita su Internet lo raggiungono.
- La durata di norma della modalità autonoma (proposta: 90 giorni) e il massimo che un
  bollettino può concedere.
- Come i centrali riconoscono gli oggetti durante l'emergenza, se i loro certificati
  scadono prima della riconfigurazione.
- Il nome stabile per da-vulcan (rischio 3).
- Il rimedio alla convivenza in `100.64.0.0/10`, se la prova della fase 0 lo richiede.
- **L'agente Python remoto di DA-IPAM** (`agent/`, raggiunto oggi via Tailscale dalla VM 533).
  Con un'istanza IPAM per cliente forse non serve più. Si decide se toglierlo o portarlo su
  NetBird, contando prima chi lo usa davvero.
- Il nome dei due livelli come lo legge il cliente (oggi «solo stato» e «stato + inventario»).
- Quali numeri dell'inventario entrano nel livello «stato + inventario», oltre a dispositivi, reti e
  ultima scansione. Si fissa col CRM, guardando cosa serve nella scheda.

## Appendice A — Censimento fase 0 (2026-10-14, fonti)

Fonti, tutte in sola lettura il 14/10: `tailscale status --json` da da-vulcan; API di
`netbird.domarc.it` (gruppi, policy, reti e risorse, rotte, nameserver, peer, utenti, chiavi;
nomi soltanto); `edge_bridges` di da-vulcan; `tenants` e `tenant_agents` dell'hub DA-IPAM
(VM 533) e dell'istanza DTS; `anagrafiche_gestionale` del CRM; porte provate da da-vulcan
attraverso Tailscale. Le date sono giorni (gli orari delle fonti sono UTC).

### A.1 Nodi Tailscale

È la vista di da-vulcan: un nodo che la policy Tailscale nasconde a da-vulcan non compare.
La tailnet ha 10 nodi, offline compresi.

| Nodo | Oggetto (dedotto) | Cliente | Online | Ultimo contatto |
|---|---|---|---|---|
| `da-vulcan` | centrale (hub VA) | — | sì | — |
| `da-invent` | istanza DA-IPAM di Domarc (VM 533), con l'edge «DOMARC» (id 1) | 70791 | sì | — |
| `dts-appliance` | istanza IPAM di DTS (`172.16.0.2`), con l'edge «DTS» (id 2) | 71734 | sì | — |
| `bridge-domarc-ovh` (`tag:domarc-bridge`) | edge DA-VA-OVH (id 5) | 70791 | sì | — |
| `appliance-pxnas-domarc` | istanza IPAM di laboratorio sul PX-NAS di casa, con l'edge «PX-NAS» (id 3) | 70791 | sì | — |
| `appliance-px-lab-domarc-local` | istanza IPAM di laboratorio | 70791 | no | 05/10 |
| `appliance-pxrg-consolidated-domarc-local` | appliance di prova superata | 70791 | no | 26/05 |
| `da-va` | VA vecchia, sostituita da DA-VA-OVH | 70791 | no | 19/07 |
| `MacBook Pro`, `S25 Ultra di riccardo` | dispositivi di Riccardo | — | no | 02/09 |

**Per la fase 3 l'elenco è corto.** L'unico cliente esterno su Tailscale è **DTS (71734)**, che
è anche il pilota della fase 2. Tutto il resto appartiene a Domarc (70791): l'istanza di sede,
DA-VA-OVH e i laboratori. I proxy Zabbix dei clienti sono già in NetBird (A.2).

### A.2 NetBird oggi

- **`Default` è già spenta**, e lo è anche `da-sns Policy` (`All → All`). Il passo 6 del
  Task 4 non ha niente da spegnere: resta solo la verifica.
- **I proxy Zabbix non stanno in un solo gruppo `zabbix-proxy`** (come dice il §3): c'è un
  gruppo per cliente, `zbx-proxy-<nome>` (gao, bagatti, dts, metalrota, grafana, domarc-rg,
  domarc-ovh). Ogni gruppo ha la sua coppia di policy: proxy → `zbx-server` tcp 10051 e
  `zbx-server` → proxy tcp 22. Sono P4 e P4b, scritte per cliente.
- **DA-ZABBIX è già un peer**, `da-zabbix`, nei gruppi `zbx-server` e `server-interni`.
- Le persone stanno in `users` e in `admins`. Gli accessi alle LAN di sede (4, 15, 30, 40,
  51) sono **risorse della rete NetBird «Domarc»**, con router `da-netbird`. Le policy verso
  le risorse hanno destinazione vuota e la risorsa come `destinationResource`: per vederle,
  lo script del censimento deve leggere anche `/api/networks`.

**Dove si usa `All`** (dettaglio per il Task 4):

| Oggetto | Cosa apre oggi | Stato |
|---|---|---|
| policy `AD01 Access` | `All` → risorsa AD01 `192.168.4.1`, tutte le porte | accesa |
| policy `AD02 Access` | `All` → risorsa AD02 `192.168.4.2`, tutte le porte | accesa |
| policy `da-rdh Access` | `All` → risorsa da-rdh `192.168.4.21`, tcp 3389 | accesa |
| policy `DA-sns Access` | `All` → risorsa DA-sns `192.168.4.42`, tcp 80 e 443 | accesa |
| policy `da-sns-dev Access` | `All` → risorsa da-sns-dev `192.168.4.41`, tcp 80 e 443 | accesa |
| policy `Default` | `All` ↔ `All` | **spenta** |
| policy `da-sns Policy` | `All` → `All` | spenta |
| nameserver `da-dc01`, `da-dc02` | DNS di `domarc.it` distribuito a `All` | acceso |
| rotte | nessuna usa `All`: `DMZ ACCESS` va a `admins`+`users`, le due uscite a `users` e `uscita-sempre` | — |

**R2 e R3 sono rosse già oggi, non solo quando entrerà il primo cliente.** I proxy Zabbix
dei clienti stanno in `All` come tutti i peer. Per questo raggiungono AD01 e AD02 su tutte le
porte, RDH in 3389 e le `.41`/`.42` in 80/443. Il Task 4 chiude anche questo.

**Peer che stanno solo in `All`.** Dopo il Task 4 perderebbero tutto:
- `MacBook-Air-di-Simone.local`, di Simone Annovi, connesso il 14/10;
- `NB-AGUZZOLI`, di Luca Aguzzoli;
- `q5qxeea`, un Android, ultimo contatto 13/10.

Simone Annovi e Luca Aguzzoli sono anche gli unici utenti senza gruppi automatici.

**Igiene, non urgente:**
- peer doppi di dispositivi rientrati più volte: `a52sxqeea` ×6, `pa3qxeea` ×3,
  `VER-N49EEA` ×2, `proxy-domarc-ovh` ×3;
- le 20 setup key esistenti sono tutte scadute o consumate.

### A.3 Codici cliente (decisione 12)

| Codice | Dove | Ragione sociale nel CRM | Esito |
|---|---|---|---|
| `70791` | tenant dell'hub; edge 1, 3, 4 (revocato), 5 | DOMARC SRL | corretto |
| `71734` | tenant dell'istanza DTS; edge 2 | DUERRE TUBI STYLE GROUP SPA | corretto |
| `70791a` | tenant dell'hub «DOMARC-OVH» | — (non è un `codcli`) | **da correggere** |

Nessun tenant `DEFAULT` è registrato. Il `public_hostname` dell'edge 5, `da-va-ovh`, non
risolve da da-vulcan: il nome Tailscale vero è `bridge-domarc-ovh`.

**Agente Python di DA-IPAM (`tenant_agents`).** Sull'hub ce n'è uno solo: tenant `70791a`,
`bridge-domarc-ovh:8443`, **mai visto** (`last_seen_at` vuoto). Sull'istanza DTS non ce n'è
nessuno. In pratica non lo usa nessuno.

### A.4 Porte degli edge (provate da da-vulcan via Tailscale)

| Edge | Nodo | 6443 | 8443 | Altre |
|---|---|---|---|---|
| DTS (2) | `dts-appliance` | aperta | chiusa | 22 |
| DA-VA-OVH (5) | `bridge-domarc-ovh` | aperta | aperta | 22 |
| DOMARC (1) | `da-invent` | chiusa | chiusa | 22 e 443. Un `uvicorn` ascolta su `0.0.0.0:8443` ma via Tailscale non risponde: l'interfaccia dell'edge di sede si raggiunge in LAN |
| PX-NAS (3) | `appliance-pxnas-domarc` | chiusa | chiusa | 22. L'ultimo contatto dell'edge è dell'08/09: è fermo |

Per P3 basta quindi **6443**. Fa eccezione DA-VA-OVH, che risponde anche su 8443; resta in
VPN diretta (fase 4).

### A.5 Riferimenti a `da-vulcan` (rischio 3)

Con `rg -w --no-ignore` su `~/Progetti` (esclusi `node_modules`, `.git`, `.next`, `.venv`,
`worktrees` e `_archive`) risultano **193 file e 522 occorrenze**:

| Progetto | File |
|---|---|
| DA-Vul-can | 125 |
| DA-News | 17 |
| DA-Infra | 17 |
| Deploy-Appliance | 8 |
| DA-IPAM | 6 |
| DA-Zabbix | 4 |
| DA-Manager | 3 |
| DA-Auth | 3 |

Il resto sta nei documenti di `Domarc/` e nel catalogo.

Attenzione: in questa macchina `grep` rispetta i `.gitignore`, e la radice di `~/Progetti`
ignora i sotto-repo. Senza `--no-ignore` il conteggio esce 2.
