# Da Tailscale a NetBird: una rete a stella fra centrali Domarc e oggetti dei clienti

**Stato:** disegno approvato a voce da Riccardo il 2026-10-14, rivisto lo stesso giorno
dopo il chiarimento sui moduli; documento da rileggere
**Data:** 2026-10-14
**Autore:** Riccardo Grandi, con Claude
**Decisione architetturale:** [ADR 0011](../../adr/0011-netbird-rete-a-stella.md)
**Livello di controllo:** completo (si toccano appliance in esercizio presso i clienti)

Riguarda cinque progetti. Ognuno lo cita con una riga dal proprio `CONTEXT.md`, senza
ricopiarlo:

- **Il concentratore** (progetto nuovo, nome da scegliere all'apertura): emette le chiavi e
  riceve i dati delle istanze IPAM. Quando il repo esiste, questo documento si sposta lì e
  qui resta un rimando.
- **DA-IPAM** (`~/Progetti/Domarc/DA-IPAM`): l'istanza che va dai clienti.
- **DA-Vul-can** (`~/Progetti/Domarc/DA-Vul-can`): hub in sede, e Scanner-Edge in
  `infra/scanner-edge/`.
- **DA-Zabbix** (`~/Progetti/DA-Zabbix`): server in sede, proxy dai clienti, e il client
  NetBird da cui si parte.
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

E fa nascere il **concentratore**, nella sua forma più piccola: sa quali oggetti remoti
esistono, li fa entrare in NetBird, li revoca, dice se sono connessi e se l'isolamento
regge, e riceve il segnale di vita delle istanze IPAM.

**Non è:**

- un cambio del dialogo fra edge e hub (API, token, formati): cambia la strada, non quello che
  ci passa sopra. La tappa 7 del [piano di miglioramento](2026-10-12-piano-miglioramento-design.md)
  protegge quel dialogo, e qui non si tocca;
- un modo per raggiungere la LAN del cliente: da Domarc si raggiunge **solo l'oggetto**
  (decisione 1, §2);
- la console centrale completa della tappa 9 (versioni, aggiornamenti, creazione di appliance):
  quella cresce dopo, **nello stesso progetto** del concentratore;
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
| 3 | **Il concentratore crea gruppi, chiavi e policy via API**, sul modello di `zbximport/netbird.py` di DA-Zabbix, con regole di nome comuni a DA-Zabbix. | a mano dalla console; uno strumento provvisorio; la procedura guidata di DA-Zabbix estesa a tutto |
| 4 | **Doppio binario cliente per cliente, pilota DTS**: NetBird accanto a Tailscale, verifica, poi si toglie Tailscale. Si finisce coi centrali e si spegne la tailnet. | solo i nuovi su NetBird; taglio netto |
| 5 | **Gruppi per ruolo, più un gruppo per cliente.** Le policy sono poche e fisse e si scrivono per ruolo; il gruppo del cliente non apre niente: serve a sapere di chi è un nodo e a revocarlo. | una policy per oggetto; centrali come «risorse» dietro un nodo d'instradamento |
| 6 | **Il concentratore nasce subito, piccolo, come progetto separato**, installato solo in sede. Il suo primo compito è questo; il resto della tappa 9 arriva dopo, lì. | dentro DA-IPAM come modalità (finirebbe su ogni appliance col ramo `main`); dentro l'hub DA-Vul-can |
| 7 | **Le istanze IPAM mandano i dati al concentratore** (443), come gli edge con da-vulcan e i proxy con Zabbix. Sul remoto non si apre nessuna porta in ingresso, tranne quelle per i tecnici. | il concentratore che va a prendere; entrambi |
| 8 | **Wazuh non entra mai in NetBird** e nessuna policy porta alle sue porte. | — |

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

La VM 533 (`192.168.4.8`) **non è il concentratore**: è l'istanza DA-IPAM di Domarc stessa.
Sta in sede, raggiunge il concentratore in LAN e non ha bisogno di NetBird.

## 4. L'architettura

### 4.1 I nodi

**Al centro**, in sede:

| Nodo | Gruppo NetBird |
|---|---|
| da-vulcan (hub VA) | `centro-vulcan` |
| DA-ZABBIX (server) | `centro-zabbix` |
| Concentratore (nuovo) | `centro-concentratore` |

**Dai clienti**:

| Tipo | Cosa contiene | Gruppi NetBird |
|---|---|---|
| 1. Edge da solo | Scanner-Edge per le scansioni VA | `remoto-edge` |
| 2. Proxy Zabbix da solo | proxy Zabbix | `zabbix-proxy` (esiste già) |
| 3. Istanza IPAM | DA-IPAM, e può contenere edge, proxy Zabbix, LibreNMS e altri applicativi | `remoto-ipam`, più `remoto-edge` e/o `zabbix-proxy` se li contiene |
| 4. Wazuh | — | **nessuno**: non entra in NetBird |

**Persone**: `admins` (tecnici) e `users` (colleghi), esistono già.

Un nodo remoto sta sempre anche nel gruppo del suo cliente `cli-<codice>` (es. `cli-71734`).
Un'istanza IPAM che contiene edge e proxy è **un nodo solo**, in tre gruppi di ruolo. Gli altri
applicativi dell'istanza (LibreNMS, Graylog leggero, …) non hanno policy proprie: si
raggiungono solo passando dall'interfaccia dell'istanza.

**Nomi nella rete NetBird**: `<codice>-<tipo>`, cioè `-edge`, `-zbx`, `-ipam`; per esempio
`71734-ipam.netbird.selfhosted`.

### 4.2 Le policy

Tutte **a senso unico**, protocollo TCP, porte esplicite. Le risposte tornano indietro da sole
(NetBird tiene lo stato della connessione); non serve la policy inversa.

| # | Sorgente | Destinazione | Porte | Perché | Di chi è |
|---|---|---|---|---|---|
| P1 | `remoto-ipam` | `centro-concentratore` | 443 | l'istanza manda segnale di vita e dati (decisione 7) | concentratore |
| P2 | `remoto-edge` | `centro-vulcan` | 443 | heartbeat, risultati, tarball degli aggiornamenti | concentratore |
| P3 | `centro-vulcan` | `remoto-edge` | 6443 (8443 sugli edge vecchi) | l'hub comanda gli scan: dialogo esistente, non si cambia | concentratore |
| P4 | `zabbix-proxy` | `centro-zabbix` | 10051 | proxy in modalità active | DA-Zabbix (esiste già) |
| P5 | `admins` | `remoto-ipam`, `remoto-edge`, `zabbix-proxy` | 22, 443, 6443 | assistenza tecnica | concentratore |
| P6 | `admins` | `centro-*` | 22, 443 | amministrazione dei centrali | concentratore |

Non ci sono policy dal concentratore verso le istanze: è l'istanza a chiamare (decisione 7).
Se in futuro servisse un comando dal centro verso un'istanza, viaggerebbe come risposta a una
sua chiamata, non come porta aperta.

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
    l'istanza stessa nel suo segnale di vita (§5.2) e il concentratore lo confronta con
    l'elenco atteso.

## 5. La vita di un oggetto remoto

### 5.1 Ingresso

1. Il tecnico apre nel concentratore «nuovo oggetto»: cliente, tipo (edge / proxy / istanza
   IPAM con i moduli che contiene), nome.
2. Il concentratore, via API NetBird:
   - crea se manca il gruppo `cli-<codice>` (idempotente);
   - emette una **setup key monouso**: un solo utilizzo, valida 24 ore, non effimera,
     gruppi automatici `cli-<codice>` + i ruoli. Il nome è `<codice>-<tipo>-<AAAAMMGG>`,
     così si riconosce chi l'ha emessa.
   - per un'istanza IPAM, genera anche il **token** con cui l'istanza manderà i dati (P1).
3. Chiave e token compaiono **una volta**, dentro il comando d'installazione. Non si salvano in
   chiaro, non vanno nei log, non tornano più a schermo. Se si perdono se ne emettono altri,
   e la chiave non usata si revoca da sola.
4. L'installatore (edge, istanza IPAM con Deploy-Appliance, in futuro il `/setup`
   dell'immagine della tappa 8, proxy dalla procedura guidata di DA-Zabbix) fa
   `netbird up --management-url https://netbird.domarc.it --setup-key … --hostname <codice>-<tipo>`.
   Il servizio `netbird` resta abilitato all'avvio.
5. Il concentratore controlla che il nodo sia comparso connesso nei gruppi giusti e, per
   un'istanza IPAM, che sia arrivato il primo segnale di vita. Se non succede entro il tempo
   d'installazione lo dice; non lo dà per fatto.

I nodi entrati con setup key non hanno scadenza del login: è il comportamento di NetBird
per i nodi non legati a una persona. Si verifica sulla versione installata in fase 0.

### 5.2 A regime

- La connessione è sempre accesa: NetBird si ricollega da solo dopo riavvii e cambi di rete.
- **Segnale di vita dell'istanza IPAM** verso il concentratore (P1), a intervalli fissi:
  - versione e moduli accesi;
  - salute dei moduli;
  - **porte aperte sull'interfaccia NetBird** (per R5);
  - ultimo errore.
- È il primo mattone della tappa 9; lì il contenuto crescerà.
- L'heartbeat dell'edge verso da-vulcan dice su quale rete passa (§6.3).
- I token applicativi restano com'erano: il token dell'edge verso l'hub, il token
  dell'istanza verso il concentratore. NetBird decide chi può arrivare alla porta; il token
  decide che cosa può fare chi ci arriva.

### 5.3 Revoca

- **Un oggetto**: il concentratore cancella il nodo in NetBird, revoca le sue chiavi non usate
  e il token dell'istanza. Il tunnel cade subito.
- **Un cliente intero**: si cancellano tutti i nodi del gruppo `cli-<codice>`. Si legge prima
  l'**elenco dei nomi** e lo si conferma (regola 10 del parco: i nomi, non i totali).
- Ogni revoca resta nel registro di audit del concentratore, con chi l'ha fatta e quando.

### 5.4 Chi scrive in NetBird

Ci sono due scrittori, con una divisione netta:

- **Il concentratore** gestisce i nodi edge e istanze IPAM, i gruppi `cli-*`, `remoto-*`,
  `centro-*` e le policy P1–P3, P5, P6.
- **La procedura guidata di DA-Zabbix** gestisce i proxy che vivono da soli, nel gruppo
  `zabbix-proxy` e nello stesso `cli-<codice>`, e la policy P4.

Nessuno dei due cancella ciò che non ha creato: si riconosce dal prefisso del nome della chiave
e del nodo. Il proxy che vive dentro un'istanza IPAM non riceve una seconda chiave: è lo stesso
nodo, e lo mette in `zabbix-proxy` il concentratore all'ingresso.

## 6. Controlli e visibilità

### 6.1 Verifica dell'isolamento

Un controllo in **sola lettura** nel concentratore legge da NetBird policy, rotte, gruppi di
nameserver e nodi, insieme alle porte dichiarate dalle istanze, e verifica R1–R5. Gira:

- a ogni emissione di chiave;
- una volta all'ora;
- a richiesta, dalla pagina.

Se una regola salta, la pagina diventa rossa e dice **quale** policy, rotta o istanza apre il
varco, per nome. Va anche nel monitoraggio (DA-ZABBIX): un controllo che fallisce in silenzio
non serve (regola 6 del parco). Le cinque regole sono anche **prove automatiche**: con dati
finti nella forma vera dell'API NetBird, ogni prova va vista fallire prima di passare.

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

- **Concentratore**: un elenco degli oggetti remoti per cliente.
  - Per ogni oggetto: tipo e moduli, rete (NetBird / Tailscale / nessuna), nome e IP NetBird,
    connesso o no, ultimo contatto NetBird, ultimo segnale di vita.
  - In cima: esito della verifica R1–R5, con data e fonte della lettura.
  - La **scadenza del token API** verso NetBird, con avviso 30 giorni prima: un token scaduto
    fermerebbe in silenzio ogni nuova installazione.
- **DA-Vul-can**: sulla pagina delle sonde, la rete da cui arriva l'heartbeat. È l'indicatore
  D15 del suo BACKLOG, generalizzato.

## 7. Il passaggio

Ogni fase si chiude da sola. Ci si può fermare dopo qualunque fase senza lasciare niente a metà.

**Fase 0 — Preparazione. Niente codice, niente clienti.**

- Censimento dei nodi Tailscale (`tailscale status` da un centrale): quali clienti, quale tipo
  di oggetto, quale macchina. L'elenco diventa la lista della fase 3 e il primo contenuto del
  concentratore.
- **Prova di convivenza su una VM di prova** con Tailscale e NetBird accesi insieme (§8,
  rischio 1). Se non passa, si decide il rimedio prima di toccare DTS.
- Versione del server NetBird; comportamento di scadenza dei nodi entrati con setup key;
  quali permessi servono al token API.
- §6.2: `All` fuori dalle policy dei colleghi, `Default` spenta.
- da-vulcan e DA-ZABBIX entrano in NetBird nei gruppi `centro-*`, **senza lasciare
  Tailscale**.
- Il nome stabile per da-vulcan (§8, rischio 3).

Esce quando: i centrali sono connessi in NetBird, la verifica R1–R4 fatta a mano è verde e i
colleghi raggiungono ciò che raggiungevano prima.

**Fase 1 — Il concentratore e il codice, sul dev.**

- Si apre il progetto del concentratore (`bin/nuovo-progetto`, poi una sessione nuova come
  vuole `AVVIO-PROGETTO.md`).
- Il concentratore nasce col solo compito di §1: elenco, chiavi, revoca, stato, R1–R5,
  ricezione del segnale di vita. Gira in sede, in `centro-concentratore`.
- Il suo token API NetBird va nel vault (`secret_ref` nel suo `ACCESSI.md`).
- Nei repo esistenti, le modifiche del §9, con Tailscale ancora supportato accanto.

Esce quando:
- i cancelli dei repo sono verdi;
- una chiave emessa dal concentratore sul NetBird vero fa entrare una VM di prova nei gruppi
  giusti;
- la VM manda il segnale di vita;
- chiave e VM si tolgono subito dopo.

**Fase 2 — Pilota DTS**: istanza IPAM `172.16.0.2`, edge `172.16.1.141`, `proxy-dts`.

1. NetBird accanto a Tailscale sulle macchine di DTS, con chiavi emesse dal concentratore. Il
   proxy, se vive da solo, passa dalla procedura guidata di DA-Zabbix.
2. Gli indirizzi con cui centrali e DTS si cercano passano ai nomi NetBird.
3. Si verifica **dal di fuori**, flusso per flusso, come lo usa chi lo usa:
   - heartbeat dell'edge arrivato a da-vulcan con rete = NetBird;
   - uno scan comandato da da-vulcan;
   - segnale di vita dell'istanza nel concentratore;
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
  al nome nuovo (§8, rischio 3).
- Si toglie il codice Tailscale: campi della procedura guidata, tipo di credenziale,
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
   - Va monitorato da DA-ZABBIX.
   - Va ricordata la trappola di DA-Infra: Traefik v3 taglia gli stream a 60 secondi,
     `readTimeout: 0` non è opzionale.
5. **Il concentratore diventa necessario per far entrare oggetti nuovi**, non per far
   funzionare quelli che ci sono: i tunnel e i dialoghi edge↔da-vulcan e proxy↔Zabbix non
   passano da lui. Se è giù si perde il segnale di vita delle istanze, e lo si vede.
6. **Il token API del concentratore verso NetBird scade.** Senza avviso, le installazioni
   smettono di funzionare il giorno dopo. Per questo la scadenza si vede in pagina (§6.3).
7. **L'agente Python di DA-IPAM accetta la fascia `100.64.0.0/10`.** Con NetBird quel
   controllo passa ancora ma non distingue più nulla. Se l'agente resta (§12), la fonte
   ammessa diventa la rete NetBird dell'account letta all'installazione, più bearer e scope
   come oggi.
8. **Il firewall dell'edge si fida di tutta l'interfaccia Tailscale** (`ufw allow in on tailscale0`).
   Su NetBird si aprono solo le porte delle policy: 6443 e 22 sull'edge, 22 e 443
   sull'istanza IPAM. La barriera vera è la policy, e il firewall è la seconda linea.
9. **Il certificato dell'edge** contiene oggi nome DNS e IP della LAN. Si aggiunge il nome
   NetBird ai SAN (`tls_extra_sans`) e si verifica in fase 2 che da-vulcan lo accetti.
10. **Il firewall del cliente in uscita.** NetBird prova la via diretta in UDP e ripiega sul
    relay in 443 TCP. Su un cliente che chiude tutto in uscita si verifica che il relay passi,
    prima di togliere Tailscale.

## 9. Cosa cambia, repo per repo

**Concentratore (nuovo)**

- Client API NetBird: gruppi, chiavi, revoca, nodi, policy. Si parte da
  `DA-Zabbix/zbximport/netbird.py`.
- Elenco degli oggetti remoti per cliente.
- Emissione del comando d'installazione con chiave e token.
- Ricezione del segnale di vita (P1).
- Verifica R1–R5 e pagina di §6.3.
- Audit di emissione, revoca e cancellazione.
- Gli standard del parco: cancello, `CONTEXT.md`, `ACCESSI.md`, scheda nel censimento.

**DA-IPAM**

- Il segnale di vita verso il concentratore: URL e token dalla configurazione
  d'installazione, e porte aperte sull'interfaccia NetBird fra i dati mandati.
- Installatore e `/setup` con `NETBIRD_SETUP_KEY` e token del concentratore.
- Firewall sull'interfaccia NetBird: solo 22 e 443, più 6443 se l'istanza contiene l'edge.
- Tailscale tolto da procedura guidata e credenziali nella fase 4. Prima si decide che fine
  fa l'agente remoto (§12).

**DA-Vul-can / Scanner-Edge**

- Heartbeat: campi `overlay` (`netbird`/`tailscale`/`nessuno`), `overlay_ip`,
  `overlay_name`; `tailscale_ip` resta fino alla fase 4.
- Hub: salva e mostra la rete dell'heartbeat (D15).
- Primo avvio, `install.sh`, `harden.sh`: setup key NetBird; firewall per porta su `wt0`;
  nome NetBird nei SAN.
- Bridge-node Ansible: ruolo `netbird` accanto a `tailscale`, poi al suo posto.

**DA-Zabbix**

- La procedura guidata dei proxy mette il nodo anche in `cli-<codice>`, usa le stesse regole
  di nome (`<codice>-zbx`) e non tocca ciò che ha creato il concentratore.
- Per un proxy dentro un'istanza IPAM non emette chiavi: il nodo c'è già.
- DA-ZABBIX tiene d'occhio la verifica R1–R5 e il server NetBird (§6.1, §8).

**Deploy-Appliance**

- Parametro setup key NetBird e token del concentratore nell'installatore, al posto
  dell'auth-key Tailscale.
- La VM Wazuh non riceve mai NetBird.

**DA-Infra** — solo documentazione: `docs/servizi/netbird.md` aggiornato con gruppi, policy
e le regole «`All` mai» e «Wazuh mai».

## 10. Rapporto col piano di miglioramento di DA-IPAM

- **Tappa 9** (console centrale): il concentratore **è** il suo inizio. La sua spec, quando ci
  si arriva, parte dal progetto che nasce qui invece che da zero, e lo fa crescere: versioni,
  canale d'aggiornamento, creazione di appliance.
- **Tappa 7** (edge guidato da DA-IPAM): non si tocca il contratto con l'hub; si cambia la
  rete sotto. La migrazione edge per edge (7e) e la fase 3 si fanno insieme dove coincidono.
- **Tappa 8** (installazione dall'immagine): il `/setup` del primo avvio chiede setup key e
  token del concentratore, non l'auth-key Tailscale. Se la tappa 8 parte prima, nasce già così.
- Questo lavoro non dipende dalle tappe 1–6, e quelle non dipendono da lui.

## 11. Come si verifica che funziona

- **Prove automatiche**:
  - R1–R5 su dati finti nella forma vera dell'API NetBird;
  - emissione della chiave coi gruppi e il nome giusti;
  - revoca che tocca solo ciò che il concentratore ha creato;
  - segnale di vita accettato col token giusto e rifiutato senza;
  - heartbeat dell'edge coi campi nuovi e quelli vecchi.
- **Sul vero, dal di fuori**, in fase 2 e per ogni cliente in fase 3:
  - i quattro flussi della fase 2, punto 3;
  - la prova d'isolamento in negativo, Wazuh compreso;
  - un riavvio dell'oggetto remoto, dopo il quale torna connesso da solo.
- **Verifica isolamento** verde nella pagina del concentratore, con la data e la fonte della
  lettura.

## 12. Cosa resta da decidere nel piano operativo

- Il nome del progetto del concentratore e la macchina in sede dove gira.
- Il nome stabile per da-vulcan (rischio 3).
- Il rimedio alla convivenza in `100.64.0.0/10`, se la prova della fase 0 lo richiede.
- **L'agente Python remoto di DA-IPAM** (`agent/`, raggiunto oggi via Tailscale dalla VM 533).
  Con un'istanza IPAM per cliente forse non serve più. Si decide se toglierlo o portarlo su
  NetBird, contando prima chi lo usa davvero.
- Il contenuto del segnale di vita oltre al minimo di §5.2: lo fissa la spec della tappa 9.
