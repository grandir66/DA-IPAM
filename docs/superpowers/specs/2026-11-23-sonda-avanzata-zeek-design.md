# Sonda avanzata con Zeek — progetto

> Spec del 23/11/2026, chiesta da Riccardo («Sì, scrivi la spec»). **Stato: approvata da Riccardo il 23/11/2026.** Piano: `docs/superpowers/plans/2026-11-23-sonda-avanzata-zeek.md`.
> Deriva da: spec del collector `2026-11-20-collector-traffico-design.md`, misure in `collector-traffico/README.md`
> («Misura di Zeek» sul banco e «Zeek sul traffico vero» sul DA-PX-03), `TASKS.md` del 23/11.

## Cos'è e cosa non è

Il **profilo di serie del collector di traffico** (decisione 4): dove la macchina lo regge, Zeek prende il
posto del conteggio e dei controlli scritti da noi, e un adattatore traduce i suoi registri nelle **stesse tabelle e
nella stessa API** del collector. IPAM lo legge come legge oggi un collector, col cursore.

**Non è**:

- il ramo NDR di Codex (`codex/edge-va-gemella` di DA-Vul-can): fermato da Riccardo il 23/11 perché «non è integrato
  con il sistema di IPAM corretto». Qui l'integrazione con IPAM è il punto di partenza, non un passo dopo;
- un sistema a firme: Suricata o simili sono un passo successivo, fuori da questa spec (vedi «Dopo»);
- un archivio dei registri grezzi: di serie i registri di Zeek si buttano appena tradotti;
- una sonda attiva: come il profilo leggero, ascolta una copia e non trasmette niente sulla rete ascoltata.

## Decisioni di Riccardo

1. Il collector resta separato e distribuito (20/11); la sonda pesante diventa un suo profilo (23/11).
2. Si riparte da un'analisi con Zeek; Suricata o altro dopo, insieme (23/11).
3. Misura sul banco e un'ora sul traffico vero fatte (23/11): i numeri sotto vengono da lì.
4. **«Se la sonda non genera tutto questo carico potrebbe diventare la standard»** (23/11, mentre si scriveva questa
   spec). Quindi: Zeek diventa il profilo **di serie**, il leggero resta per le macchine che non lo reggono. Si
   conferma con la giornata intera della tappa 3; se lì il carico tiene, i collector dell'ufficio passano tutti a Zeek.

## Cosa dicono le misure

| | Banco PX-NAS | Traffico vero, DA-PX-03, un'ora |
|---|---|---|
| Traffico | fino a 200 Mbit/s, poche connessioni | media 23 Mbit/s, picco circa 100; 95 connessioni al secondo |
| CPU di Zeek | 1-6% di una vCPU | media 4,4%, picco 8,4% |
| RAM di Zeek | 260-270 MB | 379 MB stabile |
| Pacchetti persi da Zeek | 0 | 0 su 15,4 milioni |
| Registri | 1,1 KB per scambio | 257 MB l'ora, circa 6 GB al giorno |

Conclusioni per il progetto:

- **Risorse del profilo con Zeek: 2 vCPU, 2 GB, 16 GB di disco.** Il leggero resta 1 vCPU, 512 MB, 8 GB, per i
  nodi piccoli e le appliance dei clienti che non hanno spazio.
- **Il disco è il vincolo**, non la CPU: i registri si traducono e si buttano a ogni giro.
- **La copertura si legge dai contatori di Zeek** (`stats.log`: ricevuti e scartati), non da `capture-loss`, che sul
  banco e sul DA-PX-03 ha dato picchi fino al 72% con zero pacchetti scartati. Finché non è spiegato, non si usa.
- **Zeek scrive valori che non devono toccare il disco** (comunità SNMP vista sul banco; utenti in `ntlm`, `kerberos`,
  `ftp`, `http`). Il filtro per campo provato sul DA-PX-03 funziona: è il meccanismo da usare.

## Come è fatto

```
copia ──▶ Zeek ──registri ogni 5 min──▶ adattatore ──▶ archivio SQLite (stesse tabelle) ──▶ API /v1/* ──▶ IPAM
      └─▶ identita.py + controlli che Zeek non copre (stesso processo `collector-ascolto` di oggi)
```

### Sulla VM

- `PROFILO=leggero|avanzato` in `/etc/collector-traffico/collector.env`, scelto da `installa.sh --profilo`. **Di serie
  `avanzato`**; `installa.sh` scende da solo a `leggero` (e lo dice) se la VM ha meno di 2 vCPU o 2 GB. Cambiare profilo è reinstallare: l'archivio resta, il cursore di IPAM non si rompe.
