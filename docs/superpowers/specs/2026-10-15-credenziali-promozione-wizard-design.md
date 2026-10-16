# Credenziali, promozione IP → apparato e wizard — design

**Data:** 2026-10-15 · **Stato:** approvato da Riccardo il 15/10 (design in chat) ·
**Piano della tappa 1:** `docs/superpowers/plans/2026-10-15-tappa1-credenziali-promozione.md`

## 1. Perché

Riccardo, durante una creazione iniziale, ha trovato quattro problemi:

1. le richieste di credenziali del wizard sono «fuori standard»: quattro blocchi fissi
   (SNMP, SSH, Windows, Linux) invece di più credenziali di ogni tipo come nella pagina
   Credenziali (SSH, API, WinRM, WMI, SNMP, controller UniFi/Omada, AD);
2. la finestra che trasforma un IP in apparato è caotica, ripete le stesse informazioni,
   e le credenziali vanno assegnate con una prova diretta o provate in sequenza per
   trovare quelle giuste; quelle nuove vanno nell'archivio;
3. la classificazione va scritta sull'apparato **e** sull'IP della subnet, e deve
   funzionare: spesso dopo la creazione bisogna correggere le credenziali assegnate;
4. una rete inserita nel wizard è comparsa nella pagina Reti come `192.168.0.0/24`
   («potrei anche aver sbagliato»).

L'analisi del 15/10 (tre esplorazioni + verifica riga per riga + misura in sola lettura
sull'hub) ha confermato i punti 1-3 e trovato una quarantina di difetti con quattro radici:

