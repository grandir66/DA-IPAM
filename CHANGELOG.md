# Changelog

Tutte le modifiche notevoli al progetto DA-INVENT (alias DA-IPAM) sono documentate qui.
Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) — versioni hub semver
incrementale, versioni agent indipendenti (`agent-vX.Y.Z`).

## [Non rilasciato] — 2026-10-27 · Reti dal sensore trunk con host e MAC

### Corretto

- **Le reti con VLAN prendono host e MAC dal sensore trunk**: dopo ogni lettura (ogni 2 minuti) le osservazioni dello stesso VID con un IP della rete diventano host se mancano, o completano il MAC (e produttore e nome) se manca. Un MAC già presente non si tocca: quello dell'ARP del router o dello scan resta la fonte. Solo osservazioni degli ultimi 30 giorni. Perché: sul mini PC dimostrativo (72729-ipam, 27/10) le reti aggiunte dal trunk restavano senza host e, nelle VLAN senza tabella ARP del router, senza MAC; le osservazioni finivano solo in `mac_ip_mapping` (`src/lib/trunk/host-dal-trunk.ts`).
- **«Porta in DA-IPAM» fa prima un giro ARP sul VID** (la sonda usa `arp-scan` col tag e senza IP), aspetta che la sonda finisca (al massimo 90 s), legge il trunk e crea la rete con gli host trovati; il messaggio dice quanti. Se la sonda non risponde la rete entra lo stesso con gli host già osservati (`src/lib/trunk/aggiungi-rete.ts`). Richiesta di Riccardo del 27/10.

## [Non rilasciato] — 2026-10-27 · Vault semplice, passo 1: il formato KDBX

### Aggiunto

- **`src/lib/vault/kdbx.ts`**: il formato comune dei vault Domarc (archivio KDBX 4, AES-256, Argon2id 64 MiB / 3 / 2, aperto dal solo key file: con il `.kdbx` e il file chiave KeePassXC apre tutto). Voci a gruppi annidati per percorso (`clienti/<codcli>/<sistema>/<servizio>`), storico di 10 versioni, controllo di versione per le scritture, un solo scrittore, salvataggio atomico con la copia di prima. Lo stesso contratto è in DA-Link (`dalink/vault_kdbx.py`): le prove aprono un archivio scritto da ciascuno dei due. Non ancora usato dall'app: arriva con i passi 6 e 8 del piano.

## [Non rilasciato] — 2026-10-27 · Prova del trasporto Zabbix indipendente dal carico della macchina

### Corretto

- **«Connessione che non completa il TLS»** (`zabbix-lettura/__tests__/trasporto.test.ts`) non misura più l'orologio: `Date.now() - t0 < 1_500` è fallito a 19,9 s nel cancello prima della promozione, col Mac a carico 24. Quale limite scatta lo dice già il messaggio (apertura, non totale); il limite totale ora è di 120 s, così un limite di apertura rotto non si nasconde, e un `timeout` di 30 s sulla prova ferma un blocco. Vista fallire rompendo il limite di apertura nel codice.

## [Non rilasciato] — 2026-10-27 · Next.js 16.4.2 senza leggere `data/` in build (sicurezza)

### Sicurezza

- **Di nuovo Next.js 16.4.2**, per le due RCE non autenticate e il DoS della 16.1.6 (GHSA-673q-mjm6-r5xr, CVE-2026-96889, CVE-2026-94482), stavolta con la build che non tocca i dati.

### Corretto