- **Avanzato**: si accende `zeek-collector.service` e si spegne `pmacctd-collector`. Zeek 9.x LTS (`zeek-lts-core`)
  dal repository del progetto su `download.opensuse.org`, versione fissata in `installa.sh`.
- Zeek gira da solo (senza `zeekctl`), con `Log::default_rotation_interval = 5 min`: ogni 5 minuti chiude i registri,
  come la finestra del collector. Gli script caricati sono un elenco nostro in `collector-traffico/zeek/sonda.zeek`,
  non `local` intero.
- **`collector-ascolto` resta acceso anche nell'avanzato**, per `identita.py` (ARP, CDP, LLDP: Zeek non li scrive) e
  per i controlli che Zeek non copre. Quali controlli fa chi sta in **un solo elenco** nel codice
  (`collector/profili.py`): un controllo non deve mai uscire due volte, né mai sparire.
- **Adattatore** `collector/zeek_adattatore.py`, nel servizio `collector-traffico` che c'è già: prende i registri chiusi,
  li traduce, scrive nell'archivio, li cancella. Un registro che non si legge si sposta in `scartati/` e lo si dice in
  `/v1/stato`, mai buttato in silenzio.
- **Freno sul disco**: oltre il 70% del disco Zeek si ferma e `/v1/stato` lo dice; riparte da solo sotto il 50%.
- `ZEEK_TIENI_ORE=0` di serie: i registri tradotti si cancellano subito. Un numero più alto li tiene per indagini
  (da decidere, vedi «Aperto»).

### Dai registri di Zeek alle nostre tabelle

| Registro di Zeek | Diventa | Note |
|---|---|---|
| `conn` | `coppia`, `esterno`, `connessione` | client = chi apre (`id.orig_h`), server = chi risponde: il verso è giusto, sparisce la trappola delle porte alte (client NFS preso per server). `conn_state` S0, REJ, RSTO, RSTR → connessioni senza risposta o rifiutate |
| `dns` | `nome` (tipo `dns`), `nome_ip` | richieste senza risposta o con errore → tappa 6 del piano «dati in più» |
| `ssl`, `x509` | `nome` (tipo `sni`), `nome_ip`, fatti `tls_vecchio`; certificati scaduti, autofirmati, in scadenza | i certificati sono la tappa 6 del piano «dati in più»: stesso tipo d'anomalia, altra fonte |
| `snmp` | fatto `snmp_vecchio` | campo `community` escluso; uno script nostro scrive solo `comunita_nota = true/false` |
| `http` | fatto `chiaro_http_basic`, `software` | campi `username` e `password` esclusi |
| `ftp` | fatto `chiaro_ftp` | campi `user` e `password` esclusi |
| `modbus` | fatto `impianto_scrittura` (funzioni di scrittura) | S7 richiede un pacchetto aggiuntivo (vedi «Aperto») |
| `ntlm`, `smb_*`, `kerberos`, `ldap` | fatti `smb1`, `ntlm1`, `chiaro_ldap` dove Zeek li distingue | **utenti esclusi** finché la tappa 7 del piano «dati in più» (zona rossa) non è accesa da Riccardo |
| `software` | versioni dei programmi dichiarate in rete | tappa 7 del piano «dati in più», parte non rossa |
| `notice` | fatti nuovi, solo da un elenco: `SSH::Password_Guessing`, `HTTP::SQL_Injection_Attacker`, `SSL::Invalid_Server_Cert`, `Scan::*` se caricato | tutto il resto si ignora |
| `weird`, `files`, `analyzer`, `loaded_scripts`, `packet_filter`, `capture_loss` | niente | `stats` serve solo a `/v1/stato` |

Dove Zeek non porta un dato del profilo leggero (il tempo fra SYN e SYN-ACK di `connessione`), il campo resta
vuoto e la pagina dice «non misurato da questa sonda», non zero.

### Campi in più, facoltativi

Due colonne nuove in `coppia` (collector) e `traffico_coppie` (IPAM), migrazione additiva: `byte_ritorno` e
`risposta` (0/1). Le riempie solo l'avanzato; un collector leggero non le manda e IPAM le tratta come «non so».
Servono a `vlan_chiuse` e `non_censito`, che oggi indovinano il verso dalla porta.

### In IPAM