- **le credenziali stanno in otto posti** (sei tabelle del tenant: `credentials`,
  `network_credentials`, `network_host_credentials`, `host_detect_credential`,
  `host_credentials`, `device_credential_bindings`, più le colonne di `network_devices`;
  due chiavi nelle impostazioni dell'hub) e **sette funzioni** scelgono quale usare, con
  ordini diversi;
- **lo stesso concetto ha quattro nomi**: `credentials.credential_type`
  (`ssh|snmp|api|windows|linux`), `protocol_type` di host e binding
  (`ssh|snmp|winrm|api|redfish|onvif`), `role` delle catene vecchie
  (`windows|linux|ssh|snmp`), `network_devices.protocol` (`ssh|snmp_v2|snmp_v3|api|winrm`);
  ci sono **cinque regole diverse** su quale tipo vale per quale protocollo;
- **due modelli di catena di rete**: il wizard scrive le catene vecchie per ruolo, la
  pagina della rete e la validazione leggono solo la lista nuova, il motore le usa tutte e due;
- **«marca» mescola produttore hardware e piattaforma di gestione**: il classificatore
  scrive `microsoft`, `dell`, `apple`…, la tabella degli apparati accetta solo piattaforme.

**Misure sull'hub (15/10, sola lettura, DB `70791`, `70791a`, `DEFAULT`):** la tabella
`network_devices` rifiuta `apple` e `macos`; 13 host macOS (9 con marca dedotta `apple`),
6 con `microsoft`; 68 host Windows e 51 Linux dedotti; nessuna rete con sole catene vecchie;
nessun binding SNMP inline con la community nel campo username. L'appliance del cliente A
non è stata misurata.

## 2. Decisioni di Riccardo (15/10)

- **Archivio unico** delle credenziali, con tipi per esteso (tappa 2).
- **Prima i bug confermati** in un rilascio piccolo, poi il ridisegno a tappe.
- **Livello di controllo leggero**; i passi che toccano una zona rossa (le due
  migrazioni: tabella apparati, tabella credenziali; conversioni di dati dei clienti)
  passano al completo, come dice la sua regola.
- Nella tappa 1 si aggiunge la **porta non standard sulle credenziali** (SSH su 2022,
  SNMP su una porta diversa da 161, …).
- Le credenziali si assegnano con **prova diretta e prova in sequenza**; quelle nuove
  finiscono **nell'archivio**, niente credenziali inline nelle finestre nuove.
- Apple/macOS si **aggiungono alla tabella** (la scansione macOS esiste:
  `src/lib/devices/device-acquisition-resolve.ts` `isMacosDevice`), non si ripiegano su Linux.
- Fuori perimetro: i difetti del vault del Launchpad (`system_credentials`).

## 3. Tappe

### Tappa 1 — bug confermati e porta sulle credenziali (rilascio piccolo)

Nessuna ricostruzione di tabelle; una sola colonna aggiunta (`credentials.port`).

1. **Porta facoltativa sulla credenziale** (`NULL` = porta standard del protocollo):
   campo nella pagina Credenziali; la usano il motore di risoluzione (catena di rete e
   catene vecchie), le finestre di promozione (porta del binding), la discovery (SSH e
   validazione SNMP). Limite dichiarato: il giro SNMP generale della discovery prova le
   community sulla 161; una credenziale con porta propria si prova nella validazione e
   nell'acquisizione.
2. **Una sola regola tipo ↔ protocollo** per le tendine: SSH → `ssh`, `linux`;
   WinRM → `windows`; SNMP → `snmp`; API → `api`, `ssh` (Proxmox con utente root:
   l'acquisizione non controlla il tipo); Redfish/ONVIF → `api`. Al cambio di protocollo
   una credenziale incompatibile si azzera.
3. **Proposta dell'apparato da un host** in un modulo puro: piattaforma dalla famiglia
   di sistema operativo dedotta (Windows → `windows` + WinRM, Linux → `linux` + SSH,
   macOS → `apple`), marche hardware fuori elenco mappate sulla piattaforma o su `other`,
   classificazione valida (alias `printer` → `stampante`, la scelta manuale dell'host
   vince), porta dalla credenziale validata sull'host o dall'archivio. La usano le
   quattro finestre di promozione.
4. **Promozione singola**: via i campi inline che nessuno legge, community nascosta non
   inviata, porta modificabile, classificazione obbligatoria (niente più «hypervisor» di
   ripiego), la spunta «sorgente ARP» tolta resta tolta.
5. **Finestra «Aggiungi dispositivi» della rete, discovery in blocco, lista per
   classificazione**: valori iniziali dalla proposta sugli host selezionati, non
   «server + Altro + UPS»; con SNMP la credenziale principale è SNMP e la seconda
   tendina sparisce; lo stato si azzera fra un host e l'altro.
6. **Credenziali**: password non obbligatoria in modifica e stringa vuota che non
   cancella il segreto; username SNMPv3 nella pagina; community dei binding inline nel
   campo cifrato; prova SNMP senza community = errore, non `public`; «Test» su
   API/Redfish/ONVIF non marca il binding come fallito.
7. **Porta SNMP**: le scansioni non la cambiano più.
8. **Wizard, solo i guasti**: flag «da configurare» scritto all'apertura (una ricarica
   non lo fa sparire); la rete scrive la lista credenziali nuova; il campo della rete è
   un suggerimento, non un valore precompilato.

### Tappa 1b — Apple e macOS (migrazione, controlli completi)

Ricostruzione di `network_devices` con `apple` in `vendor` e `macos` in `scan_target`,
**partendo dalla definizione attuale in `sqlite_master`** (le ricostruzioni esistenti in
`db-tenant.ts` riscrivono un elenco fisso di colonne e perdono quelle non elencate).

### Tappa 2 — archivio unico delle credenziali (migrazione, controlli completi)

- Tipi: SSH (password o chiave), SNMP v1/v2c, SNMP v3, Windows (WinRM e WMI con lo
  stesso account; WMI passa da WinRM come oggi), API (token o utente), Controller UniFi
  (chiave API o utente), Controller Omada (client id/secret o utente), Active Directory.
  `linux` confluisce in SSH.
- Controller (`network_controllers`) e AD (`ad_integrations`) prendono la credenziale
  dall'archivio; le loro credenziali attuali si spostano nell'archivio.
- Catene di rete unificate sulla lista nuova (`network_credentials`); le catene vecchie
  si convertono.
- Un solo motore di scelta (`src/lib/credentials/resolve.ts`) usato anche
  dall'acquisizione, al posto delle sette funzioni.
- I binding inline esistenti diventano voci d'archivio col nome dell'apparato.
- SNMPv3 completo: chiave di autenticazione letta da `encrypted_auth_key`, protocolli
  dalla credenziale, ramo v3 nelle prove.

### Tappa 3 — una finestra sola per trasformare un IP in apparato

Lo stesso componente nei quattro punti d'ingresso (`/objects/[id]`, pagina della rete,
discovery, lista per classificazione), ogni informazione una volta sola: **cos'è**
(classificazione, piattaforma, tipologia) · **come ci arrivo** (protocollo, porta) ·
**credenziali** (dall'archivio o nuova nell'archivio; «Prova» sulla scelta; «Trova in
automatico» che prova in sequenza le validate sull'host, poi la catena della rete, poi il
resto dell'archivio, e si ferma alla prima buona). Per Windows e AD tetto ai tentativi e
rispetto del fermo dopo i fallimenti (ogni tentativo è un accesso fallito vero: allarmi
XDR, blocco dell'account). Su più host la prova gira su ciascuno, esito riga per riga. La
scheda dell'apparato mostra le credenziali davvero assegnate. **Interfaccia proposta
oggetto per oggetto prima di scriverla.**

### Tappa 4 — wizard

Il passo credenziali riusa la pagina Credenziali (più voci, tutti i tipi); tornare
indietro modifica invece di ignorare; niente doppioni ai nuovi tentativi; «Esci»
conserva il punto raggiunto. **Interfaccia proposta oggetto per oggetto.**

### Tappa 5 — classificazione

Un solo punto scrive la classificazione su apparato e host, nei due versi (oggi
l'host → apparato sì in `hosts/bulk-update`, l'apparato → host no in `PUT
/api/devices/[id]`); la scelta manuale vale su entrambi e le scansioni non la toccano
(oggi `syncNetworkDeviceFromHostScan` la sovrascrive sugli apparati di infrastruttura);
la classificazione decide le proposte di piattaforma, protocollo e tipologia.

## 4. Rischi

- **`dev` arriva da solo all'appliance del cliente A** ogni 15 minuti: su `dev` solo
  codice pronto, cancello completo una volta prima di ogni rilascio.
- **Prove in sequenza su Windows/AD** = accessi falliti reali (tappa 3).
- **Ricostruzione di tabelle**: colonne perse se si riscrive un elenco fisso; FK verso
  `network_devices` da `device_credential_bindings` e altre: `foreign_keys = OFF` dentro
  una transazione, `PRAGMA foreign_key_check` dopo, indici ricreati.
- **Rete a 192.168.0.0/24**: nessun punto del codice la produce (cercato nel codice,
  nella storia del repo, nell'installatore e nel DB modello); si toglie il valore
  precompilato del wizard e si riproduce sull'appliance dove è successo.