- **La build non traccia più `data/`.** Il meccanismo, misurato su un'app minima: Turbopack 16.4 fa di ogni `path.join(…)`/`path.resolve(…)` scritto in un modulo un riferimento a file, e con un pezzo fisso e uno variabile (`path.join(TENANTS_DIR, `${codice}.db`)`, ma anche `path.join(os.tmpdir(), `${x}.db`)`) un glob su tutto il progetto; lo stesso fa una chiamata `fs` su un valore misto, come `ambiente || "/var/backups/…"`, un elenco con percorsi assoluti accanto a valori ignoti o il ripiego `|| ""`. I file trovati li legge: per questo la memoria cresceva coi dati e `turbopackIgnore` su `process.cwd()` non bastava (il glob nasce anche da un prefisso ignoto). Correzione: `src/lib/percorsi.ts` con `unisci`/`risolvi`, che passano i pezzi a `path` dagli argomenti di un altro modulo, dove l'analisi non li vede; usate al posto di `path.join`/`path.resolve` in tutto `src/` (51 file, stesso comportamento), più tre valori misti resi opachi (radice delle copie in `backup/engine.ts`, certificato dell'appliance in MeshCentral, `krb5.conf` in Kerberos) e `find-bridge-python.ts`. Misure sul Mac con file finti in `data/tenants` e `data/backups`: prima 441 rotte su 454 tracciavano `data/`, dopo nessuna; picco della build 3,4 GB con 18 GB di dati finti, come senza dati. Su un'app minima: 0,9 GB senza riferimenti, 3,8 GB con 4 GB finti tracciati, e `outputFileTracingExcludes` non cambia niente (toglie i file dall'elenco dopo averli letti).

### Aggiunto

- **Due freni perché non torni.** ESLint vieta `path.join`/`path.resolve` (e `import { join, resolve } from "path"`) in `src/` fuori da `percorsi.ts` e dalle prove. `scripts/controlla-tracciamento.mjs` gira come `postbuild` di `npm run build` (quindi anche in `scripts/update.sh`): se un `.nft.json` elenca file sotto `data/` o `DA_INVENT_DATA_DIR` la build fallisce con le rotte colpevoli, e fallisce anche se non trova niente da guardare. Le forme miste con `fs` non le vede ESLint: le ferma questo controllo, purché nella `data/` di chi costruisce ci sia qualcosa.

## [Non rilasciato] — 2026-10-27 · Next.js torna a 16.1.6 (la build della 16.4.2 non sta in memoria sull'hub)

### Annullato

- **Next.js 16.4.2 → 16.1.6.** Sull'hub (VM 533) la build della 16.4.2 è stata uccisa per memoria esaurita, con 12 GB e poi con 20 GB: Turbopack 16.4 legge i database di `data/` (54 GB fra `tenants/` e `backups/`) attraverso `resolveDataDir()`. Prova sull'hub: la stessa build senza `data/` passa in 1'46" con 3,3 GB di picco; con `data/` montata in sola lettura viene uccisa al limite di 8 GB. `/* turbopackIgnore: true */` sui `path.join(process.cwd(), "data")` toglie `data/backups` ma non `data/tenants` (441 rotte nei `.nft.json`): correzione da studiare fuori produzione. Le falle della 16.1.6 (GHSA-673q-mjm6-r5xr, CVE-2026-96889, CVE-2026-94482) restano aperte finché la 16.4 non si costruisce sull'hub e sulle appliance.

## [Non rilasciato] — 2026-10-27 · Next.js 16.4.2 (sicurezza)

### Sicurezza

- **Next.js 16.1.6 → 16.4.2.** La 16.1.6 era esposta a due esecuzioni di codice da remoto senza autenticazione (avviso di Next.js del 14/10/2026: GHSA-673q-mjm6-r5xr nelle funzioni «use cache», CVE-2026-96889 nell'ottimizzazione delle immagini SVG) e a un DoS dei Server Actions (CVE-2026-94482); corrette dalla 16.4.1, la 16.4.2 è quella già in DA-Vul-can. Solo `next`: `eslint-config-next` resta 16.1.6, perché la 16.4.2 porta `eslint-plugin-react-hooks` 7.1.1 con 14 errori nuovi da sistemare a parte. Lint (0 errori, 72 avvisi come prima), `tsc`, build e 6.150 prove verdi.

## [Non rilasciato] — 2026-10-25 · Schede grandi e visibili (SchedePagina)

### Cambiato

- **Le schede di «Reti dal trunk» ora si vedono.** Le schede `Tabs` di shadcn erano alte 32 px con testo grigio: Riccardo non le trovava («due pulsantini microscopici»). Nuovo mattone `SchedePagina` in `console.tsx`: una colonna per scheda a tutta larghezza, titolo a 16 px, una riga con cosa contiene (allarmi, esposizioni, novità; VLAN e indirizzi), segno ✕ degli allarmi gravi; la scheda scelta ha il fondo navy e la barra ciano. Regola in `docs/STILE-UI.md`: per dividere una pagina si usa `SchedePagina`, non `Tabs`; oltre 4 parti, voci di menu separate.

## [Non rilasciato] — 2026-10-25 · Reti dal trunk in due schede

### Cambiato

- **Reti dal trunk divisa in due schede**, «Sicurezza della rete» (prima, con le tessere Allarmi/Esposizioni e i rilievi) e «VLAN e reti» (tessere VLAN/IP, VLAN, reti, dettaglio, indirizzi). Barra della sonda e stato della lettura restano sopra, comuni. Su richiesta di Riccardo: in una pagina sola era troppo lunga. La scheda sta nell'indirizzo (`#sicurezza`, `#reti`); quella della sicurezza mostra il numero degli allarmi gravi.

## [Non rilasciato] — 2026-10-25 · Reti dal trunk: rilievi di sicurezza dalla sonda passiva, voce nel gruppo Sicurezza

### Aggiunto

- **Pannello «Sicurezza della rete» in Reti dal trunk.** A ogni lettura del sensore (ogni 2 minuti) DA-IPAM confronta quello che la sonda vede sul trunk con inventario, reti e sorgenti DHCP, e tiene i rilievi in `rete_rilievi` (`src/lib/trunk/rilievi.ts`, regole pure e provate). Allarmi: server DHCP non previsto (grave se in una VLAN ce n'è più d'uno), IP conteso da due schede (grave se è il gateway; MAC virtuali VRRP/HSRP esclusi), indirizzo fuori dalla sua rete. Esposizioni: apparati che usano LLMNR/NetBIOS, stesso MAC in più VLAN, switch che si annunciano con CDP/LLDP. Novità: apparati non in inventario (MAC casuali a parte), VLAN che passano sul trunk senza una rete in DA-IPAM. Un rilievo si chiude da solo quando la condizione sparisce; «Prendi in carico» resta. Nessun pacchetto in più in rete: sono gli stessi broadcast, multicast e ARP che il sensore legge già.
- Server DHCP per VLAN (`trunk_vlan.server_dhcp`, da `/vlan`) e vicini CDP/LLDP (`trunk_vicini`, da `/vicini`; dall'edge con DA-Vul-can v0.8.164) copiati nel DB del tenant. Nell'elenco degli indirizzi un segno per i rilievi aperti su quel MAC.
- La colonna `fonte` dei rilievi lascia la porta aperta a una futura sonda con porta specchio.

### Cambiato

- **«Reti dal trunk» passa dal gruppo Network al gruppo Sicurezza** (Riccardo, 25/10), con il numero rosso degli allarmi gravi da prendere in carico. L'indirizzo della pagina resta `/arp-table/trunk`. Le tessere in alto mostrano prima allarmi ed esposizioni.

## [Non rilasciato] — 2026-10-24 · Configurazione iniziale: rete dell'appliance proposta e passi a schede

### Aggiunto

- **La prima subnet parte dalla rete dell'appliance.** Il wizard legge interfacce, rotta predefinita e `resolv.conf` della macchina (`src/lib/onboarding/rete-appliance.ts`, puro e provato) e riempie CIDR, gateway e DNS della prima subnet, il DNS predefinito e, se c'è un dominio di ricerca, dominio e Base DN di Active Directory. Sceglie l'interfaccia di `APPLIANCE_LAN_IP`, poi quella della rotta predefinita; Docker, NetBird (`wt0`), WireGuard e link-local esclusi. Solo proposte: si scrive con «Crea rete», e una rete o un DNS già salvati non si toccano. Nel passo Router un pulsante offre il gateway come router (non precompilato: senza credenziale fermerebbe «Avanti»).
- **Passi a schede.** In testa al wizard le cinque schede (Credenziali, Router, DNS, Active Directory, Subnet) con la spunta su ciò che è già salvato; si salta a qualunque passo. Lasciando un passo i suoi dati si salvano: andando avanti un errore ferma, andando indietro si va comunque con un avviso. «Crea rete» salva comunque router, DNS e AD prima di creare la rete.

## [Non rilasciato] — 2026-10-23 · da-vault: archivio a slot, «Mostra password», KeePass, OpenBao per l'hub (tutto spento di serie)

### Aggiunto

- **Archivio locale a slot (appliance dei clienti, `DA_VAULT_LOCALE=1`, spento di serie).** Oggi le credenziali sono cifrate con `ENCRYPTION_KEY`, che sta in `.env.local` accanto ai dati: chi ha il disco ha tutto. Con l'interruttore acceso la chiave dei dati è casuale ed esiste solo dentro gli slot age: passphrase del cliente, chiave Domarc (recupero, D3/D5), TPM della macchina (si sblocca da sola all'avvio). Ogni `encrypt()` dell'app passa da lì, senza toccare i chiamanti (ADR 0034). Senza TPM l'archivio resta **bloccato**: banner in testa alle pagine, scansioni in pausa col motivo, sblocco con la passphrase in **Impostazioni › Vault**.
- **Ricifra** (`scripts/da-vault.ts ricifra`): dalla chiave di `ENCRYPTION_KEY` a quella degli slot, a vuoto di serie, `--applica` esplicito; tutto o niente per database, verificata col lettore unico delle credenziali, poi `VACUUM`. Ripetibile; dopo un crash ogni valore resta leggibile.
- **«Mostra password»** nella pagina Credenziali (D2): solo admin, con la **verifica in due passaggi dell'utente collegato** (ADR 0023), non con la passphrase del cliente; vale 5 minuti. Ogni visualizzazione va nel registro con utente e ora, e il cliente lo legge in Impostazioni › Vault («Chi ha visto cosa»).
- **«Esporta in KeePass»**: un file KDBX 4 (Argon2id) con tutte le credenziali, che si apre con la passphrase del cliente più un key file tenuto nell'archivio. È l'indipendenza del cliente da Domarc, senza un secondo archivio vivo.
- **`scripts/da-vault-recover.ts`** (reset-password, export-keyfile, rotate) con la chiave privata Domarc **solo dallo stdin**, un ticket obbligatorio e una riga per uso in `recuperi.jsonl`.
- **OpenBao per l'hub (`DA_VAULT_OPENBAO=1`, spento di serie).** Libreria `src/lib/vault` (interfaccia `SecretStore`, backend `openbao` con solo `fetch`, AppRole, token di 20 minuti, cache a tempo, `X-Domarc-Utente` per le letture per conto di una persona). Colonna `credentials.credential_ref`: con l'interruttore acceso le credenziali dei device si leggono da OpenBao; OpenBao giù oltre la cache = scansioni in pausa e letture rifiutate, mai un ripiego sulla colonna. `scripts/da-vault-migra-openbao.ts` (a vuoto di serie, `--applica`, `--verifica`) con doppia lettura per una versione.
- Col vault acceso il backup notturno copia anche l'archivio (slot già cifrati): un ripristino dei database ricifrati ha gli slot che li aprono.

### Corretto dopo la revisione (23/10)

- `/api/health` col vault bloccato risponde **200 «degraded»** (503 solo con `?strict=1`): `update.sh` e `auto-update.sh` aspettano un 200 dopo il riavvio e prima tornavano a una build che non legge i valori ricifrati.
- Ricifra: con `--applica` checkpoint e `VACUUM` si fanno **sempre** (un crash fra COMMIT e VACUUM lasciava i valori vecchi nelle pagine libere); una cartella dati senza `hub.db` è un errore e la cartella usata si stampa; `ricifra --inversa` (dalla chiave degli slot a `ENCRYPTION_KEY`); dopo `--applica` il CLI elenca i backup rimasti con la chiave vecchia e propone `--purga-backup` (a vuoto di serie).
- `age-encryption` si carica solo dentro le funzioni che lo usano: l'avvio dell'app non lo raggiunge più a interruttori spenti (su Node 20.x vecchi non partiva).
- OpenBao: un `credential_ref` malformato salta quella voce con un avviso (cliente e voce) invece di fermare la cache; `X-Domarc-Utente` percent-encoded con l'id; credenziale eliminata = cancellati i metadata del percorso (se OpenBao non risponde, avviso e `--verifica` elenca gli orfani).
- Passphrase: limite di tentativi **per utente**, condiviso fra sblocco e KeePass, e tetto alle derivazioni scrypt in corso (429); spazi ai bordi rifiutati sia da `crea` sia dal recupero.
- `crea --senza-domarc` vuole `--richiesta-cliente` e la scrive nell'archivio e in `recuperi.jsonl`; i registri dei recuperi scrivono l'intento prima e l'esito dopo. «Chi ha visto cosa» solo agli admin. All'avvio il vault parte prima delle altre inizializzazioni.
- OpenBao: un riferimento nuovo non ancora in cache (dopo `--applica` ad app accesa) fa partire **un** giro (uno alla volta, al più ogni 30 s) e la lettura dopo lo trova, senza aspettare i 5 minuti; il file del secret_id mancante o illeggibile dà `ErroreVault(configurazione)` con messaggio controllato, senza il percorso grezzo.

### Perché così

- Interruttori nel file dell'appliance e non in Opzioni: ogni push su `dev` arriva a tutte le installazioni, e il vault si accende un'appliance alla volta, dopo aver creato l'archivio, con un riavvio (piano, «Rischi»).
- I segreti della 2FA restano sulla chiave d'installazione: col vault bloccato un admin deve poter entrare a sbloccarlo (ADR 0034).
- Stesso formato dei valori cifrati: la chiave la dice GCM, così i controlli «è già cifrato?» sparsi nell'app non cifrano due volte.

### Interruttori spenti

- Nessun cambiamento di comportamento: provato contro una copia del `crypto.ts` di prima, con i job che girano, senza banner, senza «Mostra», col backup di sempre. Cambia solo lo schema (additivo): `credentials.credential_ref` e la tabella `vault_visualizzazioni`.

## [0.9.896] — 2026-10-23 · Abbinamenti: asset con lo stesso nome

### Cambiato

- **Se in inventario c'è già un asset col nome del PC, la riga chiede «Collega a n. X» o «Crea nuovo»** e non si conferma senza scelta. Alla prima conferma vera NB-AGUZZOLI è finito con due asset: il n. 31, stesso nome ma legato all'IP passato a un iPhone, e il n. 36 nuovo. «Collega» sposta l'asset sull'host del PC, toglie il legame vecchio con l'apparato e scrive ogni campo cambiato nel diario. Il controllo è sul nome del PC, non sulla persona: più asset per persona restano normali.

## [0.9.895] — 2026-10-23 · Abbinamenti: chi usa i PC → asset e assegnatari

### Aggiunto

- **Inventario › Abbinamenti.** Prima la proposta si vedeva solo aprendo un asset alla volta, e i PC non ancora in inventario non comparivano da nessuna parte. Ora una pagina elenca tutti gli host con accessi, divisi in proposti, da rivedere (assegnati a un altro), già abbinati, pochi dati ed esclusi (server, apparati, condivisi, col perché). La conferma, a spunte, crea l'assegnatario da AD e l'asset se mancano e assegna, in una transazione che ricalcola ogni voce; i «da rivedere» non sono mai spuntati di serie. La categoria dell'asset nuovo viene dalla classificazione dell'host (workstation → Desktop, notebook → Laptop); quando non basta si sceglie nella riga. La pagina Assegnatari rimanda qui («N PC hanno un utente prevalente da abbinare»).

## [0.9.892 – 0.9.894] — 2026-10-23 · Assegnatari NIS2 da Active Directory e utente prevalente dei PC

### Aggiunto

- **«Importa da Active Directory» nella pagina Assegnatari.** Prima ogni assegnatario si scriveva a mano. Ora l'anteprima propone le persone di AD (abilitate, con nome e cognome, accesso recente, niente account di servizio o amministrativi), dice per ognuna se è nuova, da aggiornare, da controllare (manca il cognome o la mail, omonimo) o invariata, e mostra i PC dove si collega; si importa a spunte. L'assegnatario resta legato all'utente per objectGUID: a ogni lettura di AD riprende nome, mail, reparto e ruolo, e se l'utente viene disattivato la pagina avvisa che i suoi asset vanno riassegnati. **L'importazione non tocca gli asset.**
- **Chi si collega ai PC.** Un giro orario (spento di serie, si accende per istanza in Opzioni › «Chi si collega ai PC», ed è in Schedulazioni) conta gli accessi 4624 da Wazuh: alla tastiera dall'agente sul PC, di rete dai server per nome della postazione; in più l'utente collegato letto da WinRM e quello dell'agente GLPI. Gli accessi si tengono 90 giorni.
- **Assegnatario proposto sulla scheda dell'asset.** Si propone chi fa più della metà degli accessi di persone al PC negli ultimi 30 giorni, con almeno 5 accessi (soglie in Opzioni › Parametri). Accanto la tabella di chi si è collegato, con il perché di chi non conta. Si scrive solo col clic («Accetta», «PC condiviso, non proporre»), con la riga nel diario dell'asset; un'assegnazione fatta a mano non si sostituisce mai: se si collega soprattutto un altro, lo dice in grigio.

### Perché così

- Solo proposte con conferma e soglia «più della metà»: decisione di Riccardo del 23/10. La misura sul Wazuh dell'hub (707 mila accessi in 30 giorni) ha mostrato postazioni con centinaia di migliaia di accessi di un solo account e proposte appoggiate su pochi accessi: da qui il minimo di 5 e il conteggio delle sole persone di AD.
- Il giro non è un tipo nuovo di job: il CHECK su `scheduled_jobs.job_type` avrebbe voluto ricostruire la tabella. È un timer di `server.ts`, come i dati sugli exploit.
- L'host dell'asset si prende anche dall'apparato collegato (0.9.893): sull'hub 32 asset su 34 avevano solo quello.

## [Non rilasciato] — 2026-10-23 · «Esci» che chiude davvero, istanza controllata e ricordata, «cliente» diventa «istanza»

### Corretto

- **«Esci» non chiudeva la sessione** (ADR 0033). Le richieste della dashboard partite un attimo prima dell'uscita tornavano dopo e rimettevano il cookie, perché il JWT si rinnova a ogni risposta: tornando su `/` si era ancora dentro. Ora l'uscita segna l'ora sull'utente (`users.sessioni_valide_da`) e un token nato da un accesso precedente non vale più, da qualunque richiesta arrivi. «Esci» chiude la sessione su tutti i browser dell'utente.
- **Il cambio d'istanza accettava qualsiasi codice dal browser.** Un utente con la sola istanza A poteva chiedere B o la vista «tutte». Ora passa solo verso istanze dell'utente (lette dal DB) e «tutte» solo per il superadmin; un rifiuto lascia l'istanza di prima e lo dice a schermo.

### Cambiato

- **L'hub riparte dall'ultima istanza usata** (`users.ultima_istanza`), se l'accesso c'è ancora; chi non ne ha mai scelta una entra come prima (superadmin nella vista «tutte»).
- **La scelta dell'istanza è in Impostazioni → Istanza** (Riccardo, 23/10), visibile solo con più istanze. Nella barra resta una riga da leggere sotto l'utente («Domarc Srl · 70791»), che porta lì. «Cliente» diventa «istanza» nella scelta, in «Dati istanza», «Config istanza» e nella pagina «Istanze» (prima «Clienti»).

## [Non rilasciato] — 2026-10-23 · Scansione veloce, soglie della pulizia e MDM da Opzioni; «Esegui ora» in Schedulazioni

### Cambiato

- **I tre numeri della scansione veloce si cambiano da Opzioni** (proposta approvata da Riccardo il 23/10): host in
  parallelo, attesa per host e tempo massimo di Nmap. Ordine: Opzioni › riga del file `.env.local` › di serie, sempre
  nei limiti di prima (1-24 host, 5-20 s, 10-90 s). Chiavi nuove `scansione_veloce.*`: le `quick_scan_*` salvate dalla
  vecchia scheda e mai lette restano ignorate, perché un valore dimenticato non cambi il ritmo delle scansioni al rilascio.
- **Soglie della pulizia degli host e limite di errori di MDM per cliente, da Opzioni**: assenza prima dell'archivio
  (di serie 60 giorni) e archivio prima della cancellazione (di serie 90), da 30 a 365 giorni (il minimo è voluto: la
  pulizia cancella righe); errori di fila prima che MDM si spenga da sola (di serie 5, da 1 a 20). Le leggono la
  pulizia notturna, l'anteprima di Impostazioni › Sistema e la sincronizzazione di MDM.

### Aggiunto

- **«Esegui ora» sulle righe dei job in Schedulazioni**, con la stessa rotta della pagina dei job. Non c'è sulla pulizia
  degli host, che gira solo di notte, né sui timer dell'appliance.

## [Non rilasciato] — 2026-10-23 · Opzioni con parametri e soglie, voce «Schedulazioni» nel menu

### Aggiunto

- **Opzioni: gruppo «Parametri e soglie»** (tavola del 22/10, oggetti 14-20, approvata da Riccardo il 23/10). Riccardo:
  «raccogliere tutti i parametri che sono opzioni e inserirli tutti nel menu». Porte TCP e percorso di Naabu della
  scansione veloce, livello, categorie e riepilogo delle notifiche, conservazione degli eventi di sicurezza si cambiano
  da Opzioni, con i limiti delle rotte di prima, «chi l'ha cambiato» e «Torna a …». Col lucchetto, in sola lettura, i
  valori che da lì non si cambiano: i tre numeri della scansione veloce (valgono quelli del file dell'appliance), le
  soglie della pulizia degli host (60 e 90 giorni) e il limite di errori di MDM. La prova di completezza legge le chiavi
  dai sorgenti di scanner, notifiche e moduli: un parametro nuovo che non entra in Opzioni né in `fuori-catalogo.ts` la
  fa fallire. Le schede Scansione, Notifiche e Alert sicurezza mostrano il riepilogo con «cambia da Opzioni ›».
- **Voce «Schedulazioni» nel menu** (`/settings/schedulazioni`, oggetti 21-30): tutto ciò che parte da solo era in sei
  posti (job del cliente, job per rete, controller, scansioni Edge per rete, timer dell'appliance, MDM). Ora un elenco
  unico ordinato per prossimo giro, con su cosa, quando, ultimo esito (anche i fallimenti in serie dello scheduler) e
  «Dove ›» verso la pagina che la configura; si accende e si spegne da qui (i job di serie passano da Opzioni, con la
  lapide); Edge e timer dicono dove si cambiano. Una prova fa fallire un tipo di job o un timer di `server.ts` nuovi
  che non compaiono.

### Corretto

- **Scansione veloce: tre numeri che la scheda salvava ma nessuno leggeva.** «Host paralleli», «Timeout per host» e
  «Limite exec Nmap» finivano nel database, mentre lo scanner usa solo `DA_INVENT_NMAP_DISCOVERY_*` del file (di serie
  12, 10 s, 22 s): la scheda mostrava valori che non contavano. Ora Opzioni dice il valore vero e dove si cambia.
## [Non rilasciato] — 2026-10-23 · Barra laterale compatta, «Cambia password» che si apre, URL dell'hub in Impostazioni

### Corretto

- **«Esci» portava a una pagina vuota** (Riccardo, 23/10). Auth.js costruisce l'indirizzo di ritorno dal nome su cui ascolta il server: sull'hub `/api/auth/signout` rispondeva `https://0.0.0.0/login`. Ora l'uscita non chiede il ritorno al server e il browser va su `/login` da solo. «Esci» è passato nel menu dell'utente.
- **«Cambia password» nel menu dell'utente non apriva niente** (segnalato a Riccardo il 23/10). La voce usava `onSelect`, che è di Radix: i menu di DA-IPAM sono Base UI, che risponde a `onClick`. Il clic chiudeva il menu e la finestra non compariva. Rotta e database erano giusti.

### Cambiato

- **Barra laterale: tutto in alto, niente blocco in fondo** (tavola approvata da Riccardo il 23/10, variante «tutto in alto»). Testata in una riga (logo alto 24 px invece di 56, «DA-IPAM», pulsante «Comprimi menu» col bordo perché si veda) e sotto l'utente con «Esci» a un clic. Il tema scuro/chiaro è una voce del menu dell'utente. Il piede con tema, comprimi, utente ed esci (≈200 px) non c'è più: la lista arriva fino in fondo. A menu compresso, in cima c'è solo il simbolo Domarc (la freccia cian, `public/simbolo-domarc.png` da DA-Template): il logo intero ridotto a 44 px non si leggeva.
- **«URL dell'hub» è in Impostazioni → Sistema** (Riccardo: «quasi inutile nel menu»). `/agents` resta e rimanda lì; il Launchpad punta direttamente alla nuova posizione.

## [Non rilasciato] — 2026-10-23 · LibreNMS nell'interfaccia (esclusione, candidati, aggiunta in blocco) e VLAN degli switch MikroTik via SSH

### Aggiunto

- **LibreNMS nell'interfaccia** (tavola `docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html`, approvata da Riccardo il 23/10). Nella scheda di un oggetto che non è in LibreNMS, la riga «Dati da» dice lo stato dell'aggiunta automatica: in coda (SNMP verificato), rifiutato col motivo, escluso. Accanto c'è «Non aggiungere a LibreNMS» / «Togli l'esclusione» (solo admin); «Aggiungi a LibreNMS» resta, perché l'esclusione ferma solo il giro automatico. Nella pagina del modulo ci sono le liste «Con SNMP verificato» (con «Escludi») ed «Esclusi» (con «Togli»), e il riepilogo dell'ultimo giro conta i candidati aggiunti.
- **Discovery: «Aggiungi a LibreNMS (N)» sugli host selezionati.** Usa la stessa rotta di una sola aggiunta, un oggetto alla volta, mai forzata. La finestra mostra l'esito riga per riga (aggiunto, già presente e aggiornato, rifiutato col motivo, senza SNMP) e ha «Ferma dopo questo». Prima si aggiungeva solo dal menu di ogni riga.
- **VLAN degli switch MikroTik letti in SSH nella matrice** (punto 5 del giro, strada scelta da Riccardo il 23/10). RouterOS non dà le VLAN del bridge via SNMP: i sei CORE di 70151 ne mostravano 0. Uno switch MikroTik in SSH ora legge `/interface bridge vlan` e `/interface bridge port` (due comandi in sola lettura) e li scrive nelle tabelle VLAN della scheda degli switch: porte per nome tradotte negli ifIndex della tabella delle porte (letta in SNMP accanto all'SSH), PVID dalle porte del bridge, fonte «mikrotik». Vale con lo stesso interruttore, la stessa cadenza oraria e lo stesso lucchetto della lettura VLAN degli switch, nel giro, in «Interroga» e nel job degli apparati scelti (che ora offre la «VLAN» anche a questi switch). Prima la lettura delle VLAN di bridge c'era solo per i router, e gli switch MikroTik in SSH erano esclusi dalla lettura VLAN.

## [Non rilasciato] — 2026-10-23 · Switch e router con SSH e SNMP, LibreNMS su tutti gli oggetti SNMP, matrice VLAN leggibile

### Aggiunto

- **LibreNMS: aggiunta automatica estesa a tutti gli oggetti con SNMP verificato** (Riccardo, 22/10). Prima i candidati erano solo i vicini LLDP che LibreNMS vede ma non interroga: sulla sede 70151 nessuno, mentre 76 oggetti avevano una SNMP validata. Ora il giro (5 per giro, rifiutati riprovati dopo 24 ore, mai `force_add`, senza SNMP mai) prende anche gli apparati con un binding SNMP riuscito o con la SNMP validata sul loro host, e gli host senza apparato con la SNMP validata. «SNMP verificato» comprende la credenziale validata sull'host perché sulla stessa sede solo 4 apparati su 16 avevano il binding «riuscito»: gli altri erano «non provati» ma letti in SNMP ogni ora. Gli oggetti SNMP si aggiungono solo se la fotografia degli apparati di LibreNMS è stata letta in quel giro (senza, non si sa chi c'è già e si aggiungerebbero doppi).
- **Esclusione per oggetto «Non aggiungere a LibreNMS»**: tabella `librenms_esclusione` (migrazione `librenms_esclusione_v21`, additiva) e rotta `POST/DELETE /api/hosts/[id]/librenms/esclusione` (admin). Vale solo per il giro automatico. L'elenco degli esclusi e dei candidati SNMP è nella risposta dei candidati; lo stato (SNMP verificato, escluso, ultimo rifiuto) nei dati LibreNMS della scheda. L'interfaccia arriva dopo l'ok sulla tavola.

### Cambiato

- **Proposta di un apparato: switch e router con SSH principale e SNMP accanto** (Riccardo, 22/10: «somma le due acquisizioni; SSH principale se c'è ed è meglio»). Con l'SNMP dedotto come protocollo la finestra non proponeva mai l'SSH, anche con una credenziale SSH validata. Ora, per switch e router di piattaforme che si leggono di preferenza in SSH (MikroTik, HP, Cisco, Omada, Stormshield), una SSH validata diventa la credenziale principale e la SNMP validata va in «SNMP aggiuntivo». Ubiquiti resta SNMP. Gli apparati già creati non cambiano.
- **LibreNMS: un host senza community nei dati SNMP usa la credenziale SNMP validata sull'host** (anche v3) invece di finire in «senza SNMP».

### Corretto

- **Matrice VLAN: intestazione e colonne Porta/Stato/PVID fisse, altezza limitata.** Con 24 VLAN e 50 porte la tabella era alta ~2500 px e la barra orizzontale stava in fondo, fuori vista: le colonne a destra sembravano tagliate. Ora la tabella scorre in un riquadro alto al più il 70% dello schermo, con la barra in vista. Resa verificata a 1280 e 1920 con dati finti.

## [Non rilasciato] — 2026-10-22 · Comware: VLAN e porte taggate dal collector via SSH

### Aggiunto

- **Le VLAN lette dal collector vanno nella matrice della scheda.** Sui Comware IRF (sede 70151) l'SNMP risponde *tooBig* anche a una sola riga delle liste di porte Q-BRIDGE: una riga è più grande del pacchetto massimo dello switch, quindi nessun modo di chiederla via SNMP la fa arrivare. Il collector `hp-comware` le legge via SSH (`display vlan all`); l'acquisizione ora le scrive nelle tabelle VLAN della scheda (VLAN coi nomi, porte taggate e non taggate per ifIndex, PVID, fonte «collector»), solo da una sezione `ok` e solo se cambiano. Il riquadro dell'acquisizione registra la riga «VLAN».

### Corretto

- **SSH verso firmware vecchi.** HP5700-Storage (Comware 7.1.045 R2422P02, 70151) offre solo cifrature CBC: il client dell'app proponeva solo GCM/CTR/ChaCha e l'SSH falliva con la credenziale giusta. AES-CBC ora sta in fondo all'elenco delle cifrature (si usa solo se l'apparato non offre altro); 3DES e DES restano fuori.
- **Comware: l'acquisizione dall'app con i tempi del collaudo.** L'app chiedeva al collector 4 s per comando e 90 s in tutto (valori di serie); su uno stack IRF `display interface brief` supera i 4 s, il giro si fermava lì e `display vlan all` non partiva (70151, 22/10). Il descrittore del collector porta ora i suoi limiti: Comware 15 s per comando, 240 s in tutto (sotto i 5 minuti del lucchetto del job sugli apparati scelti).
- **La lettura SNMP oraria non cancella più le VLAN del collector.** Sui Comware la lettura riusciva solo per PVID e mappa del bridge e scriveva una fotografia con zero VLAN: ora una lettura senza tabelle VLAN lascia la fotografia del collector; una lettura con le tabelle vere la sostituisce come prima.

## [Non rilasciato] — 2026-10-22 · Vulnerabilità per host ed exploit noti

### Aggiunto

- **Vista «Per host» nella pagina Vulnerabilità** (Riccardo, 22/10). Oltre all'elenco per CVE si poteva vedere quali vulnerabilità ha un PC solo aprendo la sua scheda, una alla volta. Ora un selettore «Per vulnerabilità | Per host» (anche `?vista=host`) mostra una riga per host, o per IP senza match nell'inventario, con i conteggi per severità. Una CVE trovata su più porte dello stesso host conta una volta. La riga si apre su tutte le vulnerabilità dell'host, le sfruttate in cima (200 alla volta: un PC Windows con Wazuh ne ha 4.420 sul cliente A). La ricerca, in entrambe le viste, trova anche per IP e nome dell'host.
- **Exploit noti per ogni vulnerabilità.** CVSS e severità non dicono se qualcuno sta già usando la falla. Tre feed pubblici, scaricati ogni mattina alle 06:00 (e all'avvio se mancano o hanno più di 26 ore): **CISA KEV** («Sfruttata», badge scuro pieno col triangolo; «R» se è usata dai ransomware), **Exploit-DB** («Exploit pubblico», badge chiaro bordato col quadrato) ed **EPSS** (probabilità di sfruttamento a 30 giorni). Badge distinti per luminanza e forma. Ci sono il filtro «Sfruttate / Con exploit pubblico», l'ordinamento per exploit, le colonne anche nella scheda dell'host, lo stato dei feed sotto i filtri e «Aggiorna ora» per gli admin. Sul cliente A (22/10): 94 vulnerabilità sfruttate su 13.588, su 25 host su 231.
- **Levetta «Dati sugli exploit» in Opzioni**, accesa di default per decisione di Riccardo: è una sola lettura da fonti pubbliche, non tocca apparati né dati dei clienti.

### Note

- I feed stanno in `exploit-intel.db` nella cartella dati, non in `hub.db`. Sono ~17 MB pubblici e riscaricabili, e non devono finire nei backup dell'hub: cancellare il file non perde niente.
- Una fonte che non risponde, o che manda un file vuoto o dimezzato, non cancella i dati del giorno prima. L'errore compare sotto i filtri e in Opzioni.

## [Non rilasciato] — 2026-10-22 · Comware: VLAN via SNMP e profilo giusto dal sysDescr

### Corretto

- **VLAN e porte taggate dei Comware via SNMP.** Gli switch Comware IRF (sede 70151) rispondono *tooBig* al GETBULK di 20 righe sulle tabelle Q-BRIDGE, perché le liste di porte sono lunghe: delle 7 walk della lettura VLAN ne riuscivano 2 (PVID e mappa del bridge), quindi 0 VLAN e nessuna porta taggata. Il lettore comune (`walkConSessioneSua`) dopo un *tooBig* rifà la walk da capo a 5 righe per richiesta, poi a 1; se fallisce anche così resta il rifiuto `SNMP_STATO_1`, mai una tabella vuota.
- **Profilo HP corretto dal sysDescr.** Cinque Comware creati in blocco col profilo di serie ProCurve non ricevevano mai comandi né collector Comware, anche se il sysDescr letto diceva «HPE Comware Platform Software». La lettura delle informazioni ora corregge profilo e sottotipo in Comware (o in ProCurve, se il sysDescr dice ProCurve/Aruba su un apparato registrato Comware; AOS-CX non si tocca) e lo scrive nel registro della lettura.

## [Non rilasciato] — 2026-10-21 · Un elenco solo dei MAC virtuali

### Corretto
- La mappa riconosceva come virtuali solo VRRP e HSRP v1, mentre gli apparati fisici conoscevano anche HSRPv2 e HSRP IPv6: due elenchi diversi in `topology/identity.ts` e `devices/physical-device-db.ts`. Un MAC HSRPv2 o GLBP visto su due router poteva fondere due apparati nella mappa, e la forma a punti Cisco (`0000.0c9f.f001`) non veniva letta. Ora c'è un elenco solo, `devices/mac-virtuali.ts` (VRRP v4/v6, HSRP v1/v2/IPv6, GLBP), usato da entrambi. Misura sui DB dell'hub (21/10): 0 MAC cambiano esito su oltre 13 milioni letti.

## [Non rilasciato] — 2026-10-22 · QNAP via SNMP con gli OID giusti, Proxmox alla parità sui dati

### Corretto

- **QNAP: il firmware non è più la memoria.** Gli OID `…24681.1.2.1/.2/.3` sono CPU %, memoria totale e libera, non modello/firmware/seriale (un QNAP mostrava firmware «15979.0 MB»). Collector e profilo SNMP storico `qnap` (seed, righe `builtin` già nell'hub) usano gli OID del walk; il firmware via SNMP resta assente. Un valore con unità (MB, %, C, rpm) non è mai modello, firmware o seriale.

### Aggiunto

- **Collector `proxmox-ve`**: dati hardware dei nodi (CPU, kernel, disco root, seriale, produttore, modello, stato abbonamento — mai la chiave) e IP delle VM dall'agent QEMU, con tre forme di `pvesh get` per nodo/VM nell'allowlist. Proiezione verso `last_proxmox_scan_result` e inventario solo per gli snapshot del collector. Resta fuori dal pulsante.

## [Non rilasciato] — 2026-10-22 · Pagina Opzioni e job di serie

Piano `docs/superpowers/plans/2026-10-22-pagina-opzioni.md`, ADR 0032.

### Aggiunto

- **Pagina `/settings/opzioni`**: ogni funzione che si accende o si spegne in un posto solo, con stato, valore di serie, chi
  l'ha cambiata, esito e ritmo. Perché: il 22/10 c'erano 34 interruttori in 13 pagine con valori di serie opposti, e su
  70151 i dati mancavano senza che nessuna pagina lo dicesse.
- **Quattro job di serie** (giro ARP 30 min, hypervisor ogni notte, DNS ogni giorno, scansione veloce ogni 12 ore per
  rete) creati all'avvio se mancano; uno spento o cancellato da un admin lascia la lapide e non rinasce. Perché: su 70151
  nessun job leggeva gli apparati, si creavano a mano.

### Cambiato

- Le levette delle altre pagine sono diventate rimandi a Opzioni; restano nelle schede i dati da inserire. Installa e
  disinstalla dei moduli in `lib/modules/installa.ts`, usato dalla rotta e da Opzioni. MeshCentral si installa ancora solo
  dalla sua scheda (l'assistente crea il server).

## [Non rilasciato] — 2026-10-22 · Letture degli apparati accese di serie

### Cambiato

- **Le sei letture in più degli apparati partono accese** (ADR 0031): VLAN, DNS e utenti dei MikroTik, spanning tree e
  bridge dei MikroTik, VLAN degli switch via SNMP, LLDP via SNMP, campi del controller, LLDP degli hypervisor. Una chiave
  assente vale «accesa»; si spengono solo da «Dati della mappa», cliente per cliente. Perché: sull'appliance di 70151 il
  router era leggibile ma la scheda non aveva le VLAN, perché la lettura nasceva spenta e andava accesa a mano, appliance
  per appliance. La mappa nuova resta spenta di serie.

## [Non rilasciato] — 2026-10-22 · Invio di AD Health e inventario a DA-Vul-can (v0.9.869-871)

Piano `docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md` (A-IPAM della spec DA-Vul-can del 21/10).

### Aggiunto

- **Invio automatico all'hub DA-Vul-can** (`src/lib/vulcan/`): l'export di ogni esecuzione AD Health riuscita, una
  fotografia dell'inventario al giorno (03:00 italiane) e un battito ogni 15 minuti, con una coda nel DB del cliente
  (`vulcan_coda`, segno `vulcan_coda_v21`) che ritenta col backoff della sonda e si ferma da sola su un gettone
  rifiutato. Perché: oggi l'AD arriva all'hub solo a mano (download qui, «Carica» là), e l'hub non sapeva se
  un'istanza è viva né cosa contiene la sua rete. Il download resta come ripiego.
- **Spento senza `VULCAN_TOKEN`** in `/etc/dalink/oggetto.env`: nessuna rete, nessuna riga, nessun audit. Perché: le
  chiavi le scrive DA-Link (A-Link) e la rete la apre la policy NetBird P9; finché non ci sono, il rilascio non
  cambia niente sulle appliance.
- **Inventario a lista bianca**: colonne scelte una per una; non escono mai credenziali, community SNMP, `snmp_data`,
  `detection_json`, utenti, note, assegnatari, licenze (prova sentinella). Perché: i dati del cliente escono dalla
  sua rete e devono essere solo quelli che servono all'analisi.
- **TLS verificato normale** (niente pin, mai `rejectUnauthorized: false`), gettone solo nell'intestazione, niente
  redirect, risposta letta fino a 64 KB. Perché: l'hub ha un certificato pubblico valido, e il gettone vale come una
  password.
- **Riquadro in «Cosa esce»** (stato, coda, ultimo battito, ultimo AD e inventario, ultimo errore, «Invia ora» solo
  admin) e riga nella pagina AD. Perché: un invio che non si vede nell'interfaccia non si sa se esiste.
- Collaudo del 22/10 contro DA-Vul-can locale (worktree di `origin/HEAD`, DB vuoto, TLS con una CA di prova solo per
  il processo di collaudo): 503 con `ipam.ingest` spento → riga in coda da ritentare; acceso → AD 201 (report 1),
  battito 200, inventario 201 (351 oggetti); stesso run reinviato → 200 doppione, una riga sola sull'hub; gettone
  sbagliato → 401 e «sospeso», tolto da solo col gettone giusto; fonte revocata → 403 e «sospeso».

## [Non rilasciato] — 2026-10-22 · Collector: uno per famiglia, agganciati al pulsante

### Cambiato

- **Un collector per famiglia.** QNAP NAS, MikroTik e Synology (rinominato `synology-dsm`) usano il motore d'inventario collaudato su apparati veri; dal collector scritto senza apparati si sono tenuti firmware QNAP vero, condivisioni e pacchetti dei NAS, velocità/PoE/FDB/STP di MikroTik. Perché: due versioni dello stesso collector erano un doppione, e quella collaudata è l'unica che ha letto un apparato.
- **Porte da switch solo a switch e router.** NAS, server, hypervisor, controller e access point non ricevono più `switch_ports` dalla proiezione.
- **Il pulsante «Aggiorna» e la scansione dei router da Reti** usano il collector per QNAP NAS, Synology, MikroTik, Ubiquiti e Proxmox quando l'interruttore dell'acquisizione modulare è acceso (spento di default: nessun cambiamento).
- Corretto: vicini e bond MikroTik letti da un'uscita illeggibile non sono più dati per «letti, lista vuota».

## [Non rilasciato] — 2026-10-22 · Un apparato, una riga; matrice VLAN degli switch

Piano `docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md` (decisioni di Riccardo del 22/10).

### Aggiunto

- **Discovery: un apparato fisico, una riga.** Gli IP dello stesso cluster fisico si accorpano sotto la riga
  principale (l'IP dell'apparato gestito, altrimenti quello scelto con «Scegli come principale», altrimenti il più
  basso) con «+N IP» che apre gli altri. Perché: un router con sette IP occupava sette righe, ognuna con la sua
  scheda, e contatori e filtri contavano sette apparati. Con due apparati nello stesso cluster non si accorpa niente.
- **Ogni filtro guarda anche gli IP accorpati** (stato, classificazione, CVE, ricerca su IP, nome e MAC): la riga
  principale compare con «↳ corrisponde <IP> (IP secondario)». Perché: nella prima stesura i filtri scartavano le
  righe prima dell'accorpamento, e un problema solo su un IP secondario (CVE critiche, un IP giù) spariva dalla lista.
  Il CSV ha in fondo la colonna «Altri IP» (ip · rete), che senza righe proprie altrimenti si perdevano.
- **Matrice porte × VLAN degli switch** (Q-BRIDGE-MIB via SNMP, qualunque marca): tabelle `switch_vlan*` per
  apparato, lettura `switch_vlan` nata **spenta** (ADR 0018), tab VLAN della scheda switch con la striscia
  (VLAN, trunk, access, senza VLAN) e la stessa matrice dei MikroTik, estratta in un componente condiviso. Perché:
  per gli switch si vedeva solo il PVID per porta, non quali VLAN passano taggate.
- **VLAN native dal controller UniFi** (Task 13, ok di Riccardo del 22/10): la lista bianca del client UniFi ammette
  `GET rest/networkconf` (unico `rest/`, solo GET, senza id); con la lettura `switch_vlan` accesa la sync UniFi che
  già gira legge anche le reti nella stessa sessione e scrive la VLAN nativa per porta (`native_networkconf_id`) in
  `switch_vlan_nativa` (segno `switch_vlan_nativa_v21`). La matrice usa la nativa solo dove l'SNMP non dichiara gli
  untagged; un untagged dichiarato vince sempre. Perché: la ProMax non dichiara gli untagged e la U era dedotta dal
  PVID. Misurato sull'hub: sui 4 switch che li dichiarano, nativa del controller = PVID SNMP su 99 porte su 99.
  La lista bianca passa da «niente `rest/`» a **solo** `GET rest/networkconf` (ogni altro `rest/`, con id o query, e ogni
  metodo diverso da GET restano rifiutati), con l'ok di Riccardo. Sulla ProMax la lettura SNMP e il controller non
  tornano (PVID diverso su 6 porte su 14): la riga delle fonti mostra «▲ nativa N (controller)» accanto al PVID.
- **Scansione automatica dei device scelti** (Riccardo, 22/10): dalla Discovery si scelgono gli apparati e un nuovo tipo
  di job `apparati_scelti` li rilegge da solo (ogni ora, ogni 4 ore o ogni giorno all'ora italiana), con esito per
  apparato nella pagina dei job (✓/▲/✕ n/m) e una pastiglia nella testata della scheda. Riusa le letture di «Interroga» e
  del giro ARP, con un lucchetto per apparato condiviso con le rotte e rispettando gli interruttori (`switch_vlan`).
  Perché: gli apparati si leggevano solo con «Aggiorna» e l'hub non ha il job `arp_poll`, quindi le tabelle MAC e le
  VLAN degli switch invecchiavano. Idoneo con credenziale provata sull'host **o** collegamento credenziale riuscito
  (diverso dalla regola della testata). Sull'hub: job #25 «Switch e router del CED», ogni 4 ore, sei apparati.

### Corretto

- **«Rendi apparato» non fa due apparati dello stesso device**: un IP che è già di un apparato, o un altro IP del suo
  cluster fisico, risponde 409 «Questo IP è già dell'apparato X» (singolo e in blocco); per un IP del gruppo il
  messaggio dice di toglierlo prima dal gruppo nella scheda di X. Lo stesso blocco vale ora per la modifica dell'IP di
  un apparato e per l'apparato DHCP che la sincronizzazione AD crea per il DC. Perché: il 21/10 sull'hub è nato così
  un secondo apparato per il router di sede.
- **«È un apparato» vuol dire la stessa cosa ovunque** (`sqlApparatoDellHost`): legato all'host, o con l'IP scritto
  se è un apparato vecchio senza legame. Prima Discovery contava solo il legame e il blocco anche l'IP, così un
  apparato vecchio era principale per uno e non per l'altro.

## [Non rilasciato] — 2026-10-22 · Topologia: il cavo a mano vince

- **Un apparato, una scheda, da qualunque suo IP** (Riccardo, 22/10): aprendo `/objects/<host>` di un IP che appartiene a un apparato fisico il cui cluster ha UN solo apparato gestito, si vede la scheda di quell'apparato (stesso tipo, tab, dati); l'intestazione mostra l'IP aperto e «stesso apparato di <nome> · N indirizzi» col link. Con due apparati nel cluster o con nessuno non cambia nulla. Prima gli altri IP del router si aprivano come host semplici con una scheda diversa. `lib/devices/apparato-del-cluster.ts`.
- **Il collegamento tracciato a mano vince sempre** (Riccardo, 22/10) su quelli solo letti o dedotti, dopo la ★: un
  server o un hypervisor collegato a mano a uno switch sta sotto quello switch anche se un altro lo vede nella tabella
  MAC. Prima la fiducia «a mano» era l'ultima della chiave del Prim e il cavo finiva fra le ridondanze.
- **Una partenza che è un oggetto finale** (hypervisor, server, client) si appende al suo switch: trascinato in una
  mappa «passo passo» prima di collegarlo diventava partenza, e il Prim partiva da lui senza poter crescere. Ora fa da
  radice solo se nessuno lo raggiunge.
- **La mappa occupa tutta l'altezza**: i 9rem tolti erano della barra in alto, rimossa il 20/10 (~80 px vuoti in fondo).

## [Non rilasciato] — 2026-10-22 · La scheda MikroTik copiata dal Manager (v0.9.832-842)

- **Ritocchi alla scheda apparato** (22/10): numeri accanto al nome delle tab (porte, VLAN, vicini e MAC, rotte e ARP, bridge, VM, nodi, dischi, volumi…) solo dai dati già caricati; nei vicini LLDP/CDP/MNDP (MikroTik e switch) «· non in IPAM» o il link all'host (IP, poi MAC, stessa restrizione di «Dispositivi»); striscia MikroTik: il firmware compare solo se aggiornabile e il suo posto lo prende il pool DHCP più pieno (≥85%, solo dalla cache della tab DHCP), «Acceso da» passa nel riquadro Risorse.

La pagina del router MikroTik del Manager mostrava più cose della scheda di DA-IPAM, che per i router non aveva
risorse, hardware, bridge, VLAN né stato delle interfacce. Si porta quello che il Manager mostra, ma i dati li legge
DA-IPAM dal router (nessun collegamento col Manager). Piano `docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md`,
ADR 0027. Non si portano: IP Scan del router, backup binari, generatore di script, archivio delle configurazioni.

### Aggiunto

- **Scheda del router MikroTik** (`components/scheda/tipi/router/mikrotik/`, `lib/devices/mikrotik-scheda.ts`):
  Panoramica con risorse, hardware e firmware aggiornabile, interfacce raggruppate per tipo con stato, MTU e commento,
  dispositivi visti dal router, ARP con stato, tab Bridge e VLAN (matrice dai PVID, VLAN con la madre), DNS, utenti
  del router (solo admin) e Configurazione. Tabelle `mikrotik_*` per apparato, migrazione `scheda_mikrotik_v21` (v3).
- **Lettura `mikrotik_scheda`, nata spenta**: bridge vlan, vlan, DNS e utenti con comandi in più sul router solo se
  un admin la accende. Perché: nessun comando nuovo ai router dei clienti senza un ok esplicito.

### Corretto

- **Server DHCP disabilitati letti come attivi**: il flag `X` in testa alla riga non veniva letto (solo `disabled=`),
  quindi i pool di un server spento contavano.
- **Export della configurazione ripulito sul server**: `GET /api/devices/[id]/mikrotik` (`config` e `all`, solo
  admin) esce già senza `/system script` e `/system scheduler`: sui router con lo script di backup del Manager lì c'è
  la password SFTP, e la vecchia pagina `/devices/[id]` la mostrava e la scaricava così com'era.
- **Host IPAM abbinati per IP**: con lo stesso IP in due reti, un host di un'altra sede teneva in vita l'ARP «failed»
  e prestava il nome. Ora vale solo un host delle reti servite dal router.
- **Lease nella vista Dispositivi**: si tengono quelli con `last_synced` entro 1 giorno dall'ultima lettura, e non
  restano per sempre.
- **Seriale e part number letti via SNMP** non vengono più cancellati dalla lettura SSH quando il routerboard è vuoto (CHR).

## [Non rilasciato] — 2026-10-21 · VLAN delle porte UniFi

### Corretto
- Le porte degli switch Ubiquiti restavano senza VLAN: la sincronizzazione notturna del controller UniFi sostituiva tutte le porte dell'apparato e cancellava VLAN e stato STP letti via SNMP (il controller non li dà). Ora si conservano i valori già nel DB per le colonne che il controller non fornisce (abbinamento per nome di porta, poi per indice); un valore del controller vince sempre.
- Lo scan SNMP scartava la VLAN sugli agenti con `dot1dBasePortIfIndex` vuota ma `dot1qPvid` piena (SW-ING-ProMax-239): in quel caso l'indice del PVID vale come ifIndex.

## [Non rilasciato] — 2026-10-21 · La scheda dell'apparato cambia secondo il tipo (v0.9.822-829)

La scheda `/objects/[id]` aveva sette tab uguali per ogni apparato: uno switch trovava «Software» con la frase
«non applicabile», un NAS i dischi sotto «Sistema», una VM Proxmox sotto «Network», e le cose più utili
(porte, interfacce, servizi, controller di dominio) erano persi, nascosti o rimasti nella pagina `/devices/[id]`
che nessuno apre. Piano `docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md`, tavola grafica approvata
da Riccardo il 21/10.

### Aggiunto

- **Tab per tipo** (`components/scheda/tipi/<tipo>/`): switch (pannello frontale, porte da guardare, VLAN, vicini e MAC),
  router e firewall (interfacce, routing e ARP, DHCP, configurazione), storage (dischi e RAID, volumi, servizi),
  hypervisor (VM e container abbinate agli host, nodi, storage, rete), server Windows e Linux (sistema, servizi,
  aggiornamenti, software, utenti, Active Directory per i DC, dipendenze). In comune a tutti: intestazione in una
  riga, striscia di numeri, Panoramica che entra in una schermata, Sicurezza · Gestione · Storico.
- **Un solo punto che decide il tipo**: `tipoScheda()` (`lib/scheda/tipo-scheda.ts`) legge classificazione e
  piattaforma, mai `device_type`; `tabDelTipo()` elenca le tab. Il punto di innesto per i tipi nuovi è
  `components/scheda/tab-scheda.tsx`.
- **Gestione anche per l'host non gestito**: classificazione, seriale, inventario, note e asset NIS2 si modificano dalla
  scheda dell'host (Discovery) senza «Rendi apparato». In Gestione, il riquadro «Rete e SNMP» riporta SNMP, IP collegati
  e «Sulla mappa» per i tipi le cui tab non li mostrano (NAS, server, host, switch e hypervisor solo SNMP).
- **Nuove letture** in sola lettura, tutte dietro login: `GET /api/devices/[id]/interfacce`,
  `GET /api/devices/[id]/proxmox-match` (il POST, che scrive, resta solo admin), `GET /api/hosts/[id]/proxmox-vm`,
  `/api/hosts/[id]/ad`, `/api/hosts/[id]/dipendenze`.

### Cambiato

- **`device_type` dei server vecchi**: lo schema d'origine non ammetteva `server`, quindi i server Windows e Linux
  erano salvati come `switch` e le query dell'API sceglievano il ramo sbagliato. Conversione una tantum
  (`lib/devices/migra-device-type-v21.ts`, segno `device_type_v21`, elenco per nome nel log prima di scrivere);
  gli apparati senza classificazione non si toccano.
- **Export della configurazione MikroTik** (`GET /api/devices/[id]/mikrotik?action=config`): ora solo admin. Prima
  bastava una sessione qualunque per scaricare l'intera configurazione del router.
- La scheda `/objects/[id]` è passata da 2889 righe a poco più di 500: i blocchi sono stati spostati nei componenti, non riscritti.

### Corretto

- Il conteggio delle VM Proxmox usava un'espressione con un errore di precedenza (`?? … > 0`): ora è `numeroVm()`,
  con prova.

### Tolto

- La tab «Dettagli» per switch, router, firewall, storage, hypervisor e server: i loro blocchi stanno nelle tab del
  tipo. Resta solo per il tipo `generico` (stampanti, access point, UPS, postazioni), che non ha tab sue.
- Il testo «Aggiungi a dispositivi da Discovery» (per promuovere un host c'è la finestra «Rendi apparato»).

## [Non rilasciato] — ONTAP/MetroCluster e consegna del modello (solo locale)

## [Non rilasciato] — collector modulari e consegna del modello (solo locale)

- Prima copertura parziale Synology DSM, QNAP NAS, MikroTik RouterOS, Ubiquiti diretto e Proxmox VE nella CLI comune: letture statiche, tabelle con fonti/stati e capacità df esatte; errori conservati senza scritture DB.

- Collector locale UniFi via API key nella CLI comune: conserva offline e topologia per apparato, senza DB; copertura parziale esplicita (radio/client rinviati).

- Collector `netapp-ontap`, REST GET con CA/pin, paginazione vincolata e stato per
  collezione: cluster/nodi/DR, SVM/LIF, aggregati, volumi/LUN e mapping, dischi/shelf
  e rete. Cluster logico distinto dai controller, nessuna operazione di gestione.
- Capacità JSON grandi preservate dal token originale; zero/false e località dei
  dischi mantenuti. Prove su conteggi, TLS, next link, 401/403/404 e dati parziali.
- SOAP: risposte grandi con entità standard gestite senza espansione DTD; NFS4.1
  conserva tutti i server. Consegna per lo sviluppo con logica di osservazioni,
  identità scoped, relazioni e prove; vCenter resta una prova locale, non profilo UI.

## [Non rilasciato] — collector VMware ESXi via vSphere (solo locale)

- Profilo `vmware-esxi` API diretta con stesso JSON/CLI/adapter: hardware, rete
  fisica/virtuale, VMkernel, datastore/LUN/multipath, VM/vNIC/dischi/snapshot e sensori.
  Riferimenti e byte esatti preservati; IP dei Tools distinti da una scansione.
- HTTPS con CA oppure impronta esplicita prima delle credenziali; sessione limitata,
  proprietà selezionate, paginazione e logout. Endpoint vCenter rifiutati.
- Corretta la collisione XML tra type del ManagedObjectReference e xsi:type,
  con regressioni per singleton, route/pNIC, byte grandi, TLS e risposte parziali.
  Nessuna persistenza, modifica dell’host, attivazione UI o pubblicazione.

## [Non rilasciato] — inventario modulare e Comware IRF (solo locale)

- ProCurve 5406R zl2: inventario ENTITY e moduli nativi, mantenendo le porte senza
  modulo osservato anziché confonderle con porte installate o cancellarle.
- Collector `hp-comware`: profilo SSH exec separato e limitato; VLAN, porte, LLDP,
  MAC, LAG/STP e inventario IRF nello stesso JSON/CLI. CPU e memoria per membro,
  temperature, ventole e alimentatori distinti dalla potenza PoE.
- Campi opzionali compatibili con i JSON QNAP precedenti; errori e letture parziali
  espliciti. Nessuna persistenza, scheduler, nuova rotta o pubblicazione automatica.

## [Non rilasciato] — collector ProCurve / ArubaOS-Switch (solo locale)

- Profilo `hp-procurve` nel registry e nella stessa CLI del QNAP: collaudo Aruba
  2540 JL357A con operator, letture SSH/SNMP senza promozione di privilegi o DB.
- Porte fisiche e LAG distinti, membership VLAN/PVID espliciti, LLDP dettagliato,
  FDB, STP CIST, PoE assorbito dai dispositivi, CPU/memoria e salute delle ventole.
  Risorse/ambiente e part-number/ROM sono estensioni opzionali compatibili con JSON 1.0.
- Corretto il footer del pager HP incollato alle righe: Enter/Return non causano più
  perdita silenziosa di porte o MAC. Allowlist per famiglia, prompt operator e
  conteggi verificati; test e snapshot QNAP precedenti restano validi. Nessun rilascio.

## [Non rilasciato] — collector modulari QNAP (solo locale)

- Collector `qnap-switch` richiamabile da CLI e adapter senza DB, per acquisire lo
  stesso JSON versionato dal banco e dall'app senza duplicare i parser. Trasporti
  SNMP centralizzati e console SSH QSS con timeout, paginazione e allowlist read-only.
- Sezioni e errori espliciti per identità, porte, VLAN, FDB, LLDP, STP, LAG, sensori
  e IP/ARP; risultati parziali non diventano liste vuote autorevoli. Credenziali solo
  da file privato fuori git, output reale fuori repo; nessuno scheduler o rilascio.
- Motivazione, limiti e prove: ADR 0024 e `docs/modules/acquisition.md`.

## [Non rilasciato] — 2026-10-21 · «Rendi apparato», classificazione unica, voci senza doppioni (v0.9.815-820)

Riccardo, creando apparati, trovava la finestra caotica (stesse domande ripetute, credenziale scelta alla
cieca) e la classificazione da correggere dopo. Piano `docs/superpowers/plans/2026-10-21-tappe-3-5-rendi-apparato.md`,
decisioni nella proposta `docs/proposte/2026-10-21-tappe-3-5-interfaccia.md`.

### Aggiunto

- **Finestra unica «Rendi apparato»** (`components/devices/rendi-apparato-*.tsx`) da scheda oggetto, Discovery,
  pagina della rete e lista per classificazione, per uno o più host (fino a 50): cos'è (classificazione,
  piattaforma, variante solo se la piattaforma ne ha più d'una, ruoli per i server), come ci arrivo (porta con
  segno standard/non standard), credenziale con «Prova», «nuova nell'archivio», «SNMP aggiuntivo» e «Trova in
  automatico». Tipo dispositivo, scan target e sottotipo non si chiedono più: si deducono (la variante decide il
  tipo: Proxmox VE → hypervisor). Si crea anche senza credenziale provata, con l'avviso.
- **Ricerca della credenziale** (`lib/credentials/trova.ts`, `POST/GET /api/hosts/trova-credenziale`): prima le
  validate sull'host, poi la lista della rete, poi l'archivio; una credenziale già rifiutata su quell'host è
  **esclusa e detta** (si riabilita con «Prova»); su WinRM **al massimo 3 tentativi per host** e, nel giro su più
  host, un account rifiutato 3 volte non si prova più; host che non risponde = la ricerca si ferma senza
  escludere niente. Ogni prova (anche il pulsante «Prova») registra successo e fallimento.
- **Ruoli dei server** (`server_roles` su host e apparati): DC, DNS, DHCP, posta, web, database, backup, NFS.
- **Scelta a mano anche sugli apparati** (`network_devices.classification_manual`) e un solo punto di scrittura
  (`lib/classification/scrivi.ts`) che scrive host e apparato insieme; «Torna automatica»
  (`POST /api/classificazione/automatica`). Le scansioni non toccano una scelta a mano.
- In scheda (linguetta «Asset & Credenziali»): classificazione con ruoli, «Credenziali assegnate» con ultimo
  esito, badge «▲ senza credenziale provata» e «a mano» anche nelle liste.

### Cambiato

- **Catalogo delle classificazioni senza doppioni** (`lib/classification/canonico.ts`): «Server Windows/Linux» →
  Server + piattaforma; «NAS Synology/QNAP» e «Storage» → «NAS / Storage»; i tre controller → «Controller di
  rete»; fotocopiatrice → «Stampante multifunzione»; ONT → «Modem / ONT»; i server DNS/DHCP/posta/web/database/
  backup/NFS → Server + ruolo. Le scritture convertono da sole gli slug vecchi che i classificatori emettono
  ancora; conversione una tantum dei dati (segno `classificazioni_v21`: sull'hub 47 host e 13 apparati il 21/10).
  «unknown» si legge «Non classificato», etichette con maiuscole e sigle giuste.
- Salvare un apparato fissa la classificazione «a mano» solo se cambia.

### Tolto

- `components/devices/promote-host-dialog.tsx` e i moduli di creazione propri di Discovery, rete e lista.

## [Non rilasciato] — 2026-10-21 · Chocolatey si installa da solo sugli host Windows

Decisione di Riccardo (21/10): fino a oggi Chocolatey si installava solo a mano, host per host, dal
bootstrap della pagina del dispositivo (60-120 s, solo admin). Un host dimenticato restava senza patch e
nessuno lo diceva. Ora, con il modulo Patch Management attivo, parte da solo.

### Aggiunto

- **Installazione automatica** (`lib/patch/choco-automatico.ts`) sugli host Windows (`os_family`) con una
  credenziale WinRM secondo la regola del loader delle patch (`hostConCredenzialeWinrmDb`, compreso
  l'account WinRM dell'integrazione AD): (1) subito, in sottofondo, quando una credenziale WinRM di un host
  viene salvata (riga dell'host, modifica in blocco) o verificata con successo (prova della voce, prova del
  binding dell'apparato, «validata» a mano); (2) ogni notte alle 02:00 (ora del server, cron in
  `server.ts`) per chi non ha Chocolatey o ha un tentativo fallito. Ogni tentativo è un bootstrap vero
  (`executeBootstrap`): riga in `patch_operations` con `user_id = 0`, che lo storico mostra come
  «Automatico», con esito e motivo dell'errore (WinRM rifiutato, niente internet, timeout).
- **Freni**: già installato (ultimo probe senza `CHOCO_MISSING` o ultimo bootstrap riuscito) → non si tocca;
  un'operazione in coda o in corso sull'host, o un'installazione già avviata da questo processo → si salta
  (mai due insieme sullo stesso host); al massimo **3 installazioni insieme** in tutto il processo; di notte
  al massimo **3 tentativi automatici falliti**, poi l'host resta fermo finché un admin non lo riprova a
  mano (un bootstrap con utente vero azzera il conto). Il salvataggio di una credenziale prova comunque una
  volta: è un gesto di un admin.
- **Interruttore «Installa Chocolatey automaticamente»** nella pagina del modulo Patch Management
  (`/settings/moduli/patch_management`), **acceso di default**, impostazione del tenant
  `patch.choco_automatico` («0» = spento); rotta `GET/PUT /api/patch/choco-automatico` (lettura con
  sessione e modulo attivo, scrittura admin). La card dice quanti host Windows con WinRM sono installati,
  da installare, da ritentare e fermi.
- **Prove** `lib/patch/__tests__/choco-automatico.test.ts` (viste fallire togliendo ogni freno): credenziali
  salvate → un solo bootstrap anche con due richieste insieme; Linux, senza WinRM, interruttore spento,
  modulo spento, già installato, operazione in corso → niente; errore → storico col motivo e nuovo tentativo
  fino a 3 notti, poi fermo e sbloccato da un admin; mai più di 3 installazioni insieme.

### Da sapere

- `dev` arriva da solo alle appliance su quel canale: con l'interruttore acceso di default, dopo il
  rilascio Chocolatey parte sugli host Windows con credenziale WinRM delle appliance che hanno il modulo
  Patch Management attivo (al primo salvataggio/verifica di una credenziale, e comunque la notte dopo).
- Le credenziali WinRM trovate dalla discovery non fanno partire niente subito: le prende il giro notturno.

## [Non rilasciato] — 2026-10-21 · I link verso l'appliance usano l'host del browser

Riccardo (21/10, «ok per 1»): l'installatore (Deploy-Appliance `connect_bootstrap_launchpad`) registra gli
URL dei servizi con l'IP LAN dell'appliance (`https://192.168.99.61:6443`). Chi apre DA-IPAM da un nome DNS o
da NetBird finiva, coi pulsanti, su un indirizzo irraggiungibile o con un certificato che non corrisponde.

### Cambiato

- **Regola unica `urlPerIlBrowser`** (`lib/integrations/url-per-browser.ts`, prove in
  `url-per-browser.test.ts`): un URL il cui host è l'appliance stessa si apre con l'host del browser
  (`window.location.hostname`), con porta, percorso e schema salvati; un URL di un'altra macchina (Proxmox,
  Wazuh o LibreNMS in una VM loro, servizi del cliente) resta com'è. Lo schema non si forza a https: gli URL
  dell'installatore lo sono già, e un `http://` salvato a mano che funzionava continua a funzionare. **Nel
  database resta l'URL vero**: cambia solo cosa si apre.
- **Chi è «l'appliance stessa»** (`host-appliance-server.ts`): loopback, nome della macchina, indirizzi delle
  interfacce vere (non Docker, non link-local: l'IP LAN c'è anche se `APPLIANCE_LAN_IP` manca dall'ambiente
  del servizio), variabili dell'host pubblico e di `NEXTAUTH_URL`/`AUTH_URL`/`DA_IPAM_PUBLIC_URL`, voce
  «DA-IPAM (this)» del vault. Il layout le passa al client con l'Host della richiesta
  (`components/shared/url-per-browser.tsx`, `useUrlPerBrowser`); dopo l'idratazione vale `window.location`.
  La stessa lista serve ora all'accesso automatico di LibreNMS (`librenmsHostAllineabili`), che prima leggeva
  solo le variabili d'ambiente.
- **Dove si applica**: console esterne del menu Applicativi, riquadri dei moduli in dashboard, «Apri» delle
  credenziali di sistema, card delle integrazioni e di Wazuh, Scanner-Edge, viewer delle dashboard (riquadro,
  «Apri in nuova scheda», scorciatoie), link a LibreNMS da Discovery e dalla scheda dell'oggetto, Wazuh dal
  badge dell'host, MeshCentral (console, riquadro della sessione, «Apri»), MDM, «Apri e accetta il
  certificato» della verifica di apertura.
- Fuori: gli script di installazione dell'agente d'inventario (li usano altre macchine, non il browser) e il
  «Apri servizio web» di Discovery (URL scritto a mano dall'operatore).

## [Non rilasciato] — 2026-10-20 · Via le rotte ferme dell'agente remoto

### Rimosso

- **Rotte dell'agente Python remoto** (`/api/agents`, `/api/tenant-agents/**`, `/api/tenants/[id]/agent/**`),
  **`/agent-install.sh`** (con la sua voce fra i percorsi pubblici di `auth.config.ts`), la **pagina
  `/tenants/[id]/agent`** e l'helper `lib/agente-remoto-tolto.ts`. Con la v0.9.810 erano rimaste ferme (410)
  per un giro, perché un `update.sh` più vecchio della v0.9.805 legge i tipi della build in uso che le citano e
  la build nuova sarebbe caduta (trappola di `/api/search`). La condizione è verificata il 20/10 sera, in sola
  lettura: da-invent 0.9.808, DTS 0.9.810, PX-NAS 0.9.810, tutte con lo script nuovo. La prova
  `rotte-agente-tolte.test.ts` impedisce che tornino; `/agents` («URL dell'hub») resta. Nel DB restano, senza
  uso, `tenant_agents` e `tenants.agent_*` (niente DROP). Matrice delle guardie (`docs/auth-matrix.md`)
  rigenerata.

## [Non rilasciato] — 2026-10-20 · Via la VPN precedente: l'overlay è solo NetBird

Riccardo (20/10 notte): la VPN precedente non esiste più su nessun dispositivo (verificato su Proxmox
Domarc, hub, da-invent, DTS, DA-VA-OVH, Mac) e va tolta da codice e documenti, storia compresa.
L'overlay è solo NetBird, governato da DA-Link (ADR 0011).

### Rimosso

- **Tipo di credenziale della VPN precedente** dalle API del caveau e dal pannello: un solo elenco dei tipi
  ammessi per creazione, modifica e bootstrap (`credentials-vault-tipi.ts`). Sul live 0 righe; niente
  migrazione che cancella: una riga vecchia di un tipo tolto si legge ancora e l'interfaccia la mostra come
  «Altro» (prova `overlay-precedente.test.ts`).
- **Nome dell'hub nella VPN precedente** come ripiego dell'indirizzo dell'hub (impostazione vuota sul live):
  non si legge, non si scrive e non nasce più nei DB nuovi; `GET /api/settings/hub-url` usa solo
  `public_hub_url`. La riga resta nei DB vecchi (niente DROP), nessuno la legge.
- **Agente Python remoto** (`agent/`, decisione 26 della spec NetBird: «si toglie nella tappa C1»; nessuno lo
  usava, una sola riga sull'hub mai collegata): via il pacchetto con installatore, unità, `openapi.json` e prove,
  il job di CI, l'esecutore remoto, l'elenco e il wizard degli agenti, la pagina agente del cliente e il suo
  pulsante, la scheda del modulo e il playbook. **Restano, ferme**, le rotte (`/api/agents`,
  `/api/tenant-agents/**`, `/api/tenants/[id]/agent/**`, `/agent-install.sh`: 410) e la pagina
  `/tenants/[id]/agent`, per un giro: chi aggiorna con un `update.sh` più vecchio della v0.9.805 legge ancora i
  tipi della build attiva che le citano (trappola di `/api/search`). Nel DB restano, senza uso, la tabella
  `tenant_agents` e le colonne `tenants.agent_*` (niente DROP). Un cliente rimasto con `agent_mode='remote'`
  non ripiega in silenzio sull'hub (manderebbe offline host che da lì non si vedono): il giro di scansione
  fallisce con un messaggio che dice di riportarlo in locale (prova `modalita-remota-tolta.test.ts`).
- **Doppio binario in `prepara-netbird.sh`**: lo script prepara solo NetBird e il firewall di `wt0`.
- **Policy ACL e playbook di migrazione della VPN precedente**: cancellati (la storia è in git).

### Modificato

- **`/agents` è ora «URL dell'hub»** (stessa voce di menu, solo superadmin): resta solo il riquadro di
  `public_hub_url`, che serve anche agli script dell'agente d'inventario e a cui rimanda il Launchpad.
- **Launchpad**: aprire in modifica una credenziale di un tipo non più ammesso e salvarla rimandava il suo tipo
  e prendeva 400; ora il tipo si manda solo se cambiato (`tipoDaInviare`). Gli schemi delle tre rotte delle
  credenziali stanno in `credentials-vault-tipi.ts` e sono provati col tipo tolto.
- **Playbook di oggi** (nuovo hub, nuovo bridge, DR, rotazione della chiave) riscritti su NetBird e DA-Link
  senza l'agente remoto; manuale utente allineato. Nella storia (CHANGELOG, spec, piani, ADR) il nome è
  diventato «la VPN precedente», i fatti restano quelli.

## [Non rilasciato] — 2026-10-20 · Testata delle scansioni semplificata

### Modificato

- **Pagina della rete: quattro comandi di scansione invece di dodici** (Riccardo, 20/10: «troppe voci»). Gli stessi
  strumenti comparivano due volte, una per la subnet e una per gli host selezionati (Nmap, SNMP), e «Credenziali»
  stava nel gruppo «intera subnet» pur lavorando solo sugli host selezionati. Ora la portata la decide la selezione
  nella lista: **Scoperta host** (sempre sulla subnet); **Avanzata** (subnet: ping → Nmap -sV → SNMP → Enrich in un
  giro solo lato server; host selezionati: Nmap profilo completo poi SNMP deep), con le fasi singole e la loro ultima
  esecuzione nel menu a fianco; **Accesso agli host** (solo selezione: verifica credenziali se la rete ne ha, poi
  WinRM, poi SSH, ferma alla prima fase in errore); **Attribuzione** (apre l'anteprima, col conteggio a livello 2 sul
  pulsante). «Applica diretto» è diventato «Applica tutto senza rivedere» dentro l'anteprima; VA Scan resta a destra.
  Nessuna funzione tolta: ogni comando di prima è a uno o due clic.
- **La scansione periodica entra nella stessa barra** (Riccardo, 20/10): era una riga pieghevole sotto, alta
  quanto la barra; ora è il pulsante «Scansione periodica · ogni 15 minuti» (o «· sospesa») che apre gli stessi
  controlli in una finestra.

## [Non rilasciato] — 2026-10-20 · Pagina d'accesso nuova e verifica in due passaggi

### Aggiunto

- **Verifica in due passaggi per utente** (Riccardo, 20/10; ADR 0023): un admin la chiede da Impostazioni → Utenti
  (colonna «Due passaggi»: Richiedi, Azzera, Togli); al primo accesso dopo, l'utente inquadra un QR e la attiva con
  un codice; poi entra con password e codice a 6 cifre. Chi entra con l'account Domarc (entra.domarc.it) non ha
  bisogno di niente; l'utenza di servizio `domarc` resta com'è. Nessun accesso cambia finché un admin non la chiede a
  qualcuno. Registro delle azioni in `data/audit/accessi-*.jsonl`; recupero dal server con
  `scripts/seconda-verifica.ts`.

### Modificato

- **Pagina d'accesso in due metà**, come DA-Template: marchio su fondo navy a sinistra (testata sul telefono), modulo
  bianco a destra; codice e QR nella stessa scheda; errori e blocco in avvisi col simbolo, il blocco con l'ora di
  sblocco.

### Sicurezza

- Password dell'utenza di servizio `domarc` confrontata a tempo costante.
- I tentativi d'accesso si contano prima di ogni attesa: in parallelo il blocco ora tiene (prima 60 richieste
  insieme passavano tutte il controllo).
- Un nome inesistente risponde nello stesso tempo di una password sbagliata (prima 0,1 ms contro 49 ms: si capiva
  se il nome esisteva).

## [Non rilasciato] — 2026-10-20 · Dashboard e Alert sicurezza ridisegnate

### Modificato

- **Dashboard a tre colonne** (mockup e scelta di Riccardo, 20/10): indicatori in card basse con l'anello della
  Health; Sicurezza in card bianche con la striscia a tinta piena del token e il simbolo (niente pastello: Riccardo è
  daltonico); a sinistra stato host e accessi falliti, al centro host offline (alta quanto la lista) e transizioni, a
  destra subnet e moduli. I moduli non configurati stanno in una riga sola invece di due file di riquadri grigi.
- **Barre delle subnet proporzionali**: una rete da 6 host non è più lunga come una da 100; l'offline ha la trama
  diagonale oltre al colore (verde e rosso hanno quasi la stessa luminanza).
- **Accessi falliti**: istogramma snello con media e picco. I conteggi orari vengono dall'indexer di Wazuh (gli stessi
  della pagina Alert, 5 minuti in memoria): la stima di prima ripartiva ogni gruppo d'allarme sulla sua durata e dava
  24 barre quasi uguali (massimo 13 in un'ora sull'hub). Se l'indexer non risponde si torna alla stima e c'è scritto.
- **«Uptime 24 h»** al posto di «Health» nel grafico dello stato host: conta gli host controllati nelle ultime 24 ore,
  mentre la Health in alto conta anche gli offline visti negli ultimi 7 giorni (74% contro 94% sull'hub).
- **Alert sicurezza in una schermata**: lo stato di Wazuh in quattro pastiglie sulla testata, tutti i filtri in alto,
  la coda degli eventi a sinistra (scorre con le intestazioni ferme), grafico nel tempo e classifiche in linguette a
  destra. Prima il lavoro da fare stava in fondo a tre schermate. Via la torta (ripeteva i conteggi delle categorie)
  e le frasi di spiegazione (ora nei `title`). Livelli coi token pieni al posto del pastello.

- **Colori ben distinguibili** (Riccardo, 20/10), misurati col validatore per daltonici della skill dataviz.
  Stato degli host (grafico, barre delle subnet, transizioni): online verde scuro pieno, offline **arancio a righe**,
  sconosciuti grigio chiaro (distanza minima 18,6; prima verde/rosso 7,4). Transizioni con la pastiglia ▲ online /
  ▼ offline. Categorie degli alert: tre colori fissi (accessi falliti navy, account privilegiati arancio, ransomware
  blu) e le altre grigio chiaro (prima sei tinte, coppia peggiore 3,2). Il «● da verificare» dei moduli diventa grigio
  chiaro con testo navy: il grigio pieno dei token stava a 6,2 dal verde «ok» (solo in DA-IPAM; per DA-Template resta
  una proposta). Colori in un posto solo: `--host-*` e `--alert-cat-*` in `globals.css`.

- **Via la barra in alto** (Riccardo, 20/10): ogni pagina guadagna circa 53 px. Tema chiaro/scuro, riga utente (nome e
  ruolo, il clic apre «Cambia password») ed «Esci» stanno in fondo al menu a sinistra; col menu compresso restano le
  icone. **Tolta la ricerca generale** (e ⌘K, con la rotta `/api/search`): si cerca nelle tabelle che hanno il loro
  campo, IP/MAC/hostname in Discovery.

- **Paginazione in alto** (Riccardo, 20/10: «perché tutto quello spazio inutilmente utilizzato in basso?»): sotto le
  tabelle la riga «Righe per pagina… Pagina 1 di 7» e i suoi margini toglievano ~100 px. Ora è compatta
  («[50] 1–50 di 348 « ‹ 1/7 › »») nella riga del titolo (Discovery: a destra della riga «Vista»; Active Directory:
  accanto alla ricerca di ogni linguetta), su tutte le 9 pagine che la usano; lo spazio riservato sotto le tabelle
  scende da 72 a 40 px. Discovery a 1920×1080: 18 righe visibili invece di 13.

### Corretto

- **Aggiornamento bloccato da una rotta tolta**: la v0.9.804 non si è installata sull'hub (tornato da solo alla
  v0.9.803). La build nuova controllava anche i tipi generati dalla build in uso, che citavano `/api/search` appena
  tolta. `update.sh` ora li svuota prima di costruire; `/api/search` resta come rotta ferma (risponde 410) finché
  tutte le installazioni non hanno lo script nuovo, perché chi aggiorna esegue ancora quello vecchio.
- Menu utente: il clic faceva cadere la pagina (Base UI vuole l'etichetta dentro un gruppo), quindi «Cambia password»
  non si raggiungeva.
- Alert sicurezza: senza indexer «Alert nel periodo», «Agent» e «Regole» dicevano 0 mentre la tabella mostrava gli
  eventi; ora dicono «—» col motivo.

## [Non rilasciato] — 2026-10-20 · Pulizia degli host assenti e dei cambi di IP (spenta)

Da questo rilascio la numerazione passa da 0.3.x a **0.9.801** (Riccardo, 20/10: «siamo a uno stato quasi
definitivo»). Il numero si mostra soltanto: gli aggiornamenti decidono sul commit, non sulla versione.

### Aggiunto

- **Pulizia degli host assenti** (Impostazioni → Sistema, solo admin; ADR 0022). Richiesta di Riccardo: sull'hub 178
  host offline, molti non visti da mesi, gonfiavano liste e conteggi. Si archiviano gli host offline da oltre 60
  giorni e, subito, il vecchio IP di un MAC che ha cambiato indirizzo nella stessa rete, solo se il MAC sta su due host
  esatti con nomi coerenti (sull'hub un router in proxy ARP aveva lo stesso MAC di 13 macchine diverse); dopo 90 giorni
  d'archivio si cancellano. Esclusi: apparati, host monitorati, nome scritto a mano, classificazione a mano, asset, credenziali,
  unioni a mano, multihomed, sessioni remote registrate, host recuperati a mano, MAC su più host online. Anteprima coi
  nomi e il motivo, «Applica» col numero scritto, recupero con un clic (torna l'identità, non lo storico), registro
  JSONL di ogni operazione (`data/audit/pulizia-host-*.jsonl`, 400 giorni).
- **Job notturno `pulizia_host`** alle 04:00, **spento**: si accende solo dall'interruttore della pulizia, con
  conferma; nella pagina dei job è in sola lettura e le sue rotte lo rifiutano. Gli host di una rete in scansione si
  rimandano.
- **«Archiviati»** in dashboard accanto ad «Assenti», **«IP precedenti»** nella scheda dell'oggetto.

### Cambiato

- **Il job `cleanup` («Pulizia tabelle MAC») non tocca più gli host**: dopo 30 giorni sovrascriveva la
  classificazione con `stale` e dopo 90 cancellava senza nessuna esclusione (apparati, credenziali, asset). Resta la
  pulizia di `mac_port_entries`; le soglie vecchie nelle config si ignorano.
## [Non rilasciato] — 2026-10-20 · Stato della sonda locale nel segnale verso DA-Link

Parte DA-IPAM delle «sonde integrate con DA-Link» (spec DA-Vul-can
`docs/superpowers/specs/2026-10-20-sonde-integrate-dalink-design.md`, §8.2), approvata da
Riccardo il 20/10. Perché: il 19/10 PX-NAS taceva perché non risolveva il nome dell'hub e
DA-VA-OVH perché aveva il disco pieno; la sonda lo sapeva, Domarc no.

### Aggiunto

- **Blocco `edge` nel segnale di vita** (`lib/dalink/edge-segnale.ts`, `edge-sonda.ts`):
  `{ raggiungibile, versione_vera, hub, aggiornamento, disco }` letto da `/api/v1/health`
  della sonda del cliente, copiato a lista bianca coi campi e gli elenchi chiusi della §8.1
  (valori fuori elenco → null, versioni e date solo nella loro forma, mai messaggi liberi né
  il nome dell'istanza). `raggiungibile: false` e il resto null quando la sonda non risponde,
  risponde con un errore, con qualcosa che non è JSON, o con un certificato diverso dal pin:
  un errore di trasporto non è un «ok». Sonda vecchia (solo `ok`/`version`): raggiungibile,
  il resto null, e `version` non diventa `versione_vera` (è il pyproject).
- Il blocco **non esce** se il modulo edge non è configurato (nessuna riga in
  `vuln_scanners`) o se l'istanza non ha il cliente di DA-Link. Stessa fiducia TLS delle
  altre chiamate alla sonda (pin SPKI di `cert_pin`, `leggiSaluteEdge`), timeout totale di
  3 secondi, lettura in parallelo alle sonde dei moduli: il segnale non rallenta e non
  fallisce per la sonda. DA-Link oggi ignora i campi che non conosce (`Segnale`,
  `extra="ignore"`): il segnale non prende 422; verificato col modello di `origin/main`.
- `LIMITI` del segnale in `lib/dalink/segnale-limiti.ts` (riesportati da `segnale.ts`), per
  usarli anche nel blocco della sonda senza import circolari.

### Corretto (revisione del 20/10, stesso ramo)

- **Stesse forme di DA-Link** (`dalink/sonde/forma.py` del suo ramo sonde): versioni e
  commit `^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$` **senza tagliare** (prima si tagliavano a 64:
  una versione tagliata è un'altra versione, e DA-Link l'avrebbe scartata), interi fino a un
  miliardo, disco solo con tutti e due i numeri validi, totale > 0 e liberi ≤ totale, motivo
  del contatto con l'hub solo con esito «errore». Così nessun valore cambia significato
  attraversando il confine.
- **Modulo edge spento per scelta** (`enabled=0` senza `auto_disabled_at`): il blocco non
  esce, come chiede il contratto («assente se il modulo edge non c'è»). Resta quando lo ha
  spento la sequenza di errori: lì serve sapere se la sonda risponde.
- **Allo scadere dei 3 secondi la connessione si chiude davvero** (`AbortSignal` fino al
  socket) e il corpo ha un tetto di 64 KB: il timeout del socket di `rawRequest` è di
  inattività, e una sonda che risponde a goccia lo rinnovava all'infinito, lasciando la
  richiesta appesa dietro al segnale. `signal` e `maxBytes` sono facoltativi: le altre
  chiamate alla sonda restano come prima.

## [Non rilasciato] — 2026-10-20 · Salute coerente e passaggi a offline nello storico

### Corretto

- **Passaggio a offline delle scansioni nello storico** (`markHostsOffline`): cambiava lo
  stato senza scrivere `status_history`, quindi grafico e «Transizioni recenti» non vedevano
  chi andava offline per una scansione (sull'hub 34 host «online» nello storico e offline
  nello stato attuale). Vale da ora in avanti.
- **Salute in alto e grafico dicevano due cose** (51% contro 98% sull'hub): la riga in alto
  contava tutti gli offline, il grafico solo chi aveva controlli recenti. Decisione di
  Riccardo: «offline» = visto negli ultimi 7 giorni; gli host offline non visti da più di 7
  giorni sono «assenti» (`lib/hosts/assenti.ts`), un indicatore a parte, fuori dalla salute
  e dal grafico.

## [Non rilasciato] — 2026-10-20 · Colori ufficiali degli stati, accessi falliti nelle 24 ore

### Cambiato

- **Colori degli stati dai token di DA-Template** (design system Domarc): ✓ verde pieno
  `#1F7A4D` = funziona, ▲ giallo `#FFD400` = attenzione, ✕ rosso pieno `#8E1B20` = guasto,
  ● grigio pieno `#5B6B77` = da verificare, – grigio tratteggiato = non configurato; valori
  scuri dei token in modalità scura. Prima il verde era `green-800`, più scuro, e attenzione
  un ambra pallido («il verde deve essere un verde», Riccardo). Valgono per riquadri, riga
  Sicurezza, etichette della dashboard ed elenco di Impostazioni → Moduli.
- **Accessi falliti**: il grafico parte dalle ultime 24 ore, ora per ora in ora italiana, con
  l'interruttore per i 14 giorni (Riccardo: «è utile avere le ultime 24 ore»).

## [Non rilasciato] — 2026-10-20 · Dashboard: KPI di sicurezza

Richiesta di Riccardo del 20/10, dati misurati sull'hub prima del codice.

### Cambiato

- **Riga «Sicurezza»** (`lib/security/kpi-dashboard.ts`): vulnerabilità critiche e alte dello
  Scanner-Edge (contate come la pagina Vulnerabilità: CVE, o NVT quando la CVE manca; host
  colpiti), accessi falliti nelle ultime 24 ore con la tendenza, account bloccati in 30
  giorni, alert da gestire (dagli alert di Wazuh, diagnostici esclusi), Health AD (rilievi,
  età, tentativo fallito). Una fonte non configurata è grigia, non «0».
- **«Accessi falliti, 14 giorni»** al posto di «Attività scan recente»: barre per giorno
  italiano, account bloccati segnati sopra.
- Gli alert di Wazuh sono raggruppati e un gruppo resta aperto per mesi: ogni gruppo si
  ripartisce sul periodo in cui è rimasto aperto. Contarlo tutto nel giorno dell'ultima
  occorrenza dava 41.223 accessi falliti in 24 ore sull'hub contro circa 530 (revisione del
  20/10). Resta un'approssimazione: niente contatore giornaliero (scelta di Riccardo).

## [Non rilasciato] — 2026-10-20 · Dashboard in una schermata, stato moduli a riquadri

Richiesta di Riccardo del 20/10, proposta approvata prima del codice.

### Cambiato

- **Dashboard senza scorrere** (1920×1080, 1366×768, 1280×720): titolo e indicatori su una
  riga; «Stato moduli» a riquadri; sotto tre colonne a tutta altezza (grafico e transizioni,
  host conosciuti offline, subnet e scansioni) con le liste che scorrono dentro il riquadro.
- **Stato moduli a riquadri piccoli**, uno per applicativo: nome, ultimo aggiornamento in
  forma breve (ora esatta e dettaglio al passaggio), stato dal colore con simbolo e
  luminanza (✓ verde pieno, ! ambra, ✕ rosso pieno, ? bianco, – grigio tratteggiato). Tutti
  i moduli possibili: i non configurati o spenti in grigio, anche Inventario NIS2, Zabbix e
  Active Directory se assenti. Zabbix prende lo stato dall'esito delle letture.
- Colori degli stati in un file solo (`components/shared/stile-stato-modulo.ts`), lo stesso
  dell'elenco in Impostazioni → Moduli.

## [Non rilasciato] — 2026-10-20 · Intestazioni ferme anche sulle pagine secondarie

### Cambiato

- `<Table fissa>` sulle liste principali delle altre pagine: Subnet, Tabella ARP, Scansioni,
  Agenti remoti, IP esclusi, Anomalie, Clienti, Dispositivi (e la lista per classificazione),
  Ubicazioni, Licenze, Assegnatari, Servizi NIS2, Sorgenti DHCP, Host conosciuti, Patch
  (dispositivi e software), CVE del Patch, Storico Patch, Classificazioni, e nelle Impostazioni
  le tabelle di MAC→prodotto, identificazione dispositivi e sysObjectID. Restano come prima le
  pagine di dettaglio con più tabelle e le tabelle nei dialoghi.
- Le intestazioni ferme valgono anche per un `thead` scritto con celle normali (Anomalie).

### Corretto

- Menu: sulla Health di Active Directory non si accende anche «Active Directory» in Network,
  e il gruppo Sicurezza si apre da solo.

## [Non rilasciato] — 2026-10-20 · Tabelle con le intestazioni ferme, testate più basse

Richiesta di Riccardo del 20/10 («le intestazioni sono enormi; intestazioni e colonne
scorrono col contenuto»), proposta approvata prima del codice.

### Cambiato

- **Intestazioni delle colonne ferme**: `ScorrimentoTabella` e `<Table fissa>`
  (`components/ui/table.tsx`, hook `use-altezza-disponibile.ts`), la regola del kit di
  DA-Template: la tabella è alta quanto lo spazio che resta sullo schermo e scorre lei;
  titolo, filtri e paginazione restano dove sono. Accese su Discovery, dettaglio subnet,
  Credenziali, Inventario, Controller, Software, Vulnerabilità, Alert sicurezza e le quattro
  liste di Active Directory. Le sottotabelle delle righe espanse non si incollano.
- **Discovery**: titolo, contatori e filtri su una riga; vista e categorie su una riga. La
  tabella parte a ~180 px invece di ~410 (a 1920).
- **Dettaglio subnet**: contatori, gateway e router accanto al titolo; i quattro riquadri
  «Azioni» diventano gruppi in linea (data dell'ultima esecuzione nel suggerimento,
  «obsoleta» a vista); vista e filtri della lista nella barra della selezione; «Seleziona
  per tipo» accanto al conteggio della selezione (aggiunge, non filtra). La tabella parte a
  ~380 px invece di ~600.

## [Non rilasciato] — 2026-10-19 · Menu: Applicativi e Sicurezza al posto del Launchpad

Richiesta di Riccardo del 19/10 sera, proposta approvata prima del codice.

### Cambiato

- **Gruppo «Applicativi»** nel menu al posto del Launchpad a tessere e delle voci sparse dei
  moduli (un doppione): Patch Management (Panoramica, CVE, Storico), Controllo remoto
  (Dispositivi, console MeshCentral), Zabbix, e le console esterne (Scanner-Edge, Wazuh, UniFi,
  LibreNMS, Graylog, MDM) in una scheda nuova. Solo i moduli accesi. `/launchpad`,
  `/integrations` e `/appliance` portano a Impostazioni → Moduli; le righe dei moduli esterni
  in dashboard alla pagina del modulo.
- **Gruppo «Sicurezza»**: Vulnerabilità, Alert sicurezza e Health Active Directory (la pagina AD
  si apre sulla scheda Health con `?tab=health`).
- **Network**: «Credenziali» come sezione con Credenziali e Controller di rete.
- Nel menu è evidenziata solo la voce più precisa (su CVE del Patch non anche «Panoramica»,
  su Assegnatari non anche «Asset»).

### Corretto

- Riga MDM della dashboard verso `/settings/mdm` (andava a «Modulo sconosciuto»); messaggi
  d'apertura che citavano «la Launchpad»; manuale (§22 riscritta, albero del menu).

## [Non rilasciato] — 2026-10-19 · Moduli, MDM e Discovery più leggibili (F09-F11)

Proposta approvata da Riccardo il 19/10, oggetto per oggetto.

### Cambiato

- **Moduli: un elenco e una pagina per modulo** (F10). La scheda mostrava insieme
  configurazione, installazione, salute, certificati e vault di tutti i moduli (49 pulsanti):
  ora è una riga per modulo (nome, «Opzione», stato con fondo, bordo e simbolo, salute in
  parole, «Apri») e ogni modulo ha `/settings/moduli/<chiave>`. I collegamenti di prima
  (`#module-…`, `#int-…`) portano lì.
- **Desktop remoto senza agente: interruttore nella pagina di MeshCentral** (F10). Stava solo in
  `.env.local` e dall'interfaccia non si vedeva: sull'hub la voce RDP mancava per questo.
  Ora è un'impostazione del tenant; `MESHCENTRAL_SENZA_AGENTE=1` resta e vince.
- **MDM come gli altri moduli** (F11): nell'elenco, nella salute (dall'esito della
  sincronizzazione, senza sonde di rete) e nel Launchpad solo con la console configurata.
- **Un solo reset** in Impostazioni: «Reset lab» faceva la stessa cosa di «Reset per nuovo cliente».
- **Discovery** (F09): viste per attività (Inventario, Sicurezza, Rete) che filtrano le colonne
  senza toccare l'ordine salvato (l'ordine delle 19 colonne è una decisione di Riccardo, 23/05);
  le sigle (Cred, Conf, CVE C/H/M, DHCP, AD, MH…) si spiegano passando sull'intestazione; i
  filtri rapidi di serie in italiano, quelli a zero dietro «Altre categorie». «Più IP» e
  «Altro» contavano sempre 0: ora contano con la loro regola.

### Corretto

- **Filtri rapidi personali di Discovery** (`user:<slug>`): cliccandoli la tabella si svuotava
  (confrontava la classificazione con «user:…»). Ora tabella e conteggi usano una regola sola
  (`prendePreset`); un filtro di serie rinominato dall'utente tiene il suo nome.
- **verify-install verso l'host locale** non controlla più il nome del certificato (`-k` solo
  per `https://127.0.0.1` e `https://localhost`): sull'hub ogni aggiornamento finiva «con avvisi».

## [Non rilasciato] — 2026-10-19 · Correzioni dell'analisi del 19/10 (F01-F04, F06-F08)

### Corretto

- **Import per unione** (F01): falliva sempre su un'installazione vera («UNIQUE constraint
  failed: tenant_settings.key», le migrazioni scrivono 4 chiavi anche su un tenant nuovo) e
  annullava tutto. Decisione di Riccardo: **vince la destinazione**. Sulle tabelle a chiave
  naturale la riga del bundle si salta e la pagina elenca le chiavi rimaste quelle di prima;
  sulle tabelle a id numerico un id già presente ferma l'import prima di scrivere, con le
  tabelle e i conteggi: l'unione non rinumera, e saltare la riga attaccherebbe le righe figlie
  del bundle a quella sbagliata. Anche gli indici UNIQUE parziali o su espressione seguono la
  regola, e il segno delle conversioni si legge dal bundle: una sorgente già convertita non si
  riconverte, come con lo svuotamento.
- **Reset per nuovo cliente** (F02): la rotta chiamava la gemella di `db.ts`, che dentro un
  tenant cercava `users` nel DB del cliente («no such table: users»): non ha mai funzionato.
  Decisione di Riccardo: **restano le impostazioni del cliente e gli utenti**. La rotta usa lo
  stesso reset del laboratorio e riapre il wizard; la gemella di `db.ts` dentro un tenant passa
  a quella del tenant. Il reset ora dichiara cosa **resta** (`TABELLE_TENUTE`: impostazioni,
  configurazione dei moduli dell'appliance, classificazioni personalizzate) e svuota ogni altra
  tabella del tenant: le due liste a mano lasciavano controller di rete con le password,
  telefoni, Wazuh, vulnerabilità, apparati e topologia del cliente di prima. Non scrive più il
  flag d'onboarding globale dell'hub (apriva `requireAdminOrOnboarding` a tutti i tenant).
- **Aggiornamento con servizio fermo** (F03): `update.sh` chiudeva «riuscito» senza riavvio né
  salute, e il commit risultava avviato. Ora l'esito è `pronto_non_avviato`, il commit avviato
  resta quello di prima, `auto-update` non rifà la build ogni 15 minuti finché il servizio è
  fermo, e verso DA-Link (che accetta quattro esiti) va come «interrotto», fase «avvio».
  Ogni build scrive il suo commit in `DA_COMMIT`: un ritorno indietro torna al codice della
  build in uso, non al commit avviato (dopo un «pronto_non_avviato» non coincidono).
- **verify-install fallito** (F04): l'esito resta «riuscito» (salute buona), ma la scheda
  Aggiornamenti dice «riuscito, con avvisi» e «Aggiorna ora» riporta l'avviso.
- **`stato-aggiornamento.mjs` non partiva da una cartella dietro un collegamento simbolico**
  (macOS `/var/folders`): le 9 prove «rosse per `flock`» del Mac erano questo. Si confrontano
  i percorsi reali.
- **Menu compatto da tastiera** (F06): Invio/Spazio aprono il flyout, Tab ci entra, Escape lo
  chiude e torna al pulsante; `aria-expanded` e `aria-haspopup`.
- **Azioni riservate al viewer** (F07): Discovery offriva al viewer terminale SSH, desktop
  remoto, test credenziali, installazioni, LibreNMS ed eliminazioni, che il server poi
  rifiutava. Regola unica `eAdmin` (`src/lib/permessi/ruolo.ts`, hook `useEAdmin`); per il
  viewer «Apri la scheda».
- **Controllo remoto che spariva su un errore** (F08): una lettura non riuscita diventava
  «nessun nodo». Ora la scheda dice «non riesco a leggere» con il codice e un Riprova.

## [Non rilasciato] — 2026-10-19 · Segnale verso DA-Link: stati dei moduli sulle basi modulari

### Novità

- **MeshCentral negli `stati_componenti`** (terzo modulo della base modulare di
  Deploy-Appliance, 19/10): container `meshcentral`; `operativo` solo se gira e la sua UI su
  127.0.0.1:4443 risponde con un codice < 400 (o col suo healthcheck), mai dal file-segno.
  Senza, con IPAM acceso DA-Link non vedeva lo stato di MeshCentral (VM 900).

- **`stati_componenti` nel segnale verso DA-Link** sulle basi modulari di Deploy-Appliance
  (file `/etc/da-appliance/modules/modular-v1`): IPAM `operativo`, Edge dal container
  (`operativo` solo se healthy, Docker muto = omesso). Perché: sulla base trasmette un
  mittente alla volta, e con IPAM acceso DA-Link mostrava ancora l'ultima fotografia della
  base («ipam disattivato»), vista nel collaudo M5.1 sulla VM 900. Le appliance legacy non
  mandano il campo.

## [Non rilasciato] — 2026-10-18 · MeshCentral: desktop remoto senza agente

### Novità

- **RDP e VNC senza agente** dalla scheda host (card «Controllo remoto»): per gli host senza agente MeshCentral con la
  3389 o la 5900-5902 aperte. La sessione la apre il server MeshCentral dell'appliance, dentro DA-IPAM, senza
  installare niente sulla postazione; le credenziali si inseriscono nella sessione. DA-IPAM crea alla bisogna il
  gruppo «Domarc Senza Agente» e il device. **Spento di default** (`MESHCENTRAL_SENZA_AGENTE=1`), da provare sul
  pilota. Dettagli in `docs/modules/interni/meshcentral-rmm.md`.
- **Terminale SSH dalla scheda host**: con la porta 22 aperta la card «Controllo remoto» offre anche il terminale SSH
  di DA-IPAM (prima solo dal menu di /discovery), con le credenziali salvate dell'host. Non dipende dal flag.

## [Non rilasciato] — 2026-10-18 · DA-Link: nodi delle sedi oltre la prima

Un'appliance per sede per cliente (decisione del 18/10/2026): dalla seconda sede il nodo si chiama
`<codice>-ipam-<n>`.

### Correzioni

- **`DALINK_NODO=<codice>-ipam-<n>` accettato** (n da 2 a 99, senza zeri davanti) in `src/lib/dalink/config.ts` e in
  `scripts/dalink/prepara-netbird.sh`: prima solo `<codice>-ipam`, e un'appliance di seconda sede risultava «non
  valida» (nessun segnale a DA-Link) e non poteva entrare in NetBird. Il codice cliente del nodo deve restare quello di
  `DALINK_CODCLI`.
- **Prove SSH stabili** (`ssh-chiave`, `ssh-connessione-caduta`, `chiave-ssh-percorsi`): la causa non era il carico.
  `utils.generateKeyPairSync("ed25519")` di ssh2 scrive male circa una chiave su 256 (toglie il byte 0 in testa alla
  pubblica) e poi la rifiuta con «Malformed OpenSSH private key». Le prove ora prendono la chiave da `ed25519Prova()`,
  che la rigenera finché ssh2 la rilegge. Solo codice di prova.

## [Non rilasciato] — 2026-10-16 · pannello Zabbix in sola lettura (opzione)

Passo 7.4-7.5 del piano di solidità. Perché: DA-IPAM sapeva solo se il proxy Zabbix gira sulla macchina; il pannello
mostra cosa il centro sa degli apparati di questo cliente, dall'API di lettura per cliente di DA-Zabbix (design
`docs/2026-10-16-api-lettura-per-cliente-design.md` in DA-Zabbix, ancora da approvare: decisioni provvisorie sotto).

### Modifiche

- **Pagina `/zabbix`** (voce «Zabbix» nel menu solo se acquistato, configurato e acceso) e scheda in Impostazioni →
  Moduli, con l'etichetta «Opzione». Stati: non acquistato · da configurare · spento · guasto · attivo. **Senza
  configurazione, spento o non acquistato: zero richieste al centro.**
- **Configurazione nel DB del cliente** (tabelle nuove `zabbix_lettura_config`, `zabbix_abbinamenti` in
  `db-tenant-schema.ts`, `CREATE TABLE IF NOT EXISTS`): indirizzo https del centro, chiave di lettura `zl1.<id>.<segreto>`
  cifrata a riposo e mai restituita, impronta TLS facoltativa (`sha256//…` come DA-Link o SHA-256 del certificato),
  codice cliente atteso (proposto da `/etc/dalink/oggetto.env` se c'è), nome del proxy della macchina (facoltativo:
  altrimenti `Hostname=` del file del proxy). Un indirizzo nuovo vuole la chiave riscritta.
- **Client** (`src/lib/zabbix-lettura/`): TLS sempre verificato, senza interruttore (catena e nome, oppure l'impronta,
  controllata prima di mandare la chiave sullo stesso socket); 5 s per aprire, 15 s in tutto; attesa crescente dopo
  i fallimenti (15 s, 30 s … fino a 5 minuti, persistente, `Retry-After` rispettato), «Riprova adesso» per un admin.
  Ogni risposta deve portare il `codcli` di questa istanza: un altro codice è **«guasto: cliente errato»** e nessun
  dato si mostra. Le risposte si validano con Zod; un campo strano diventa «non so» / «vecchio», mai «sì».
- **Dati vecchi** (§6): con `vecchio: true` o `dati_affidabili: false` la disponibilità è «non so» (accanto l'ultimo
  valore noto), i valori sono segnati vecchi, mai «tutto ok». Guasto: l'ora dell'ultima lettura buona e nessun dato.
- **Abbinamento host ↔ DA-IPAM** (§5): hostid verificato tenuto; IP unico → «proposto» finché una persona non
  conferma; IP condiviso (o doppio in DA-IPAM) → «ambiguo» coi candidati, niente salvato; verificato che cambia IP o
  sparisce → «perso», mai riabbinato da solo. Si salvano solo le conferme.
- **Proxy della macchina come componente locale**: se gira lo dice la macchina, se è in linea lo dice il centro.
  DA-IPAM non lo avvia, non lo ferma e non lo riavvia, nemmeno quando si aggiorna (lo prova un test).
- **Rotte**: `GET /api/zabbix/pannello` (sessione), `POST` stesso percorso = «Riprova adesso» (admin);
  `GET|PUT|DELETE /api/zabbix/config` (admin); `POST|DELETE /api/zabbix/abbinamenti` (admin). Elenco host paginato a
  50, misure chieste solo per la pagina (le sette chiavi della v1). `docs/auth-matrix.md` rigenerata.
- `/api/modules` restituisce anche `pannelli.zabbix` (per il menu, nessuna rete). Il pannello non entra nel catalogo
  dei moduli: il segnale verso DA-Link non cambia (il proxy lo conosce già come `zbx`).

### Decisioni provvisorie (da confermare con Riccardo, domande del §8 del design)

- Strada di rete: overlay NetBird; TLS per catena o per impronta.
- Più sedi: si mostrano tutti gli host del cliente col loro proxy, segnando quelli di questa macchina (filtro «Solo
  questa macchina»).
- Misure: le sette chiavi della v1. Diritto: `opzioneAcquistata("zabbix")`, sempre vero fino alla licenza di DA-Link.

### Installazioni esistenti

Le due tabelle nascono vuote alla prima apertura del DB del cliente. Nessuna configurazione = pannello «da
configurare», nessuna voce di menu, nessun traffico. Oggi l'API del centro non esiste ancora (spenta finché
DA-Zabbix non la pubblica).

## [Non rilasciato] — 2026-10-16 · LibreNMS «appliance» dall'import JSON

Seguito del passo 5 del piano di solidità. Perché: Deploy-Appliance ora dichiara il LibreNMS che installa lui
(`extra.mode = "appliance"` nell'import JSON dei moduli, `mode: "appliance"` nel PUT di ripiego), ma l'import
scriveva sempre `external`, e la scheda proponeva «Converti» a ogni installazione nuova.

### Modifiche

- **Import JSON dei moduli** (`POST /api/modules/import`): per LibreNMS con `extra.mode` uguale a `"appliance"` scrive
  il modo `appliance`; senza `extra.mode` (installatore vecchio), con un altro valore o per Graylog scrive `external`
  come prima. Logica in `modules/import-integrazione.ts` (pura, provata in `import-integrazione.test.ts`).
- Il PUT di ripiego (`/api/integrations/librenms`) accettava già `mode: "appliance"` dal passo 5: niente da cambiare.
- **Installazioni esistenti**: nessuna migrazione. Una riga `external` resta tale finché un import nuovo con
  `extra.mode` o «Converti» non la riscrive.

## [Non rilasciato] — 2026-10-16 · apertura delle interfacce dei moduli: «Verifica» dice perché non si aprono

Passo 4b del piano di solidità del 16/10 (parte DA-IPAM; analisi `2026-10-16-catena-apertura-interfacce-moduli.md`).
Perché: «Verifica» provava solo l'URL dell'API, mai quello che apre il browser. Un'interfaccia che non si apriva dava
un riquadro vuoto o la pagina di login, senza una causa.

### Modifiche

- **Verifica «apertura per il browser»** accanto a quella dell'API, nel modulo comune di salute
  (`verificaAperturaModulo` in `modules/health.ts`, motore `modules/apertura-browser.ts`, URL per modulo
  `modules/apertura-bersagli.ts`, rotta `GET /api/modules/[key]/apertura?origine=…`, sessione richiesta). Esiti:
  certificato non fidato, nome errato, scaduto (tre controlli indipendenti: OpenSSL si ferma al primo), login
  richiesto, riquadro bloccato (X-Frame-Options, CSP `frame-ancestors`, contenuto misto), risposta di un'API invece
  dell'interfaccia, errore HTTP, non raggiungibile, nessun indirizzo. Ogni esito ha la spiegazione in italiano; con un
  problema di certificato, finché non c'è la CA interna di DA-Link, l'istruzione per accettarlo una volta e
  l'**impronta SHA-256** da confrontare. Il certificato si legge senza rifiutarlo e lo si giudica nel codice; la GET che
  segue non porta credenziali. **Modulo spento: nessuna chiamata** (verdetto `off` della sonda, prima di tutto).
- **Pagina dei moduli** (Impostazioni → Moduli): per Scanner-Edge, LibreNMS, Graylog, Wazuh, MeshCentral e controller,
  il riquadro «Verifica» con due righe distinte, «API» e «Apertura per il browser».
- **LibreNMS**: il login automatico si giudica dal contenuto della risposta (rinvio a `/login`, campo password, 419),
  non dalla presenza di `laravel_session`, che Laravel dà anche con la password sbagliata: `/sso` risponde con un errore
  spiegato invece di un 302 verso il login. Prima di usare la sessione in cache si controlla che apra ancora LibreNMS:
  se finisce sul login, cache svuotata e login nuovo (anche nel proxy; `clearLibreNMSWebSessionCache` non aveva
  chiamanti). Il 302 porta a LibreNMS sullo stesso nome con cui il browser ha aperto DA-IPAM, dove finiscono i cookie,
  se LibreNMS è servito da nginx dell'appliance; altrimenti una pagina spiega che l'accesso automatico non può
  funzionare da quel nome. `insecureTls` del login resta (certificato autofirmato dell'appliance), ma la verifica lo
  dice e mostra l'impronta.
- **MeshCentral**: la sessione nel riquadro chiede subito la verifica e mostra la causa vera: certificato (con
  l'impronta) oppure origine non ammessa da `frame-ancestors`, con le origini ammesse e quelle **da ammettere**
  (quella di adesso più l'host dell'appliance). `allowedFramingOrigins` lo scrive l'installatore, non DA-IPAM.
- **Scanner-Edge**: l'URL dell'interfaccia viene dal nodo che serve davvero la 6443 (`resolveEdgeBrowserUrl`: voce
  «edge» del vault scritta dall'installatore, poi host pubblico dell'appliance), non dall'host di `base_url` (in
  consolidated 127.0.0.1, niente pulsante; in full l'IP dell'edge, porta sbagliata). Launchpad, card e verifica usano
  la stessa funzione; `deriveEdgeUiBase` resta solo come ripiego per un edge fuori dall'appliance.
- **Wazuh e Graylog**: la Launchpad e il viewer leggono la stessa fonte (`resolveWazuhBrowserUrl`,
  `resolveIntegrationBrowserUrl`). Il vault si legge con qualunque etichetta del tipo («Wazuh SIEM» dell'installatore
  compresa, mai l'API :55000), non più solo «dashboard». Graylog ripiega sulla 9443 di nginx, non sulla 9000. Le porte
  dell'appliance sono in una tabella sola (`PORTE_UI_APPLIANCE` in `integrations/public-url.ts`).

### Prove

- `modules/__tests__/apertura-browser.test.ts`: server `https.createServer` finti su 127.0.0.1 con certificati
  generati sul momento (`certificati-finti.ts`, X.509 v3 con SAN, senza openssl): fidato, autofirmato, nome errato,
  scaduto, login richiesto, X-Frame-Options DENY, CSP `frame-ancestors`, JSON 401, porta chiusa.
- `integrations/__tests__/librenms-sessione-web.test.ts`: Laravel finto che dà il cookie anche col login sbagliato.
- `modules/__tests__/apertura-moduli.test.ts`: spento = nessuna chiamata; edge in full; Wazuh/Graylog stessa fonte;
  MeshCentral con l'origine non ammessa.

### Da verificare su un'appliance vera

- LibreNMS aperto con un nome diverso da `APP_URL`: se genera link assoluti verso l'IP, i cookie non li seguono.
- Le intestazioni vere di MeshCentral con `allowedFramingOrigins`, e quelle di Graylog e LibreNMS nel viewer.
## [Non rilasciato] — 2026-10-16 · MDM: il job segue l'interruttore, spegnimento automatico spiegato

Passo 3 del piano di solidità del 16/10. Perché: «sincronizzazione automatica abilitata» non creava nessun job
`mdm_sync` (nessuno lo creava), dopo cinque errori l'MDM si spegneva da solo e riaccenderlo lasciava il contatore a
cinque (il primo errore lo rispegneva), e la pagina era aperta anche a chi non è admin.

### Modifiche

- **`saveMdmConfig` allinea il job `mdm_sync`** in una transazione (come `ensureWazuhSyncJobForAllTenants`): acceso →
  il job c'è ed è acceso (creato ogni 60 minuti, o riacceso, mai doppio); spento → il job si toglie. `PUT /api/mdm/config`
  ricarica lo scheduler del tenant quando il job cambia, e ora restituisce l'errore della vista aggregata invece di
  ignorarlo.
- **Riattivare azzera `consecutive_errors`** (anche dopo lo spegnimento automatico); salvare da acceso non lo tocca.
- **Colonne nuove `last_attempt_at` e `last_success_at`** in `mdm_config`: nella CREATE di `db-tenant-schema.ts` e,
  sui DB esistenti, con `ALTER TABLE ADD COLUMN` idempotente nello stesso file (`assicuraColonneMdmConfig`), chiamata
  da `mdm-config.ts` all'apertura della connessione. `db-tenant.ts` non è toccato. `last_sync_at` resta com'era.
- **Pagina /settings/mdm solo per admin** (gli altri tornano a /settings), come le sue API. Lo spegnimento automatico è
  spiegato in pagina (quanti errori, il limite, come riattivare); ultimo tentativo e ultima riuscita separati.
- **Testi**: «Android» al posto di «Android/iOS» (pagina MDM e scheda in Impostazioni).

### Invariato

- Il job resta in tabella dopo lo spegnimento automatico e gira a vuoto («disabled») finché l'admin non salva:
  toglierlo dall'interno del job lascerebbe allo scheduler un cron senza riga.

## [Non rilasciato] — 2026-10-16 · LibreNMS solo locale: modo «Installato dall'appliance»

Passo 5 del piano di solidità del 16/10, parte DA-IPAM. Perché: LibreNMS è integrato e solo locale (decisione di
Riccardo), ma l'installatore dell'appliance lo registra come «Istanza esterna» e la scheda offriva ancora di puntare un
LibreNMS esterno.

### Aggiunte

- **Modo nuovo `appliance`** (`IntegrationMode`): LibreNMS installato dall'installatore dell'appliance. Accettato dove si
  accetta `managed` (PUT `/api/integrations/librenms`); per sync, grafici, accesso automatico e salute vale come
  `external` (URL + token). DA-IPAM non ne gestisce il contenitore: avvio, arresto e rimozione restano solo per `managed`.
  Solo per LibreNMS: Graylog e Loki lo rifiutano (400, motivo in italiano). Logica pura in `integrations/librenms-modo.ts`.
- **«Istanza esterna» sparisce dalla tendina di LibreNMS** per le configurazioni nuove (`vociModalita`); al suo posto
  «Installato dall'appliance». Graylog e Loki come prima.
- **«Converti in «Installato dall'appliance»…»**: unico passaggio da `external` ad `appliance`, nella scheda di
  LibreNMS con conferma in italiano, e `POST /api/integrations/librenms/converti` (solo admin, corpo
  `{ "conferma": true }`). Cambia solo il modo: indirizzo, token e password restano. Rifiutato (409) se il modo non è
  `external` o se manca l'indirizzo.

### Invariato

- **Le righe `external` esistenti restano leggibili e funzionanti**: nessuna migrazione automatica; in tendina compaiono
  come «Istanza esterna (da convertire)». Il PUT continua ad accettare `external`: lo manda ancora Deploy-Appliance
  (`connect.sh`), e così l'import del JSON dei moduli.
- Da fare fuori da qui: censimento in sola lettura su hub, cliente A e pilota; Deploy-Appliance `connect.sh` che scrive
  `appliance`; il kit di DA-Link (K2a).

## [Non rilasciato] — 2026-10-16 · moduli opzionali: campo «offerta» ed etichetta «Opzione»

Passo 4c del piano di solidità del 16/10. Perché: Riccardo ha deciso che MDM, Patch/Chocolatey, MeshCentral, Wazuh e
Zabbix sono moduli opzionali, potenzialmente a pagamento, mentre LibreNMS è integrato. La fonte del diritto sarà la
licenza consegnata da DA-Link, che non esiste ancora: si prepara solo il campo e la presentazione.

### Aggiunte

- **Campo `offerta: "base" | "opzione"`** nel descrittore dei moduli (`modules/registry.ts`), letto dalla tabella pura
  `OFFERTA_MODULO` (`modules/offerta.ts`). Opzioni nel catalogo: Patch Management, MeshCentral, Wazuh. LibreNMS e gli
  altri: base. **MDM e Zabbix non hanno una voce nel catalogo**: non se ne inventa una (l'MDM ha comunque l'etichetta
  sulla sua scheda in Impostazioni → Sistema).
- **Stato di presentazione** delle opzioni, funzione pura `statoOfferta`: non acquistato · acquistato da configurare ·
  spento · attivo · guasto. L'ingresso `acquistato` oggi è sempre vero (`opzioneAcquistata`), col perché scritto nel codice.
- **Etichetta «Opzione»** nella griglia della Launchpad (lo stato nel suggerimento), nelle sezioni del tab Moduli e
  sulla scheda MDM.

### Invariato

- **Nessun blocco e nessun cambio di comportamento** su hub, cliente A e pilota: nessun modulo si spegne, nessuna sonda
  di salute cambia, il segnale verso DA-Link è lo stesso.

## [Non rilasciato] — 2026-10-16 · salute dei moduli: «spento» non è «guasto»

Passo 4 del piano di solidità del 16/10. Perché: su un'istanza appena installata ogni sonda di un modulo spento diceva
`fail` (visto a schermo il 15/10), Patch Management diceva `ok` solo perché l'interruttore era acceso, Inventory Agent
non aveva sonda e Network Services era «ok» con un 200 anche con Unbound fermo.

### Modifiche

- **Verdetto nuovo `off`** (`ModuleHealthVerdict` in `modules/health.ts`): modulo spento o mai configurato, nessuna
  chiamata, status «never» (fuori dal conteggio di errori e avvisi). Vale per Scanner-Edge, Wazuh, LibreNMS, Graylog,
  MeshCentral (ora segue l'interruttore: spento non chiama più il server anche coi parametri rimasti), Network
  Services, Patch, Inventory Agent e controller UniFi. Un modulo **acceso a metà** (LibreNMS o Graylog senza URL,
  Wazuh senza URL, MeshCentral senza parametri, Network Services senza bridge) resta un guasto: `fail`.
- **Patch Management acceso: «locale, non verificato»** (`unverified`) invece di `ok` dedotto dall'interruttore.
- **Inventory Agent ha una sonda**: l'età dell'ultimo inventario ricevuto (`inv_agent_endpoint.last_seen_at`), non
  l'interruttore. Fino a 48 ore ok, fino a 8 giorni degradato (l'intervallo massimo degli agenti è 7), oltre guasto;
  mai ricevuto = degradato.
- **Network Services letto dal contenuto di `/api/v1/status`**: un verdetto per servizio (Unbound, AdGuard, PowerDNS,
  Kea; `network-services/salute.ts`): acceso ok, fermo ma abilitato guasto, fermo e disabilitato spento. Il modulo è
  degradato con un servizio guasto, guasto se nessuno è acceso. La pagina /network-services mostra lo stesso verdetto
  per servizio e, a tutti, «configurazione dalle variabili d'ambiente» quando `source` è `env` (anche nel dettaglio
  della sonda).
- **Consumatori**: Launchpad (pallino e scritta «Spento» / «Locale, non verificato»), dashboard («Locale, non
  verificato» al posto di «Mai eseguita»), «Ripara» (un modulo spento non è riparato: dice di accenderlo),
  notifica di salute dell'appliance (salta i verdetti che non sono una misura).

### Invariato

- **Segnale verso DA-Link**: parte solo la salute dei moduli accesi (più il sistema), e solo con `ok` | `degraded` |
  `fail`. `unverified` va come `ok` (come prima per Patch), `off` non parte (`verdettoPerDaLink` in `dalink/fatti.ts`).
  Inventory Agent acceso ora ha la sua voce.
- **Deploy-Appliance `connect.sh`**: legge `verdict`; un modulo `off` cade nel ramo «health non determinato» (avviso,
  l'installazione prosegue) invece che in `fail`.
## [Non rilasciato] — 2026-10-16 · errori e operazioni lunghe nell'interfaccia dei moduli

Passo 2 del piano di solidità del 16/10. Perché: nella pagina Moduli un errore si vedeva come uno stato («Docker non
trovato», «Non configurato», «Non installato», scheda «Disabilitato») e il polling di un'installazione con la sessione
scaduta, il servizio riavviato o la rete giù girava per sempre senza dire niente.

### Modifiche

- **Caricamenti con `fetchJson` + `LoadError`** in `integration-card.tsx` e `modules-tab.tsx` (stato di Docker, moduli
  opzionali, Network Services, configurazione di LibreNMS/Graylog/Loki): con un errore compare il riquadro «Impossibile
  caricare…» con «Riprova»; durante il caricamento «Caricamento…», non «Non installato».
- **Polling dell'installazione** (integrazioni e Docker) da un modulo puro, `src/lib/integrations/polling-job.ts`, e
  dall'hook `useJobPolling` (un giro alla volta, fermo all'uscita dalla pagina). 401 → «Sessione scaduta», polling fermo;
  404 → «Esito sconosciuto: il servizio è stato riavviato», polling fermo; rete giù o 5xx → messaggio col tentativo
  («tentativo 2 di 5»), e al quinto di fila polling fermo col perché. Il messaggio resta accanto al log.
- **Un solo `toggleServizio`** (`src/lib/network-services/toggle-servizio.ts`) per Network Services e DNS: non lancia
  mai, dà sempre un messaggio; a schermo resta lo stato di prima finché la rilettura del bridge non lo cambia.
- **`job-store.ts`**: log tenuto alle ultime 500 righe (la prima dice quante ne mancano) e job finiti tolti dopo un'ora,
  alla prima creazione o lettura dell'elenco. L'esecutore fuori processo resta nella tappa 4 del piano del 12/10.

### Prove

- `polling-job.test.ts` (200 in corso e finito, 401, 404, 500 fino alla soglia, rete giù, conto azzerato, corpo strano),
  `job-store.test.ts` (tetto del log, pulizia), `toggle-servizio.test.ts` (riuscito, 502, ok:false, 401, rete giù).
## [Non rilasciato] — 2026-10-16 · lo stato dell'aggiornamento nel segnale verso DA-Link

Passo 1d del piano di solidità (metà DA-IPAM; la metà DA-Link è in DA-Link, con le email ad allarmiDA@domarc.it).
Perché: DA-Link vedeva versione e salute, ma non che un'appliance era ferma su un aggiornamento fallito.

### Aggiunte

- **Campo `aggiornamento` nel segnale**: commit avviato, ramo, esito, fase, commit tentato, tentativi e date, da
  `data/aggiornamento.json`. Solo stato: messaggi e avvisi restano sull'istanza (possono contenere percorsi).
  Assente se l'istanza non ha ancora uno stato; una lettura rotta non ferma il segnale.

## [Non rilasciato] — 2026-10-16 · «Aggiorna ora» passa dal servizio d'aggiornamento

Passo 1c del piano di solidità. Perché: c'erano due strade d'aggiornamento. Il timer usava `update.sh` (ora con
build separata, salute e ritorno indietro), mentre «Aggiorna ora» faceva pull, `npm install` e build dentro il
processo acceso, sopra la sua `.next`, con un ritorno indietro tutto suo.

### Cambiate

- **«Aggiorna ora»** (Impostazioni → Aggiornamenti e banner) lascia `data/aggiornamento-richiesto` e avvia
  `<servizio>-update.service` con `systemctl --no-block start`. La rotta non esegue più comandi; risponde
  `started` con l'ora della richiesta. `auto-update.sh` consuma il file e lo tratta come
  `DA_INVENT_FORZA_AGGIORNAMENTO=1`: chi preme il pulsante riprova anche un commit già fallito 3 volte.
- **Ogni giro di `auto-update.sh` lascia il suo esito** in `ultimo_controllo` (già aggiornato, solo documentazione,
  aggiornamento avviato, commit fallito in attesa, fetch fallito), così il pulsante non resta mai senza risposta.
- **Scheda «Stato dell'aggiornamento»**: codice scaricato e avviato, ultimo tentativo con fase, esito, tentativi e
  avvisi. Dopo il clic la segue fase per fase anche durante il riavvio (fino a 5 minuti senza risposta), e a
  esito riuscito ricarica la pagina. Un aggiornamento già in corso all'apertura si segue lo stesso.
- «Riavvia» controlla la build in uso (`.next-attiva`), non per forza `.next`.
- Fuori da systemd (sviluppo) «Aggiorna ora» spiega di usare `scripts/update.sh --restart`.

### Documenti

- Piano del 12/10: MDM, GLPI e «Verifica» per modulo nella tappa 6; la tappa 9 riscritta (elenco delle
  appliance e stato dell'aggiornamento a DA-Link, nessun comando verso le appliance).

## [Non rilasciato] — 2026-10-16 · aggiornamento automatico: ritenta e non lascia l'app rotta

Passo 1 del piano di solidità (1a + 1b). Perché: `auto-update.sh` confrontava origin con HEAD, e HEAD avanza col pull
prima del build. Un build fallito lasciava HEAD = origin, il giro dopo diceva «già aggiornato» e non ritentava più;
intanto il build era stato fatto sopra la cartella `.next` del processo acceso.

### Cambiate

- **Build in una cartella separata**: `update.sh` costruisce nella cartella libera fra `.next-a` e `.next-b` mentre
  l'app continua a girare dall'altra (provato: 141 richieste su 141 a 200 durante un build). Il nome della cartella in
  uso sta in `.next-attiva`, letto da `next.config.ts`; si cambia solo a build riuscita. Perché: Next scrive la
  cartella dentro i file compilati, quindi una build non si può rinominare dopo.
- **Controllo di salute dopo il riavvio**: fino a 90 s (`DA_INVENT_ATTESA_SALUTE`) per un 200 da `/api/health`; se non
  arriva, torna al commit e alla cartella di prima (con `npm install` se è cambiato il lock) e riavvia.
- **Stato su file** (`data/aggiornamento.json`, `scripts/stato-aggiornamento.mjs`): commit avviato, ultimo tentativo
  con fase, esito, tentativi e avvisi. `auto-update.sh` confronta origin col commit avviato e ritenta un commit fallito
  al massimo 3 volte (`DA_INVENT_MAX_TENTATIVI`), poi aspetta un commit nuovo; `DA_INVENT_FORZA_AGGIORNAMENTO=1` riprova
  subito. Un giro morto a metà conta come «interrotto». Lo leggeranno la pagina Aggiornamenti e il segnale verso DA-Link
  (passi 1c e 1d).
- **Solo documentazione** resta senza build né riavvio, ma solo se la build accesa è quella di HEAD.

### Invariato

- Al primo giro senza stato si assume che HEAD giri, come prima. Le installazioni con la sola `.next` passano alle due
  cartelle al primo aggiornamento riuscito.

## [Non rilasciato] — 2026-10-16 · topologia: unire e separare a mano gli oggetti della mappa

Piano `docs/superpowers/plans/2026-10-16-apparati-multihomed-unisci.md`, decisione in ADR 0021. Perché: un apparato con
più schede su più reti (il NAS dell'hub: quattro indirizzi, tre reti, MAC diversi) era tre oggetti sulla mappa, e nessuna
regola automatica può dire che sono uno solo. Riccardo (16/10): **nessuna regola automatica nuova, si unisce solo a mano**.

### Aggiunte

- **«Unisci con…» e «Separa…»** nel tasto destro della mappa (di oggi e per cavo), nella scheda dell'oggetto (sezione
  «Sulla mappa») e nella barra della Discovery («Unisci (N)…» con più righe). Solo gli admin; prima di scrivere
  un'anteprima obbligatoria («Vedi cosa succede»). Perché: decidere l'oggetto giusto vedendo che cosa cambia.
- **«Separa…» toglie anche una fusione automatica sbagliata** (per MAC, nome, apparato fisico), mai l'indirizzo
  dell'apparato né quello con l'IP di gestione. Perché: oggi una fusione sbagliata non aveva rimedio.
- **Due tabelle nel DB del cliente** (`topology_unioni`, `topology_separazioni`), migrazione additiva e idempotente
  all'apertura; le righe non si cancellano mai (chi e quando restano). Perché: `physical_device_id` lo riscrive il
  risolutore e guida le scansioni, che un gesto sulla mappa non deve toccare.
- **`misura-cavi --unisci/--separa/--unioni`**: le unioni in memoria su una copia, prima di farle davvero.
- **Ogni «Unisci» in un gruppo nuovo**, con un 409 chiaro se cambierebbe un'altra unione già fatta. Perché: con «il gruppo
  più basso» un'unione nuova poteva portare via un indirizzo a una vecchia senza dirlo (revisione finale, casi provati).

### Invariato

- **Senza righe la mappa è identica a prima**, nelle due mappe (impronte uguali sulle copie dell'hub e del cliente A).
  «Stesso device fisico» delle scansioni resta com'è: convivono due funzioni simili (confermato da Riccardo).

## [Non rilasciato] — 2026-10-16 · credenziali 2g (T27): via colonne e tabelle vecchie, archivio unico completo

**Rilasciata e applicata il 16/10** (v0.3.310): pulizia su hub, cliente A e pilota fra le 16:12 e le 16:19, ognuno
con il suo backup accanto; sull'hub prima un `VACUUM` della rete principale, perché le 4 pagine «never used» facevano
fallire (giustamente) il controllo del backup. Controller e Active Directory riletti subito dopo: tutti «ok».

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md`, sotto-tappa 2g, Task 27. Perché: dal T26
nessuno legge più le fonti vecchie, ma i segreti sono ancora lì, fuori dall'archivio (colonne di `network_devices`,
di `network_controllers` e di `ad_integrations`, catene vecchie). La pulizia dei dati è **uno script**, non una
migrazione di `getTenantDb`: su un'appliance che riceve `main` girerebbe all'apertura, senza prova a vuoto, backup e
conferma. Lo lancia la sessione principale sul server, a servizio fermo, con l'ok di Riccardo per ognuno.

### Aggiunte

- `scripts/credenziali/pulizia-t2.ts` (regole in `src/lib/credentials/pulizia-t2.ts`): a vuoto di base, coi nomi a
  terminale; `--applica` chiede la conferma scritta (il codice del tenant), fa il backup `.bak-YYYYMMDD-HHMMSS`
  accanto al DB (spazio controllato prima) e pulisce un tenant alla volta, in una transazione col segno
  `credenziali_t2_pulizia`. Prima controlla le condizioni del T26 (segni chiusi, lasciati della 2e uguali a
  `--lasciati-accettati`, nessuna riga Omada, registro dei ripieghi a zero dal rilascio della 2f: niente attesa di
  giorni). Due modi sempre dichiarati: `--copia` (guardia delle copie) o `--servizio <unità>` (dati veri: servizio e
  timer dell'aggiornamento devono essere fermi, letti da `systemctl show`, perché `is-active` di un'unità che non
  esiste risponde «inactive» come un servizio fermo).
- `scripts/credenziali/togli-chiavi-hub.ts`: toglie da hub.db le due chiavi «di default» (D3) e le
  `integration_unifi_*`, solo quando nessuno le leggerà più (con un tenant attivo, la sua 2d e la sua migrazione
  UniFi devono essere già fatte; altrimenti restano, col perché). A vuoto stampa solo i nomi, mai i valori.

### Modifiche

- **Cosa si svuota** (decisioni di Riccardo del 16/10): le colonne dei soli apparati lasciati accettati che hanno
  già un binding equivalente (la definizione della 2e, ora una funzione sola usata da conversione e pulizia); un
  apparato con una colonna piena fuori dall'elenco, uno accettato con una colonna senza equivalente o un binding
  inline **bloccano il tenant**, elencati. Controller e AD si svuotano (`''`) solo dove c'è la voce: le righe senza
  voce restano com'erano e si elencano. Le due tabelle delle catene vecchie si tolgono con due `DROP` nella stessa
  transazione: se una fallisce torna indietro tutto. L'elenco dei lasciati accettati va nel segno.
- **Ripieghi da confermare**: il registro scrive caso, tenant e firma, non l'apparato. Con dei lasciati accettati,
  i `cred_colonna_apparato` dal rilascio della 2f possono venire proprio da loro: non bloccano da soli, si stampano
  per firma col conteggio e si confermano nella stessa conferma scritta, col numero (`<tenant> <n>`). Lo script
  delle condizioni del T26 li dice «DA CONFERMARE» (uscita 3), mai «in regola».
- **Schema dei tenant nuovi senza le catene vecchie** (`network_host_credentials`, `host_detect_credential` e il loro
  indice): un tenant nuovo nasce senza, la 2d non ha niente da convertire. Nei DB di prima le toglie la pulizia.
- **Script di misura della topologia e dei MAC per porta**: l'utente del controller viene dalla voce (la colonna
  della riga, dopo la pulizia, è vuota); senza voce o se non si decifra, errore invece di un utente vuoto.

### Correzioni della revisione

- **`--servizio da-ipam.service` apriva il freno del timer.** La guardia ricavava il timer come
  `<unità>-update.timer`, quindi guardava `da-ipam.service-update.timer`, che non esiste, e lasciava scrivere col vero
  `da-ipam-update.timer` acceso (pull, npm install e build sotto lo script). Ora il nome si accetta con o senza
  `.service` e timer e aggiornamento si ricavano dal nome dell'app; un altro suffisso o un punto nel nome è un errore.
  Il timer che non c'è passa solo se non c'è nemmeno `<app>-update.service`; e deve essere fermo anche
  `<app>-update.service`, perché fermare il timer non ferma un aggiornamento già partito, che alla fine riavvia il
  servizio. Gli script stampano le tre unità guardate col loro stato.
- **Via `--dal`** da `pulizia-t2.ts` e `condizioni-2g.ts`: sostituiva la data del segno della 2f anche con una data più
  tarda, e un ripiego vero dopo il rilascio spariva dal conto (con `--applica` la pulizia partiva). I ripieghi contano
  dalla data del segno, come dice il piano. I due script rifiutano le opzioni che non conoscono (uscita 2): ignorata,
  un'opzione tolta o scritta male farebbe girare lo script senza quello che si credeva di chiedere.

### Effetto accettato

- Dopo la pulizia i due apparati lasciati dell'hub non hanno più nemmeno le colonne: restano senza credenziale
  valida finché una Prova dalla scheda non riesce (il binding fallito resta, ed è la strada per tornare ad avere
  accesso). Tornare indietro dalla pulizia vuol dire il `.bak` di quel tenant: si perde quello che è stato scritto
  dopo l'ora del backup.

## [Non rilasciato] — 2026-10-16 · credenziali 2g (T26): il vecchio non si legge più

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md`, sotto-tappa 2g, Task 26. Perché:
dalla 2e e dalla 2f le credenziali stanno nell'archivio, ma il motore e i lettori ripiegavano ancora sui posti
vecchi; finché li leggono, svuotarli (T27) cambierebbe in silenzio la credenziale di qualcuno. Due decisioni di
Riccardo del 16/10: **niente attesa di 14 giorni** (D9 rivista: bastano i segni chiusi, il registro dei
ripieghi a zero dal rilascio della 2f e i giri del giorno andati bene) e **i due apparati lasciati dell'hub
accettati così**.

### Modifiche

- **Il motore legge solo l'archivio**: niente più binding inline, colonne di `network_devices`
  (`credential_id`, `snmp_credential_id`, utente e password, `community_string`, `api_token`), catene vecchie
  (`network_host_credentials`, `host_detect_credential`) né chiavi «di default» dell'hub, nemmeno in un tenant
  senza il segno della 2d. Il «public» dichiarato (D5) resta. Perché: erano i ripieghi che la 2g toglie, e un
  tenant mai convertito li avrebbe ripresi.
- **Effetto accettato da Riccardo (16/10)**: sull'hub i due apparati che la 2e ha lasciato (binding fallito
  verso la stessa voce della colonna, uno SSH e uno WinRM) da qui hanno la scelta «nessuna» e restano senza
  credenziale valida finché una Prova dalla scheda non riesce.
- **Controller e AD senza voce dicono «Credenziale mancante»**, qualunque sia il segno della 2f: le colonne della
  riga non si leggono più e la «forma vecchia» sparisce dalla finestra del controller e dalla pagina AD. Le
  righe Omada lasciate dalla 2f restano senza voce, e bloccano la pulizia.
- **Gli usi di una voce** (D8) non contano più colonne dell'apparato, catene vecchie e pin: una voce rimasta
  solo lì si può eliminare (le colonne hanno ON DELETE SET NULL).
- **La prova dalla finestra** (apparato non salvato) porta le voci scelte (`voci_provvisorie`), non più le
  colonne dell'oggetto.
- **Le rotte degli apparati non mandano più le colonne vecchie**, nemmeno mascherate: una `SELECT *` le
  porta ancora e un segreto rimasto (cifrato) non deve uscire.
- **Export e import**: catene vecchie e pin non si esportano più; un bundle di prima della 2d si importa anche
  in un DB senza quelle tabelle, con le righe convertite in memoria (tabelle temporanee) nella lista della
  rete e nelle righe host, con le regole di sempre. La conversione della 2d su un DB senza le tabelle vecchie
  non ha niente da convertire (`done:`).
- **La conversione della 2e** ricostruisce lei la scelta di prima (binding inline e colonne passati al motore
  solo per il suo controllo «prima/dopo»): serve ancora per i bundle di prima e per le appliance che arrivano
  da prima della 2e; senza, ogni apparato con le sole colonne risulterebbe lasciato, cioè senza accesso.

### Tolte

- `getHostDetectCredentialId`, `setHostDetectCredential`, `getNetworkHostCredentialIds`,
  `replaceNetworkHostCredentials` (le due gemelle): nessuno le chiamava più.
- `resetConfiguration` (le due gemelle) non nomina più le due tabelle vecchie: dove ci sono, le loro righe se ne
  vanno con la cascata; dove la pulizia le avrà tolte, la DELETE avrebbe fatto fallire tutto il reset.
- I campi vecchi delle credenziali dal tipo `NetworkDevice` e da chi li scriveva (a NULL). Le colonne restano
  nello schema: toglierle vorrebbe dire ricostruire la tabella più collegata.

### Aggiunte

- `scripts/credenziali/condizioni-2g.ts`: le condizioni per partire con la 2g, sulla copia dei dati, in sola
  lettura (segni, lasciati della 2e e della 2f ricalcolati a vuoto, registro dei ripieghi dal rilascio della
  2f). Un `parziale:` della 2e passa solo con `--lasciati-accettati <tenant>:<id>,<id>` uguale ai lasciati di
  adesso: mai dedotto, mai di default. La regola sta in `src/lib/credentials/condizioni-2g.ts`, che userà anche
  la pulizia (T27).

## [Non rilasciato] — 2026-10-16 · topologia T3: la mappa per cavo, spenta per cliente

Spec `docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md` §13.11.4, piano
`docs/superpowers/plans/2026-10-15-topologia-collegamenti-T3.md`, decisione in ADR 0020. Perché: la mappa di oggi
disegna una linea per coppia e un albero dalle tabelle degli indirizzi; la mappa nuova disegna una linea per
cavo e l'albero dallo spanning tree, ma due modelli che decidono lo stesso albero si accendono solo uno
alla volta. **Con l'interruttore spento la mappa è identica a prima** (impronte uguali sulle copie dell'hub e
del cliente A, dopo ogni correzione).

### Aggiunte

- **La mappa nuova, per cliente, spenta**: «Dati della mappa → Mappa nuova» (`topologia.mappa.cavi`, solo
  gli admin accendono e spengono). Perché per cliente: si accende dove ogni differenza della traccia è
  spiegata, e si spegne con un clic se qualcosa non torna (torna la mappa di prima, nessun dato perso).
- **«Anomalie della rete»** in «Dati della mappa»: i casi in cui l'albero non regge (per esempio un core sotto un
  accesso), per nome, con la porta. Perché: oggi si vedono solo guardando la mappa.
- **«Candidati per porta»** nel pannello dell'oggetto: per ogni porta, gli apparati che la sentono e le prove (da
  quale lettura, a che ora). Perché: scegliere il cavo giusto per una ★ senza indovinare.
- **Ruoli «Core» e «Accesso»** nel menu del ruolo, accanto a «Apparato di rete», «Attaccato» e «Decide il
  sistema». Perché: l'albero ha una testa e una gerarchia, e a volte la rete non la dice.
- **Tipo «tunnel»** per i collegamenti a mano. Perché: un tunnel fra due sedi non è un cavo e non va confuso
  con uno.
- **Il nodo scelto evidenzia i suoi collegamenti** (ciano pieno, gli altri sbiaditi; lo spessore dice ancora la
  velocità). Richiesta di Riccardo sulla bozza; solo con la mappa nuova.
- **Istanze MSTP sui bridge MikroTik in MSTP**: 2 comandi in più in sola lettura (`/interface bridge msti
  print` e il suo `monitor`), **solo su quei bridge**; sugli altri i comandi restano 6 (router) e 8 (switch).
  Perché: un tunnel fra due bridge della stessa regione può essere bloccato nell'albero comune e attivo per
  alcune VLAN; senza le istanze si vede solo «bloccato».
- Una ★ vale **per collegamento**, non più per coppia; il segmento è un oggetto con le sue voci («Togli dal
  segmento»); un fascio si ignora cavo per cavo. Perché: con due cavi fra due apparati la coppia non
  dice quale.

### Correzioni

- **Un fatto vecchio non fa più «giù» un cavo visto oggi** (M5): un `running = 0` di 90 giorni fa, di una fonte
  non più letta, diventava «giù» anche se il cavo era visto oggi da un'altra. La soglia usa l'orologio passato
  alla funzione.
- **`PUT /api/topology/settings/letture` ha le sue prove** (M6): prima nessuna prova ne fissava il comportamento
  (corpo non valido, apparato non disponibile).
- I quattro casi trovati misurando sui dati veri fanno parte del **modello nuovo**, non sono correzioni della
  mappa di prima (che resta com'è): una porta che sente due apparati non dà un cavo; un bond è il suo fascio e
  mai «instradato»; un router o firewall dentro una VM sta dentro il suo hypervisor; due porte con lo stesso
  nome si distinguono per indice. I collegamenti «dalle VM» non principali stanno nei dettagli
  dell'hypervisor («visto dalle VM anche su ‹porta›»). Perché: la misura sul cliente A ne ha trovati 2, tutti
  verso lo stesso hypervisor, nessuno nella mappa attesa.
- Nessuna migrazione: nessuna tabella o colonna nuova.

## [Non rilasciato] — 2026-10-16 · credenziali tappa 2f: controller e AD dall'archivio

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2f, zona rossa).
Perché: chiave e password dei controller UniFi e l'account LDAP dell'AD stavano nelle righe delle loro tabelle,
fuori dall'archivio: non si vedevano nella pagina Credenziali e non si potevano riusare né contare fra gli usi.

### Modifiche

- **Le credenziali dei controller e dell'AD diventano voci dell'archivio, una volta sola**
  (`converti-integrazioni.ts`, segno `credenziali_t2_integrazioni`): «UniFi · <nome>» (chiave, oppure utente e
  password: anche una console UniFi OS con utente locale, ADR 0019) e «AD · <nome>». Per ogni riga il segreto
  si decifra in memoria prima e dopo e deve essere uguale, altrimenti ROLLBACK. Le colonne vecchie restano
  piene fino alla 2g, per poter tornare al codice di prima.
- **Controller e AD leggono la voce**. Le colonne della riga valgono solo per una riga mai convertita, e il
  ripiego si registra; con la conversione chiusa una riga senza voce dice «Credenziale mancante» e non parte
  nessuna connessione.
- **Un cambio d'indirizzo del controller o del DC scollega la voce e svuota le colonne** (D12), a meno che la
  stessa richiesta non scelga di nuovo una voce: così una chiave o una password non partono verso un host
  nuovo che nessuno ha confermato.
- Una voce di controller o di AD non si elimina finché è in uso (409 con l'uso elencato).
- Il WinRM del DHCP dell'AD e la sonda WinRM accettano solo una voce Windows e usano la sua porta (prima
  5985 fissa).
- Nella finestra del controller una voce nuova vuole tutti i campi del suo metodo; il server rifiuta un
  utente nuovo senza password invece di scartarlo.
- **Omada**: le righe Omada non si convertono (Omada non si legge ancora e i suoi segreti non hanno un
  formato): si lasciano come sono e il segno resta `parziale:`. Oggi non ce ne sono.

## [Non rilasciato] — 2026-10-16 · credenziali tappa 2e: le credenziali degli apparati nell'archivio

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2e, zona rossa).
Perché: le credenziali di un apparato stavano in tre posti (binding d'archivio, binding «inline» con utente e
password nel binding, colonne vecchie di `network_devices`), e la pagina ne mostrava uno solo; un «Nessuna»
scelto dall'utente poteva essere scavalcato da una colonna invisibile.

### Modifiche

- **Binding inline e colonne vecchie diventano voci e binding d'archivio, una volta sola**
  (`converti-apparati.ts`, segno `credenziali_t2_apparati`): ogni inline diventa la voce «<apparato> ·
  <protocollo>» con lo stesso segreto cifrato e la stessa storia di prova; una colonna senza binding equivalente
  diventa un binding non provato; poi le colonne si svuotano. Per ogni apparato si controlla che la scelta resti
  la stessa leggendo solo i binding (impronta e porta): se cambierebbe, l'apparato si lascia com'era e si elenca.
- **Chi scrive scrive solo nell'archivio**: creazione dell'apparato, modifica del singolo, modifica in blocco,
  assegnazione ai router delle reti, apparato DHCP del DC, tabella delle credenziali dell'apparato. Una voce
  scelta va in testa ai binding del protocollo e quelli che c'erano restano con la loro storia; «Nessuna» toglie
  i binding di quel protocollo dopo una conferma che dice quanti (anche quelli riusciti).
- **Una voce scelta che è già fallita su quell'apparato resta esclusa, e la risposta lo dice** (prima passava
  per riuscita).
- **Utente senza password** in creazione o modifica: 400, invece di un binding incompleto.
- Il token di Omada viene dall'archivio; il wizard del router trova la voce da sostituire fra i binding.
- `delete`/`update` di un binding di un altro apparato rispondono 404 (prima lo cancellavano).

## [Non rilasciato] — 2026-10-16 · credenziali tappa 2d: una lista sola per rete

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2d, zona rossa).
Perché: le credenziali di una rete stavano in tre posti (lista della rete, catene vecchie per ruolo, chiave
«di default» dell'hub) e in un quarto per host (i pin del rilevamento); la pagina ne mostrava uno solo.

### Modifiche

- **Catene vecchie e pin entrano nella lista della rete, una volta sola** (`converti-catene.ts`, segno
  `credenziali_t2_catene`): le voci già presenti non si duplicano, quelle di un tipo che non vale per il
  protocollo si saltano e si contano. Le tabelle vecchie restano congelate fino alla 2g.
- **Il motore non legge più catene vecchie né chiave dell'hub** dopo la conversione: una voce tolta dalla
  lista non torna, e sull'hub la chiave «di default» non si accoda più alle reti.
- **Rilevamento sul motore** (Windows, SSH, fase 4 della scansione completa): prova prima la voce che
  funzionava, poi il resto della lista; prima un pin provava solo se stesso e un host con la password
  cambiata restava non rilevato. La scansione completa non salta più la fase SSH con la lista vuota.
- **Reti**: i quattro campi per ruolo si accodano alla lista con un avviso; la GET non restituisce più le
  catene vecchie. `detect_credentials` dell'host risponde 400 («campo superato»). Via la scheda «Credenziali
  host di default» da Impostazioni → Sistema.
- **Anteprima per lo scanner edge**: gli slot vengono dalla catena del motore, uguali prima e dopo.
- **Usi di una voce**: catene e pin congelati non contano più; una voce tolta dalla lista si elimina.
- **Import**: un bundle esportato dopo la 2d (segno chiuso) non si riconverte, così le voci tolte non
  tornano; un bundle di prima si converte come prima.

## [Non rilasciato] — 2026-10-16 · credenziali tappa 2c: archivio coi tipi per esteso

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2c, zona rossa), ADR 0017.
Perché: la spec chiede otto tipi per esteso e un archivio unico; il CHECK della tabella ne ammetteva cinque.

### Modifiche

- **La tabella `credentials` si ricostruisce una volta senza il CHECK sui tipi**, partendo dalla sua
  definizione attuale, con figli, violazioni e contatore degli id controllati prima e dopo (se non tornano,
  ROLLBACK). I tipi validi stanno in `src/lib/credentials/tipi.ts`.
- **«Linux» confluisce in SSH** ovunque (sull'hub 1 voce convertita, stesso id e stesso segreto); le v3 vecchie
  diventano del tipo SNMP v3. Un segno in `tenant_settings` impedisce di rifare la conversione.
- **Chiave SSH** come metodo della voce SSH, nel trasporto principale (D6); paramiko e il terminale la
  rifiutano con un messaggio. Una password SSH sbagliata ora dà subito «credenziali rifiutate» invece di un
  timeout dopo 15 secondi (i fallimenti registrati passano da [connect_timeout] ad [auth_failed]).
- **Pagina Credenziali e API sui tipi per esteso**: eliminare una voce in uso risponde 409 con l'elenco degli
  usi (D8); una voce non si lega più a un protocollo per cui non vale (400); le API non restituiscono più le
  colonne `encrypted_*` ma `ha_*`; la creazione rapida offre solo i tipi del protocollo.
- **Finestra «Modifica Rete»**: salva rete e lista credenziali in un colpo solo e un errore si vede; una rete
  senza gateway si salva; le catene vecchie nascoste non vengono più riscritte.
- `PATCH /api/hosts/bulk-update` restituisce `credentials_failed`: prima l'errore si ingoiava.
- **Attenzione all'export**: un bundle esportato da questa versione, importato in un'installazione di prima
  della 2c, viene annullato per intero se contiene voci SNMP v3, UniFi, Omada o AD; le voci SSH a chiave vi
  arrivano senza la chiave.

## [Non rilasciato] — 2026-10-16 · la porta segue il protocollo anche in modifica

- **Nella finestra di modifica dell'apparato la porta segue il protocollo, e una porta di un altro protocollo
  si segnala.** Perché: sul pilota un MikroTik creato in SNMP e passato a SSH dalla modifica è rimasto con
  protocol=ssh, port=161 (la finestra non aveva il campo porta), e l'acquisizione SSH, che usa la porta
  dell'apparato, falliva: niente tabella MAC né vicini, col binding SSH sulla 22 provato con successo. Ora la
  finestra mostra la porta e la manda nel PUT se cambiata; cambiando protocollo la porta passa a quella del primo
  binding del nuovo protocollo (la stessa regola del motore: un binding SSH sulla 2222 dà 2222), poi a quella
  propria della credenziale compatibile, poi allo standard (SSH 22, WinRM 5985, API 443). Verso SNMP la porta non
  si tocca: per un apparato SNMP è quella del ripiego SSH della tabella MAC, e portarla a 161 lo rompeva.
  Tornando al protocollo salvato torna la porta salvata, una porta scritta a mano dopo il cambio resta, e Proxmox
  tiene la porta dell'API. PUT e creazione restituiscono un avviso (non un rifiuto) se la porta
  è lo standard di un altro protocollo: un rifiuto bloccherebbe anche il cambio del nome degli apparati già
  storti, e Proxmox tiene la porta dell'API anche in SSH.
- **Le scansioni non spostano più un apparato SSH su una porta che non è SSH.** Se la porta salvata non risulta aperta, si cercano prima le porte del protocollo (22, 2222); le porte del produttore (per MikroTik 8291 Winbox e 8728 API) valgono solo per l'accesso API. Prima uno switch MikroTik in SSH finiva sulla 8291 e la lettura SSH continuava a fallire (pilota, 16/10).

## [Non rilasciato] — 2026-10-16 · una firma di porte non è un modello

- **Il modello non viene più dall'impronta di sole porte, e quello già scritto così si corregge.** Perché: sul
  pilota il UniFi Cloud Gateway Fiber (192.168.99.250) aveva modello «QNAP QTS», perché la firma 8080+22+443
  vinceva fra le porte aperte, e le scansioni successive lo preservavano anche davanti al sysDescr SNMP. Ora
  l'etichetta dell'impronta fa da modello solo se c'è una fonte che non sia di porte o TTL (SNMP, banner, regola su
  sysDescr/OID/hostname/MAC, profilo vendor); il sysDescr «Ubiquiti UniFi UCG-Fiber 5.1.33 …» dà `UCG-Fiber`; un
  modello salvato uguale all'etichetta di un'impronta di sole porte viene sostituito dal modello nuovo o azzerato
  alla scansione successiva. I modelli scritti a mano, da SNMP o dagli agenti non si toccano.
- **Correzioni dalla revisione.** Perché: banner HTTP/SSH, SNMP e SMB entrano fra le fonti appena la sonda risponde
  ma non decidono l'etichetta, e col banner della porta 22 «QNAP QTS» tornava modello; ora contano solo una regola
  con una condizione non di porte o il profilo vendor. Il modello si azzera solo se TUTTE le impronte con
  quell'etichetta sono di porte: una scansione senza SNMP non cancella più un «QNAP QTS» venuto da una regola OID
  (le regole del seed condividono le etichette). Senza una colonna sulla provenienza resta un salto: due scansioni
  di sole porte di fila lo azzerano alla seconda. L'override del profilo vendor è una funzione provata.

## [Non rilasciato] — 2026-10-16 · credenziali tappa 2b: un motore solo sceglie le credenziali

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2b, nessun dato toccato).
Perché: sette funzioni sceglievano la credenziale con ordini diversi; ora le sceglie un motore solo
(`src/lib/credentials/resolve.ts`), che legge anche le fonti vecchie come fonti dichiarate e registrate.

### Modifiche

- **L'acquisizione degli apparati, l'inventario, le patch e il terminale scelgono col motore unico.** Sugli
  apparati resta sulle fonti dell'apparato (binding, inline, colonne), come prima (D1b).
- **Un binding che ha fallito la prova si salta** finché una prova non riesce (D10): l'apparato passa al
  candidato successivo fra le sue fonti, o resta senza credenziale invece di usarne una che non funziona.
  Fotografia sulla stessa copia dei dati del 15/10: sull'hub 3 apparati cambiano per questo (2 WinRM restano
  senza credenziale, 1 SSH passa alla voce d'archivio successiva).
- **Le chiavi globali dell'hub entrano nelle catene delle reti solo se puntano a una voce che esiste ed è del
  tipo giusto** (sull'hub, nel secondo tenant, spariscono da una rete dove non puntavano a niente).
- **Un apparato con l'SNMP solo in un binding risulta «ha SNMP»**: per access point, stampanti, telecamere e
  simili il piano di acquisizione diventa «periferica SNMP» (al cliente A: 2 ponti radio classificati access
  point, che prima erano letti come switch con la tabella MAC via SSH).
- **Patch: le righe WinRM in fermo non si usano più**; il ripiego sull'account dell'AD resta, dentro il motore
  (D4). Corretto prima del rilascio l'ordine con più integrazioni AD.
- Le scelte delle fonti vecchie (colonne, catene vecchie, chiave dell'hub, «public») si annotano nel registro
  dei ripieghi: servono a decidere quando togliere il vecchio (2g).

## [Non rilasciato] — 2026-10-16 · controller UDM anche con utente locale e password

Chiesto da Riccardo il 16/10 (ADR 0019). Perché: sull'appliance pilota il controller è un UDM con un account
locale (`rgadmin`) che non può creare la chiave API, l'unico modo con cui si leggevano le console UniFi OS; salvato
come self-hosted falliva sempre, anche con la password giusta, senza dire perché.

### Modifiche

- **UDM / console UniFi OS: «Chiave API» oppure «Utente locale e password»** nella finestra del controller. Con
  l'utente: `POST /api/auth/login`, letture col cookie `TOKEN` e il CSRF, `POST /api/auth/logout` alla fine; stesso
  certificato fissato al primo uso. Il metodo scelto viaggia col salvataggio e il server rifiuta i campi dell'altro
  (una password scritta senza utente non sparisce più lasciando entrare la chiave salvata); niente colonne nuove; un
  controller self-hosted con utente e password passa a UDM senza riscrivere la password.
- **Login rifiutato detto chiaro e mai ritentato**: 401 utente o password, 403 (o 499) account senza permessi
  sull'app Network o con la 2FA, 429 console che ha bloccato i tentativi. Un secondo tentativo potrebbe bloccare
  l'account. Un 404 o un rinvio al login dicono che l'indirizzo non è una console UniFi OS (tipo self-hosted).
- **«Questo indirizzo è una console UniFi OS: scegli UDM»**: lo dicono la prova e il salvataggio di un controller
  self-hosted puntato a un UDM (una `GET /` anonima, dal suo cancello: niente corpo, niente cookie, chiave o CSRF).

## [Non rilasciato] — 2026-10-15 · credenziali tappa 4: il wizard usa l'archivio delle credenziali

Proposta approvata da Riccardo il 15/10. Perché: il wizard apriva, ma chiedeva le stesse cose di prima. Il router
voleva utente, password e community in linea (finivano sull'apparato, fuori dall'archivio), il passo «Credenziali»
richiedeva di nuovo SNMP, SSH, Windows e Linux in quattro blocchi fissi (una voce per tipo) e la subnet sceglieva
solo fra quei quattro. «Indietro» ignorava quanto già creato ed «Esci» dimenticava il punto raggiunto.

### Modifiche

- **Credenziali per prime**: il primo passo mostra l'archivio (nome, tipo, utente mascherato, porta) e lo gestisce
  con lo stesso modulo della pagina Credenziali, ora un componente condiviso: più voci per tipo, modifica ed
  eliminazione, nessuna obbligatoria. I tipi sono quelli che l'archivio accetta, con le etichette di
  `credentials/tipi.ts` («Linux» come SSH): i tipi nuovi delle sotto-tappe 2c/2f compaiono da soli.
- **Router dall'archivio**: «Credenziale» e «SNMP per porte/LLDP» sono tendine delle voci adatte all'accesso
  (regola unica tipo ↔ protocollo), con «nuova nell'archivio» che crea e seleziona, e «Prova connessione».
  Tornando indietro il router già creato si modifica, mandando solo i campi toccati (`/api/onboarding/router`).
- **Active Directory**: la credenziale WinRM si sceglie fra le voci Windows dell'archivio.
- **Prima subnet**: tutte le voci dell'archivio, con casella e frecce per l'ordine (prima SNMP, poi SSH, Windows, le
  altre), nella lista nuova delle credenziali della rete.
- **Punto raggiunto ricordato** (`/api/onboarding/progresso`, impostazione `onboarding_progresso:<cliente>`): «Esci»
  segna il wizard completato come prima, ma riaprendolo da Impostazioni si riparte da lì; router, rete e integrazione
  AD già creati non si ricreano. Il wizard non scrive più `host_windows_credential_id` / `host_linux_credential_id`.

### Correzioni della revisione

- **Le credenziali cambiate nel router già creato si usano davvero**: tornando «Indietro» il wizard mandava il PUT
  dell'apparato, che scrive solo le colonne; i binding creati alla registrazione e la porta restavano quelli di prima,
  e il polling continuava con la voce vecchia mentre il wizard diceva «Router aggiornato». Ora la modifica passa da
  `/api/onboarding/router`, che in una transazione aggiorna colonne, porta della voce (2222, o 22/161 cambiando
  accesso) e i due binding che le rispecchiano; gli altri binding dell'apparato restano. Un router con lo stesso
  indirizzo già registrato (dal vecchio wizard, o con il punto non salvato) non si crea una seconda volta: si propone
  di usarlo, e le sue credenziali in linea passano alle voci scelte.
- **Router registrato dopo la rete**: «Completa e apri la rete» lo collega alla rete già creata (prima il collegamento
  si faceva solo alla creazione).
- **«Reset lab» azzera anche il punto raggiunto**, e un punto con oggetti spariti riparte dal passo che li crea (dalle
  credenziali se sono spariti tutti) invece che dall'ultimo passo con niente dietro.
- **Archivio non caricato = niente creazioni alla cieca**: router, Active Directory e rete non si creano senza
  credenziali come se l'archivio fosse vuoto; le tendine dicono «Caricamento…» o «Archivio non caricato» invece di
  «nessuna voce, creane una».
- **DNS svuotato = DNS cancellato** (prima il campo vuoto si ignorava); «Indietro» aspetta il salvataggio del punto.
- **SNMP v3 riconoscibile**: il tipo si chiama «SNMP (v1/v2c o v3)» finché l'archivio non ha un tipo v3 suo, una voce
  col livello di sicurezza si mostra «SNMP v3», e «nuova nell'archivio» con accesso SNMP v3 apre il modulo già in
  authPriv.
- **Active Directory già creata**: la credenziale WinRM si cambia anche dal wizard (l'account resta della sua pagina).
- **Telefono**: il modulo della voce scorre quando è più alto dello schermo (SNMPv3 authPriv), e nella lista della
  prima subnet il nome della voce sta sopra il tipo; i pulsanti piccoli a 13 px.

### Da sapere

- La modifica del singolo apparato **fuori dal wizard** aggiorna ancora solo le colonne, non i binding: si sistema con
  la sotto-tappa 2e (che lì aggiunge la voce in testa invece di sostituirla).

## [Non rilasciato] — 2026-10-15 · topologia T2.5: la lettura degli hypervisor (lldpd e bond), spenta

Spec §13.5.5, piano di T2 Task 7. Perché: dove sugli host Proxmox gira `lldpd`, l'host dice da sé a quale porta di
quale switch è attaccata ogni scheda, compresi i cavi di riserva dei bond che non portano VM e che oggi la mappa
non vede; e il MAC permanente dei membri dei bond è quello con cui le schede si annunciano agli switch.

### Aggiunte

- **«LLDP e bond degli hypervisor» si può accendere** in «Dati della mappa → Letture in più per la mappa» (prima
  diceva «non disponibile in questa versione»). Nasce spenta. Accesa, la lettura notturna degli hypervisor, dopo
  la scansione e al più una volta l'ora per apparato, manda su ogni nodo tre comandi in sola lettura, ognuno a
  parte: `command -v lldpcli`, `lldpcli -f json0 show neighbors details` (solo se c'è), `ip -d -j link show`.
  Scrive i vicini LLDP dell'host, il tipo e lo stato delle schede, il membro attivo o «di riserva» di ogni bond e
  i MAC permanenti: servono al modello per cavo e **la mappa di oggi non cambia**; i vicini LLDP dell'host
  compaiono anche nella scheda «Neighbors» dell'apparato, che non filtra per fonte. Un host senza `lldpd` non è un
  errore; un comando che non risponde o dà un'uscita che non si capisce non scrive niente al posto suo, e
  l'esito per apparato lo dice col codice. Il lettore è scritto sull'uscita vera di un nodo dell'hub con `lldpd`.

## [Non rilasciato] — 2026-10-15 · credenziali tappa 2a: SNMPv3 letto per intero, modifica in blocco che non azzera

Piano `docs/superpowers/plans/2026-10-15-tappa2-archivio-credenziali.md` (sotto-tappa 2a, solo codice,
nessun dato toccato). Fotografia delle scelte delle credenziali prima/dopo sulla stessa copia dei dati
del 15/10: 0 differenze su hub e cliente A.

### Correzioni

- **SNMPv3 letto per intero**: la chiave di autenticazione si legge da `encrypted_auth_key` (prima da
  `encrypted_password`) e i protocolli dalla credenziale (prima MD5/authNoPriv fissi in cinque sessioni).
  Un lettore solo dei segreti (`src/lib/credentials/segreti.ts`) e una sola regola dei tipi
  (`src/lib/credentials/tipi.ts`), così le sotto-tappe dopo cambiano un punto e non sette.
- **Niente community al posto di una v3**: un apparato v3 senza una v3 leggibile dà «Credenziale SNMPv3
  assente o illeggibile» invece di provare la community (anche «public») in chiaro; vale per le cinque
  sessioni v3 e per quella degli switch e della topologia. Il 15/10 gli apparati v3 erano 0 su hub e
  cliente A. Resta da fare: il profilo vendor di `getDeviceInfo` apre ancora una v2c prima della v3 (passa
  al motore unico nella 2b); la validazione v3 della discovery non salva sysDescr/sysObjectID (rinviata).
- **La modifica in blocco e quella del singolo apparato non azzerano più le credenziali** quando si
  lascia «Non modificare»: si mandano solo i campi toccati.
- **Tolta la rotta `/api/credentials/[id]/test-snmp`**: la prova SNMP sta in quella generale, col ramo v3.

### Aggiunte

- Script di sola lettura per i rilasci della tappa 2 (`scripts/credenziali/`: copia dei dati con l'API di
  backup di SQLite, fotografia delle scelte, misure), con una guardia che rifiuta di aprire i dati del
  servizio invece della copia.

## [Non rilasciato] — 2026-10-15 · mappa topologia T2: letture in più spente e «Cosa cambierebbe»

Spec `docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md` §13.11.3, piano
`docs/superpowers/plans/2026-10-15-topologia-collegamenti-T2.md`, decisione in ADR 0018. Perché: la mappa «una
linea per cavo, albero dallo spanning tree» ha bisogno di dati che oggi non si leggono (stato delle porte nello
spanning tree, fasci, indici delle porte). Leggerli vuol dire carico in più sugli apparati dei clienti: si
legge prima con tutto spento, poi si accende un cliente alla volta, e si guarda che cosa cambierebbe prima di
cambiare la mappa. **A schermo la mappa non cambia**, nemmeno con le letture accese.

### Aggiunte

- **Letture in più per la mappa, spente**: spanning tree e fasci dei MikroTik via SSH (6 comandi in sola
  lettura sul router, 8 sugli switch MikroTik, al più una volta l'ora), campi in più che il controller manda
  già nella lettura notturna, letture SNMP sugli switch che non sono del controller (16 letture in sola
  lettura, al più una volta l'ora). Ognuna si accende **per cliente** da «Dati della mappa → Letture in più
  per la mappa», con l'esito per apparato in parole. La lettura degli hypervisor e le istanze MSTP non sono
  disponibili: aspettano le uscite vere degli apparati.
- **«Cosa cambierebbe con la mappa nuova (una linea per cavo)»**, in «Dati della mappa», solo per gli
  amministratori: si calcola quando si preme «Calcola» (mai all'apertura), in memoria, senza scrivere niente.
  Dice quanti oggetti avrebbero un altro padre e perché, chi entra o esce dall'albero, i collegamenti per
  genere e le anomalie per nome. Serve a decidere quando accendere la mappa nuova, a differenze spiegate.
- **Tabelle e colonne nuove nel DB di ogni cliente**, aggiunte da sole alla prima apertura (una riga
  `topologia cavi (T2), aggiunto …` nel journal): restano vuote finché le letture sono spente. Nessuna
  tabella ricostruita, nessun dato di oggi toccato.

### Correzioni

- **La lettura a mano dello spanning tree via SNMP perdeva otto letture su nove** (pagina dell'apparato e
  scansione in blocco degli apparati di una rete): la prima chiudeva la sessione usata anche dalle altre.
  Adesso ogni lettura ha la sua.
- **La lettura a mano dello spanning tree dei MikroTik via SSH** legge priorità e bridge-id nelle due forme
  di RouterOS (`/interface bridge print terse without-paging` e `/interface bridge monitor [find] once`, in
  sola lettura): prima la priorità usciva nulla (stava due righe sotto quella letta), il bridge-id si capiva
  in una forma sola e un bridge in MSTP diventava «nessuno spanning tree».
- Revisione finale (tutte senza effetto a letture spente): nel calcolo in ombra la velocità di una porta col
  nome doppio, come nella mappa di oggi (sull'hub un hypervisor cambiava padre solo per questo); via SNMP la
  porta locale di un vicino LLDP presa dal nome quando il numero dell'apparato è un'altra porta; uno switch
  che smette di rispondere a metà giro si salta dopo due letture senza risposta; l'avviso «il controller non
  riporta vicini» conta solo le righe del controller e delle letture di oggi.

## [Non rilasciato] — 2026-10-15 · promozione: una tendina SNMP sola

### Modifiche

- **Promozione di un IP con SNMP come protocollo: niente seconda tendina «SNMP aggiuntivo».** La
  credenziale principale è già la SNMP e la seconda ripeteva la stessa scelta (le finestre in blocco la
  nascondevano già). Resta visibile se l'apparato ne ha già una salvata, per non nascondere un valore.

## [Non rilasciato] — 2026-10-15 · Apple e macOS fra gli apparati (tappa 1b credenziali)

### Correzioni

- **Un Mac si può promuovere ad apparato**: la tabella `network_devices` accetta la marca `apple` e la
  scansione `macos` (la scansione macOS e il validatore li conoscevano già, il vincolo della tabella li
  rifiutava e la promozione finiva in un errore). Accettati anche dalla creazione in blocco e dalla prova
  provvisoria, che validano per conto loro. Perché ora: dalla tappa 1 le finestre propongono «apple» per i
  Mac invece di ripiegare su Linux o «other».
- **Come**: SQLite non cambia un vincolo, la tabella si ricostruisce
  (`src/lib/devices/migra-apple-macos.ts`) partendo dalla sua definizione attuale in `sqlite_master`: cambiano
  solo i due elenchi, nessuna colonna si perde (le ricostruzioni vecchie riscrivono un elenco fisso).
  Chiavi esterne spente fuori dalla transazione, indici ricreati, conteggio e `foreign_key_check` dentro: se
  non tornano si annulla. Prova a vuoto del 15/10 sulle copie dei DB di hub (3 tenant) e cliente A: stesse
  colonne, righe e binding, nessuna violazione nuova, un Mac si inserisce.

## [Non rilasciato] — 2026-10-15 · credenziali, promozione IP → apparato, wizard (tappa 1)

Spec `docs/superpowers/specs/2026-10-15-credenziali-promozione-wizard-design.md`, piano
`docs/superpowers/plans/2026-10-15-tappa1-credenziali-promozione.md`. Perché: in una creazione
iniziale Riccardo ha trovato la finestra di promozione caotica, le credenziali da correggere dopo e il
wizard che spariva; l'analisi del 15/10 ha confermato i difetti qui sotto.

### Aggiunte

- **Porta facoltativa sulla credenziale** (`credentials.port`, vuota = porta standard del protocollo):
  campo e colonna nella pagina Credenziali; la usano il motore di scelta delle credenziali (catena della
  rete e catene vecchie), la discovery (prove SSH e validazione SSH/SNMP) e le finestre di promozione.
  Perché: una credenziale SSH sulla 2022 veniva provata sulla 22 e sembrava sbagliata. Limite: il giro
  SNMP generale della discovery prova le community sulla 161.

### Correzioni

- **Una regola sola su quale credenziale vale per quale protocollo** (`tipiCredenzialePerProtocollo`):
  SSH → SSH e Linux, WinRM → Windows, SNMP → SNMP, API → API e SSH, Redfish/ONVIF → API. Perché: c'erano
  cinque regole; per SSH le tendine offrivano le Windows e nascondevano le Linux, per WinRM le SSH che la
  prova WinRM rifiuta.
- **Promuovere un IP propone l'apparato dal sistema operativo**, non dal produttore dell'hardware: un
  server Windows su HP è Windows + WinRM (prima «hp» + SSH + ProCurve), una marca dedotta «microsoft»
  diventa Windows; la classificazione è sempre un valore dell'elenco («printer» → stampante, la scelta
  manuale dell'host vince, sconosciuto = da scegliere e «Crea» bloccato); credenziale proposta = quella
  validata sull'host con tipo compatibile, sulla porta con cui è stata validata. Una sola logica
  (`src/lib/devices/proposta-apparato.ts`) per le quattro finestre: scheda dell'oggetto, «Aggiungi
  dispositivi» della rete (prima partiva sempre da «server + Altro + UPS + SNMP v2»), discovery, lista
  per classificazione («Configura» proponeva «hp + SNMP» per tutto).
- **Promozione singola senza campi finti**: tolti username/password/community inline che nessuno
  leggeva e modello/seriale/firmware (stanno sull'host); porta modificabile; la spunta «sorgente ARP»
  tolta resta tolta (si manda 0). Con SNMP come protocollo la tendina principale è la SNMP; al cambio di
  protocollo una credenziale incompatibile si azzera.
- **Creazione apparato senza ripiego su «hypervisor»**: senza classificazione vale il tipo dispositivo
  (prima un server diventava hypervisor, anche sull'host); classificazioni fuori elenco rifiutate con un
  messaggio; il binding SNMP usa la porta della credenziale.
- **Modificare una credenziale non cancella più il segreto**: password e chiavi SNMPv3 vuote = non
  modificare (prima `""` azzerava il campo, e la pagina in modifica la mandava vuota). Campo «Username
  SNMPv3» nella pagina (il testo rimandava a un campo che non c'era).
- **Community dei binding SNMP inline nel campo cifrato**: prima finiva nello username, in chiaro, e chi
  legge la community non la trovava. Conversione idempotente delle righe vecchie all'apertura del tenant
  (il 15/10 erano 0 sull'hub e sul cliente A).
- **Prova dei binding senza ripieghi**: SNMP senza community = «Community mancante» (prima provava
  «public»); su API/Redfish/ONVIF la prova non c'è e il binding non si marca più fallito (il motore delle
  credenziali scarta i falliti), il pulsante «Test» lì non compare. Lo username inline dei binding lo
  vede solo l'admin.
- **Le scansioni non spostano la porta degli apparati in SNMP**: la 161 è UDP e non compare fra le TCP
  aperte, quindi un MikroTik in SNMP finiva sulla 8291.
- **Wizard**: su un tenant vuoto il flag «da configurare» si scrive all'apertura (prima il router del
  primo passo contava come «dati presenti» e una ricarica faceva sparire il wizard); la rete creata
  riceve la lista credenziali nuova, quella che mostra la pagina della rete; il campo della rete è vuoto
  con 192.168.1.0/24 solo come suggerimento. La rete «192.168.0.0/24» vista da Riccardo non si riproduce
  su hub e cliente A.

## [Non rilasciato] — 2026-10-15 · topologia T1b: il ruolo dalle prove e «Perché questo collegamento»

### Modifiche

- **Nella mappa automatica uno switch, un router o un access point sta nell'albero solo se ha una prova
  sua** (vede vicini, ha una porta con spanning tree attivo, ha apparati dietro le porte, è letto da un
  controller, ospita VM, si annuncia come apparato…). Gli altri escono dall'albero e vanno nel gruppo
  «Da sistemare» dell'elenco con «senza prove di ruolo»; il motivo intero si legge passandoci sopra col
  mouse. Perché: sulla rete B PC, server e uno scanner registrati come «switch» per l'inventario stavano
  nell'albero come apparati di rete (vincolo 7 di Riccardo), e host che la classificazione automatica
  dice router (un telefono, un notebook) anche. Un oggetto «da sistemare» conta come un client: la sua
  tabella MAC non fa più da apparato di passaggio. Spec §13.8.2.
- **«Ruolo nella mappa ▸ Apparato di rete · Attaccato (server, PC) · Decide il sistema»** nel menu del
  tasto destro di un apparato (solo admin), per la via d'uscita a mano: un apparato vero che non si legge
  torna nell'albero, un server registrato come switch diventa una foglia. Scrive `topology_role`
  (`PATCH /api/topology/nodes/role`); «Decide il sistema» toglie la scelta. Su un host il menu dice
  «prima Promuovi ad apparato».
- **Nessuna radice sola, «hypervisor» solo con una prova, spanning tree solo se attivo** (passaggio
  universale, spec §13.16): un oggetto di rete con una prova ma senza collegamenti va in «Da sistemare»
  con «nessun collegamento» invece di fare da seconda radice (sulle copie del 15/10: rete B da 5 radici a
  1, cliente A da 2 a 1); un nodo «hypervisor» senza VM né scansione è un attaccato; uno stato
  `disabled` dello spanning tree non è una prova.

### Aggiunte

- **«Perché questo collegamento»** nei dettagli di una linea: chi vede chi, con quale lettura e a che ora
  (ora italiana), se il cavo è confermato dai due capi, quando l'uplink del controller è la stessa
  osservazione e non una seconda prova, e perché le righe scartate sulla coppia non sono un cavo
  («in mezzo c'è un apparato che non si legge», un nome scelto a mano che non si sa se è una porta).
  Perché: senza, una linea sulla mappa non si poteva verificare senza aprire il DB.

### Correzioni

- **«Attaccato (server, PC)» sposta davvero l'oggetto nella fascia degli attaccati.** Visto a schermo
  prima del rilascio: il ruolo si salvava ma il disegno leggeva ancora il tipo dichiarato. Ora il disegno
  legge la classe della mappa; per lo stesso motivo un «hypervisor» senza prove compare fra gli attaccati
  del suo padre.

## [Non rilasciato] — 2026-10-15 · LibreNMS dell'appliance riconosciuto nella scheda

### Correzioni

- **La scheda LibreNMS (Impostazioni → Moduli) riconosce il LibreNMS messo dall'installatore
  dell'appliance.** Se sulla macchina c'è il contenitore `appliance-librenms`, la modalità si
  chiama «Installato dall'appliance» invece di «Istanza esterna», «Docker locale» non si può
  scegliere e il pulsante «Installa» sparisce. Anche il server rifiuta l'installazione (409, col
  motivo a schermo). Perché: sul pilota PX-NAS (15/10) la scheda faceva sembrare assente il
  LibreNMS che c'era, e «Installa» ha avviato un secondo LibreNMS (`da-librenms`, porta 8090,
  vuoto) che a fine lavoro avrebbe preso il posto di quello dell'installatore. Prova:
  `src/lib/integrations/__tests__/librenms-appliance.test.ts`.
- **Lo stato di un contenitore senza controllo di salute non risulta più «assente».** La
  lettura (`getContainerStatus`) chiedeva sempre `{{.State.Health.Status}}`: su un contenitore
  senza healthcheck, come `appliance-librenms` o il `da-librenms` installato da qui, `docker
  inspect` esce con errore e la scheda lo dava per inesistente o fermo anche acceso. Ora la
  salute si chiede solo se c'è. Trovato verificando la v0.3.290 sulla VM del pilota, dove la
  scheda continuava a dire «Istanza esterna».

## [Non rilasciato] — 2026-10-15 · topologia: elenco aggiornato tornando sulla pagina

### Correzioni

- **Tornando sulla Topologia da un'altra scheda o finestra, elenco e mappa si rileggono subito.**
  La pagina rileggeva i dati all'apertura, dopo le proprie modifiche e ogni 30 secondi: se si
  cambiava l'inventario in un'altra scheda (cancellare un doppione, rinominare un apparato) e poi
  si tornava sulla scheda della mappa rimasta aperta, l'elenco a sinistra e la mappa restavano
  quelli di prima fino al giro successivo (misurato: 26 secondi; con la scheda in secondo piano
  Chrome rallenta anche quel giro), e veniva da ricaricare la pagina a mano. Ora la pagina si
  rilegge appena torna visibile o la finestra torna a fuoco, con una lettura sola anche quando i
  due segnali arrivano insieme. Le modifiche fatte dalla mappa stessa e il ritorno con i link del
  menu già si vedevano subito: verificato una per una.

## [Non rilasciato] — 2026-10-15 · firewall NetBird sul prerouting

### Correzioni

- **Il segnale verso DA-Link legge l'appliance a cliente singolo.** Deploy-Appliance crea
  sempre il cliente «DEFAULT», e il codice di DA-Link (es. 70175) lì non c'è: sul pilota il
  segnale partiva senza moduli, salute né numeri (`cliente: non_trovato`). Ora, se il codice
  non c'è e l'istanza ha un solo cliente «DEFAULT», si legge da lui e il segnale lo dichiara
  (`cliente: appliance`). Con più clienti vale ancora solo il codice esatto (rischio 8).
- **Il firewall dell'interfaccia NetBird ora filtra davvero.** Sul pilota (PX-NAS, 15/10)
  NetBird, collegandosi, ha messo «accetta tutto da wt0» in cima alla nostra catena
  sull'input, e il filtro per porta (22, 443, 6443) non contava più: restava solo la
  policy NetBird. La catena ora sta sul prerouting, dove NetBird non inserisce niente e
  uno scarto è definitivo (provato riavviando NetBird e bussando dal Mac: 22/443/6443
  aperte, 7443/8443/3000/5432 chiuse dal nostro filtro). Il segnale dichiara le porte
  del filtro solo se la catena sta lì; altrimenti ripiega sulle porte in ascolto, per
  non dare a DA-Link (R5) un dato falso.

## [0.3.286] — 2026-10-15 · versione SNMP per apparato

Versione SNMP per apparato e firmware degli airFiber Ubiquiti (ADR 0016), approvati da Riccardo il 15/10.

### Aggiunte

- **Ogni apparato ricorda in che versione SNMP risponde (v1 o v2c).** La discovery prova prima la
  v2c, come prima, e sugli host accesi che tacciono riprova in v1; la versione che risponde finisce
  sull'apparato collegato e nel registro del giro («risponde in v1 (v2c muta) → salvata su …»).
  Perché: gli AP Ubiquiti di DTS (172.16.3.4-7) rispondono **solo** in v1 e in v2c vanno in timeout,
  quindi la discovery non li vedeva. La passata sugli IP che non rispondono al ping resta solo v2c:
  la v1 lì raddoppierebbe il tempo su centinaia di indirizzi vuoti.
- **Scelta a mano nel modulo dell'apparato**: «Automatica (rilevata: v1)», «v1, fissata a mano»,
  «v2c, fissata a mano». Una versione fissata la discovery non la tocca (e lo dice nel registro se
  vede altro); la scheda mostra la versione accanto all'accesso SNMP. Perché: se la discovery
  sbaglia, ci dev'essere un modo di correggerla.
- **Il test di una credenziale SNMP prova v2c e poi v1 e dice quale ha risposto** (anche
  `/api/test-snmp`). Perché: prima provava solo la v1, per caso, e non diceva niente.
- **Firmware degli airFiber Ubiquiti nella lettura dati** (`1.3.6.1.4.1.41112.1.3.2.1.40.1`, es.
  «v4.1.0»), con «airFiber» come modello quando nient'altro lo dice: il MIB airFiber non espone il
  nome del prodotto (letto tutto il ramo 41112 su un AP di DTS, sola lettura).

### Modifiche

- **Un solo punto apre le sessioni SNMP a community** (`src/lib/protocols/snmp-sessione.ts`), sempre
  con la versione esplicita. In net-snmp `createSession` senza `version` parla **v1** e `version: 1`
  vuol dire **v2c**: la discovery forzava v2c, mentre lettura dati, client switch/router, sonda
  interfacce e test credenziali parlavano v1 per caso. **Un apparato non ancora rilevato si comporta
  esattamente come prima**: ogni punto dichiara la versione che usava. Una prova fallisce se nasce un
  `createSession(` fuori dal modulo.

## [Non rilasciato] — 2026-10-15 · mappa: ritocchi e VM, SSH degli hypervisor

Ramo `fix/mappa-ritocchi-vm`, non ancora su `dev`.

### Correzioni

- **Un riquadro spostato resta dove lo si lascia.** I ritocchi si applicavano in ordine di nome
  interno (dove «120» viene prima di «78»): quando un antenato ritoccato veniva «dopo», il suo
  spostamento si sommava una seconda volta al discendente, che al rilascio saltava altrove. Ora si
  applicano dagli antenati ai discendenti, nei due orientamenti.
- **Trascinare un apparato si porta dietro il suo ramo, anche i pezzi già ritoccati.** Le posizioni
  ritoccate sono assolute: spostando un padre dopo aver sistemato un suo discendente, il discendente
  restava fermo e il ramo si spezzava. Ora lo spostamento del padre salva, nello stesso colpo, anche
  le posizioni dei discendenti già ritoccati spostate dello stesso tanto (spec §4/§11.2).
- **Le VM restano sotto il loro nodo del cluster anche quando una lettura è a metà.** Se la lettura di
  un nodo non riportava l'host di un altro nodo, le VM di quest'ultimo finivano all'apparato che aveva
  letto, e con loro il cavo «dalle VM». Ora si usa l'abbinamento dello stesso nome di nodo trovato
  nelle altre letture; se è ambiguo, come prima. Vale solo per le letture di cluster: un hypervisor
  autonomo ha un nodo solo, e il nome di fabbrica («pve») si ripete su macchine diverse.
- **Le schede di rete «vive» degli hypervisor Proxmox ora si leggono.** La lettura via SSH usava la
  porta dell'API (443/8006) e veniva rifiutata, quindi le schede vive non arrivavano mai. Ora usa la
  porta della credenziale SSH legata all'apparato, altrimenti 22.

## [Non rilasciato] — 2026-10-15 · topologia, tappa T1

Mappa topologia, tappa T1 «collegamenti come la rete reale» (ADR 0015, spec §13): pronta il 15/10,
non ancora rilasciata (aspetta la conferma di Riccardo).

### Correzioni

- **Core 1 del cliente A torna sotto il router, sul cavo a 10G.** Il 14/10 la mappa lo appendeva a
  uno switch di accesso. Due cause: una linea univa porte prese da prove diverse (la porta di core 1
  dal controller, quella del router dalla prima riga del router in ordine, che non era il cavo), e
  «Ignora» su quella linea toglieva la coppia intera, cioè anche il cavo vero. Ora una linea prende le
  due porte **da una prova sola**.
- **I vicini del router col protocollo vero e i nomi interi.** Il lettore di `/ip neighbor` (lo stesso
  comando di prima: nessun comando nuovo sui router) legge `discovered-by` e i valori con gli spazi.
  Prima ogni riga era «MNDP» e «Port 47» diventava «Port»: il modello non poteva distinguere un cavo da
  un annuncio arrivato attraverso uno switch. A schermo queste righe si chiamano «annuncio di rete
  (MNDP o CDP)».
- **Una porta che sente due o più apparati non dà cavi** (regola del segmento): in mezzo c'è qualcosa
  che ripete gli annunci. Chi resta senza collegamenti va in «Da sistemare», «nessun collegamento»,
  invece di restare appeso a quella porta. Sul cliente A il router di riserva va sotto uno switch di accesso
  (porta 16), non più sulla porta della WAN di core 1; sull'hub i tre switch di
  laboratorio dietro la porta 5 dello switch PoE escono dall'albero.
- **Il ripiego del router parte solo dalle porte riconosciute come fisiche**: un nome scelto dal
  cliente (bridge, VLAN, VRRP) non dà cavi.
- La velocità di una porta si trova per chiave (indice o nome) anche quando il nome cambia forma: i due
  cavi fra core 2 e gli switch di accesso del cliente A ora dicono «10G» (prima velocità non nota).

### Modifiche

- **«Ignora questo cavo…» vale per un cavo, non per la coppia.** Il dialogo dice quale cavo sparisce e
  che gli altri fra i due oggetti restano. Una correzione di prima che non corrisponde a nessun cavo
  visto compare in «Collegamenti ignorati» con «non corrisponde a nessun cavo visto: non toglie
  niente», «Togli la correzione» e «Scegli il cavo da ignorare…»; una senza porte toglie solo un cavo
  senza porte. Perché: l'«Ignora» per coppia del 14/10 aveva fatto sparire il cavo vero. Quella
  correzione resta orfana finché Riccardo non la toglie: nessuno script la converte.
- **«Altri cavi visti fra questi due oggetti»** nei dettagli di una linea: fino a T3 una linea unisce
  due oggetti, e gli altri cavi fra loro si leggono qui. Serve a scegliere quale cavo ignorare.
- **Pareggi dell'albero per verso e velocità, non per id**; la testa proposta, a pari oggetti
  raggiunti, è il router che fa da gateway a più reti. Perché: con l'id decideva il caso.
- **Regole scritte per ogni rete**, provate su cinque famiglie di reti-campione inventate (solo
  MikroTik, solo UniFi, altre marche via SNMP, con hypervisor, mista) e misurate sulle due reti vere:
  un nome scelto dal cliente non è una porta fisica; gli apparati di una porta si contano per apparato
  (un MikroTik ha un MAC per interfaccia); fra una VM e il suo hypervisor nessun collegamento, e i MAC
  propri di un apparato non sono client né VM; la testa proposta dalle reti di cui fa da gateway; un
  nome doppio con una velocità sola dà la velocità. Sull'hub la linea verso il router di frontiera passa
  dai cavi veri e non da una VLAN, e gli hypervisor vanno sotto l'aggregazione a 10G (uno stava sotto
  una sua VM); sul cliente A nessuna di queste regole cambia qualcosa.
- **Le linee di ridondanza escono dal lato del riquadro più vicino**, a schermo e in stampa; le linee
  fra padre e figli restano a tronco. Perché: uscivano da un lato fisso e facevano il giro sopra la
  mappa. Su una linea molto corta la parola si mette accanto, fuori dai riquadri.
- **L'elenco a sinistra si chiude** («◂ Elenco» / «Elenco ▸»), così la mappa prende tutta la
  larghezza; la scelta resta nel browser.
- Il calcolo della mappa costa di più: sul cliente A circa 18-19 ms sul Mac invece di 14 (tetto 20).

### Aggiunte

- `scripts/misura-cavi.ts`: misura sulla copia di un DB (scenari, chi cambia padre, conteggi, tempo del
  modello; `--adesso` per giudicare «non visto» all'ora del «prima», `--senza-regola` per spegnere una
  regola alla volta). Perché: il rilascio si decide sui numeri della copia, prima.
- `scripts/ripristina-vicini-router.ts`: lo script di «Tornare indietro» (prova a vuoto di base, copia
  delle righe, `--applica`). Perché: il codice di prima, con le righe nuove del router fra router dai due
  lati, cambia un padre; lo script riporta quelle righe a «mndp», il valore che il codice di prima
  conosce. È una scrittura sul DB del cliente: si usa solo se si torna indietro, con la conferma di
  Riccardo.

## [Non rilasciato] — 2026-10-15

Tappa C1 del passaggio a NetBird con **DA-Link** (ramo `netbird-c1`, non ancora su `dev`).
Piano: `docs/superpowers/plans/2026-10-15-tappa-c1-netbird.md`. Tutto nasce spento:
senza `/etc/dalink/oggetto.env` (lo scrive il comando d'installazione di DA-Link)
l'istanza non chiama nessuno.

### Aggiunte

- **Segnale di vita verso DA-Link, ogni 5 minuti.** Versione, moduli accesi, salute
  (solo il verdetto, e solo dei moduli accesi più il sistema), porte aperte
  sull'interfaccia NetBird lette dal firewall vivo, e il livello scelto. I numeri
  dell'inventario (dispositivi, reti, ultima scansione) escono solo se l'istanza lo
  consente, e a «solo stato» non si leggono nemmeno. Perché: Domarc deve sapere se
  l'istanza è viva senza vedere i dati del cliente, e la scelta vale all'origine.
  Il segnale dice anche se il **proxy Zabbix** della macchina gira (`zbx`: ok / fermo /
  non letto; niente voce se non è installato). Perché: il proxy non è un modulo del
  registro, e senza questa voce la colonna «Zabbix» del CRM non avrebbe mai un dato vero.
- **Pagina «Cosa esce da questa istanza»** (voce «Cosa esce» del menu Sistema, solo
  amministratori). Dice tutto ciò che esce verso Domarc, fa scegliere il livello (ogni
  cambio resta nel registro con chi e quando), mostra il prossimo segnale così com'è e,
  quando il livello si abbassa, dice «in attesa di conferma» finché DA-Link non conferma
  di aver cancellato i numeri. Perché: la privacy la decide il cliente, e la deve vedere.
- **Livello al `/setup`**, facoltativo e senza scelta preselezionata; la rotta accetta
  `livello_uscita` per Deploy-Appliance. Perché: si chiede al cliente all'installazione.
- **Firewall dell'interfaccia NetBird** (`scripts/dalink/firewall-wt0.sh`, servizio
  `dalink-firewall`): su `wt0` solo 22 e 443, più 6443 con l'edge, eventualmente solo dai
  centrali dichiarati; Wazuh mai. Restringe soltanto, non apre niente che UFW chiude.
  Perché: la policy NetBird è la prima barriera, questa è la seconda.
- **Preparazione all'ingresso in NetBird** (`scripts/dalink/prepara-netbird.sh`,
  `install.sh --netbird --edge=si|no`): client NetBird dal repository firmato, la VPN precedente
  con `--netfilter-mode=off`, firewall; la chiave d'ingresso solo da stdin. Prova a vuoto
  di default.

### Correzioni

- **Apparati che parlano solo SNMP v1: la lettura dei dati ora riesce.** In v1 una
  richiesta di più valori è tutto o niente: se l'apparato non ne ha anche uno solo
  (tipicamente il numero di serie, che gli apparati vecchi non espongono) rifiuta
  l'intera richiesta e non si salvava nemmeno il nome. Ora, a quel rifiuto, i valori
  si chiedono uno per uno e si tengono quelli che ci sono. Perché: a DTS gli access
  point Ubiquiti 172.16.3.4–6 rispondono solo in v1 e non avevano mai salvato
  nome, modello o descrizione. Un timeout resta un timeout, non diventa «nessun dato».
- **Il test credenziali SNMP di un apparato non manda più in errore il processo.**
  Quando l'apparato non rispondeva, la sessione veniva chiusa due volte (dal timer e
  dalla risposta) e la seconda chiusura sollevava un'eccezione fuori dalla richiesta:
  a DTS tre volte il 15/10.

## [0.3.281] — 2026-10-14

Mappa verticale e stampa (ADR 0012, spec §12): rilasciata il 14/10 alle 14:25 ora italiana,
sul cliente A e sull'hub.

### Aggiunte

- **Mappa «Verticale», predefinita.** L'albero va da sinistra a destra: un livello per
  colonna, i fratelli uno sotto l'altro, si legge dall'alto in basso come un elenco.
  Interruttore «Verticale | Orizzontale» nella barra; lo cambia un amministratore e vale
  per tutti quelli che guardano quella mappa. Perché: la mappa automatica del cliente A
  era una striscia larga più di 13.000 px, e «Adatta» la portava a uno zoom illeggibile.
  In verticale «Adatta» riempie la larghezza e la rotellina scorre (Ctrl o il pizzico per
  lo zoom).
- **Stampa della mappa** («Stampa» nella barra, si apre in una scheda nuova). Foglio A3 o
  A4, scala 100 % o 80 %, «con le VM». Il primo foglio ha nome, data e ora, legenda, la
  mappa intera rimpicciolita con la griglia dei fogli e l'elenco dei cavi di ridondanza;
  gli altri sono pezzi della mappa che si sovrappongono di 15 mm, numerati, con le frecce
  ai vicini, e un riquadro tagliato dal bordo compare intero nel foglio accanto. Perché:
  la mappa va consegnata al cliente su carta o in PDF. Il PDF si fa dal browser, con
  margini e scala lasciati su «Predefiniti».
- **Ridondanze a richiesta.** Si disegna solo il collegamento principale; il riquadro dice
  «⇄ N», un clic mostra le sue ridondanze, «Mostra ridondanze» le mostra tutte. Perché: con
  due switch centrali quasi ogni apparato ha due cavi, e le linee di riserva coprivano la
  mappa. In stampa stanno nell'elenco «Cavi di ridondanza».
- **Hypervisor trovati dalle VM sulla porta** (fonte «dalle VM»). Una porta di switch da
  cui escono solo VM accese di uno stesso hypervisor è il suo cavo. Perché: sui cavi 10G
  degli hypervisor non passa il loro MAC di gestione ma passano le VM; prima i server del
  cluster finivano sotto lo switch di accesso, sulla porta 1G.
- **Nome dal Proxmox sulla mappa**, con «DNS: nome di prima» sotto, quando il nome DNS di
  un hypervisor è diverso da quello del nodo Proxmox. Solo da una scansione degli ultimi
  30 giorni. Perché: un nome vecchio rimasto nel DNS non diceva quale server fosse.
  L'inventario non si rinomina.
- Script `scripts/misura-orientamento.ts`: misura sulla copia di un DB quanto è grande la
  mappa nei due orientamenti e quanti fogli servono, prima di rilasciare.

### Modifiche

- **Il collegamento principale di un hypervisor è il più veloce**, poi quello con più VM;
  «★ Rendi principale» vince sempre. Così il 10G verso il centrale è il principale e il 1G
  di gestione una ridondanza.
- **Un ritocco a mano vale nell'orientamento in cui è fatto.** I ritocchi di prima sono
  orizzontali: in verticale restano da parte e ricompaiono passando a «Orizzontale». Una
  pagina della mappa aperta prima del rilascio va ricaricata: senza, lo spostamento di un
  oggetto non si salva (la richiesta non dice l'orientamento e viene rifiutata, invece di
  finire nel disegno sbagliato) e «Riordina» toglierebbe i ritocchi di tutti e due.
- «Riordina» toglie solo i ritocchi dell'orientamento a schermo.
- Pagina della mappa e stampa usano lo stesso calcolo: la carta è identica allo schermo.

### Correzioni

- **«Ignora il collegamento…» non toglieva le linee nate dalla tabella MAC** (e dal ripiego
  del router): la scelta si salvava e compariva fra gli ignorati, ma la linea restava sulla
  mappa. Ora vale per tutte le fonti, anche per «dalle VM».
- **La parola «ridondanza» finiva sopra i riquadri**: ora si sposta lungo la linea nel primo
  punto libero.

## [Non rilasciato] — 2026-10-14

Fase 2b della mappa (ADR 0010): rilasciata in due passi, v0.3.279 (la correzione dei
router) e v0.3.280 (tutto il resto).

### Aggiunte

- **Trascinare gli oggetti sulla mappa e tasto destro.** Si trascina un oggetto
  dall'elenco per aggiungerlo alla mappa passo passo (senza una mappa scelta, il primo
  trascinamento chiede il nome e la crea); il tasto destro su un oggetto o su una linea
  porta le azioni (collega, aggiungi i collegati, nascondi, promuovi ad apparato, rendi
  principale, ignora). Prima c'era un pulsante «Inserisci» che spariva senza spiegare
  perché. La barra dei dettagli si chiude, così la mappa prende tutto lo spazio.
- **Collegamenti a mano con porte e tipo.** «Collega a…» chiede porta di partenza e di
  arrivo (fra quelle note o scritte a mano), il tipo (cavo, fibra, wireless) e una nota.
  Un collegamento a mano è «✓ confermato» se i dati lo vedono e «? solo a mano» se no, e
  la linea lo dice in parole: chi lo ha disegnato deve poter sapere se il sistema gli dà ragione.
- **Collegamento principale.** Quando un oggetto ha più strade verso l'albero, decide il
  sistema (confermati e recenti, poi la fonte più affidabile); «★ Rendi principale»
  decide Riccardo e vince sempre. Le altre strade sono «ridondanza» e si disegnano a parte,
  accese all'apertura.
- **Stile delle linee.** Spessore = velocità (10G, 2,5G, 1G, 100M), forma = tipo e stato
  (ondulata per il wireless, tratteggiata «non visto da N g», puntinata per il solo a
  mano), «⚡ N W» per il PoE. Mai il solo colore: Riccardo è daltonico.
- **Hypervisor con le VM dentro.** Un riquadro dice «N VM, M accese ▸» e si espande con le
  VM (accesa/spenta, IP); le VM si riconoscono dal MAC, dal nome o dall'IP che dichiarano e
  non contano più come client della porta dello switch né come «Da sistemare» (sul cliente A,
  23 MAC di VM tolti dai client).
- **Job «lettura hypervisor» (`hypervisor_sync`)** una volta al giorno, spento di default, e
  «Aggiorna VM» dal tasto destro: legge le schede vive via SSH (MAC vero, stato, velocità,
  membri del bond), così le schede si trovano da sole sugli switch.
- **Tipo di uplink UniFi (cavo o wireless)** salvato sull'apparato: serve a distinguere un AP
  in mesh. Prima si buttava via.
- **Elenco «Collegamenti ignorati»** in «Dati della mappa», con «Ripristina»: «Ignora» prima
  non si poteva annullare dall'interfaccia.
- Script di misura `scripts/misura-fase2b.ts` per vedere l'effetto sulla copia di un DB prima
  di rilasciare.

### Modifiche

- **Un router aggiunge solo ciò che gli è collegato direttamente** (v0.3.279). Un MAC visto
  solo dal router, sul bridge o su una VLAN, non crea più nessun collegamento, e un vicino
  LLDP/CDP/MNDP del router vale solo se è visto su una porta fisica ed è l'unico lì, o se
  l'altro lato lo conferma. Il router sente gli annunci di tutto il suo segmento, anche
  quelli dietro uno switch: prima tre host Proxmox risultavano attaccati al router.
- **Il router legge le sue porte fisiche** (bridge host e tipo delle interfacce) e propone ciò
  che c'è su una porta di bordo come ripiego. Le righe MAC del router venivano dall'ARP, che
  riporta l'interfaccia di livello 3 (bridge, VLAN, VRRP) e mai la porta del cavo: i router
  mostravano pochi collegati e i due piccoli nessuno. L'ARP non scrive più le porte; le righe
  vecchie invecchiano e si potano a 30 giorni.
- **Conferma dai due lati solo per LLDP/CDP, non per MNDP.** MNDP attraversa gli switch e
  confermava un collegamento falso fra due router (tolto sul cliente A).
- **Le VM spente si leggono.** Senza, con il job acceso una VM spenta spariva dalla mappa.
- **Una VM letta da più apparati è una sola**, con l'id dell'apparato con l'id più basso: sul
  cliente A due apparati scansionano lo stesso cluster e le VM comparivano doppie.
- **Un server con la scansione Proxmox è un hypervisor**, non solo chi ha il fornitore giusto.
- **Gli apparati senza collegamenti vanno in «Da sistemare»**, non diventano radici staccate
  dell'albero (v0.3.279).

### Correzioni

- **Un collegamento a mano verso una VM non censita si salvava e non compariva mai.** Ora si
  rifiuta in parole e il menu non lo propone.
- **Togliere un collegamento a mano toglie anche il suo «principale»**, nella stessa
  transazione: restava una scelta orfana.
- **Il menu del tasto destro faceva cadere la pagina**; corretto, con 13 px come minimo.
- **Il MAC delle schede nella scheda dell'apparato Proxmox era l'indirizzo IP** (la
  colonna prendeva il campo sbagliato).
- **I MAC letti dalle scansioni Proxmox si validano**: le scansioni vecchie avevano un IP in
  `mac_address`, e un IP a 12 cifre sembrava un MAC.
- **Il log della scansione Proxmox non riporta più nomi di nodi né indirizzi**: il job ora gira
  da solo ogni giorno.
- **Un nome MikroTik come `ether1-vlan20` non è più una porta fisica**; `ether1-2.5` (porta
  da 2,5G rinominata) lo è.
- La casella del job `hypervisor_sync` si disabilita per chi non è amministratore, col motivo.

## [Non rilasciato] — 2026-10-13

### Aggiunte

- **Mappa della rete in due modi (Topologia, ADR 0009).** «Tutto automatico» disegna
  l'albero di tutta la rete partendo dalla testa; «passo passo» è una mappa che si
  costruisce un oggetto alla volta, partendo da qualunque apparato, e si salva. Prima
  esisteva solo il disegno automatico, inservibile sulle reti grandi e per chi voleva
  mostrare solo una parte. Gli apparati senza collegamenti stanno in «Da sistemare»;
  i client attaccati a switch e AP si contano e si elencano nel pannello.
- **Tabella dei MAC per porta** (`mac_port_entries`): dice a quale porta è attaccato
  ogni MAC, con prima e ultima volta visto e la fonte. Serve a mettere i PC sotto lo
  switch giusto invece di indovinare.
- **Lettura dei client UniFi**: un job per controller, spento di default, che gira solo
  fra le 7:00 e le 19:59 ora di Roma, così non pesa di notte. Lo storico delle letture
  tiene 50 giri per tipo.

- **Pagina «Dati della mappa» (Topologia), testa e subnet nelle Ubicazioni, sede
  sull'apparato, uplink UniFi salvato (ADR 0008).** La nuova mappa ha bisogno di
  sapere dove sta ogni apparato e quali reti fanno capo a una sede: prima non era
  scritto da nessuna parte e la mappa lo tirava a indovinare. Ora una persona lo
  conferma una volta, e la pagina mostra cosa manca. L'uplink che la lettura UniFi
  già conosceva (a chi è attaccato ogni apparato) non si butta più.

- **Controller di rete: più controller per cliente, in una pagina propria
  (Rete → Controller di rete, ADR 0007).** Prima c'era un solo controller UniFi,
  configurato nelle impostazioni globali dell'hub da una card in Impostazioni →
  Moduli: non bastava per la rete Domarc (una console UniFi OS e un Cloud Key)
  né per i clienti con più impianti, e sull'hub non si sapeva di quale cliente
  fosse. Ora ogni controller è una riga nel database del cliente, con stato,
  ultima lettura, apparati, porte e vicini letti, pianificazione (spenta di
  default) e lo storico delle ultime letture (le ultime 50, potate dall'app).
  «Prova» si fa prima di salvare; «Sincronizza ora» chiede conferma perché
  scrive. Omada si vede nel modulo ma non si può ancora scegliere: si accende
  dopo la misura su un controller vero.
- **Console UniFi OS (UDM, UDM Pro/Beast, Cloud Key Gen2+) lette con la chiave
  API** creata in Network → Impostazioni → Control Plane → Integrazioni. Stessa
  lettura in sola lettura del self-hosted (apparati, porte, vicini LLDP); la
  chiave parte solo dopo la verifica del certificato.

### Modifiche

- **La tabella dei MAC per porta non si cancella più a ogni lettura; invecchia e si pota
  a 30 giorni.** «Dove è attaccato» deve sopravvivere a un PC spento. La lettura UniFi
  non cancella la VLAN scritta da SNMP.
- **Un oggetto con più indirizzi è un nodo solo.** Riccardo vedeva lo stesso router tre
  volte (indirizzo reale e due virtuali). L'identità è il MAC vero o il nome annunciato;
  mai il MAC virtuale né il seriale dell'host (inaffidabile), e i nomi di fabbrica, corti
  o solo numerici non fondono nulla.
- **Una mappa salvata segue gli oggetti promossi o fusi**, così non perde nodi quando un
  host diventa apparato.
- **Un apparato con stato «sconosciuto» prende quello dei suoi host**: senza questo, la
  gran parte degli apparati non interrogati sarebbe un punto interrogativo.
- **La vecchia mappa e la libreria dagre sono tolte**: la pagina nuova le sostituisce e
  due mappe darebbero due verità diverse.

- **I collegamenti fra apparati non si cancellano più a ogni lettura.** La specifica
  della mappa chiede «non visto da N giorni» al posto di linee che spariscono, e due
  fonti sullo stesso apparato (per esempio SNMP e UniFi) si cancellavano a vicenda.
  Ora la riga si aggiorna, invecchia e dopo 90 giorni si toglie. Le pagine di oggi
  (scheda «Neighbors» dell'apparato, mappa `/topology`, attribuzione) continuano a
  vedere solo l'ultima lettura di ogni apparato per fonte, come prima: erano state
  scritte per quella, e mostrerebbero come presenti vicini spariti da settimane.
  Solo il modello nuovo della mappa legge anche i vicini non visti.

- **La configurazione UniFi esistente passa da sola nella tabella dei
  controller**, al primo accesso dopo l'aggiornamento: una volta per cliente,
  con la password copiata cifrata com'è e il certificato già fissato. Solo
  dove l'hub ha un cliente attivo (cliente A sì; con più clienti non si indovina di
  chi sia, e lo si scrive nel log). Le impostazioni vecchie restano nell'hub,
  non più lette, per poter tornare indietro. Misurato sulla copia del database
  del cliente A: un controller creato, nessuna tabella esistente cambiata.
- **«Stato moduli» non fa più login sui controller**: legge l'esito
  dell'ultima lettura di ciascuno. Prima ogni apertura della dashboard (ogni
  cinque minuti) era un accesso nel registro del controller del cliente.
  Conseguenza visibile: dopo l'aggiornamento il controller risulta «mai letto»
  finché non si lancia una lettura.
- La card «Controller UniFi» delle Impostazioni e le rotte
  `/api/integrations/unifi/*` sono tolte; `/api/integrations/unifi` risponde
  410 con l'indirizzo nuovo. Un job `unifi_sync` senza controller (nato prima)
  fallisce col motivo invece di indovinare quale controller leggere.

### Correzioni

- **I MAC virtuali (VRRP/HSRP) non fondono più un host con un router**, né entrano
  nell'indice per MAC: due apparati diversi che condividevano un MAC virtuale diventavano uno.
- **Lo stato «online» di LibreNMS era letto come giù sulla mappa**: ora è letto come attivo.
- **Un errore nella scrittura dei MAC per porta non salta più vicini e routing** dello
  stesso apparato (punto 12 dell'ADR 0008).
- **Lo storico dei controller non perde più i giri degli apparati**: quelli dei client
  hanno il loro tetto, altrimenti i giri orari li cancellavano.
- **Il trasferimento fra hub porta anche le mappe** e riduce i doppi di `mac_port_entries`.

- **I vicini si abbinano anche per MAC, nel modello nuovo della mappa** (la pagina
  «Dati della mappa»). Prima il MAC del vicino veniva letto e poi ignorato: un
  vicino senza nome o con nome diverso restava non abbinato, e il collegamento non
  compariva fra gli apparati. La mappa di oggi (`/topology`) non usa ancora il
  modello nuovo: lì l'abbinamento resta per nome e IP finché non arriva la fase 2.

- Dockerfile e `hub-install.sh`: aggiunti `openssl`, `net-tools` e `krb5-user`,
  mancanti per la lettura ARP, i certificati e Kerberos. Erano su un ramo mai
  confluito in `dev` (`claude/project-thread-7swirj`), cancellato nella
  pulizia dei rami del 13/10.

### Modifiche

- **Un job di scansione dura quanto il suo giro (INV-1, T3-17).** I job
  «ping sweep», «scansione veloce», SNMP e nmap tornavano appena il giro era
  partito: la scansione continuava in background, «Ultima esecuzione» segnava
  la partenza, il tick successivo poteva farne partire un'altra sulla stessa
  rete mentre la prima scriveva ancora (21 accavallamenti nella storia di
  un'installazione), e un giro fallito risultava riuscito. Ora il job resta in
  esecuzione fino alla fine vera del giro; se il giro fallisce (anche nei rami
  che si chiudevano in errore senza segnalarlo) il job fallisce e finisce nel
  conteggio dei fallimenti dello scheduler. Un job su tutte le reti le
  scansiona una dopo l'altra invece che tutte insieme; una rete in errore non
  ferma le altre, ma fa fallire il job. Il giro si aspetta al massimo quanto la
  soglia d'allarme (100 minuti, `scan_lock_alarm_minutes`): un giro che non si
  chiude entro quel tempo fa scrivere la riga d'allarme e fallire il job, la
  rete resta occupata finché il giro non finisce davvero, e un job su tutte le
  reti passa alle successive invece di restare fermo su quella. Una scansione
  senza tenant aperto non parte più. **Cosa cambia sulle installazioni del canale `dev`:** «Ultima
  esecuzione» vuol dire fine del giro; un giro più lungo dell'intervallo fa
  saltare i tick nel frattempo (voluto); un job i cui giri falliscono non
  aggiorna più «Ultima esecuzione», quindi il controllo di salute lo vede
  fermo e gli errori prima muti fanno scattare l'allarme dei fallimenti in
  serie (voluto). «Esegui ora» su un job di scansione risponde subito
  («Scansione avviata») invece di tenere aperta la richiesta per tutto il giro.
  Prova: `scansione-attesa.test.ts`.
- **Un giro alla volta per rete (INV-1, T3-18).** Sulla stessa rete dello
  stesso tenant potevano girare due scansioni insieme: dallo scheduler, da
  «Esegui ora», dai pulsanti della pagina rete e dall'aggiornamento automatico
  della pagina, che ne lancia una ogni due minuti senza guardare se la
  precedente è finita. Due giri insieme scrivono sugli stessi host, e quello
  partito prima può spegnere host visti dal secondo. Ora una scansione su una
  rete già in scansione non parte. **Cosa cambia sulle installazioni del canale
  `dev`:** il pulsante dice «Scansione non avviata: su questa rete è già in
  corso …, partita alle …» invece di avviarne un'altra; «Esegui ora» lo dice
  allo stesso modo. Un job dello scheduler che trova la rete occupata aspetta
  che il giro in corso si chiuda e poi parte, così non perde l'intervallo: gli
  intervalli da un'ora in su partono tutti al minuto 0, e due job sulla stessa
  rete partirebbero sempre insieme. Il secondo parte quindi con il ritardo di un
  giro. Se la rete resta occupata oltre la soglia d'allarme il job salta il
  giro, non aggiorna «Ultima esecuzione» e non conta né come riuscito né come
  fallito (il controllo di salute lo vede fermo, ed è voluto: vuol dire un giro
  appeso). Un job su tutte le reti fa prima le reti libere e poi aspetta quelle
  occupate. La rete si libera solo quando il giro è chiuso davvero, anche se
  fallisce: un giro che dura più di 100 minuti fa scrivere una riga d'allarme
  nel registro (una per giro, dal job che lo aspettava o da chi prova a
  ripartire) ma non libera la rete. La soglia si cambia per tenant con
  l'impostazione `scan_lock_alarm_minutes`. Il controllo vale per la rete
  intera, anche per le azioni su pochi host selezionati (WinRM, SSH,
  validazione credenziali, nmap, SNMP): mentre gira una scansione sulla rete
  rispondono che è occupata. Restano fuori le letture ARP e DHCP, che non sono
  giri di scansione. Prova: `network-scan-lock.test.ts`.
- **Un giro vecchio non spegne un host visto dopo la sua partenza (INV-1,
  INV-2, T3-20).** A fine giro le scansioni ping, veloce, discovery e naabu
  mandavano offline ogni indirizzo scansionato che non aveva risposto, senza
  guardare lo stato né quando l'host era stato visto l'ultima volta: un host
  visto vivo durante il giro (dal controllo degli host noti, che gira ogni 15
  minuti, o da un'altra scansione) veniva spento da un giro partito prima, e
  gli host già offline si vedevano riscrivere la data di modifica a ogni giro
  (su una copia del database di un'installazione: 207 righe a ogni giro sulla
  sola rete che ha un job di scansione acceso, 676 sommando tutte le reti). Ora passano offline
  solo gli host non ancora offline e non visti dopo l'inizio del giro;
  l'inizio si prende dall'orologio del database, nella stessa forma della
  data «ultimo visto». Il conteggio delle righe da cambiare e la scrittura
  usano lo stesso filtro, che servirà alla soglia di sicurezza sugli
  spegnimenti in massa. Una scansione che non ha nessun indirizzo da decidere
  non tocca niente (prima valeva come «tutta la rete»). **Cosa cambia sulle
  installazioni del canale `dev`:** lo stato degli host già offline non si
  riscrive più a ogni giro; la loro data di modifica invece avanza ancora,
  perché a fine giro l'aggiornamento delle assegnazioni IP la riscrive su tutti
  gli host della rete, cambiati o no (misurato con la prova dei giri
  sovrapposti, T3-22: tutte le righe della rete a ogni giro, prima e dopo):
  si sistema a parte. La pulizia degli host vecchi guarda «ultimo visto», non
  questa data, e non cambia. Un host visto vivo mentre un giro
  era in corso resta online fino al giro successivo che non lo vede; il
  registro del giro dice quanti host sono passati offline. Nessuna bonifica:
  gli host eventualmente spenti per errore tornano online al primo giro che li
  vede. Prova: `mark-hosts-offline.test.ts`.

### Aggiunte

- **Le scelte sulle scansioni scritte in un ADR (INV-1, INV-2, T3-23).** Le
  correzioni dei giri di scansione (T3-17…T3-22) si reggono su tre scelte che
  dal codice non si capiscono: il lucchetto «un giro per rete» vive in memoria
  e vale solo finché scheduler e applicazione sono un processo solo; la soglia
  sugli spegnimenti in massa conferma per intersezione, così non resta mai
  bloccata; «Ultima esecuzione» di un job di scansione vuol dire fine del giro.
  Stanno in `docs/adr/0006-una-scansione-per-rete-e-soglia-offline.md`, con
  ciò che diventa difficile dopo (uno scheduler in un processo a parte, più
  scrittori sulla stessa rete). Corretti anche i commenti della scansione
  veloce: dicevano che non manda offline gli host che non rispondono, ma lo fa
  (e lo faceva già), come la discovery completa; se debba farlo è una
  decisione ancora aperta e intanto il codice resta com'è. Nessun cambio
  di comportamento.

- **Prova dei giri sovrapposti su una copia del database (INV-1, INV-2,
  T3-22).** Le correzioni sulle scansioni (un giro alla volta per rete, un
  giro vecchio che non spegne host visti dopo, la soglia sugli spegnimenti in
  massa) erano provate su dati finti; mancava la prova sul dato vero. Lo script
  `scripts/prova-giri-sovrapposti.ts` copia il database di un tenant in una
  cartella temporanea e ci fa girare la scansione vera con un esecutore finto
  (niente esce sulla rete): un giro lento, un secondo giro sulla stessa rete
  mentre il primo è fermo, host visti vivi da altri nel frattempo, poi un giro
  in cui non risponde nessuno. Stampa solo conteggi e rifiuta di partire se un
  percorso esce dalla cartella temporanea. Su una copia del database di
  un'installazione, rete con 155 host di cui 25 online: col codice di prima il
  secondo giro partiva, il primo spegneva 5 host visti dopo la sua partenza e
  il giro senza risposte spegneva tutti i 20 rimasti; con le correzioni il
  secondo giro è rifiutato, nessun host visto dopo viene spento e il giro senza
  risposte non scrive lo stato di nessun host (soglia in `applica`). Nessun
  cambio di comportamento. Prova: `giri-sovrapposti.test.ts` (stessa sequenza
  su un tenant di prova).
- **Soglia di sicurezza sugli spegnimenti in massa, con conferma al giro dopo
  (INV-2, T3-21).** Un giro che non vedeva nessuno (un ping che non esce, un
  apparato in mezzo che filtra, un esecutore remoto che risponde male)
  mandava offline in un colpo tutti gli host della rete. Un calo così è più
  spesso un guasto della scansione che della rete. Ora, se un giro spegnerebbe
  più della metà degli host non offline fra gli indirizzi scansionati, e
  almeno 5, la soglia scatta. In modo `applica` il giro non spegne nessuno e
  lo dice nel registro del giro e nella storia delle scansioni («soglia
  superata, N non marcati»); il giro dopo manda offline solo gli host che
  erano candidati in tutti e due i giri, così un calo vero arriva con un giro
  di ritardo e la guardia non resta bloccata. Ogni giro decide solo per gli
  host che ha scansionato: un giro su pochi host selezionati, o con indirizzi
  esclusi perché il ping non ha potuto girare, non cancella la conferma in
  attesa per il resto della rete. Un calo sotto soglia si applica subito come
  prima. I candidati in attesa di conferma si conservano nel
  database del tenant, quindi un riavvio per aggiornamento non azzera la
  conferma. Impostazioni per tenant: `offline_guard_mode` (`registra` o
  `applica`), `offline_guard_pct` (50), `offline_guard_min` (5). **Cosa
  cambia sulle installazioni del canale `dev`:** niente sullo stato degli
  host, perché il modo predefinito è `registra`: si spegne come prima e, quando
  la soglia sarebbe scattata, si scrive «qui avrei bloccato N» nel registro
  del giro, nella storia delle scansioni e una riga `[SogliaOffline]` nel
  journal. Il passaggio ad `applica` è un'impostazione per tenant e si fa
  contando quelle righe. Rigiocando la storia di un'installazione (2.172 giri
  in 147 giorni) la soglia sarebbe scattata 11 volte, e tutte le volte il calo
  c'era ancora al giro dopo. Prova: `offline-guard.test.ts`.

## [Non rilasciato] — 2026-10-12

### Correzioni

- **Alert sicurezza: «finestra» e «sistema» filtrano anche l'elenco.** Prima
  cambiavano solo i grafici e l'elenco restava quello di sempre. Ora l'elenco
  mostra gli eventi visti nel periodo scelto (di default le ultime 24 ore) e del
  sistema scelto; l'intestazione dice il periodo e, se ce ne sono di più vecchi,
  quanti eventi aperti ci sono in tutto, così un evento vecchio non preso in
  carico non sparisce senza dirlo.
- **Richieste superate annullate.** In Inventario, Tabella ARP, Analytics, Sorgenti
  DHCP, Subnet e nella ricerca in alto una risposta lenta poteva arrivare dopo
  quella giusta e sostituirla. Ora ogni richiesta nuova annulla la precedente. La
  ricerca dei lease DHCP aspetta che si finisca di scrivere e torna a pagina 1
  (prima restava sulla pagina aperta, spesso vuota).
- **Discovery.** Due subnet con lo stesso nome si fondevano nel filtro: ora sono
  distinte. Il filtro vulnerabilità riporta a pagina 1. A modulo LibreNMS spento
  la pagina non fa più una richiesta a LibreNMS per ogni rete a ogni caricamento.
- **Export CSV senza formule.** Un valore che comincia con `=`, `+`, `-` o `@`
  (un hostname, un banner) Excel lo apriva come formula: ora gli si antepone un
  apostrofo, che Excel non mostra. Vale per tutti gli export che usano la funzione
  comune, compresi Discovery e software dell'host.
- **Dispositivi: i chip delle classificazioni contano i risultati filtrati** e ci
  sono tutti (prima solo i primi 12, con i numeri dell'insieme intero). Un errore
  di caricamento non si presenta più come «nessun dispositivo».
- **Impostazioni dell'hub senza segreti per chi non è admin (SEC-5, seconda
  strada).** Chiusa la configurazione delle integrazioni, la lettura generale
  delle impostazioni restituiva ancora a ogni utente con accesso tutta la
  tabella dell'hub, dove stanno anche password e token delle integrazioni e
  della posta: di solito cifrati, ma non sulle installazioni nate prima della
  cifratura. Ora chi non è admin la riceve senza le chiavi dei segreti
  (riconosciute dal nome; nel dubbio si nascondono), con il solo conteggio di
  quelle tolte; l'admin la riceve come prima. Il censimento delle guardie la
  dichiara lettura «mascherata» e la verifica dal di fuori la prova col
  viewer. **Cambia sulle installazioni del canale `dev`** solo per chi non è
  admin, e nessuna pagina aperta ai viewer legge quelle chiavi. Prova:
  `impostazioni-viewer.test.ts`.
- **Scritture verso la dashboard Wazuh dal proxy solo per gli admin (SEC-6).**
  Il proxy della dashboard Wazuh accettava ogni metodo da chiunque avesse una
  sessione, viewer compresi: le letture restavano a tutti, ma anche le
  scritture, a differenza di ogni altra scrittura di `/api`. Ora le letture
  (GET, HEAD, OPTIONS) restano a chi ha una sessione e le scritture chiedono
  l'admin. Era l'ultimo debito del censimento delle guardie, che adesso è vuoto
  e resta tale (una prova lo tiene vuoto). **Cambia sulle installazioni del
  canale `dev`** solo in teoria: nessuna pagina di DA-IPAM usa questo proxy (i
  collegamenti vanno all'indirizzo diretto della dashboard).
- **MeshCentral comanda solo se il modulo è attivo (SEC-18).** «Disinstalla»
  spegneva il modulo ma lasciava salvati i parametri di collegamento (per non
  perderli a un clic) e, di default, nodi e storico: comandi remoti, sessioni
  di controllo remoto, associazioni nodo-host, sincronizzazione e
  installazione degli agenti guardavano solo se i parametri c'erano, e quindi
  continuavano a funzionare a modulo spento. Ora ognuna di queste azioni
  controlla prima che il modulo sia attivo e, se non lo è, risponde «Modulo
  MeshCentral disattivato» senza contattare il server MeshCentral; il job di
  sincronizzazione resta in elenco ma non gira (e non conta come guasto),
  l'icona Mesh sparisce dall'elenco degli host e la conferma di
  disinstallazione lo dice. Configurazione e dati restano: reinstallando il
  modulo tutto torna come prima. **Cambia sulle installazioni del canale
  `dev`** solo per chi ha il modulo spento con la configurazione salvata:
  al cliente A il modulo non è configurato, sull'hub (letture del 12/10) risulta
  attivo su due clienti; resta da confermare che nessun cliente dell'hub abbia
  la configurazione col modulo spento. Prova: `disinstallato.test.ts`.
- **Installazioni di LibreNMS e Graylog con segreti propri, mai nel registro
  (SEC-13).** Fino a oggi ogni installazione gestita usava gli stessi segreti
  interni, scritti nel sorgente (che è pubblico), e il registro
  dell'installazione, visibile dalla pagina, riportava la password admin.
  Ora ogni installazione nuova genera i propri segreti, li salva cifrati
  nell'hub e li passa ai container per ambiente invece che fra gli argomenti
  dei comandi; il registro dice solo che sono stati salvati. Se la richiesta
  d'installazione non indica una password admin, se ne genera una invece di
  usare un valore predefinito: la si legge nella card dell'integrazione (solo
  admin). **Cambia all'avvio sulle installazioni del canale `dev`**: per le
  installazioni già presenti l'hub legge i segreti dall'ambiente dei container
  (sola lettura) e ne salva una copia cifrata, così i comandi di manutenzione
  continuano a funzionare; i container non vengono toccati. La sostituzione
  dei segreti delle installazioni esistenti è un passo a parte, non fatto qui.
  Prove: `install-segreti.test.ts`, `install-segreti-invariante.test.ts`.
- **Accesso automatico a LibreNMS solo per gli admin (SEC-6, parte utenti in
  sola lettura).** L'accesso automatico entra in LibreNMS con l'utenza admin
  salvata nell'hub, ma bastava essere collegati a DA-IPAM per usarlo: anche un
  utente in sola lettura si trovava dentro LibreNMS da amministratore. Ora lo
  usa solo chi è admin; gli altri arrivano alla pagina di login di LibreNMS
  (dal Launchpad, dalla dashboard e dal proxy) ed entrano con un'utenza
  LibreNMS loro; ad accesso automatico spento il proxy passa la richiesta
  com'è, così quel login funziona anche da lì. Limite: in un browser condiviso
  in cui un admin ha usato l'accesso automatico, la sua sessione di LibreNMS
  resta nel browser finché LibreNMS non la fa scadere. **Cambia subito sulle installazioni del canale `dev`** (deroga
  a «nasce spento», decisa nel piano): chi era viewer e apriva LibreNMS senza
  login ora vede il login; secondo la lettura del 12/10 sull'hub c'è un utente
  viewer, al cliente A nessuno. Per l'admin non cambia niente, tranne la voce
  LibreNMS del vault delle credenziali, che ora tiene l'indirizzo diretto
  dell'interfaccia (la scelta dell'accesso automatico si fa quando si apre il
  link, in base al ruolo: anche «Apri» nella scheda della credenziale porta
  l'admin dentro con l'accesso automatico); le voci salvate in passato si correggono alla
  prossima sincronizzazione del vault. Prova: `librenms-accesso.test.ts`.
- **Configurazione delle integrazioni senza segreti per chi non è admin
  (SEC-5, SEC-13).** La lettura della configurazione di LibreNMS, Graylog e Loki
  era aperta a ogni utente con accesso, anche in sola lettura, e restituiva i
  campi segreti così come erano salvati; UniFi li nascondeva già, le altre no.
  Ora chi non è admin riceve quei campi vuoti e un'indicazione «impostato»,
  così la scheda in Impostazioni → Moduli mostra lo stesso stato senza il
  valore; per l'admin non cambia niente (e quindi il salvataggio della scheda
  non può sovrascrivere un segreto con un campo vuoto). L'avanzamento di
  un'installazione ora si legge solo da admin, come l'installazione stessa. La
  prova `politica.test.ts` controlla la maschera e che la rotta ci passi prima
  di rispondere; il censimento delle guardie toglie i due debiti.

### Aggiunte

- **Registro dei ripieghi del database** (tappa 3, NUC-1 fase A). Ogni accesso al
  database senza contesto tenant, su un'installazione con hub, si conta: il
  ripiego su DEFAULT, quello su `ipam.db` e il file di un tenant che l'hub non
  conosce. Il registro è in `data/logs/ripieghi/` (un file JSONL al giorno, 30
  giorni, una riga per chiamante e ora, lo stack una volta sola). `/api/health`
  dà solo il numero; `/api/modules/health` dice chi e da dove solo al
  superadmin, perché il dettaglio riguarda tutti i tenant del processo. Il
  chiamante si riconosce anche quando il codice gira dal build di Next (file
  minificati, dove il nome del file non dice niente): la firma è la catena dei
  primi punti di chiamata con riga e colonna. Il file di un tenant sconosciuto
  si conta a ogni apertura, anche se esisteva già prima del registro.
  Perché: il 02/09 un contesto perso ha mandato dati di un tenant in DEFAULT senza
  un allarme; prima di trasformare questi ripieghi in errori bisogna sapere, con
  una settimana di dati che sopravvive agli aggiornamenti, chi li usa ancora.

- **Misura del database di un tenant, in sola lettura** (tappa 3, strumento per
  DB-1, DB-2, DB-3). `npx tsx scripts/misura-db-tenant.ts <file.db>` stampa righe
  e spazio per tabella, righe al giorno dello storico MAC-IP, coppie già viste,
  MAC con più IP, forme dei MAC e delle date per colonna, righe oltre 30/90/180
  giorni e ultima scansione per rete e tipo (`--json` per la forma macchina,
  `--senza-spazio` per saltare il calcolo dello spazio sui file grandi).
  Perché: gli interventi della tappa 3 sul database (chiave dei MAC, storico,
  retention) vanno misurati prima e dopo sullo stesso file, sempre allo stesso
  modo. Il file si apre in sola lettura e l'output contiene solo numeri e nomi di
  colonna, mai MAC, IP o nomi del cliente: si può incollare in un documento.
- **Banco di prova delle scansioni** (tappa 3, T3-16): il vero giro di scoperta della rete ora si può far girare in una prova con un esecutore finto, mentre una guardia fa fallire la prova se qualcosa prova a uscire davvero sulla rete. *Perché*: le correzioni delle scansioni che si accavallano e degli host vivi segnati spenti (INV-1, INV-2) vanno provate sul codice vero, e fin qui l'unico modo era mandare pacchetti veri. In produzione non cambia niente: la porta per le prove è vuota. Il doppio sa anche rallentare, trattenere fino a un segnale della prova o fallire, così due giri accavallati si possono mettere nell'ordine voluto; e la guardia copre anche le richieste DNS dirette e i processi lanciati in modo sincrono. Di contorno, i timer che puliscono l'avanzamento di una scansione finita non tengono più vivo il processo per cinque minuti.
- **Censimento delle guardie di tutte le rotte API (prova nel cancello).** Prima
  una prova copriva solo un elenco di rotte scelte a mano, e lo script di audit
  leggeva i sorgenti con espressioni regolari: nei due proxy delle integrazioni
  non vedeva nessun metodo (14 gestori fuori dal conto). Ora un rilevatore unico
  (`src/lib/permessi/`) legge l'albero sintattico e la prova
  `rotte-censite.test.ts` controlla tutti i 452 gestori: ognuno deve avere la
  guardia attesa (lettura → accesso, scrittura → admin, lettura sensibile →
  admin), oppure un'eccezione col motivo scritto, oppure un debito col codice
  del difetto che lo chiude. Una rotta nuova non dichiarata fa fallire il
  cancello; un debito sanato pure, finché non lo si toglie dall'elenco; e le
  rotte aperte senza accesso devono essere esattamente quelle ammesse da
  `auth.config.ts`. Le letture delle credenziali aperte ai viewer hanno una prova
  loro (`letture-mascherate.test.ts`): ogni colonna cifrata va mascherata,
  anche una aggiunta domani. `scripts/audit-api-auth.ts` usa lo stesso
  rilevatore e scrive la matrice nel percorso che gli si passa. Nessun
  comportamento cambia: sono solo prove.
- **Verifica dei permessi dal di fuori, in locale
  (`scripts/verifica-permessi.sh`).** Il censimento legge il codice; uno strato
  che sta prima del gestore, o una rotta che fa qualcosa prima della guardia,
  lì non si vede. La verifica chiede all'applicazione accesa in locale, come
  farebbe un browser: crea un utente in sola lettura di prova (password
  generata sul posto, mai stampata), fa solo letture senza sessione e da viewer
  sulle rotte che il censimento indica, controlla che i rifiuti siano rifiuti e
  che le configurazioni delle integrazioni arrivino senza segreti, poi toglie
  l'utente. Rifiuta un indirizzo che non sia locale: un'utenza di prova su un
  server vero sarebbe una scrittura in produzione. Il giudizio sulle risposte
  ha una prova sua (`verifica-esterna.test.ts`) che fa fallire le risposte del
  codice di prima. `docs/auth-matrix.md` è rigenerata dal censimento (452
  gestori, nessun debito, nessuna rotta scoperta) e torna a valere.

- **Controller UniFi come fonte di dati (spento finché non lo si accende).** Al
  cliente A il controller UniFi gestisce 74 apparati, ma per DA-IPAM erano solo host:
  nessuno fra i dispositivi di rete, nessuna porta, nessun vicino LLDP, e la
  mappa della topologia mostrava quasi solo i tre MikroTik. Ora DA-IPAM legge il
  controller in sola lettura e scrive nel tenant gli switch e gli access point,
  le loro porte e i collegamenti fra apparati. Si configura in Impostazioni →
  Moduli → «Controller UniFi» (indirizzo, site, utente in sola lettura,
  password), si prova con «Prova connessione» e si lancia con «Sincronizza ora».
  Per ora funziona solo il controller installato su un server (self-hosted):
  UDM e cloud rispondono «non ancora supportato». Le scelte sono nell'ADR 0005.
  - **Nasce spento**: modalità «Disattivata» e nessuna sincronizzazione
    automatica. Gli apparati nuovi entrano disabilitati, così il poll ARP non
    li interroga via SNMP.
  - **Il certificato del controller si fissa al primo collegamento riuscito.**
    Se cambia, la sincronizzazione si ferma e la card mostra le due impronte:
    la nuova si accetta solo a mano. La password non parte mai verso un
    certificato che non è quello fissato. Cambiando l'indirizzo del
    controller la password salvata si cancella e va riscritta: altrimenti
    un errore di battitura (o chi non la conosce) la farebbe arrivare al
    primo host che risponde. La prova di connessione è un POST, così un
    link aperto con la sessione attiva non la fa partire.
  - **Una risposta vuota non cancella niente.** Se il controller non riporta
    porte o vicini per un apparato che nel database ne ha, si tengono i dati
    di prima e lo si segnala. Lo stesso per un apparato spento o scollegato:
    il controller ne dà solo le porte senza stato, quindi porte e vicini
    restano quelli dell'ultima sincronizzazione e la card lo elenca a parte.
  - **Nessun doppione e nessuna scelta sovrascritta.** Un apparato già censito
    si ritrova per seriale, MAC o IP, e se ne aggiornano solo i dati di fatto
    (modello, firmware, seriale), non nome, credenziali e abilitazione. Un IP
    occupato da un altro apparato (MAC diverso, altro produttore o altro
    seriale) si salta e lo si dice. Se un AP cambia IP e uno nuovo prende il
    suo, il nuovo non sovrascrive più quello censito, qualunque sia l'ordine
    in cui il controller li elenca. Gli apparati non ancora adottati non
    entrano.
  - **Compare in «Stato moduli»**, con una sonda che non fissa mai il
    certificato da sola e non interroga il controller più di una volta ogni
    cinque minuti. Il controllo del disco dell'appliance, ogni 30 minuti, non
    lo interroga affatto: la verifica di un solo modulo fa partire solo la
    sua sonda.
  - Il job `unifi_sync` esiste nello scheduler (migrazione v8 di
    `scheduled_jobs`) ma nessuno lo crea da solo. I tipi di job ora stanno in
    un solo elenco, condiviso da schema e migrazione; una prova confronta la
    tabella aggiornata con quella di un tenant nuovo, vincoli e indici
    compresi, perché il resto del DDL della v8 è ancora scritto a mano.

### Correzioni

- **Liste che non dicono di essere troncate.** Inventario, Scansioni e Alert
  sicurezza caricano al massimo 200 righe, ma non lo dicevano: chi cercava un
  asset o un evento oltre la duecentesima riga concludeva che non esistesse. Ora
  compare «Sono mostrati i primi 200…» (o «le più vecchie non sono mostrate»)
  quando ce ne sono altre. In Inventario il filtro «Solo con gap» lavorava sulle
  sole 200 righe caricate: con il filtro attivo se ne caricano fino a 1000, il
  massimo che il server concede. Un errore di caricamento in Inventario e negli
  Alert sicurezza ora si vede, con «Riprova», invece di sembrare una lista vuota.
- **Ricerca host nella cronologia Patch.** La ricerca per hostname o IP filtrava
  solo le 50 righe della pagina aperta: un host presente nelle pagine successive
  risultava assente. Ora la ricerca la fa il server su tutta la cronologia, e i
  campi host e CVE aspettano che si finisca di scrivere invece di interrogare il
  server a ogni tasto.
- **Ricerche di Active Directory.** Computer, utenti, gruppi e DHCP interrogavano
  il server a ogni tasto, e una risposta lenta poteva arrivare dopo quella giusta
  e sostituirla. Ora la ricerca parte 300 ms dopo l'ultimo tasto e le richieste
  superate si annullano. Accanto a «Attivi (90gg)», che è acceso di default, si
  legge quanti ne mostra sul totale («40 di 500»): prima la linguetta diceva 500
  e la tabella ne mostrava 40 senza spiegare perché.
- **Pulizia dei riferimenti orfani su ogni tenant** (tappa 3, NUC-2 gruppo 0).
  La pulizia dei collegamenti rimasti a reti, host e apparati cancellati (tabelle
  dello storico MAC-IP e dei lease DHCP) partiva una volta sola per processo: su
  un hub con più tenant toccava il primo database e mai gli altri. Ora gira una
  volta per ciascun database. Cambia il comportamento sull'hub: alla prima
  interrogazione di un apparato, ogni tenant azzera i propri riferimenti orfani.
  Insieme, quattro funzioni dati (pulizia, intervallo dei job, andamento degli
  stati, ultimi cambi di stato) esistono ora in una sola copia, quella per
  tenant; la vecchia facciata le riesporta. Un test tiene il numero esatto delle
  funzioni ancora definite nella facciata (anche quelle scritte come costanti) e
  impedisce che una funzione spostata vi ricompaia, anche non esportata. Un
  banco di prova confronta la copia per tenant con la vecchia copia della
  facciata, conservata nel test, sugli stessi dati; il banco rifiuta un
  confronto di una funzione con se stessa, che passerebbe sempre. Perché: le
  due copie si erano separate, e una correzione fatta in una non arrivava
  all'altra.

- **Un tenant il cui database non si apre è un errore** (NUC-1). Prima il facade
  ripiegava in silenzio su DEFAULT: le scritture finivano nel database sbagliato.
  `/api/health` verifica il database sull'hub invece che passare dal facade, che
  senza contesto è proprio un ripiego.
- **Un ping che non può girare non spegne più gli host** (tappa 3, T3-19, INV-2): il ping ora ha tre esiti, «vivo», «nessuna risposta» e «sconosciuto». Quando il comando di ping non può partire o esce con un errore suo (e non per mancanza di risposta), l'indirizzo resta com'era invece di essere segnato spento; se nessun indirizzo ha avuto un esito vero, il giro finisce «fallito» senza toccare gli host. *Perché*: prima ogni errore del ping valeva «host spento», quindi un problema della macchina che scansiona poteva spegnere in un colpo tutta una rete. Il codice di uscita si legge secondo la piattaforma (Linux e macOS lo usano in modo diverso), e un ping fermato da fuori (non per il suo tempo massimo) conta come sconosciuto. Vale in tre punti: la scoperta della rete, il controllo periodico degli host noti (che con un esito sconosciuto non scrive né lo stato né lo storico) e l'agente remoto, che ora riporta anche lui l'esito sconosciuto. Un agente remoto non ancora aggiornato continua a rispondere come prima, cioè a segnare spento ciò che non ha potuto provare, finché non riceve la nuova versione.

- **Ordinamenti giusti nelle liste paginate.** Nelle liste DHCP e Subnet gli IP e
  i CIDR si ordinavano come testo («10.0.0.10» prima di «10.0.0.2»); la colonna
  «Ultimo visto» del DHCP ordinava in realtà per «Ultimo sync»; a valori uguali
  le righe potevano ripetersi o saltare fra una pagina e l'altra. Ora IP e CIDR
  vanno in ordine numerico, ogni colonna cliccabile è ammessa dal server (una
  prova lo controlla) e a parità di valore l'ordine è stabile. Nella pagina
  Dispositivi l'ordinamento per IP non si confonde più con un nome host.
- **I filtri valgono su tutta la lista, non sulla sola pagina.** «Solo recenti»
  del DHCP e, in Patch, la ricerca e la soglia di gravità filtravano soltanto le
  righe già caricate: si cercava un host e «non c'era», ma stava a pagina 2, e i
  totali restavano quelli non filtrati. Ora li applica il server.
- **L'amministratore del cliente gestisce gli utenti del proprio cliente (UI-18).**
  Su un'appliance installata per un solo cliente, l'amministratore creato dal
  setup apriva Impostazioni → Utenti e leggeva «Nessun utente trovato»: le rotte
  degli utenti erano riservate al super amministratore e il loro rifiuto si
  presentava come lista vuota. Ora l'amministratore vede, crea, modifica,
  reimposta la password ed elimina gli utenti dei clienti che amministra, e solo
  quelli: non tocca un super amministratore, non assegna quel ruolo, non elimina
  sé stesso e non si toglie il ruolo di amministratore, così l'installazione non
  resta mai senza. La propria password la cambia da «Cambia password» nel menu
  utente, che chiede quella attuale: da Utenti no, altrimenti una sessione
  rubata diventerebbe una password nuova che dura oltre la sessione. Nella
  pagina il ruolo «Super amministratore» non gli viene proposto e il cliente è
  fisso sul suo; un errore del server si mostra come errore. Il solo-lettura non
  gestisce utenti e non vede più la scheda Utenti (prima l'avrebbe vista come un
  errore da riprovare). Un super amministratore declassato smette subito di
  gestire utenti, senza aspettare che la sessione scada; per il resto resta
  com'era. Lo username dell'utenza di servizio Domarc («domarc») non si può più
  dare a un utente locale, che nei log sembrerebbe il supporto. Le regole stanno
  in un punto solo (`src/lib/users/`), provate su tutte le combinazioni e su
  ogni rotta.
- **Le conferme di disinstallazione e rimozione dicono cosa si perde (MOD-19).**
  Sotto «Elimina anche i dati storici» c'era scritto che la richiesta veniva
  accettata «ma non droppa», mentre la disinstallazione cancellava davvero le
  tabelle del modulo; «Rimuovi» dello Scanner-Edge prometteva che i findings
  restavano in archivio, e invece se ne vanno a cascata con lo storico delle
  scansioni. Ora la conferma di Patch Management, Inventory Agent e MeshCentral
  dice cosa resta senza la casella e cosa si cancella con la casella (con
  l'elenco delle tabelle), e il messaggio finale dice se i dati sono stati
  cancellati davvero; «Rimuovi» dello Scanner-Edge dice quanti findings si
  cancellano; le conferme dei container di LibreNMS, Graylog e Loki e quella di
  Network Services dicono che cosa non torna. Il comportamento sui dati non
  cambia (è la tappa 7): cambiano solo i testi, e due prove eseguono la
  cancellazione vera e la confrontano con ciò che la conferma promette.
  Network Services, sulle appliance dove il bridge viene dalle variabili
  d'ambiente `NET_SERVICES_API_URL` e `NET_SERVICES_API_TOKEN` (le scrive
  `appliance-integrate-fix.sh`), dopo la disinstallazione resta attivo con lo
  stesso bridge: la conferma ora lo dice, e se il bridge viene solo da lì il
  pulsante «Disinstalla» lascia il posto a una nota che spiega come spegnerlo.
  Anche l'import del JSON dello Scanner-Edge (Impostazioni → Moduli →
  «Importa configurazione modulo») sostituisce lo scanner cancellando a
  cascata findings e storico delle scansioni, e lo faceva senza dire niente:
  ora, se c'è uno storico, prima di scrivere chiede conferma dicendo quanti
  findings e quante scansioni si cancellano e che la sincronizzazione
  riscarica solo ciò che l'edge conserva ancora. Il connect di
  Deploy-Appliance, che usa la stessa rotta, non cambia.
- **Le righe «Stato moduli» della dashboard portano al modulo (UI-20).**
  Aprivano sempre la configurazione, anche per un modulo attivo con la sua
  pagina, e un modulo mai installato diceva «Mai eseguita», che si legge come
  «c'è ma non ha ancora girato». Ora un modulo attivo apre la sua pagina in
  DA-IPAM anche quando la sonda è in errore (i findings e i nodi in cache si
  leggono lo stesso), o il Launchpad se ha un'interfaccia esterna e non è in
  errore; uno non installato, da configurare o spento apre la sua scheda in
  Impostazioni → Moduli, e al posto dell'ora dice «Modulo non attivo», «da
  configurare» o «disattivato». Un modulo non installato non conta più fra
  quelli «in errore»: MeshCentral disinstallato tiene i parametri di
  collegamento e la sua sonda poteva accendere il badge rosso.
- **I filtri mostrano l'etichetta della voce scelta, non il suo codice.** Dopo
  una scelta, i menu a tendina dei filtri mostravano il valore tecnico: «all»
  invece di «Tutti gli stati», «unacked» invece di «Non gestiti», il numero della
  rete invece del suo nome. La libreria dei componenti (base-ui) mostra
  l'etichetta solo se riceve l'elenco delle voci, e nessuna pagina glielo
  passava. Ora il componente comune `Select` lo ricava da solo dalle voci che
  contiene: la correzione vale per tutti i menu senza toccarli uno per uno.
- **Gli orari sono quelli di Roma, non indietro di una o due ore.** Il database
  scrive le date in UTC senza indicare il fuso (`2026-10-12 08:00:00`) e le
  pagine le leggevano come ora locale: ogni orario mostrato era indietro di
  un'ora d'inverno e di due d'estate, e su Safari compariva «Invalid Date». Una
  sola funzione, `parseDbDate` (`src/lib/db-date.ts`), legge quelle date come UTC
  ed è usata in tutte le pagine; la dashboard, preparata sul server (che in
  produzione è in UTC), indica in più il fuso di Roma.
- **Dispositivi: lo stato è la raggiungibilità vera.** La colonna «Stato» e il
  filtro Online/Offline guardavano se il dispositivo era *abilitato in
  anagrafica*: un router spento ma abilitato risultava «Online». Ora lo stato
  viene dall'host scansionato con lo stesso IP (con «stale» se l'ultima risposta
  è vecchia), e un dispositivo che nessuna scansione ha mai visto è
  «Sconosciuto», con una voce apposta nel filtro.
- **Un errore non si presenta più come «nessun dato».** Scansioni, IP esclusi,
  Anomalie e Tabella ARP, se il server rispondeva con un errore (sessione
  scaduta, errore interno, server irraggiungibile), mostravano una lista vuota
  («Nessuna scansione eseguita») oppure lasciavano a schermo i dati vecchi senza
  dire niente. Ora compare «Impossibile caricare …» con il motivo e il pulsante
  «Riprova». Due pezzi riusabili per le altre pagine: `fetchJson`
  (`src/lib/fetch-json.ts`) e il riquadro `LoadError`.
- **Grafico «Stato host nel tempo»: niente più denti di sega.** Il grafico
  contava, ora per ora, solo gli host controllati dentro quell'ora e metteva
  tutti gli altri fra gli «Sconosciuti». Dove il controllo degli host gira ogni
  3 ore (cliente A) la curva saliva all'ora del controllo e crollava nelle due ore
  dopo, con la salute al 3%, anche se nessun host cambiava stato. Ora ogni host
  conserva il suo ultimo stato per 24 ore (oltre torna «sconosciuto»), la serie
  ha un punto per ogni ora anche senza controlli, e la salute si calcola sugli
  host di stato noto (`src/lib/status-over-time.ts`).
- **L'aggiornamento automatico delle appliance non si blocca più su WinRM e
  riavvia il servizio giusto.** Sul cliente A da giugno ogni aggiornamento si fermava:
  l'ambiente Python per WinRM era stato creato senza `pip` e lo script, trovando
  `python3`, non lo ricreava; dopo il `git pull` si fermava tutto e la build
  nuova non partiva mai. Ora un ambiente senza `pip` si ricrea, un guasto di
  WinRM (funzione facoltativa) è solo un avviso, e il riavvio cerca il servizio
  attivo (`da-invent` o `da-ipam`) invece del solo `da-invent`.
- **Il controllo finale dell'aggiornamento non segnala più un falso errore.**
  Partiva un secondo dopo il riavvio, quando l'app non ascoltava ancora, e
  falliva sempre con un avviso che rimandava a WinRM. Ora aspetta fino a 60
  secondi che l'app risponda.
- **L'aggiornamento automatico non riavvia per i commit di sola
  documentazione.** Un commit che cambia solo `docs/` o file `.md` aggiorna i
  file senza build né riavvio: prima ogni nota pubblicata riavviava l'appliance del cliente A e
  interrompeva il controllo degli host in corso.
- **«Aggiorna» e «Riavvia» dall'interfaccia non lasciano più l'app spenta, e
  «Aggiorna ora» di Impostazioni funziona.** Il riavvio cercava solo il servizio
  `da-invent`; sulle appliance installate con Deploy-Appliance, come cliente A, si
  chiama `da-ipam`, e il pulsante ripiegava sul rilancio da sé (un processo
  staccato e un'uscita senza errore), che sotto systemd chiude tutto: l'app
  restava spenta finché qualcuno non la riavviava a mano (successo due volte il
  12/10). Ora, sotto systemd, si riavvia l'unità in cui gira il processo, letta
  da `/proc/self/cgroup` qualunque nome abbia, con `systemctl --no-block
  restart`, e si lascia che sia systemd a fermare il processo e a farlo
  ripartire. Il processo esce con errore, e con `Restart=on-failure` riparte
  comunque, in tre casi: se risulta sotto systemd (variabile `INVOCATION_ID`)
  ma non si capisce quale unità; se systemd rifiuta la richiesta (per esempio
  per i permessi) o non risponde entro 15 secondi, e il motivo va nel log; se
  systemd l'accetta ma dopo 90 secondi il processo è ancora vivo. Sotto systemd
  non esce mai senza errore e non si rilancia mai da sé: il rilancio resta solo
  fuori da systemd, in sviluppo, dopo PM2 se c'è. Non si sceglie più il primo
  servizio attivo fra `da-invent` e `da-ipam`: con `systemctl` lento (macchina
  sotto carico) o un nome diverso risultava «nessun servizio» e si tornava al
  rilancio da sé, e con tutti e due attivi si poteva riavviare quello sbagliato
  (`src/lib/app-service.ts`).
  Dopo un «Aggiorna» riuscito il riavvio lo programma il server, un secondo
  dopo aver risposto, sulla stessa strada di «Riavvia»: prima lo chiedeva il
  browser alla risposta, e con una build più lunga dell'attesa di nginx (300 s)
  o con la scheda chiusa la build nuova restava su disco col processo vecchio.
  L'interfaccia non chiede un secondo riavvio, mostra i passi eseguiti e
  l'esito, e se la risposta si perde spiega che il server finisce da solo.
  «Aggiorna ora» in Impostazioni → Aggiornamenti mandava l'azione nel corpo
  della richiesta, che la rotta non leggeva, e riceveva «Azione non
  supportata»: ora l'azione si legge dall'indirizzo o dal corpo.
  I comandi da copiare dell'aggiornamento manuale riavviano il servizio attivo
  fra `da-invent` e `da-ipam` (prima solo `systemctl restart da-invent`, che sul
  cliente A falliva) e, se nessuno dei due è attivo, lo scrivono; il messaggio dello
  scheduler che chiede di riavviare il processo nomina tutti e due.
- **Un job non parte più due volte nello stesso processo.** Quando una pagina
  salvava la configurazione dei job (job, AD, Wazuh, MeshCentral, Scanner-Edge,
  import moduli), lo scheduler veniva ricaricato da una seconda copia del suo
  modulo, che non vedeva i cron già attivi: non li fermava e ne aggiungeva
  altri. Sul cliente A, il 12/10 alle 15:04, il controllo degli host è partito due
  volte insieme. Ora l'elenco dei cron è unico per processo.
- **Tabella ARP: si vede quando la lista è troncata.** Mostra al massimo 500
  righe; arrivata al limite, ora lo dice e invita a restringere con i filtri,
  invece di tagliare in silenzio.
- **VA Scan: i profili assessment sono quelli dell'edge (EDG-1).** Il pannello
  della subnet offriva quattro profili scritti nel codice, ma l'edge conosce solo
  quelli del suo catalogo: due dei quattro non li ha mai avuti. L'id si salvava
  senza errori e l'assessment falliva dopo la scansione, sull'edge, con «Profilo
  sconosciuto», senza che DA-IPAM lo mostrasse. Ora l'elenco si legge dall'edge
  (`GET /api/v1/profiles`) con la sua etichetta; se l'edge non risponde la pagina
  lo dice e non offre una lista inventata. Prima di avviare una scansione o di
  salvare una pianificazione DA-IPAM controlla che l'edge abbia il profilo, e se
  non c'è risponde con l'errore e l'elenco dei profili disponibili. Un profilo
  salvato che l'edge non ha più si vede sul pulsante «VA Scan» e nel pannello.
  Acceso senza profilo non ripiega più su «validation-plus»: chiede di sceglierlo.
  Il profilo nuovo si salva in DA-IPAM solo dopo che l'edge l'ha accettato: prima
  si scriveva subito, e se l'edge rifiutava la richiesta (integrazione IPAM spenta,
  token senza permessi, timeout) l'avviso spariva mentre l'edge teneva il profilo
  vecchio. L'avviso c'è solo a pagina aperta: le reti che nessuno apre non lo
  mostrano ancora.

## [Non rilasciato] — 2026-09-07

### Aggiunte

- **L'utenza si crea su dichiarazione di DA-Auth, non da sola.** Chi arriva da
  `entra.domarc.it` e non ha un'utenza qui entra **solo** se un amministratore
  l'ha dichiarato su DA-INVENT: allora l'utenza si crea, col ruolo e i clienti
  che la tabella di traduzione associa al suo. Senza dichiarazione, rifiuto
  come prima. Non è auto-provisioning: non si inventa niente, si esegue una
  decisione presa e firmata.
  La traduzione (`RUOLO_DOMARC_A_LOCALE` in `src/lib/daauth.ts`) è scritta in
  chiaro e sta **qui**, perché è questa applicazione a sapere cosa significano
  i propri ruoli e cos'è un cliente: `admin` → `superadmin` (vede tutti);
  `standard` → `admin` su Domarc (`70791` e `70791a`, che sono la sede e
  l'infrastruttura a OVH dello stesso cliente) — è il livello del tecnico;
  `readonly` → `viewer` sugli stessi. Non è un accesso regalato a chi lavora in
  Domarc: **senza dichiarazione non entra nessuno**, e la traduzione vale solo
  per chi un amministratore ha messo esplicitamente su questa applicazione. Un
  ruolo che non c'è (o che è stato tolto dal parco) non si traduce.
  ⚠️ I clienti si dichiarano **per codice** e un codice che non esiste viene
  saltato con un avviso: non diventa «tutti». Il ruolo e i clienti di chi ha
  già un'utenza non si toccano.

- ⚠️ **È un'OPZIONE, e nasce spenta.** DA-INVENT è installato anche presso i
  clienti, su appliance che non hanno — e non devono avere — un servizio di
  autenticazione Domarc da contattare. Il freno è la variabile `DAAUTH_URL`:
  **senza, la funzione non esiste**, il bottone non compare e l'installazione
  si comporta esattamente come prima. Non c'è un valore predefinito, di
  proposito. Si accende solo sugli impianti Domarc mettendo l'indirizzo del
  servizio in `.env.local` (o nel compose) e riavviando.
- **Si entra con l'account Domarc.** Un bottone «Accedi con l'account Domarc»
  sulla pagina di accesso: si viene riconosciuti da `entra.domarc.it` — con
  Microsoft e MFA, con le credenziali di dominio o col PIN — e si entra senza
  digitare niente qui. Chi ha già una sessione Domarc aperta da un'altra
  applicazione non rifà nulla. **Non serve una registrazione Entra per
  DA-INVENT**: quella ce l'ha DA-Auth, che in più conosce i nostri utenti, sa
  dire il ruolo per singola applicazione e tiene il registro degli ingressi,
  compresi quelli falliti.
- **Username e password restano**, e non per inerzia: sono la riserva. Se
  `entra.domarc.it` non risponde si entra come prima — la funzione che lo
  interroga restituisce «non lo so» invece di sollevare, ed è provato. Il
  backoff sui tentativi falliti non è stato toccato.
- ⚠️ **Chi arriva da DA-Auth deve avere un'utenza DA-INVENT**: nessun
  auto-provisioning. Una riga creata al volo non avrebbe tenant (inutile) o li
  avrebbe sbagliati (dannoso). E **ruolo e tenant restano quelli della riga
  locale**, non quelli che dice DA-Auth: i due sistemi parlano vocabolari
  diversi (qui c'è `superadmin` e l'accesso per tenant, là no), e tradurli in
  silenzio darebbe a qualcuno più permessi di quelli che ha oggi.

- **I CPE dei servizi arrivano fino al database.** `parseNmapXml` leggeva solo
  gli attributi `product`/`version` di `<service>` e scartava i figli `<cpe>`:
  misurato su 664 porte reali, 194 avevano la versione e **zero** un CPE. Senza
  CPE il match con l'NVD non e' possibile — `cpe:/a:openbsd:openssh:9.6p1` si
  confronta con i cpeMatch, la stringa "OpenSSH 9.6p1 Ubuntu 3ubuntu13.15" no.
  `NmapPort` ora porta anche `product`, `product_version` e `cpes`; la stringa
  unita `version` resta identica, perche' la leggono UI, classificatore e
  fingerprint. Primo passo del match CVE da feed locali (NVD + EPSS + KEV),
  scelti al posto dell'API vulners.com per non far uscire l'inventario software
  dei clienti verso terzi.
- **Intensita' `-sV` configurabile** via `DA_INVENT_NMAP_VERSION_INTENSITY`
  (0-9). **Default invariato a 0**: alzarla costa tempo di scansione su ogni
  host di ogni cliente, e si decide misurando su rete vera, non a sensazione.
- Test-invariante `src/lib/scanner/__tests__/nmap-cpe.test.ts`: la perdita dei
  CPE era silenziosa — nessun test falliva, il campo semplicemente non c'era.

## [Unreleased] — branch `feature/remote-agents`

Aggiunge l'architettura **hub + agenti remoti via VPN precedente**: l'hub IPAM
orchestra agenti Python installati presso i clienti, mantenendo invariato
il flusso per i tenant gestiti localmente.

### Added

#### Hub (Next.js)

- **Tabella `tenant_agents`** (`db-hub-schema.ts`): supporta **N agenti per
  tenant** (sedi diverse dello stesso cliente). Colonne: id, tenant_id FK,
  label, hostname, port, token_hash, token_encrypted, version, last_seen_at,
  subnet_match (riservato a routing per-subnet futuro), timestamps.
  Migrazione idempotente in `initializeHubDb()`: per ogni tenant con
  `agent_hostname` non-null, crea una riga in `tenant_agents` etichettata
  "Sede principale".
- **Pagina `/agents`** (`src/app/(dashboard)/agents/page.tsx`): overview
  cross-tenant di tutti gli agenti. Colonne: cliente, label/sede,
  hostname:porta, versione, ultimo heartbeat, stato live (online/error_code),
  azioni (Test, Configura, Elimina). Pulsanti "Ricarica", "Testa tutti".
- **Wizard "Nuovo agente"** (dialog 2-step + token):
  - Step 1: scelta cliente esistente (dropdown) o creazione cliente nuovo
    inline (codice + ragione sociale).
  - Step 2: configurazione agente (label/sede, hostname nella VPN precedente, porta,
    subnet_match opzionale). Imposta automaticamente `agent_mode='remote'`.
  - Step 3: mostra token plaintext (una sola volta) + campo opzionale
    chiave d'ingresso della VPN precedente + comando di install one-liner pre-popolato.
- **`Executor` abstraction** (`src/lib/executor/`):
  - `Executor` interface (`index.ts`): primitive ping/nmap/dns/macVendor.
  - `LocalExecutor` (`local.ts`): delega ai moduli `src/lib/scanner/*`.
  - `RemoteExecutor` (`remote.ts`): client HTTP verso agent via VPN precedente,
    timeout per metodo, error envelope strutturato (`RemoteExecutorError`).
  - `getExecutor(tenantCode)`: legge `tenants.agent_mode` e pesca il primo
    agente da `tenant_agents` per i tenant remote.
- **`discoverNetwork`/`runDiscovery` instradano via executor** del tenant:
  shadowing trasparente di `pingSweep`/`nmapDiscoverHosts`/`nmapPortScan` —
  zero modifiche ai call site interni. Skip del check `isNmapAvailable` locale
  quando l'executor è remoto (l'hub si fida dell'agent).
- **Bottone "Testa connessione"** in `/tenants/[id]/agent` con badge
  esito (online + latency / error_code).
- **API tenant-agents** (per-agent CRUD):
  - `GET/POST /api/tenant-agents` (lista cross-tenant o filtrata; create).
  - `GET/PUT/DELETE /api/tenant-agents/[id]` (singolo).
  - `POST /api/tenant-agents/[id]/token` (genera, sovrascrive precedente).
  - `POST /api/tenant-agents/[id]/token/import` (importa token plaintext esistente).
  - `POST /api/tenant-agents/[id]/test` (call `/whoami` su agent).
- **API back-compat** `/api/tenants/[id]/agent*`: continuano a funzionare
  puntando al primo agent del tenant; le scritture creano l'agent se assente.
- **API `GET /api/agents`**: lista one-row-per-agent cross-tenant.
- **Endpoint pubblico `/agent-install.sh`**: serve lo script con
  `Content-Type: text/x-shellscript`, esente da auth middleware
  (consumabile via `curl|bash` da macchine senza sessione).
- **`scripts/hub-install.sh`** idempotente: apt-installs (nmap, snmpwalk,
  fping, arping, Kerberos, build-essential), `setcap` su nmap, crea venv
  pywinrm in `/root/.da-invent-venv`. Da usare dopo migrazioni LXC→VM.
- **Sidebar**: voce "Agenti remoti" (solo superadmin) con icona `ServerCog`.
- **Validazione hostname nella VPN precedente** lato API (`PUT /agent`): regex
  nome breve del suo DNS o FQDN, niente schemi `http://` o path.
- **Frontend `Tenant` interface** allineata: campi `agent_*` opzionali nel
  tipo della pagina `/tenants`.

#### Agent (Python / FastAPI)

- **v0.2.0** — riscrittura completa Phase 3:
  - Multi-token auth con `DA_INVENT_AGENT_TOKENS` (lista JSON di
    `{label, token_hash, scopes}`). Drop totale di `DA_INVENT_AGENT_TOKEN_HASH`.
  - **Scope enforcement**: `exec:network`, `exec:device`, `admin:update` o
    wildcard `*`. Dependency `require_scope(...)` per endpoint.
  - **Endpoint nuovi**:
    - `GET /whoami` — info token autenticato.
    - `POST /exec/snmp-walk` — wrapper `snmpwalk -Oqn`, v1/v2c/v3.
    - `POST /exec/arp-poll` — OID `1.3.6.1.2.1.4.22.1.2`, parser MAC
      robusto a 3 formati (colon, hex-string, RouterOS CHR quoted) +
      filtro MAC vuoti/zero.
    - `POST /exec/snmp-routes` — ipAddrTable + ipCidrRouteTable in
      parallelo, filtri `/32`, `/0`, link-local, multicast, loopback,
      dedup per CIDR.
    - `POST /exec/ssh-exec` — asyncssh con password o key, trunc stdout
      1 MiB / stderr 256 KiB.
    - `POST /exec/winrm-exec` — subprocess `winrm_bridge.py` (copia
      dell'hub), Kerberos auto-fallback NTLM→CredSSP→Basic.
  - **Error contract uniforme**: `{error: {code, message, retriable, details?}}`
    con codes: `tool_missing`, `auth_invalid`, `scope_denied`, `invalid_input`,
    `target_unreachable`, `timeout`, `parse_error`, `internal`.
  - **`/healthz` esteso**: `tools` (nmap, snmpwalk, ping, ssh), `network`
    (stato e IP della VPN precedente), cache 60s.
  - **OpenAPI export**: `agent/scripts/dump_openapi.py` +
    `check_openapi_fresh.sh` + pre-commit hook locale.
- **v0.2.1** — fix bug asyncssh: rimosso kwarg invalido `client_keys_load_path`,
  sostituito con `client_keys=[]` per disabilitare pickup automatico delle
  chiavi locali.
- **v0.2.2** — **UDP port scan** attivo (in v0.2.0/v0.2.1 era stubbato).
  Seconda fase nmap `-sU` con porte default (53,67,68,69,123,137,138,161,
  162,500,514,520,1900,4500,5060,5353) override-abili. Merge TCP+UDP senza
  duplicati su (port, protocol).
- **v0.2.3** — UDP scan funzionante in produzione:
  - `nmap.py` antepone `sudo -n /usr/bin/nmap` per il path UDP
    (nmap 7.94 su Ubuntu 24.04 hard-checka euid==0).
  - Systemd unit aggiornato: omesso `NoNewPrivileges` (per sudo +
    file caps), omesso `CapabilityBoundingSet` (impediva CAP_SETUID a
    sudo), omesso `MemoryDenyWriteExecute` (interferiva con runtime
    Python), aggiunto `AF_PACKET` a `RestrictAddressFamilies` (per
    libpcap).
  - Installer scrive `/etc/sudoers.d/da-invent-agent` con NOPASSWD
    limitato a `/usr/bin/nmap`, validato con `visudo -cf`.
- **v0.2.4** — installer one-liner ora gestisce la VPN precedente:
  - `install.sh` installa la VPN precedente (script ufficiale del fornitore)
    se mancante.
  - ingresso nella VPN precedente con la sua chiave, se fornita (fully automated)
    o interattivo (stampa URL da aprire nel browser).
  - Variabile opzionale per il nome del nodo.

### Changed

- `getExecutor(tenantCode)` ora pesca il primo agent dal nuovo
  `tenant_agents` invece che dai campi `tenants.agent_*` (rimangono per
  back-compat ma deprecati).
- Endpoint `GET /api/agents` ritorna un row per agente (era un row per
  tenant in modalità remote).
- UI `/agents`: dropdown stati e azioni rifatti per multi-agent.

### Fixed

- **Reset password hash** corrotto da shell interpolation del `$` bcrypt
  attraverso doppio SSH. Procedura ora usa `ssh -J` + script via scp con
  parameter binding (vedi memo `feedback_no_shell_concat_hashes.md`).
- **Build hub su VM 533** mancava `nmap`, `snmpwalk`, `fping`, `arping`,
  Kerberos, venv pywinrm. `scripts/hub-install.sh` chiude il gap.
- **Rate limiter login** in-memory si pulisce al restart del servizio.

### Security

- Token plaintext mai persistiti né loggati: solo bcrypt hash + ciphertext
  AES-GCM (chiave da `ENCRYPTION_KEY`).
- Agent: redact di community SNMP, password SSH/WinRM nei subprocess args
  loggati (`SecretStr` pydantic).
- Origin check CGNAT (100.64.0.0/10) **prima** della verifica token
  sull'agent.
- Sudo NOPASSWD limitato esclusivamente a `/usr/bin/nmap` per l'agent user.

### Deploy notes

- Hub: dopo `git pull`, eseguire `bash scripts/hub-install.sh` su host nuovi
  o migrati per garantire le dipendenze di sistema.
- Agent: il flusso d'installazione completo è ora un singolo `curl|bash`
  generato dalla UI hub (pagina `/agents` → "Nuovo agente" → step 3).
- Migrazione dati: tenant esistenti con `agent_hostname` configurato
  vengono migrati automaticamente in `tenant_agents` al primo restart del
  hub (idempotente, no perdita).

### Note architetturali

- L'**aggiunta di un agente richiede un cliente esistente** (1 agente
  appartiene sempre a un tenant). Il wizard può crearne uno inline.
- Il **routing subnet→agent** è schematizzato (campo `subnet_match`) ma
  non ancora valutato: oggi il primo agente del tenant gestisce tutte le
  scansioni. Phase 7 introdurrà il dispatch per CIDR.

---

## Storico versioni (commit log)

| Tag/Versione | Commit | Note |
|---|---|---|
| `agent-v0.2.4` | `7501732` | installer gestisce la VPN precedente |
| (hub) | `43d5380` | aggiunto `scripts/hub-install.sh` |
| (hub v0.2.421) | `a9cb244` | skip isNmapAvailable locale per remote |
| `agent-v0.2.3` | `9ec4130` | UDP scan attivo + sudo fallback |
| (hub v0.2.420) | `103a952` | RemoteExecutor + scan flow wiring |
| `agent-v0.2.2` | `4e28670` | UDP scan implementato |
| (hub v0.2.419) | `543970c` | overview /agents + test endpoint |
| `agent-v0.2.1` | `01f7bb3` | fix asyncssh kwarg |
| `agent-v0.2.0` | `638b13b` | Phase 3 endpoints + multi-token |
| (hub v0.2.418) | `a660d6c` | Phase 2 agent skeleton |
| (hub v0.2.417) | `4c07873` | Phase 1 schema + Executor abstraction |

---

# 📘 Handoff — onboarding per la prossima istanza Claude

Sezione operativa per chi raccoglie lo sviluppo da qui in poi. Non sostituisce
[CLAUDE.md](CLAUDE.md) (regole stack/anti-regressione invarianti), ma copre
contesto di sessione, decisioni del branch `feature/remote-agents` e gotchas.

## 1. Contesto progetto in due paragrafi

**DA-INVENT** (alias DA-IPAM) è un IPAM multi-tenant Next.js 16 + better-sqlite3
con architettura **hub + spoke**: un DB SQLite per tenant (`data/tenants/<code>.db`)
e un hub condiviso (`data/hub.db`). Da Phase 1 il sistema supporta anche
**agenti Python remoti** installati presso i clienti, raggiunti via VPN precedente,
che eseguono le primitive di rete (ping/nmap/SNMP/SSH/WinRM) dentro la rete
del cliente. L'hub orchestrazione resta uguale; l'`Executor` decide a runtime
se eseguire localmente o tramite agent.

Stato produzione (2026-05-12): hub su **VM 533** (Proxmox PX-04, IP interno
`192.168.4.8`, accessibile da chi sta sulla 192.168.4.0/24 o via jump host
`root@192.168.40.4`). Un agent live su `bridge-domarc-ovh` (IP nella VPN precedente
`100.89.234.89`) servente il tenant `70791a` (DOMARC-OVH).

## 2. Architettura agenti remoti — modello mentale

```
┌────────────────┐                         ┌─────────────────────┐
│   DA-INVENT    │   HTTPS via VPN precedente   │  da-invent-agent    │
│  hub (Next.js) │ ──────────────────────▶ │  (Python/FastAPI)   │
│   VM 533       │   Bearer token          │   N istanze per     │
│                │                         │   tenant possibili  │
└───────┬────────┘                         └──────────┬──────────┘
        │                                             │
        ▼                                             ▼
    hub.db                                      rete del cliente
  (orchestrazione)                            (scan, SNMP, SSH...)
```

- **1 tenant** può avere **N agenti** (es. sedi diverse). Tabella
  `tenant_agents` 1:N su `tenants`.
- Selezione agent: oggi `getExecutor()` usa il **primo** agent. Routing
  per-subnet via campo `subnet_match` è schematizzato ma **non** dispatched.
- Token: ogni agent ha 1 token plaintext, salvato hub-side come hash bcrypt
  (verifica) + ciphertext AES-GCM (per re-trasmetterlo all'agent al test).
  Il plaintext non è mai persistito. L'agent ha la sua copia (hash bcrypt
  in `/etc/da-invent-agent/config.yml`).

## 3. File map — dove vivono le cose

### Hub Next.js

```
src/lib/executor/             ← astrazione (introdotta in questo branch)
  ├── types.ts                ← interfacce I/O (PingResult, NmapResult, …)
  ├── index.ts                ← Executor interface + getExecutor(tenantCode)
  ├── local.ts                ← LocalExecutor (wrap src/lib/scanner/*)
  └── remote.ts               ← RemoteExecutor (HTTP → agent via VPN precedente)

src/lib/db-hub-schema.ts      ← include `tenants` (con agent_* deprecati)
                                e `tenant_agents` (autorità)
src/lib/db-hub.ts             ← include CRUD su tenant_agents + back-compat
                                tenant.agent_* helpers
src/lib/scanner/discovery.ts  ← runDiscovery() shadowa pingSweep/nmap*
                                con executor del tenant (function-local consts)

src/app/api/tenant-agents/                ← API canoniche (multi-agent)
  ├── route.ts                            ← GET list + POST create
  ├── [id]/route.ts                       ← GET/PUT/DELETE
  ├── [id]/token/route.ts                 ← POST genera nuovo
  ├── [id]/token/import/route.ts          ← POST importa esistente
  └── [id]/test/route.ts                  ← POST test connessione

src/app/api/tenants/[id]/agent/           ← API back-compat (puntano al primo agent)
src/app/api/agents/route.ts               ← lista cross-tenant per UI overview
src/app/agent-install.sh/route.ts         ← serve agent/scripts/install.sh
                                            con Content-Type shellscript
                                            (esente da auth, vedi auth.config.ts)

src/app/(dashboard)/agents/page.tsx       ← UI overview + Wizard 3-step
src/app/(dashboard)/tenants/[id]/agent/page.tsx ← UI per-tenant (back-compat)
src/components/shared/sidebar.tsx         ← link "Agenti remoti" (solo superadmin)

scripts/hub-install.sh                    ← bootstrap deps di sistema hub
```

### Agent Python

```
agent/
├── pyproject.toml              ← Python 3.11+, FastAPI, asyncssh, pywinrm[kerberos]
├── da_invent_agent/
│   ├── __version__.py          ← single source of truth versione agent
│   ├── main.py                 ← FastAPI app + lifespan + error handlers
│   ├── config.py               ← pydantic-settings, sorgenti env + YAML
│   ├── auth.py                 ← bearer token + origin CGNAT + require_scope()
│   ├── scopes.py               ← Scope enum (exec:network|device, admin:update)
│   ├── errors.py               ← AgentException + error envelope uniforme
│   ├── system_probe.py         ← _which() + probe della VPN precedente, cache 60s
│   ├── models.py               ← pydantic models speculari a executor/types.ts
│   └── exec/
│       ├── ping.py             ← subprocess ping (cross-platform)
│       ├── nmap.py             ← TCP -sT + UDP -sU via sudo, parser XML
│       ├── dns.py              ← socket.getaddrinfo + getnameinfo
│       ├── snmp.py             ← subprocess snmpwalk -Oqn + parsers (walk, routes)
│       ├── arp.py              ← parser MAC 3 formati (colon, hex-string, RouterOS CHR)
│       ├── ssh.py              ← asyncssh wrapper, trunc stdout/stderr
│       ├── winrm.py            ← subprocess winrm_bridge.py, classify_error
│       └── winrm_bridge.py     ← copia di src/lib/devices/winrm-bridge.py (hardenato)
├── scripts/
│   ├── install.sh              ← installer one-liner (apt, VPN precedente, venv, systemd)
│   ├── da-invent-agent.service ← systemd unit (no NoNewPrivileges per sudo+caps)
│   ├── dump_openapi.py         ← rigenera openapi.json
│   └── check_openapi_fresh.sh  ← pre-commit drift check
├── tests/                      ← 56 test pytest (parser ARP/routes + auth + endpoints)
└── openapi.json                ← snapshot OpenAPI 3.1 schema (commitato)
```

## 4. Comandi essenziali

```bash
# Dev hub locale
npm run dev:server                # custom server con scheduler cron
npm run lint && npx tsc --noEmit && npm run build  # verifica completa
npm run version:release           # bump patch + commit "release: vX.Y.Z"
git push origin <branch>          # produzione fa git pull

# Dev agent locale
cd agent
.venv/bin/pytest                  # 56/56 attesi (Python 3.11+, testato 3.14)
.venv/bin/python scripts/dump_openapi.py
./scripts/check_openapi_fresh.sh

# Pre-commit hook locale (installato manualmente, vedi sotto)
ls .git/hooks/pre-commit          # check_openapi_fresh.sh chiamato se tocchi agent/

# Deploy hub su VM 533 (jump via Proxmox)
ssh root@192.168.40.4 'cd /tmp/da-invent-deploy && git fetch && git reset --hard origin/feature/remote-agents && \
  rsync -az --delete --exclude=/data/ --exclude=/.env.local --exclude=/.next/ --exclude=/node_modules/ \
    /tmp/da-invent-deploy/ root@192.168.4.8:/opt/da-invent/'
ssh -J root@192.168.40.4 root@192.168.4.8 'cd /opt/da-invent && npm run build && systemctl restart da-invent'

# Deploy agent su un host nuovo (cliente)
# 1. genera token dalla UI hub → wizard /agents
# 2. copia il one-liner dal step 3 del wizard, esegui come root sull'host
```

## 5. Accesso operativo

| Risorsa | Come |
|---|---|
| Web app hub | `https://192.168.4.8` (login: admin / **DaInvent2026** — cambia al primo uso) |
| SSH hub VM 533 | `ssh -J root@192.168.40.4 root@192.168.4.8` (chiave già autorizzata su entrambi) |
| Proxmox host | `ssh root@192.168.40.4` (chiave già autorizzata) |
| Agent OVH | `ssh root@100.89.234.89` (direct via VPN precedente, chiave autorizzata) |
| Agent OVH (config) | `/etc/da-invent-agent/config.yml`, service `systemctl status da-invent-agent` |
| Visibilità nella VPN precedente | hub `100.124.2.70` (da-invent), agent `100.89.234.89` (bridge-domarc-ovh) |

## 6. Lezioni dure imparate (memorie persistenti)

Tutte in `~/.claude/projects/-Users-riccardo-Progetti-DA-IPAM/memory/`:

- **`feedback_no_shell_concat_hashes.md`**: mai passare hash bcrypt via shell
  concatenation attraverso doppio SSH. I `$` di `$2b$10$...` vengono
  interpolati dalla shell remota → hash troncato a 2 char → admin lockout.
  Usare `ssh -J` + script file via scp con parameter binding.
- **`feedback_verify_system_deps_on_deploy.md`**: il check `/api/health`
  ritorna OK anche se mancano `nmap`/`snmpwalk` di sistema. Sempre eseguire
  `scripts/hub-install.sh` dopo migrazione/clone host.
- **`feedback_bundle_tool_calls.md`**: bundle tool call invece di N parallele
  (ognuna genera prompt di permesso).
- **`feedback_prod_debug_no_confirm.md`**: per debug **non distruttivo** su
  Proxmox/PCT/VM (SSH, sqlite read-only, pct exec, restart servizio, push
  file fixato) procedere senza chiedere. Per **distruttivo** (DROP, modifiche
  env, distruzione container, push su `main`, credenziali in chiaro) chiedere.
- **`project_remote_agents.md`**: decisioni architetturali approvate.

## 7. Gotchas tecniche scoperte in questa sessione

### VPN precedente + agent
- Agent **DEVE** girare con CGNAT origin check (100.64.0.0/10): il middleware
  rifiuta richieste da fuori la rete della VPN precedente.
- **Nome breve del DNS della VPN precedente** e FQDN entrambi accettati. La validazione
  hostname hub-side usa regex permissiva: niente schemi `http://`, niente path.
- Ingresso interattivo nella VPN precedente: stampa URL, lo script aspetta. Con
  la sua chiave (reusable) → fully automated.

### nmap + capabilities (Ubuntu 24.04)
- **nmap 7.94 hard-checka `euid==0`** per `-sU`/`-sS` ANCHE con
  `CAP_NET_RAW` ambient + setcap +eip. La soluzione operativa è
  `sudo -n /usr/bin/nmap` con sudoers fragment NOPASSWD limitato. Vedi
  `agent/da_invent_agent/exec/nmap.py:_nmap_cmd()`.
- `NoNewPrivileges=true` nel systemd unit blocca sudo (non può ottenere
  CAP_SETUID). Lasciato OFF per l'agent. Mitigation: agent gira come utente
  non-root `da-invent-agent`.
- `CapabilityBoundingSet` deve essere **omesso** (non limita): se lo
  restringi a `CAP_NET_RAW` ecc., sudo non può elevare.
- `RestrictAddressFamilies` deve includere `AF_PACKET` (libpcap UDP scan).

### asyncssh
- NON passare `client_keys_load_path` (kwarg inventato — bug pre-v0.2.1).
- Per **disabilitare il pickup automatico** delle chiavi locali, passare
  `client_keys=[]` esplicito. L'autenticazione deve venire solo da `auth.*`
  del payload.

### NextAuth tenant switching
- I tenant nel JWT sono **iniettati al login** in `auth.ts:authorize()`.
  Non si aggiornano per JWT refresh. Se aggiungi un tenant mentre l'utente
  è loggato, **fagli fare logout+login** per vederlo.
- Variabile `NEXTAUTH_URL` su VM 533 può finire a `https://0.0.0.0` —
  comporta redirect post-login strani ma non blocca l'auth. Da fixare via
  `.env.local`.

### Rate limit login
- In-memory `Map` con sliding window 15 min. **Restart del servizio** è
  l'unico modo per ripulirlo. Nessuna UI/CLI di reset.

### Hub deploy (cosa NON ti aspetti)
- VM 533 (migrata da LXC 333) NON aveva di base: `nmap`, `snmpwalk`,
  `fping`, `arping`, Kerberos packages, venv `/root/.da-invent-venv`.
  Eseguire `bash scripts/hub-install.sh` dopo ogni migrazione.
- `/opt/da-invent` su VM **NON è git repo** — deploy via rsync da
  `/tmp/da-invent-deploy` su Proxmox host.

## 8. Phase residue e backlog

| Phase | Cosa | Note |
|---|---|---|
| **6** | Heartbeat + observability persistenti | Tabella `agent_heartbeats` su hub.db, agente fa POST a hub `/api/agents/heartbeat` ogni 60s. Per ora abbiamo solo on-demand test. |
| **7** | Routing **subnet → agent** | Quando un tenant ha N agent con subnet diverse, decidere quale chiamare in base al target IP. Campo `subnet_match` (CSV CIDR) già nello schema. `getExecutor()` accetta optional targetIp param. |
| **7+** | TLS end-to-end | Oggi HTTP plain via VPN precedente (WireGuard cifra). Per compliance: il servizio HTTPS della VPN precedente con cert LetsEncrypt OR self-signed con TOFU pinning hub-side. |
| **8** | Auto-update agent dall'hub | Endpoint agent `/admin/update` (token-protetto, scope `admin:update`) scarica tarball + verifica SHA256 + atomic swap + systemctl restart. Tabella `agent_releases` hub-side. |
| **9** | UI tenant per-tenant agents | Oggi `/tenants/[id]/agent` mostra solo il primo agent (back-compat). Trasformare in `/tenants/[id]/agents` con lista multi-agent. |
| **dep** | Rimuovere campi `tenants.agent_*` | Sono deprecati dalla migrazione. Lasciati per back-compat di route esistenti. Dopo 1-2 release di stabilità si possono droppare. |

## 9. Pull request e merge

- PR aperta: <https://github.com/grandir66/DA-IPAM/pull/2> — `feature/remote-agents` → `main`.
- **Non è ancora mergeata.** Riepilogo PR descrive il breaking change agent
  (drop `DA_INVENT_AGENT_TOKEN_HASH`). Hub NON ha breaking change.
- Quando si merge: verificare che lo script `npm run version:release` non
  rimbalzi su file mai versionati (`.claude/scheduled_tasks.lock` deve restare
  in `.gitignore`).

## 10. Pre-commit hook locale (non versionato)

`.git/hooks/pre-commit` installato manualmente per evitare drift
`openapi.json` quando si toccano endpoint agent. Contenuto:

```sh
#!/bin/sh
if git diff --cached --name-only | grep -qE '^agent/(da_invent_agent/|scripts/dump_openapi\.py)'; then
  agent/scripts/check_openapi_fresh.sh || {
    echo 'OpenAPI drift: rigenera con `python agent/scripts/dump_openapi.py`'
    exit 1
  }
fi
```

Quando si condividerà il branch con altri sviluppatori: creare
`agent/scripts/install-hooks.sh` versionato che fa il symlink (vedi memo
sessione 2026-05-11).

## 11. Pattern di codice da non rompere

In aggiunta a quanto in [CLAUDE.md](CLAUDE.md):

- **`getExecutor(tenantCode)` può throware `ExecutorNotConfiguredError`**
  per tenant remote non configurati. Chi lo chiama dentro un cron job
  deve **catchare** e degradare con grace (es. log + skip iteration),
  vedi pattern in `src/lib/scanner/discovery.ts:_exec`.
- **`safeDecrypt()`** se cerchi di leggere `agent_token_encrypted` (e in
  generale qualunque ciphertext): tornare null/error gracefully se la
  ENCRYPTION_KEY è cambiata.
- **Le route agent token** ritornano il plaintext **solo in response**, mai
  in DB. La response NON deve essere loggata.
- **Pydantic SecretStr** lato agent: usare per password/community/token —
  fa redact su repr() e log automatici.
- **Errori dall'agent**: hanno **error envelope uniforme** `{error: {code,
  message, retriable, details?}}`. `RemoteExecutor` lo traduce in
  `RemoteExecutorError` typed. I call site possono ispezionare `.retriable`.
- **OpenAPI freshness**: ogni modifica a endpoint/model in `agent/da_invent_agent/`
  o `agent/scripts/dump_openapi.py` richiede rigenerazione di `agent/openapi.json`.
  Il pre-commit lo blocca; CI lo bloccherà se aggiunto.

## 12. Variabili d'ambiente critiche

### Hub (.env.local su VM 533)

- `ENCRYPTION_KEY` — **non perdere**: senza, tutti i token encrypted
  diventano inutilizzabili (test connection ritorna `decrypt_failed`).
- `AUTH_SECRET` — NextAuth JWT signing key.
- `DOMARC_USERNAME` / `DOMARC_PASSWORD` — utente di servizio
  (incondizionato, vede tutti i tenant).

### Agent (/etc/da-invent-agent/config.yml su host cliente)

```yaml
tenant_code: "70791a"        # MUST match hub tenants.codice_cliente
hub_url: "https://192.168.4.8"
port: 8443
host: "0.0.0.0"               # bind, l'origin check filtra a CGNAT
dev_mode: false
log_level: "INFO"
tokens:
  - label: "hub-prod"
    token_hash: "$2b$12$..."  # bcrypt — generato in-process, mai shell concat
    scopes:
      - "exec:network"
      - "exec:device"
      - "admin:update"
```

`DA_INVENT_AGENT_*` env vars overridano YAML (per testing). Vedi
`agent/.env.example`.

## 13. Debug rapido — playbook

- **"Le scansioni non trovano porte"** → verificare in ordine:
  1. `tenants.agent_mode` del tenant è `'remote'`?
  2. `tenant_agents` ha una riga per il tenant con token configurato?
  3. Sull'host hub: `which nmap`. Se manca: `bash scripts/hub-install.sh`.
  4. Sull'host agent: `systemctl status da-invent-agent`. Log:
     `journalctl -u da-invent-agent -n 50`.
  5. Test diretto: `curl http://<agent-ip>:8443/whoami -H "Authorization: Bearer <token>"` dalla VM hub.
- **"Login non funziona"** →
  1. `[Auth] Rate limit raggiunto` nei log: `systemctl restart da-invent`.
  2. Hash corrotto: verificare con node `bcrypt.compareSync` (mai shell
     interpolation del `$`).
  3. JWT obsoleto (tenant nuovo non visibile): logout + login.
- **"Test connessione mostra `decrypt_failed`"** → ENCRYPTION_KEY è cambiata.
  Rigenera il token dall'UI (sovrascriverà il nuovo ciphertext).
- **"UDP scan non trova porte"** → controlla `/etc/sudoers.d/da-invent-agent`
  esiste e nmap ha `setcap cap_net_raw,cap_net_admin=eip`.