- Nessuna tabella nuova oltre alle due colonne. I tipi nuovi di fatto entrano in `TIPI_FATTO` di `anomalie.ts` e in
  `frasi.ts`, col loro interruttore per rete come gli altri controlli.
- La riga del collector mostra il profilo (`leggero` o `avanzato`) e la versione di Zeek, da `/v1/stato`.
- Le sonde note (`sonde.ts`) valgono uguali per i due profili. Da aggiungere per l'ufficio: `192.168.4.40` e
  `192.168.4.15`, che fanno da soli 165.000 connessioni SNMP l'ora sul DA-PX-03.

## Regole da non rompere

1. **Mai su disco un segreto**: password, comunità SNMP, hash, biglietti Kerberos, utenti (finché la zona rossa è
   spenta). L'esclusione si fa con un filtro per campo **prima** della scrittura (`Log::Filter$exclude`), non dopo.
2. **Prova di non-fuga prima del codice**: catture vere fatte sul banco del PX-NAS (mai sull'ufficio) con password e
   comunità di prova; la prova cerca quei valori in tutti i file della VM e deve essere vista fallire senza filtri.
3. Un controllo esce da una fonte sola (elenco in `profili.py`).
4. La copertura viene dai contatori, non da `capture-loss`.
5. Il collector non conosce IPAM e non trasmette sulla rete ascoltata.

## Tappe

| # | Cosa | Fatto quando |
|---|------|--------------|
| 1 | Adattatore per `conn`, `dns`, `ssl`: coppie (con `byte_ritorno` e `risposta`), esterni, connessioni, nomi | con registri veri del banco come dati di prova, le righe sono quelle del profilo leggero sullo stesso traffico, più il verso |
| 2 | Filtri dei campi, `sonda.zeek`, fatti da `snmp`, `http`, `ftp`, `modbus`, `ssl`, `smb`, `ntlm`, `ldap`; `profili.py` | la prova di non-fuga è verde dopo essere stata vista rossa; sul banco ogni controllo scatta una volta sola |
| 3 | `installa.sh --profilo avanzato`, rotazione, freno sul disco, `/v1/stato` coi contatori di Zeek; profilo in IPAM | una giornata intera su `DA-COLLECTOR-PX03`: disco sotto il 50%, nessun registro scartato, IPAM legge senza errori |
| 4 | Fatti nuovi: certificati, `notice` scelti, `software`; frasi e interruttori in IPAM | un caso provocato sul banco per ciascuno compare nella pagina Traffico |
| 5 | Utenti da `ntlm`, `kerberos`, `smb`, `ldap` · **zona rossa** | si fa con la tappa 7 del piano «dati in più», stesse regole: spento di serie, lo accende Riccardo |

Livello di controllo proposto: **leggero** per le tappe 1-4, **completo** per la 5 (zona rossa).

**Da coordinare**: le tappe 6 e 7 del piano `2026-11-23-collector-dati-in-piu.md` (in esecuzione in un'altra
sessione) toccano gli stessi dati per il profilo leggero. Stessi tipi d'anomalia, stesse tabelle: due fonti, non due
prodotti. Chi scrive per primo un tipo nuovo, lo scrive anche per l'altro profilo o lo segna come mancante.

## Dopo

- **Suricata o un altro motore a firme**: terzo profilo o aggiunta all'avanzato, stesso schema (i suoi avvisi in
  `eve.json` diventano fatti col nome della firma e la gravità). Si decide quando si vede cosa Zeek lascia scoperto.

## Aperto (decide Riccardo)

- **Nome** del profilo avanzato (qui «sonda avanzata»).
- **Registri grezzi**: buttarli subito (proposta) o tenerne alcune ore per le indagini, a costo di circa 250 MB l'ora.
- **Pacchetti aggiuntivi di Zeek**: JA4 (impronta dei programmi che si collegano) e i parser industriali (S7, BACnet,
  EtherNet/IP). Si installano con `zkg` da GitHub: è codice di terzi da scegliere uno per uno.
- **Passaggio dei collector esistenti**: proposta, prima `DA-COLLECTOR-PX03` (il nodo col traffico più vario); se la
  giornata della tappa 3 va bene, gli altri nodi dell'ufficio, ognuno portato a 2 vCPU e 2 GB.
- **Il leggero sparisce?** No, proposta: resta come ripiego per le macchine piccole, con gli stessi tipi d'anomalia
  dove li sa fare. Ma ogni controllo nuovo si scrive prima per Zeek.
- **`capture-loss`**: capire perché segnala perdite che i contatori non vedono (primo indiziato: il GRO sulla scheda).
