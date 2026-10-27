# TASKS — DA-IPAM

## 2026-10-27 — Reti dal sensore trunk: host e MAC insieme alla rete (da approvare)

Riccardo (27/10, mini PC dimostrativo 72729-ipam): «Aggiungi» di una rete vista dal trunk crea solo la
rete (`/api/trunk/rete`), senza gli host trovati; nelle reti con tag (niente ARP del router né L2
dall'appliance) gli host restano senza MAC, nella nativa li hanno. Vuole: (1) all'aggiunta, l'elenco
degli host dalle osservazioni del trunk; (2) MAC compilati dal trunk per le reti con VLAN senza tabella
ARP; (3) prima dell'aggiunta un ARP ping col tag giusto (il giro c'è già: `/api/trunk/giro`, sonda
`arp-scan -Q <vid> --arpspa 0.0.0.0`).
- [x] piano e livello (leggero) approvati da Riccardo (27/10 «hai preso in carico gli altri rilievi»)
- [x] «Aggiungi»: rete, giro ARP sul VID, attesa della sonda (`/stato` giro_in_corso, max 90 s), lettura, host (IP, MAC, nome, produttore) — `src/lib/trunk/aggiungi-rete.ts`
- [x] dopo ogni lettura del trunk: host nuovi e MAC mancanti delle reti con `vlan_id` (mai sovrascrivere un MAC presente) — `src/lib/trunk/host-dal-trunk.ts`
- [x] prove `src/lib/trunk/__tests__/host-dal-trunk.test.ts` (la lettura vista rossa prima dell'aggancio); eslint verde; tsc e npm test rossi solo in `src/lib/vault/` per `age-encryption`/`kdbxweb` assenti dai node_modules locali (non toccati)
- [ ] collaudo su 72729-ipam (dopo l'aggiornamento della VM a una versione che lo contiene)

## 2026-10-27 — Vault semplice: un file KeePass al posto di OpenBao e degli slot

Riccardo (27/10): via OpenBao, gli slot, la 2FA per «Mostra», la ricifra e il recupero a tre comandi. Le
password stanno in un file `.kdbx` con il suo file chiave: per le appliance dei clienti locale
(`data/vault/credenziali.kdbx`, si apre da solo all'avvio con `systemd-creds`), per hub e DA-Vul-can su
DA-Link. Esportazione su chiavetta (archivio + chiave) per gli admin. Spec e piano nel repo DA-Link
(`docs/superpowers/specs|plans/2026-10-27-vault-semplice-kdbx*`). ADR 0034 superato.
- [x] piano approvato (27/10), semplificato lo stesso giorno: niente chiave Domarc, niente `age`
- [x] DA-IPAM#22 (svuotamento verso OpenBao) chiusa senza fonderla: si rifà sul backend `dalink`
- [x] passo 1, parte TS: `src/lib/vault/kdbx.ts` (formato comune con DA-Link), prove in
  `__tests__/kdbx.test.ts` con gli archivi incrociati di `__tests__/dati/vault_kdbx/`. Non ancora usato
- [ ] passo 6 (hub e DA-Vul-can leggono da DA-Link) e passo 8 (appliance dei clienti) del piano

## 2026-10-27 — Next.js 16.4.2: la build non deve leggere `data/`

Documento: `docs/proposte/2026-10-27-next-16-4-build-memoria.md` (misure, meccanismo, esito). Ramo `fix/next164-build-data`.
- [x] meccanismo trovato su un'app minima: `path.join`/`path.resolve` nel modulo e `fs` su valori misti diventano glob sul progetto
- [x] correzione (`src/lib/percorsi.ts`, ESLint, `scripts/controlla-tracciamento.mjs` in postbuild): 441 rotte → 0, picco 3,4 GB con 18 GB finti; cancello e 6150 prove verdi
- [x] prova sull'hub (27/10, ok di Riccardo): copia con `data/` vera in sola lettura, `MemoryMax=8G`: riuscita in 1'41", picco 4,6 GB, nessun OOM, postbuild 0 rotte su `data/`
- [x] merge su `dev` (27/10, ok di Riccardo, v0.9.916): hub ricostruito da solo alle 11:04 UTC, build 59" + tipi 45", postbuild 0 rotte su `data/`, servizio riavviato, `/api/health` 200, Next 16.4.2 in esercizio
- [x] promozione su `main` (27/10, ok di Riccardo): `43e98c15`, albero identico a `dev` v0.9.916. Cancello prima: lint 0 errori, tsc, build (0 rotte su `data/`), 6149 prove verdi e 1 rossa a tempo, ripassata da sola 12/12 (Mac a carico 24). Nota: per il CONTEXT del 22/10 tutte le installazioni seguono già `dev`, quindi la 16.4.2 era già arrivata con il push su `dev`
- [x] (27/10, fatto: messaggio al posto dell'orologio, vista fallire) `src/lib/zabbix-lettura/__tests__/trasporto.test.ts` («connessione che non completa il TLS»): `assert.ok(Date.now() - t0 < 1_500)` fallisce sotto carico (19,9 s il 27/10 con load 24): soglia da legare al limite di apertura, non al tempo della macchina

## 2026-10-23 — da-vault (piano approvato, livello completo)

Riccardo (23/10): sta valutando un vault unico al posto dei file locali di ogni app, a partire dalle credenziali del DA-IPAM di Domarc (hub) e poi firewall e altri device. Piano in valutazione: `~/Downloads/da-vault — Piano di implementazione.md` (OpenBao interno + KDBX/age dai clienti, libreria `@domarc/vault`).
- [ ] decidere dove gira OpenBao: Riccardo pensa a DA-Link o a DA-Auth (oggi sulla .42); valutazione Claude 23/10: no alla .42, sì alla VM di DA-Link o a una VM piccola dedicata
- [x] punto d'innesto nel codice (fatto il 23/10, ADR 0034: la chiave degli slot sta dentro `encrypt()` di `crypto.ts`, il riferimento OpenBao dentro il lettore unico): `src/lib/credentials/segreti.ts` (lettore unico dei segreti), più gli altri `encrypt()` fuori da `credentials/` (integrazioni, vuln edge, inventory-agent, network-services)
- [ ] rimando a DA-Link/TASKS.md (stessa data) per la parte vault interno
- [ ] Riccardo (23/10): valutare Keeper (già in uso, tenant keepersecurity.eu) sia per il vault personale dei file «accessi» sul Mac sia per la soluzione. Analisi Claude 23/10: Keeper (cartelle condivise + Secrets Manager, un'applicazione KSM per app) al posto di OpenBao per Domarc; dai clienti resta l'archivio locale con slot age. Da verificare: licenza (KSM, SSO Entra, KeeperPAM inclusi?), prezzo per chiamate API
- [ ] licenza letta nella console il 23/10: **Keeper Business**, 18 licenze, scade 20/06/2027, 100 GB; niente SSO (serve Enterprise, listino 5,50 €/utente/mese), niente ARAM, compliance, BreachWatch. **KSM richiede KeeperPAM, 90 €/utente/mese**: chiedere a Keeper il preventivo per 2-3 utenti PAM prima di decidere KSM vs OpenBao per le app. Persone e vault personale: Business basta
- [x] **Decisione di Riccardo (23/10)**: Keeper Business solo per le persone e il vault personale (Commander per gli agenti); per le app **OpenBao** (open source, self-hosted): KSM troppo costoso e il prodotto è pensato per essere open source. Dai clienti archivio locale con slot age. Il vault personale si fa per primo (piano in ~/.claude)
- [x] piano riscritto (23/10, sessione da-vault): `docs/superpowers/plans/2026-10-23-da-vault.md` — regola della fonte (se una macchina la usa sta in OpenBao, altrimenti Keeper; in Keeper solo puntatori), 12 passi, livello completo, ~5-6 settimane
- [x] Riccardo (23/10): D1 OpenBao in container nella VM di DA-Link, niente VM nuova; D2 nel DA-IPAM dei clienti entrano tecnici e cliente; D3 per ora senza YubiKey (chiave age in Keeper, cartella personale); D4 `fc5171b` in esercizio ora, in OpenBao al passo 9 — piano aggiornato
- [x] Riccardo (23/10): D5 slot Domarc acceso di serie con una riga nel contratto (chi non lo vuole lo spegne firmando); **piano approvato, livello completo**
- [x] clausola sullo slot Domarc approvata da Riccardo il 23/10 (testo nel piano, sezione Decisioni)
- [x] esecuzione, parte di codice (sessione cloud del 23/10, prompt `~/.claude/prompts/da-vault-esecuzione-1.md`): passi 5, 6 e 10 sul ramo `claude/da-vault-codice`, PR verso `dev` (dettaglio sotto)
- [ ] analisi Claude 23/10 (da approvare): separare la «chiave» di ogni app (da TPM/OpenBao, mai in `.env.local`) dalle «credenziali condivise» dei device (OpenBao KV, solo riferimenti nelle app); dai clienti archivio locale cifrato con slot age e KDBX solo come esportazione, non come archivio vivo; login tecnici con OIDC nativo di OpenBao (DA-Auth non si tocca)

Esecuzione, parte di codice (23/10, sessione cloud, ramo `claude/da-vault-codice`, livello completo; interruttori spenti):
- [x] passo 5, `src/lib/vault/`: `SecretStore` (tipi.ts), archivio a slot age (archivio.ts: cliente scrypt, Domarc X25519, TPM da `$CREDENTIALS_DIRECTORY/vault-key`), backend `locale` e `openbao` (solo fetch, AppRole, token 20 min, cache a tempo della cartella dell'app, `X-Domarc-Utente`, errore dichiarato oltre la cache), OpenBao finto per le prove — archivio 23, openbao 22, locale 6
- [x] passo 10: chiave degli slot dentro `encrypt()`/`decrypt()`, 2FA sulla chiave d'installazione (ADR 0034), ricifra (a vuoto di serie, `--applica`, tutto o niente, lettore unico, VACUUM, crash con SIGKILL), «Vault bloccato» (banner, job in pausa), «Mostra password» (2FA, 5 min, admin, registro e pagina), «Esporta in KeePass» (kdbxweb + Argon2id di hash-wasm, key file nel suo slot), `scripts/da-vault-recover.ts`, `scripts/da-vault.ts`, archivio nel backup notturno
- [x] passo 6: `credentials.credential_ref`, doppia lettura in `segreti.ts`, OpenBao dall'ambiente all'avvio, `scripts/da-vault-migra-openbao.ts` (a vuoto di serie, `--applica`, `--verifica`)
- [ ] **in locale** (non fattibile dal cloud): container OpenBao nella VM di DA-Link (passo 1), app «Domarc Vault» in Entra, chiave Domarc age generata scollegata e messa in Keeper (passo 0), AppRole `da-ipam` dell'hub con `secret_id` in `LoadCredentialEncrypted`, CA in `NODE_EXTRA_CA_CERTS`
- [ ] **in locale**: migrazione sui dati veri dell'hub (`--applica`, `--verifica`, poi `DA_VAULT_OPENBAO=1`); campione SNMP/SSH/API provato
- [ ] **in locale**: appliance una alla volta, con la conferma di Riccardo per ciascuna: `crea` → `slot-tpm` (VM modello con `tpmstate0`) → unità con `LoadCredentialEncrypted=vault-key:…` → `DA_VAULT_LOCALE=1` e riavvio → `ricifra` a vuoto → `--applica`
- [ ] **in locale**: un'esportazione aperta con KeePassXC senza DA-IPAM (la prova usa kdbxweb)
- [ ] (scoperto) prima di svuotare le colonne cifrate sull'hub (versione dopo la doppia lettura): portare sul lettore unico le letture dirette (`credentials/trova.ts`, `apparato-archivio.ts`, `integrations/self-identity.ts`, `controllers/credenziale.ts`, `for_edit` di `/api/credentials/[id]`), poi svuota + VACUUM
- [ ] (scoperto) l'interfaccia `SecretStore` è ricavata dal piano: il documento originale (`~/Downloads/da-vault — Piano di implementazione.md`) non era nel repo; confrontarla
- [ ] (scoperto) «parte un avviso» quando il vault resta bloccato: oggi log CRITICAL + banner + Opzioni; manca un avviso nelle notifiche (email/webhook)
- [ ] (scoperto) cambio di generazione della chiave Domarc: oggi `da-vault-recover rotate` a mano; la riscrittura dello slot al primo sblocco (piano, «Più avanti») non è fatta
- [ ] (scoperto) `kdbxweb` porta `@xmldom/xmldom` 0.7 con avvisi alti: forzato a 0.8.15 con `overrides` in package.json; da ricontrollare a ogni aggiornamento di kdbxweb
- [ ] (scoperto) `ENCRYPTION_KEY` resta sull'appliance per i segreti TOTP (ADR 0034): toglierla vuole un'altra soluzione per la 2FA
- [x] (24/10, sessione locale) PR #18 fusa (`17dddc68`) e rilasciata **v0.9.897**; PR #19 (ricarica della cache per un segreto mancante, secret_id illeggibile = errore controllato) **v0.9.898**
- [x] (24/10) passo 6 sull'hub in esercizio: AppRole `app-da-ipam` (IP NetBird dell'hub), `.env.local` con `DA_VAULT_OPENBAO*`, backup in `data/backups/*-pre-da-vault-openbao-20261023-223753.db`, 17 credenziali migrate, `--verifica` 0 diverse, `DA_VAULT_OPENBAO=1`; SNMP, SSH, AD, UniFi ok dopo l'accensione. Dettaglio: DA-Link `TASKS.md` (parte locale)
- [ ] (24/10) passo 10 su un'appliance di prova: serve l'accesso alle appliance del laboratorio e la VM modello con `tpmstate0` (Deploy-Appliance); passo 11 dai clienti con la loro passphrase
- [ ] (24/10) **`vault.domarc.it` non è nel DNS**: sull'hub è in `/etc/hosts` (backup `/etc/hosts.bak-*`), da togliere quando c'è il record (Riccardo)


## 2026-10-23 — Uscita vera, istanza controllata e ricordata (livello completo, ADR 0033)

Riccardo (23/10): ok alla revoca della sessione; la scelta del cliente diventa «istanza», va in Impostazioni,
e si riparte dall'ultima usata; verificare sull'hub (unico multi-istanza) le Opzioni con un'istanza scelta.
- [x] prove `src/lib/accesso/__tests__/sessione.test.ts` viste fallire (5 su 6) prima della correzione, poi verdi
- [x] revoca all'uscita (`sessioni_valide_da`, `accessoAt`), cambio d'istanza controllato, ultima istanza
- [x] Impostazioni → Istanza, riga in sola lettura nella barra, «cliente» → «istanza» (resa locale a 1440, aperta e compressa)
- [x] scenario locale: dopo «Esci» `/` porta a `/login`; rientro sull'ultima istanza; un viewer non forza un'altra istanza né «tutte»
- [x] hub aggiornato a v0.9.891 (`scripts/update.sh --restart`, servizio ripartito 08:52 UTC); verificato con `prova-claude`:
  Opzioni si apre sull'istanza 70791 con gli interruttori, nessun «vista aggregata»; dopo «Esci» `/` porta a `/login`, sessione null
- [ ] sull'hub non provati col superadmin (prova-claude ha una sola istanza): scheda Istanza, scelta e rientro sull'ultima — li prova Riccardo
- [ ] Opzioni dice ancora «Cliente 70791 · …» e «questo cliente»: da portare a «istanza» (pagina di un'altra sessione attiva il 23/10)
- [ ] `next build --webpack` (solo in locale, serve col worktree perché Turbopack rifiuta `node_modules` in link) cade
  sulle rotte che esportano funzioni (`meshcentral/*`, `mac-product-map`): la build normale dell'hub passa. Non urgente

## 2026-10-23 — Idea: DA-IPAM per i portatili dei tecnici (da pensare, nessun codice)

Riccardo (23/10): «poi penseremo a una release di DA-IPAM da eseguire sui notebook dei tecnici, multi tenant con
meno funzioni». Da decidere: quali funzioni restano, da dove prende le istanze (hub? copia locale?), come si aggiorna.

## 2026-10-22 — da controllare (solo nota, niente lavoro fatto)

Riccardo (22/10): da verificare in un secondo momento, nessuna analisi fatta finora.

- [ ] VLAN degli switch HP Comware: non sempre vengono rilevate tutte le VLAN.
- [ ] VLAN degli switch HP Comware: le porte taggate (trunk) non vengono riconosciute.
- [ ] Schermata VLAN: con troppe VLAN la tabella taglia le colonne più a destra (manca lo scorrimento orizzontale o l'adattamento).
- [ ] Scansione switch: per default si abilita solo SNMP anche quando SSH risponde. Da decidere se è voluto (un protocollo basta) o se servono entrambi (es. SSH per VLAN/trunk dove SNMP è parziale, vedi Comware).
- [ ] LibreNMS: aggiunta in batch di più oggetti, invece di uno alla volta dalla pagina Discovery.
- [ ] LibreNMS: se l'integrazione è presente (configurata), gli oggetti che rispondono a SNMP si aggiungono in automatico. Da definire: quando (a fine scansione?), come si escludono, cosa si vede a schermo dell'esito.

## 2026-10-23 — Barra laterale compatta e cambio password

Riccardo (23/10): il blocco in basso della barra è brutto, logo più piccolo, «URL dell'hub» in Impostazioni,
comprimi ben visibile; scelta «tutto in alto». Segnalato: il cambio password non funziona.
- [x] causa del cambio password: `onSelect` (Radix) su un menu Base UI → `onClick` (provato in locale: la finestra si apre)
- [x] cambio password verificato sull'hub v0.9.894 (23/10, utente `prova-claude-admin`, dall'interfaccia): la finestra si apre dal menu,
  conferma diversa e password corrente sbagliata rifiutate, cambio riuscito, dopo «Esci» la vecchia non entra e la nuova sì
- [x] testata compatta con comprimi, utente ed Esci; tema nel menu utente; piede tolto (resa guardata a 1440 aperta e compressa)
- [x] «URL dell'hub» in Impostazioni → Sistema, `/agents` rimanda lì (provato in locale)
- [x] a menu compresso solo il simbolo (Riccardo, 23/10; resa guardata in locale a 1440)
- [x] «Esci» nel menu dell'utente e ritorno a `/login` deciso dal browser (sull'hub il server rispondeva `https://0.0.0.0/login`; provato in locale)
- [ ] **«Esci» non chiude davvero la sessione** (trovato il 23/10, c'era già prima): le richieste della dashboard partite prima dell'uscita
  tornano dopo e rimettono il cookie, perché il proxy rinnova il JWT a ogni risposta (traccia: signout `Max-Age=0` a +495 ms,
  `/api/status/*` rimettono `authjs.session-token` a +525 ms, `/` riapre la sessione). Zona rossa (accesso): proposta a Riccardo, in attesa dell'ok.
- [ ] guardarla sull'hub dopo l'aggiornamento

## 2026-10-23 — Assegnatari NIS2 da AD e utente prevalente dei PC (idea, da decidere)

Riccardo (23/10): «come possiamo determinare almeno dei PC gli utenti collegati? Nella voce NIS2 degli assegnatari
permettere l'importazione degli utenti da AD in modo semi-automatico con i dati registrati, proponendo quelli che
hanno nome e cognome e altre informazioni, e verificare se si possono collegare agli oggetti nel discovery o asset».

Cosa c'è già (origin/dev `646fe741`): `ad_users` sincronizzati (nome visualizzato, mail, reparto, ruolo, telefono,
ultimo accesso); `ad_computers.host_id`; raccolta WinRM in `lib/devices/device-info.ts` con `last_logged_on_user`
(registro LogonUI) e `logged_on_users` (Win32_LoggedOnUser) in `last_device_info_json`; agente GLPI con
`last_logged_user`; `asset_assignees` ha solo nome/mail/telefono/nota, `inventory_assets.asset_assignee_id`.
Decisioni di Riccardo (23/10): **sì, strada da prevedere come disegnata**; niente clienti solo su Entra (basta AD
locale); **Wazuh come fonte** dove è installato. Wazuh (verificato su origin/dev): gli alert dell'indexer hanno già
`data.win.eventdata.targetUserName`/`workstationName`/`ipAddress` + `agent.name` (li aggrega
`wazuh-alerts-stats.ts`); l'accesso riuscito 4624 è la regola 60106 (livello 3), da misurare se arriva all'indice;
i processi di syscollector (`wazuh_process`) non hanno il proprietario, quindi non servono.
Valori predefiniti proposti (Riccardo può correggerli): solo proposta con conferma, niente assegnazione automatica;
livello leggero. Prossimo passo: tavola grafica (pagina «Importa da AD» + riquadro proposta sull'asset), poi piano
breve ed esecuzione in una sessione nuova.
- [x] tavola grafica (23/10): https://claude.ai/artifact/64gZcjsoZQmrcoXJkV6eFf — elenco assegnatari (1-4),
      «Importa da AD» (5-11), scheda asset con proposta, chi si collega e i casi limite (12-18); **da approvare**
- [x] misura su Wazuh dell'hub .8 (23/10, sola lettura): tastiera 11 PC → 10 proposte; rete 38 postazioni → 30
      proposte; dettaglio e trappole nel piano
- [x] tavola e soglia approvate da Riccardo (23/10); **piano: `docs/superpowers/plans/2026-10-23-assegnatari-da-ad.md`**,
      da eseguire in una sessione nuova (i punti sotto sono dettagliati là)
- [ ] storico delle osservazioni utente↔host (WinRM, GLPI, Wazuh 60106, eventi 4624/4768 dei DC) e «utente prevalente» per PC
- [ ] `ad-client`: leggere anche givenName, sn, mobile, company, manager, employeeID, office; computer: managedBy
- [ ] `asset_assignees`: legame con l'utente AD (guid), reparto, ruolo, origine; «Importa da AD» con proposta
      (abilitato, nome e cognome, mail, accesso recente, niente account di servizio) e conferma a spunte
- [ ] proposta di assegnatario sull'asset dall'utente prevalente, mai sopra un'assegnazione manuale; utente AD
      disabilitato → asset da riassegnare
- [x] chi scrive `ad_computers.host_id`: `linkAdComputerToHost` nella sync AD e `relinkAdComputersForNetwork` dopo una scansione

Esecuzione (23/10, sessione nuova, livello leggero; passi del piano):
- [x] passo 1, schema: `migrateAssegnatariAd` (colonne, `host_accessi_utente`, indici) — prova `assegnatari-ad-migration.test.ts` 6/6
- [x] passo 2, AD: attributi in più e assegnatari legati riallineati dopo la sync — `raccolta.test.ts` (allineamento) verde
- [x] passo 3, raccolta degli accessi (Wazuh tastiera/rete, WinRM, GLPI) — `raccolta.test.ts` 7/7 con risposta finta della forma vera
- [x] passo 4, calcolo della proposta (funzione pura, provata) — `proposta.test.ts` 8/8
- [x] passo 5, API (anteprima/importazione AD, elenco, proposta sull'asset) + interruttore e soglie in Opzioni — `importa.test.ts` 5/5, prove di Opzioni 25/25
- [x] passo 6, interfaccia (elenco, «Importa da AD», riquadro sull'asset) — resa guardata sull'hub a 1440 coi dati veri
- [x] passo 7, cancello — tsc 0, lint 0 errori, 5882 prove / 0 rosse (worktree pulito), build 0. Nel clone del Mac 2 prove cadono solo perché c'è `data/ipam.db` di marzo (dipendono dalla macchina)
- [x] passo 8, v0.9.892-894 sull'hub .8 (`update.sh --restart`, health ok); giro acceso per 70791: primo giro 09:13 UTC, 992 righe in 31 finestre, tastiera 8 PC, rete 30 postazioni (misura: 11 e 38), 18 postazioni senza host; importati da AD 19 assegnatari (17 da qualcuno dalla pagina alle 09:16 UTC, 2 dal mio giro, copia `70791.db.bak-20261023-assegnatari`); proposte viste su PC-MIARI e PC-APADULA, «nessuna fonte» su PC-Soragni
- [x] passo 9, documenti: CHANGELOG, CONTEXT §6, scheda-mappa
- [ ] (aperto) WinRM ha dato 0 righe su 70791: nessun apparato Windows con l'utente collegato letto di recente; da guardare
- [ ] (aperto) 3 agenti Wazuh su 11 senza host: i loro accessi alla tastiera non entrano; e 18 postazioni di rete non trovate fra gli host
- [ ] (aperto) nessun «Accetta» provato col clic sull'hub (prova-claude è in sola lettura): lo prova Riccardo; la scrittura è coperta dalle prove
- [ ] (aperto) nell'AD di domarc.it il campo «Reparto» contiene il ruolo: dato loro, non un errore

Pagina «Abbinamenti» (Riccardo, 23/10, decisioni alle domande; livello leggero, tavola da approvare prima del codice):
- [x] tavola grafica sullo stesso canvas della prima (tavola 4, approvata il 23/10)
- [x] Inventario › **Abbinamenti**, voce nuova accanto ad Assegnatari, con rimando «N PC da abbinare» dalla pagina Assegnatari (v0.9.895, visto sull'hub a 1440)
- [x] **tutti gli host con accessi**, anche quelli non ancora in inventario
- [x] conferma **tutto in un clic**, a spunte: crea l'assegnatario da AD se manca, crea l'asset se manca, assegna (prove; non eseguita sull'hub)
- [x] asset già assegnati a un altro: sezione «Da rivedere», **senza spunta**; si sostituisce solo spuntando a mano
- [x] prima conferma vera sull'hub fatta da Riccardo (23/10, 16:25): 11 abbinamenti, 6 asset creati, diario a posto
- [ ] Abbinamenti, asset con lo stesso nome (Riccardo, 23/10: «sì, ma un utente può avere asset multipli»): se esiste già un
  asset col nome del PC, la riga chiede «Collega a n. X» o «Crea nuovo» e non si conferma senza scelta. Il controllo è
  sul NOME del PC, mai sulla persona (più asset per persona è normale). Nato dal doppione NB-AGUZZOLI n. 31/36
- [ ] NB-AGUZZOLI n. 31 (IP .172, oggi un iPhone): rinominare o dismettere lo decide Riccardo; 5 host Discovery con quel nome
- Riccardo (23/10) «non vedo nulla»: il suo utente superadmin entra nella vista «tutte» e la scheda era aperta da prima
  dell'aggiornamento; i dati stanno solo in 70791 (scegliere l'istanza e ricaricare). Da confermare con lui.
- Scostamento (23/10): il giro orario non è un tipo nuovo di `scheduled_jobs` (il CHECK su `job_type` vorrebbe la
  ricostruzione della tabella, zona gialla) ma un timer di `server.ts` con interruttore per cliente in Opzioni, come il
  feed degli exploit. WinRM si legge dal giro (da `network_devices.last_device_info_json`), GLPI all'arrivo dell'inventario.

## 2026-10-22 — Opzioni complete e voce «Schedulazioni» nel menu

Riccardo (22/10): «raccogliere tutti i parametri che sono opzioni e inserirli tutti nel menu, e così una voce per
le schedulazioni che ora sono sparse». Decisioni (22/10, risposte alle domande):
- «Opzioni» (già nel menu, ADR 0032) si allarga dagli interruttori ai **parametri e soglie**, ognuno con descrizione
  e predefinito; chiavi API e password restano nelle loro pagine;
- voce nuova nel menu **«Schedulazioni»**: elenco unico (cosa, rete/controller, quando, prossimo giro, ultimo esito)
  con acceso/spento; «Modifica» apre la pagina che la configura oggi, niente moduli doppi;
- livello leggero; solo admin, modifiche nel diario; **tavola grafica da approvare**, poi piano breve ed esecuzione
  in una sessione nuova.

Censimento (22/10, origin/dev): parametri fuori da Opzioni nelle schede di `/settings` Scansione, Alert sicurezza,
Notifiche, Sistema, Aggiornamenti, e in `/settings/mdm` (intervallo, errori di fila). Schedulazioni in quattro posti:
`/settings?tab=jobs`, righe `gruppo: "job"` del catalogo, `SubnetScheduleCard` in `/networks/[id]` (edge-scan,
oggi in `fuori-catalogo.ts` come dato della rete: nell'elenco ci va col rimando), intervalli propri di MDM e dei
timer di `src/lib/vulcan/`.

- [x] Censimento puntuale dei parametri per scheda (chiave, dove si legge, predefinito) — 22/10 sera, su `6ee683f9`:
  - **Scansione** (`components/settings/scan-config-tab.tsx`, `tenant_settings` via `/api/settings`, letti da
    `/api/scan-config`): `quick_scan_concurrency` (6), `quick_scan_host_timeout_s` (10), `quick_scan_exec_limit_ms`
    (22000), `quick_scan_tcp_ports` (lista di serie dello scanner), `port_discovery` (già in Opzioni: `automatismo.naabu`),
    `naabu_bin_path` (vuoto = PATH); profilo Nmap (`nmap_profiles`: porte TCP/UDP, community) = **dato**, resta lì.
  - **Alert sicurezza** (`/api/integrations/wazuh/alerts/config`): `wazuh_alerts_self_ips`, `wazuh_alerts_self_accounts`,
    `integration_wazuh_device_rule_ids` = dati (elenchi nostri), restano; `notify_retention_days` (30, 1-365) = parametro.
  - **Notifiche** (`lib/notifications/config.ts`): canale SMTP/webhook = dati e segreti, restano;
    `notify_immediate_categories` (ransomware, log_tampering), `notify_immediate_min_level` (12),
    `notify_digest_interval_minutes` (60) = parametri.
  - **Sistema** (in `settings/page.tsx`): configurazione guidata, `PuliziaHostCard` (soglie in costanti: 60 giorni di
    assenza, 90 d'archivio, 400 di registro — oggi non si cambiano), scheda MDM, export/backup. Nessuna chiave nuova.
  - **Aggiornamenti** (`/api/system/update-channel`): canale = `DA_INVENT_BRANCH` in `.env.local` (voce da file); timer
    `da-ipam-update.timer` ogni 15 min (systemd, fuori dall'app).
  - **MDM** (`lib/integrations/mdm-config.ts`): `MDM_SYNC_INTERVALLO_MINUTI` 60 (ritmo del job `mdm_sync` creato
    all'accensione), `MDM_MAX_ERRORI_CONSECUTIVI` 5 (costante); URL, utente, password, campo utente = dati.
  - **Schedulazioni**, sei famiglie: (1) `scheduled_jobs` per cliente (16 tipi + `unifi_sync` per controller, +
    `apparati_scelti` creati da Discovery) — `/settings?tab=jobs` e Opzioni; (2) scansione rapida per rete
    `SubnetScheduleCard` in `/networks/[id]` (è un `scheduled_jobs` con rete); (3) Edge per rete
    (`lib/vuln/edge-schedule-store.ts`, cron sulla sonda) — `/networks/[id]`; (4) timer dell'app in `server.ts`:
    backup 03:00 (`DA_INVENT_BACKUP_CRON`), Chocolatey 02:00, feed exploit 06:00, salute appliance e job fermi ogni 30
    min, segnale DA-Link ogni 5 min, DA-Vul-can coda 1 min/battito 15 min/inventario 24 h; (5) `mdm_sync` (job, ritmo 60);
    (6) aggiornamento automatico (systemd, 15 min).
- [ ] Tavola grafica di Opzioni allargata e Schedulazioni, approvata da Riccardo — pubblicata il 22/10 sera
  (https://claude.ai/artifact/MFg8HqVhyS4dEzwiDoo1LX, fogli «parametri e soglie» e «Schedulazioni», oggetti 14-30),
  in attesa dell'approvazione oggetto per oggetto. Lavoro nel worktree `.worktrees/da-ipam-opzioni`.
- [x] Tavola approvata da Riccardo il 23/10 («ok su tutto»): soglie fisse col lucchetto, gruppo dei job in Opzioni che
  resta, timer dell'appliance col lucchetto (senza DA-Vul-can né aggiornamento), niente «Esegui ora», scheda job invariata.
- Scoperto il 23/10: `quick_scan_concurrency`, `quick_scan_host_timeout_s`, `quick_scan_exec_limit_ms` li scrive la scheda
  Scansione ma **lo scanner non li legge** (`scanner/ports.ts` usa solo `DA_INVENT_NMAP_DISCOVERY_*`, di serie 12/10 s/22 s):
  in Opzioni col lucchetto e il valore vero; farli contare = proposta a parte (cambia il ritmo delle scansioni ovunque).
- Piano breve (livello leggero):
  - [x] A1 `opzioni/tipi.ts`: gruppo `parametri`, forme `numero` · `elenco` · `testo` · `fisso`; `parametro` (sezione,
        unità, min, max); `valore` fino a 2000 caratteri; «chi l'ha cambiato» in `opzioni.cambio.<id>` (hub), «Torna a di
        serie» cancella chiave e segno (`deleteSetting` nuovo in `db-hub`)
  - [x] A2 `opzioni/parametri.ts`: porte TCP, percorso Naabu, livello/categorie/riepilogo delle notifiche, conservazione
        eventi (scrivono con `setSetting`/`setNotificationConfig`, stessi limiti delle rotte); fissi: tre numeri della
        scansione (da file), 60/90 giorni della pulizia, 5 errori di MDM
  - [x] A3 prova di completezza: ogni chiave delle schede Scansione/Notifiche/Alert/MDM nel catalogo o in `fuori-catalogo`
        col motivo; prove su limiti (400), ritorno al di serie, segno di chi — `parametri.test.ts` 8 verdi; vista rossa
        togliendo il gruppo dal catalogo e una voce da `fuori-catalogo` (`quick_scan_concurrency: né in Opzioni…`)
  - [x] A4 pagina Opzioni: gruppo «Parametri e soglie» con sottotitoli, campo in riga, finestra per gli elenchi, lucchetto;
        schede vecchie: riga di riepilogo + «cambia da Opzioni ›» (Scansione veloce e Naabu, Quando notificare,
        Conservazione); il salvataggio delle Notifiche non manda più la politica
  - [x] B1 `lib/schedulazioni/elenco.ts`: righe da `scheduled_jobs`, controller senza job, Edge per rete, timer di
        `server.ts`; esito da `last_run`, fallimenti in serie dello scheduler (stato portato su `globalThis`, come
        `stato-scheduler.ts`), ritardo (`findStaleJobs`), MDM, hypervisor
  - [x] B2 `GET /api/schedulazioni`, `PUT /api/schedulazioni/[id]` (admin, registro come Opzioni; righe con opzione →
        `cambiaOpzione`, job semplici → `toggleJob` + ricarica; Edge e timer → 409 col posto dove si cambia)
  - [x] B3 pagina `/settings/schedulazioni` + voce di menu sotto Opzioni; prove di completezza (ogni tipo di job e ogni
        timer di `server.ts` ha la sua riga)
  - [x] C cancello (in DA-IPAM non c'è `scripts/controlla.sh`: lint, tsc, `npm test`, build come da CLAUDE.md) —
        23/10: lint 0 errori, tsc 0, `npm test` 5846 passate / 0 fallite, build ok; resa con playwright-core + Chrome
        (il Playwright MCP era occupato) a 1920 e 1280 sull'app locale con dati finti: niente scorrimento orizzontale,
        17 rifiutato col motivo, 10 salvato «cambiato da prova», «Torna a 12», categorie in finestra, SNMP spento da
        Schedulazioni con dialogo e registro, Edge ferma. Corretti in corsa: campo Naabu troppo largo, colonna Famiglia
        nascosta sotto 1536 (a 1280 esito e «Dove» uscivano di vista), doppio salvataggio Invio+uscita dal campo.
  - Proposte approvate da Riccardo il 23/10 («perfetto anche sulle proposte»), livello leggero:
    - [x] P1 scansione veloce: i tre numeri da Opzioni con chiavi NUOVE `scansione_veloce.*` (le vecchie `quick_scan_*`
          scritte dalla scheda di prima restano ignorate: un valore dimenticato non deve accendersi da solo al rilascio);
          ordine: Opzioni › file `.env.local` › di serie; stessi limiti del file (1-24 host, 5-20 s, 10-90 s)
    - [x] P2 soglie della pulizia per cliente (`pulizia.giorni_assenza` 30-365, di serie 60; `pulizia.giorni_archivio`
          30-365, di serie 90) e limite di MDM (`mdm.max_errori` 1-20, di serie 5), letti dove oggi ci sono le costanti;
          il minimo di 30 giorni è una mia scelta: la pulizia cancella righe
    - [x] P3 «Esegui ora» sulle righe dei job in Schedulazioni, con la rotta che c'è (`POST /api/jobs/[id]/run`)
    - [x] prove (viste rosse), cancello, resa, rilascio su `dev`, CHANGELOG/CONTEXT — 23/10: cancello intero verde
          (5848 passate, 0 fallite, build ok), poi tipi/lint/prove toccate/build dopo le correzioni a schermo; resa a
          1920 e 1280: 10 giorni rifiutato («da 30 a 365»), 45 salvato e letto dalla scheda Sistema, 16 host salvato,
          «Esegui ora» sul DNS → «girato alle 10:16», niente «Esegui ora» sulla pulizia. Corretti in corsa: «Torna a
          16 host» (il di serie leggeva il valore appena salvato; prova aggiunta), la scheda della pulizia diceva «60»
          fisso finché non si chiedeva l'anteprima.

## 2026-10-22 — Vulnerabilità per host ed exploit noti

Riccardo (22/10): in `/vulnerabilities` l'elenco anche per host/IP, e per ogni vulnerabilità se esiste già un exploit. Piano: `docs/superpowers/plans/2026-10-22-vulnerabilita-per-host-ed-exploit.md` (mockup approvato, livello leggero, via di Riccardo il 22/10: eseguito in questa sessione).

- [x] Riccardo: fonti CISA KEV + Exploit-DB + EPSS; selettore «Per vulnerabilità | Per host» nella stessa pagina; scaricamento giornaliero acceso di default
- [x] Passi 1-5 del piano (archivio, job, viste, interfaccia, cancello verde): stati e verifiche nel piano
- [x] Passo 6, hub: v0.9.880 installata e riavviata il 22/10 alle 19:24 (ora italiana), i tre feed scaricati senza errori alle 19:26
- [ ] Passo 6, cliente A: controllare che l'appliance scarichi i feed (Riccardo deve dire quale file del vault)
- [ ] Aperto: a 1280 px le ultime 2-3 colonne delle tabelle scorrono di lato (a 1920 ci stanno)

## 2026-10-22 sera — elenco degli aperti verificato su origin (18:30)

Riccardo ha chiesto di valutare l'elenco «cose da fare» della sessione «VLAN VMware in da-ipam». Confronto con i rami su origin alle 18:30 italiane:

- [x] MAC virtuali: non aspetta più nessuno, è in `dev` dalla v0.9.876 (voce S3 qui sotto chiusa).
- [x] Invio diretto all'hub con l'inventario: le regole ci sono (`DA-Vul-can/docs/operativo/contratto-ipam-hub.md`), A-IPAM è in v0.9.872, A-Link S7-S12a in esercizio; il primo inventario di 70791 è arrivato all'hub alle 16:18. Restano: il primo AD Health automatico (al prossimo controllo AD Health, vedi TASKS di DA-Link S12b) e A3 sull'hub (rotta e report dell'inventario, nessun piano ancora).
- [x] CIDR vero nei documenti: fatto in DA-Vul-can (`nome-rete.ts`, «LAN BASE · 172.16.0.0/17»).
- [ ] Collector modulari: il giro 7 (riga in Opzioni per l'acquisizione con i collector, Proxmox agganciato al pulsante) è su `origin/collector-modulari` ma **non in `dev`**: 5 commit da unire, `dev` intanto è andato avanti di 4 (v0.9.877-878). Poi le due prove sull'hub scritte nella sezione «giro 7».
- [ ] Controller UniFi: decisione di Riccardo fra (a) lasciarlo strumento da CLI, (b) fotografia per apparato dalla stessa lettura della sincronizzazione, (c) radio e client (sezione «giro 7» su `collector-modulari`).
- Restano aperti come scritti: collaudo HP della sede nuova (e lì si vede se «ArubaOS» è ArubaOS-Switch o AOS-CX), misure sul DB dell'hub, SSH rifiutato sugli Ubiquiti, NAS da ricollaudare, letture SNMP Comware incomplete (forse la stessa causa di VLAN e porte taggate mancanti). Rinviati di proposito: firmware e modelli in più, PoE/ottiche/sensori, LLDP, aggancio all'interfaccia per Comware, ProCurve, QNAP, VMware e NetApp.

## 2026-10-22 — difetti degli switch segnalati sulla sede 70151 (Comware, VLAN, LibreNMS)

Diagnosi in sola lettura sull'appliance 70151 (VM 104 su PX01, `qm guest exec`; v0.9.874) il 22/10 sera. Livello leggero.

- [x] Causa VLAN Comware: le 5 walk Q-BRIDGE (Static/Current) ricevono `SNMP_STATO_1` = *tooBig* (liste di porte IRF lunghe con GETBULK a 20 righe), riescono solo PVID e mappa del bridge (2/7); stessa causa per le porte taggate mancanti
- [x] Causa profilo: i 5 Comware (5900AF, 4× FF 5700) creati il 22/10 alle 14:19 con profilo `hp_switch_procurve` benché il sysDescr dica «HPE Comware Platform Software»: con quel profilo non si usano mai comandi e collector Comware
- [x] Aruba 2530/2540 della stessa sede: VLAN complete (21-24, taggate e non) — il lettore Q-BRIDGE va
- [x] Scoperto: l'appliance 70151 non si aggiorna più: «Aggiorna ora» segue il canale `main` (v0.9.873) ed è installata `dev` v0.9.874 → «retrocessione rifiutata» (15:21 e 15:38 UTC)
- [x] Riccardo (22/10): switch e router con le due acquisizioni sommate, SSH principale quando c'è ed è migliore, più SNMP
- [x] Riccardo (22/10): aggiunta automatica in LibreNMS estesa a tutti gli oggetti con SNMP verificato (non solo i vicini LLDP)
- [x] Walk SNMP: su *tooBig* riprova la stessa walk a blocchi più piccoli (5, poi 1) — 2 prove viste fallire poi verdi (`snmp-walk.test.ts`), suite 5789/0
- [x] Profilo HP dal sysDescr alla lettura delle informazioni (`profiloHpDaSysDescr`, solo profili switch HP; AOS-CX escluso) — 3 prove viste fallire poi verdi
- [ ] Lettura SNMP generale dei Comware: `TEMPO_SCADUTO` su 1-3 walk su 16 (IRF lento, già noto dal collector): da guardare dopo la VLAN
- [x] Canale di aggiornamento di 70151 su `dev` (ok di Riccardo 22/10): `DA_INVENT_BRANCH=dev` in `.env.local`, backup `.env.local.bak-20261022-164828`, aggiornamento avviato
- [x] Verifica VLAN dei Comware sul dato vero dopo l'aggiornamento a v0.9.879 — **non basta**: letture 19:02-19:06 ancora `SNMP_STATO_1` 2/7. Prova vera su HP5700-Core (22/10 19:57): *tooBig* anche con UNA riga (v1 GETNEXT e v2c a 1) sulle liste di porte (Static/Current Egress); i nomi arrivano tutti (29 VLAN) e il walk cade solo alla riga dopo l'ultimo nome (la prima lista di porte); PVID 91 righe ok. La riprova a blocchi piccoli resta valida per altri agenti ma qui la causa è la riga singola più grande del pacchetto massimo dello switch
- [ ] Comware: tenere i nomi delle VLAN quando il walk dei nomi cade per *tooBig* dopo righe lette (un nome non supera mai il pacchetto), matrice dai PVID segnata «dedotta» come per la ProMax
- [x] Codice: proiezione `proiettaVlan` (sezione `ok` → `switch_vlan*`, fonte «collector»), scritta da `applicaSnapshot` solo se cambia; il job SNMP orario non sovrascrive con una lettura senza tabelle VLAN — prove viste fallire (proiezioni 3, applica 2, job 1), suite 5809 (1 rossa a caso: tempi bcrypt, verde da sola)
- [x] 70151 (22/10 sera, ok di Riccardo): v0.9.881; credenziale SSH «HP-SW» legata a 20, 21, 22; «Interroga» ha corretto il profilo dei 5 in Comware (v0.9.879 sul dato vero); acquisizione col collector accesa; prima acquisizione: 5 snapshot `partial`, VLAN in errore per `SSH_EXEC_TIMEOUT` su `display interface brief` (limite di 4 s dell'app contro i 15 s del collaudo) → limiti per collector nel descrittore, prova vista fallire
- [x] 70151 v0.9.882 (22/10, 23:09 italiane): VLAN dal collector scritte su 4 Comware su 5 — HP5900-Route 29 VLAN/256 taggate, HP5700-NET 29/2778, HP5700-Core 29/860, HP5700-DR 29/755 (`switch_vlan_lettura.tabella=collector`, righe «VLAN» nel riquadro)
- [x] HP5700-Storage (id 22): `SSH_CONNECT_FAILED` con «HP-SW» — Riccardo: credenziale giusta, firmware vecchissimo. Proposta del server letta: solo kex SHA-1, `ssh-rsa`, cifrature CBC → AES-CBC in fondo all'elenco del client (prova con server ssh2 che offre solo quelle, vista fallire)
- [ ] Riccardo guarda la tab VLAN di HP5700-Core su 70151 (resa non vista da me: l'accesso admin dell'appliance sta solo nella VM)
- [x] HP5700-Storage su v0.9.883 (22/10, 23:22 italiane): SSH entra, 29 VLAN, 659 porte taggate, 167 non taggate. **5 Comware su 5 con le VLAN dal collector**
- [x] Comware: porte taggate via SSH — **scelta di Riccardo (22/10, strada 2)**. Il collector `hp-comware` legge già `display vlan all` con taggate/non taggate; manca la proiezione delle VLAN del collector in `switch_vlan*` (porta per nome → ifIndex) con precedenza sulla lettura SNMP che non riesce. Su 70151: credenziale SSH «HP-SW» (id 2) già legata e provata su 18 e 19; da legare e provare su 20, 21, 22 (porta 22 aperta su tutti); `acquisizione_modulare.attiva` assente (spenta); profilo Comware dal job delle 02:00 o da «Interroga». Scritture su 70151 con conferma di Riccardo
- [ ] Comware: in alternativa sullo switch `snmp-agent packet max-size` più grande (scrittura sull'apparato del cliente: decide Riccardo)
- Prompt per il resto del giro: [`docs/handoff/2026-10-22-prompt-switch-librenms.md`](docs/handoff/2026-10-22-prompt-switch-librenms.md) (Riccardo: ok a farlo in una sessione nuova)
- [x] Proposta di aggiunta switch/router: SSH principale + SNMP (oggi con SNMP principale non propone mai l'SSH: `proposta-apparato.ts`) — 23/10: solo piattaforme col protocollo predefinito SSH (Ubiquiti resta SNMP); 3 prove viste fallire, poi verdi
- [x] LibreNMS, lato server: candidati = apparati con binding SNMP riuscito o SNMP validata sull'host + host con SNMP validata (misura 70151: binding riusciti 4 su 16, SNMP validata su 76 host); tabella `librenms_esclusione` (`_v21`), rotta `/api/hosts/[id]/librenms/esclusione`; host aggiunto con la sua SNMP validata — prove viste fallire (giro, aggiunta), migrazione e rotta verdi
- [x] LibreNMS, interfaccia: esclusione e stato sulla scheda, liste «SNMP verificati» ed «Esclusi» nella pagina del modulo — tavola da approvare: [`docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html`](docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html) (oggetti 1-7) — **Riccardo 23/10: tavola approvata così com'è** (anche oggetti 8-9)
- [x] LibreNMS: migrazione `_v21` misurata su una copia del DB di 70151 (23/10 09:39 italiane: +1 tabella e il suo indice, hosts 243→243, integrity ok, copia cancellata); poi applicata dall'avvio della v0.9.885 (journal: «librenms esclusioni, aggiunto librenms_esclusione», segno `done:2026-10-23:v1`)
- [x] LibreNMS: aggiunta in blocco dalla Discovery — stessa tavola, oggetti 8-9 — 23/10: resa a 1280 e 1920 con `fetch` finto (scheda nei tre stati, card del modulo, finestra con i quattro esiti), nessun errore in pagina; esito per riga provato (`librenms-blocco.test.ts`, vista fallire)
- [x] Matrice VLAN: colonne e intestazione fisse, altezza limitata (barra orizzontale oggi in fondo a una tabella di ~2500 px) — 23/10: resa con Chrome a 1280 e 1920, 24 VLAN × 50 porte finte, scorrimento verticale e orizzontale
- [ ] MikroTik CORE1/CORE2 (6 switch SNMP) senza VLAN: RouterOS non espone Q-BRIDGE via SNMP; servono SSH (`/interface bridge vlan`) o il collector
  - 23/10, letto nel codice: dare l'SSH non basta. Uno switch MikroTik usa la scheda degli switch (tabelle `switch_vlan`); in SSH la lettura SNMP degli switch è saltata (`jobs.ts`, ramo switch), la lettura delle VLAN di bridge (`letturaSchedaMikrotik`) parte solo nel ramo dei router e scrive le tabelle della scheda MikroTik, e la sezione VLAN del collector `mikrotik-routeros` esce sempre `partial` e senza ifIndex, quindi `proiettaVlan` non la scrive. Strada da scegliere con Riccardo
  - **Riccardo 23/10: strada «lettura SSH degli switch»** — il giro degli switch MikroTik in SSH fa anche la lettura delle VLAN di bridge (oggi solo router) e la scrive in `switch_vlan` (porta per nome → ifIndex); la lettura SNMP resta accanto
  - [x] 23/10, codice: `letturaVlanSwitchMikrotik` (giro, «Interroga», apparati scelti) → `switch_vlan` con fonte «mikrotik»; le porte via SNMP accanto all'SSH le dava già il client combinato degli switch. Prove viste fallire (proiezione, regola delle letture), prova del giro aggiornata (SW-7 ora legge via SSH)
  - [x] 70151 (23/10, ok di Riccardo): aggiornata a v0.9.885 con `update.sh --restart` (health 200 sulla 3001); backup `DEFAULT.db.bak-20261023-074025`; credenziale SSH id 1 (quella del router) legata ai CORE 12-17, protocollo SSH porta 22, SNMP accanto; lettura VLAN lanciata subito: **6 su 6 letti**, 20-31 VLAN, 159-204 porte/VLAN, 9-14 PVID, 0 porte senza mappa (`switch_vlan_lettura.tabella=mikrotik`)
  - [ ] Riccardo guarda la tab VLAN di un CORE (es. CORE1-241) su 70151: resa non vista da me
  - [ ] **Token API di LibreNMS di 70151 da rigenerare** (Riccardo): 48 caratteri finiti nel trascritto il 23/10 (`. .env.local` con uno spazio nel valore di `LIBRENMS_API_TOKEN`); lezione in `~/.claude/lezioni/DA-IPAM.md`
  - **Riccardo 23/10: ok alle scritture su 70151** quando PX01 torna raggiungibile: credenziale SSH del router MikroTik legata ai 6 CORE, SSH principale con SNMP accanto, «Aggiorna ora» a v0.9.884+ (prima la migrazione misurata su una copia)

## 2026-10-21 — S3, un elenco solo dei MAC virtuali (ramo `s3-mac-virtuali`)

Piano: `docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md` (ramo `collector-modulari`), blocco S3, controllo completo.

- [x] Prova `devices/__tests__/mac-virtuali.test.ts` vista rossa (la mappa non riconosceva HSRPv2), poi verde.
- [x] `devices/mac-virtuali.ts` puro; `topology/identity.ts` e `devices/physical-device-db.ts` lo usano (riesportato, chiamanti invariati).
- [x] Prove di topologia, apparati e MeshCentral: 1292 verdi; `tsc` e lint verdi.
- [x] Misura in sola lettura sui DB dell'hub: 0 MAC cambiano esito (oltre 13 milioni letti).
- [x] Riccardo: unire in `dev` e rilasciare — unito il 22/10 (e1f15243, ramo `integra-20261022`), uscito con v0.9.876 sull'hub; resta facoltativa la stessa misura sull'appliance del cliente A.
- Nota: le righe di `device_interfaces.is_virtual_mac` scritte prima restano come sono (si ricalcolano alla scrittura successiva); sull'hub non ce n'è nessuna da correggere.

## 2026-10-22 — Letture degli apparati accese di serie (ADR 0031)

Livello leggero, approvato da Riccardo il 22/10 dopo 70151 (VLAN del router mancanti perché la lettura nasceva spenta).

- [x] Chiave assente/rovinata = accesa in `leggiInterruttore`; la mappa nuova resta spenta
- [x] Testi della pagina «Dati della mappa» («accesa di serie»)
- [x] Prove: 49 che davano per scontata la partenza spenta ora la dichiarano; prova nuova sul valore di serie
- [x] ADR 0031, CHANGELOG
- [x] Cancello (lint 0, tsc 0, prove 5366/0 fallite, build 0), release v0.9.873, push su dev
- [x] Appliance di 70151 aggiornata a 0.9.873 (14:20 italiane, health 200)
- [x] Scoperto: su 70151 nessun job legge gli apparati (niente `arp_poll` né scansioni): creato `arp_poll` ogni 30 min (job 4, ok di Riccardo)
- [x] Verifica sul router 172.20.40.102: primo giro 15:00 italiane, letture 6/6 e 4/4 comandi, 19 VLAN, 26 VLAN di bridge, 1 bridge
- [x] Pagina unica delle opzioni + job di serie: censimento (34 interruttori in 13 pagine), tavola approvata, spec e piano scritti
- [x] Promote dev → main v0.9.873 (85662969), chiesto da Riccardo il 22/10
- [x] Esecuzione del piano [`2026-10-22-pagina-opzioni.md`](docs/superpowers/plans/2026-10-22-pagina-opzioni.md) (9 task, leggero; 8 = aggiornamento che non retrocede + installatore, 9 = errore SSH), avviata il 22/10 sera nel worktree `.worktrees/da-ipam-opzioni`; ordine 1-6, 8, 9, poi 7 (Riccardo:)
  - [x] Task 1-9 · v0.9.874 su dev (42c5ba90), Deploy-Appliance e9a1fda su main; 70151 aggiornata e verificata (job 8-11 nati, ARP job 4 invariato); consuntivo nel piano
  - [ ] Riccardo apre `/settings/opzioni` su 70151
  - [ ] Promote dev → main (chiedere a Riccardo)
  - [ ] Hub: guardare i job di serie nati al suo prossimo aggiornamento (oggi fermo a 0.9.872)
  - Trovato: la spec rimanda al censimento del §1, che nel file non c'era; recuperato dal trascritto della sessione di progettazione, va nella spec col Task 6

## 2026-10-22 — LibreNMS come fonte di dati degli apparati SNMP

Spec [`docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md`](docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md), piano [`docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md`](docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md) (10 task; livello leggero dal 22/10, zone rosse invariate; stato: approvato, S1-S5 e tavola S6 sul ramo `librenms-fonte`). Prova in sola lettura sull'hub il 22/10: LibreNMS ha 3-4 volte porte, vicini e MAC dei nostri motori, più 1160 sensori.

- [x] Prova in sola lettura sull'API di LibreNMS dell'hub e confronto con il DB 70791 (spec §2)
- [x] Spec e piano scritti
- [x] Riccardo (22/10): leggero; vicini aggiunti in automatico se l'SNMP risponde; i 5 server mai interrogati quasi certamente senza SNMP (si verifica nel task 4, poi si propone di toglierli); container LibreNMS già aggiornato. Registro del piano. In coda dietro i collector modulari.
- [x] Uscite vere per S3 raccolte sull'hub (sola lettura) e anonimizzate a chiusura: fixture in `src/lib/integrations/__tests__/fixtures/librenms/`; `ports_vlans` dà 404.
- [x] Giro cloud LibreNMS 1 sul ramo `librenms-fonte`: S1-S5 e la tavola S6 (prompt `docs/handoff/2026-10-22-prompt-cloud-librenms.md`). Non rilasciato: niente `version:release` sul ramo (lo si fa all'unione in `dev`).
- [x] Piano approvato da Riccardo (livelli compresi) — 22/10, Registro del piano
- [x] T1 aggiunta senza force_add, v1/v2c/v3 — rifiuto in `librenms_rifiuto` (tabella in più rispetto al piano) e nel `last_status` di una riga di mappa che c'era; AES256C non accettato (fuori tabella); `probe()` ora riconosce 401/403
- [ ] T1 sull'hub (locale, dopo l'unione in `dev`): «Aggiungi a LibreNMS» su un IP senza SNMP scelto da Riccardo → rifiuto visibile, `/api/v0/devices` stesso numero
- [x] T2 migrazione librenms_fonte_v21 — 10 tabelle + 2 indici; provata su DB nuovo e su DB con lo schema di oggi (< 50 ms in memoria)
- [x] T2 sulla copia dell'hub (22/10, locale): `70791.db` 2,0 GB, segno `done:2026-10-22:v1`, 11 tabelle, `integrity_check` ok, apertura+lettura ~3 s
- [x] T3 client e lettori con uscite vere anonimizzate — una forma sconosciuta per parte (`fixtures/librenms/forma-sconosciuta/`); il `vlan_id` dell'FDB è l'id di riga delle VLAN (si traduce); VLAN per porta assente (404)
- [x] T4 scrittura e giro nel job librenms_sync — interruttore `librenms` spento; vicini non interrogati aggiunti da soli (5 per giro, rifiutati riprovati dopo 24 h); `scripts/prova-librenms-fonte.ts` provato contro un LibreNMS finto
- [x] T4 prova a vuoto con l'API vera (22/10, locale, LibreNMS 26.10.2, exit 0): 51/1086/109/76/3280/3055/1160, inventario 20 per giro, 5 non interrogati, 10 vicini da aggiungere, ~2 s. Era: prova a vuoto con l'API vera sulla copia dell'hub (locale): `printf '%s' "$TOKEN" | npx tsx scripts/prova-librenms-fonte.ts <copia> --cartella <scratch> --url http://127.0.0.1:8090` (con un tunnel); numeri contro spec §2, versione di LibreNMS; poi decidere se tenere l'aggiunta automatica accesa al primo giro sull'hub
- [ ] T4 i 5 server mai interrogati: prova SNMP con la credenziale dell'apparato (locale, traffico verso gli apparati), poi proporli per la rimozione
- [x] T5 rotte API — `GET /api/hosts/[id]/librenms/dati`, `GET`/`POST /api/integrations/librenms/candidati`; guardie predefinite, `rotte-censite` verde
- [ ] T5 `bash scripts/verifica-permessi.sh` con l'app accesa (locale)
- [x] T6 tavola grafica approvata (22/10: L1 limiti di avviso di LibreNMS o 10%, L2 Alias solo se presente, L3 due righe, L5 nella pagina del modulo) — era: tavola grafica approvata — `docs/proposte/2026-10-22-librenms-interfaccia.html` (L1-L5 e 4 domande in fondo), in attesa di Riccardo
- [x] T7 scheda: Sensori, Porte e Vicini con fonte (cloud 22/10 giro 2; resa vista a 1440 e 1920 con dati finti)
- [ ] T7 resta: provare la scheda con dati veri dopo l'accensione sull'hub (T10); limiti di avviso di LibreNMS non letti (solo il 10%)
- [x] T8 pagina del modulo (cloud 22/10 giro 2; resa vista a 1440 e 1920): non interrogati, rifiutati, candidati — nota: la card «Letture in più» mostra «Nessuna lettura ancora» per LibreNMS (gli esiti sono per parte, non per apparato): l'esito per parte va in L5
- [ ] T9 vicini nella mappa (zona rossa, misura prima/dopo)
- [ ] T10 accensione sull'hub, ADR, documenti

## 2026-10-22 — scansione automatica dei device scelti

Piano: [`docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md`](docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md) (10 task; giro e migrazione livello completo, interfaccia leggero; stato: bozza da approvare). Tavola approvata il 22/10: artboard `ScansioneAutomatica` (J1-J4) del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv. Risponde anche al punto (a) qui sotto (job `arp_poll` sull'hub).

- [x] Piano approvato da Riccardo (22/10: tavola «si va benissimo», piano «ok»)
- [x] T1 tipo `apparati_scelti`, CHECK v11 di `scheduled_jobs`, tabella `job_apparati_esiti` (misura sulla copia dell'hub) — v0.9.861; v11 sulla copia 3-4 ms, 23 job identici, integrity ok; revisione completa: approvato (una colonna sconosciuta ora blocca la ricostruzione)
- [x] T2 regole pure: config, frequenze (ogni ora · ogni 4 ore · ogni giorno alle HH:MM), idoneità, letture valide — regole pure; il job segue l ora italiana (fuso esplicito); revisione completa: 1 importante (fuso) corretto
- [x] T3 funzioni DB: stato degli apparati in una query, esiti per apparato — una query per 50 id, db.test 11 casi rosso poi verde
- [x] T4 letture estratte da «Interroga» e dal giro ARP, lucchetto per apparato, log senza nomi né IP — lucchetto in comune fra scheduler e rotte (globalThis), 5 min per apparato, log senza nomi né IP; le 90 prove del giro invariate; revisione completa: 1 grave (lucchetto non condiviso) corretto
- [x] T5 il giro `apparati_scelti` nello scheduler (prova a vuoto sulla copia dell'hub) — giro in serie con esito per apparato; «saltato» se niente da leggere; idoneo anche con binding riuscito (decisione nel registro); prova a vuoto sulla copia; revisione completa: 1 grave corretto. Nota per T10: i 5 switch Ubiquiti hanno il binding SNMP mai provato → prima «Prova credenziali»
- [x] T6 rotte API (anteprima, creazione, modifica, esiti, testata) — rotte con guardie (scrittura solo admin), anteprima con valutaApparato, /api/jobs generico non può creare né cambiare la frequenza di questi job; revisione completa: approvato
- [x] T7 Discovery: pulsante e finestra (J1, J2), resa 1440 e 1920 — J1-J2 in Discovery, viste a 1440 e 1920
- [x] T8 pagina dei job: riga ed esiti per apparato (J3), resa 1440 e 1920 — viste sulla copia; salvataggio della modifica non provato a schermo
- [x] T9 testata della scheda: pastiglia (J4), resa 1440 e 1920 — viste sulla copia
- [x] T10 accensione sull'hub (con l'ok di Riccardo per creare il job), ADR 0030, CHANGELOG, CONTEXT, scheda-mappa — sull hub (22/10 11:24 ora italiana): credenziali SNMP di 5 switch e del router provate, job #25 «Switch e router del CED» ogni 4 ore con 6 apparati, primo giro 6 letti su 6 in 83 s; servizio riavviato perché lo scheduler veda il job; backup /root/70791.db.bak-20261022-092258-prima-job-apparati. Revisione finale: 3 importanti corretti (modifica che restringeva il job, VLAN tolta in silenzio, «Esegui ora» sovrapponibile)
- [x] Consuntivo scritto nel piano; ADR 0030 non scritto (resta aperto, sotto)
- [x] ADR 0030 «job sugli apparati scelti» con «cosa diventa difficile» (lucchetto in memoria, due letture sovrapponibili dopo il timeout dei 5 minuti) → scritto il 22/10
- [x] SW-UFLEX-RG-10GB (apparato 9): IP 192.168.40.240 morto dal 06/10 e assente dal controller UniFi, quindi fuori dal job #25: serve da Riccardo l'IP attuale (sostituisce il punto (c) sotto) → Riccardo 22/10: non è più attivo; apparato 9 disattivato (enabled=0, non cancellato).
- [ ] ProMax: PVID SNMP diverso dalla nativa del controller su 6 porte su 14 (vedi riga più sotto); finché non si rivede la lettura Q-BRIDGE il job la rilegge ma la matrice resta «dedotta» — Riccardo 22/10: forse porte aggregate (LAG); da verificare con la lettura dei LAG.
- [ ] Panoramica switch: con i filtri «Trunk» / «Tutte» la pagina scorre ancora di ~150 px a 1440×900 (vedi riga più sotto)
- [ ] J4: la pastiglia nello stato «spenta» (job sospeso) non è stata vista a schermo, solo con e senza job
- [ ] Un job creato da script ha bisogno di un reload o riavvio dello scheduler; se capita ancora, aggiungere un modo per ricaricarlo

## 2026-10-22 — accorpamento IP e matrice VLAN degli switch

Piano: [`docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md`](docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md) (12 task + 1 rimandato; A leggero, B leggero con misura sulla copia dell'hub, C completo; stato: eseguito e acceso sull'hub il 22/10, aperti (a)-(f)). Grafica: artboard `Discovery` e `SwitchVlan` del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv.

- [x] Piano approvato da Riccardo (22/10: tavole «ok», «eseguilo qui», «non fare altre domande, procedi fino al live»): i dubbi in fondo al piano si risolvono col consiglio del piano
- [x] T1 blocco di «Rendi apparato» sul server (`apparatoGiaPresente`, 409, anche `/api/devices/bulk`)
- [x] T2 blocco nella finestra, singolo e in blocco, con link all'apparato
- [x] T3 principale del cluster (`physical_devices.primary_host_id`, segno `cluster_principale_v21`) + elenco per nome delle righe nascoste sulla copia dell'hub — v0.9.849; sull hub: 7 cluster, 17 righe da nascondere, tutti i principali sono IP di apparati; cluster 10 e 11 (iLO HPE + schede dello stesso server?) da confermare con Riccardo; migrazione 2 ms, integrity ok; revisione: approvato
- [x] T4 API di Discovery con il cluster, tempo misurato sulla copia (soglia +10 % o +50 ms) — v0.9.850; tempo invariato sulla copia (36-43 ms prima, 39-41 dopo), risposta +0,4 %; principale offline resta principale (la riga non balla a ogni scansione)
- [x] T5 Discovery: secondari nascosti, «+N IP», ricerca sugli IP secondari, contatori spiegati — v0.9.851; resa a 1440 vista (+6 IP sul router, ricerca 192.168.16.254, subnet 16 con l IP ancora dentro)
- [x] T6 «Scegli come principale» e scelta nel «Collega altro IP» — v0.9.852; con un apparato nel gruppo il principale è il suo IP e il pulsante non c'è; senza apparato: «Scegli come principale» (solo admin); il pulsante non visto a schermo (sull hub ogni cluster ha un apparato), coperto dalle prove
- [x] T7 lettore Q-BRIDGE con le uscite vere di SW-CED-48POE-242, SW-CED-16XG-241, SW-ING-ProMax-239 — v0.9.853; esposto dai tre switch: 48POE e 16XG tabelle complete (13 VLAN), ProMax senza nomi né mappa del bridge e porte in ordine inverso; porte da Current (il 16XG mente nella Static); U della ProMax dedotta dal PVID; revisione completa: 1 importante (lettura parziale data per buona) + 3 minori corretti
- [x] T8 tabelle `switch_vlan*` (segno `switch_vlan_v21`), ADR 0029, prova a vuoto su copia hub e cliente A — v0.9.854; ADR 0029; migrazione sulla copia dell hub 41 ms, integrity ok; copia del cliente A non disponibile (decisione del controllore nel registro); revisione completa: 1 medio corretto (righe doppie ora con avviso)
- [x] T9 lettura `switch_vlan` spenta di default, nel giro ARP (una volta l'ora) e in «Interroga» — v0.9.855; spenta = nessuna walk nuova; accesa sull hub: 6 switch Ubiquiti, 42 walk/ora; «Interroga» da admin legge subito se accesa; revisione completa: approvato (3 minori passati al T11)
- [x] T10 matrice VLAN condivisa estratta dalla scheda MikroTik (aspetto invariato) — v0.9.856; matrice in `components/scheda/matrice-vlan.tsx` + `lib/scheda/matrice-vlan.ts`; la tab VLAN del MikroTik è identica byte per byte prima e dopo
- [x] T11 tab VLAN dello switch: striscia VLAN/trunk/access/senza VLAN + matrice — v0.9.857; striscia e matrice viste a 1440 e 1920 sulla copia (48POE 13·45·7·0, ProMax 13·31·1·20 «dedotta»); revisione completa: approvato + 4 minori corretti
- [x] T12 accensione sull'hub e verifica sul dato vero — hub v0.9.858 (22/10, 04:05): migrazioni `cluster_principale_v21` e `switch_vlan_v21` fatte (righe nel journal); lettura `switch_vlan` ACCESA («procedi fino al live»); lettura fatta una volta da script: 5 switch letti, 13 VLAN ciascuno, SW-UFLEX-RG-10GB (apparato 9) TEMPO_SCADUTO; tab VLAN di SW-CED-48POE-242 vista con i nomi veri; la Panoramica ora conta 13 come la tab (831c88d5); Discovery: 7 cluster, 17 righe nascoste; correzioni della revisione finale 4cf651d8 (filtri e ricerca anche sui secondari, CSV «Altri IP», blocco anche su PUT host e DHCP AD) e ratchet di `db.ts` (df2e7dc3); CONTEXT, CHANGELOG, scheda-mappa aggiornati
- [ ] (a) job `arp_poll` sull'hub: il job `apparati_scelti` #25 (22/10) legge già ogni 4 ore router e switch scelti; da chiudere se Riccardo conferma che basta (decide lui)
- [ ] (b) cluster 10 e 11 (iLO HPE + schede di rete dello stesso server?) da confermare con Riccardo
- [x] (c) SW-UFLEX-RG-10GB (apparato 9) non risponde a SNMP (TEMPO_SCADUTO): community, ACL o SNMP spento sullo switch → Riccardo 22/10: non è più attivo; apparato 9 disattivato (enabled=0, non cancellato).
- [x] (d) T13 completamento dal controller UniFi (ok di Riccardo 22/10): lista bianca + `GET rest/networkconf`, native in `switch_vlan_nativa` dalla sync UniFi (solo con `switch_vlan` accesa); ProMax 14 porte completate, resta «dedotta» (18 porte senza nativa dal controller); prove `unifi-vlan-native`, `vlan-switch`, `unifi-api`; resa a 1440 vista sulla copia
- [ ] (e) il blocco «un IP, un apparato» va aggiunto anche in `unifi-sync` prima di accenderlo (oggi spento)
- [ ] (f) le migrazioni sulla copia del cliente A (MikroTik v1-v3, cluster, `switch_vlan`) non sono mai state misurate: la copia non era disponibile
- [ ] ProMax: PVID SNMP diverso dalla nativa del controller su 6 porte su 14 confrontabili, e l'SNMP non dà le porte 33-52 (sugli altri 4 switch 99/99 uguali): la lettura Q-BRIDGE della ProMax (bit «inversi», ifIndex) è da rivedere — Riccardo 22/10: forse porte aggregate (LAG); da verificare con la lettura dei LAG.
- [ ] Native del controller senza scadenza: se uno switch esce dal controller o la lettura `switch_vlan` si spegne e riaccende, le righe di `switch_vlan_nativa` restano (l'età si vede da `nativa_letta_il` nella riga delle fonti); da decidere se farle scadere
- [ ] Sull'hub la nativa si scrive al primo giro di `unifi_sync` #22 (03:00) dopo il rilascio: verificare `switch_vlan_nativa` il giorno dopo
- [x] Panoramica dello switch sull hub (SW-CED-48POE-242): scorreva di ~190 px a 1440×900. Il riquadro mostrava già 5 VLAN: a far scorrere era la colonna destra (dettaglio + vicini + VLAN). Ora VLAN a 8 voci (due colonne da 4) sotto «Porte da guardare», «tutte (N) ›» verso la tab: a 1440×900 entra (scrollHeight 900, vista sulla copia).
- [ ] Con un filtro a chip che riempie la tabella (Trunk 7, Tutte) la pagina scorre ancora di ~150 px: la tabella arriva a 230 px e il riquadro VLAN sta sotto. Da decidere se accettarlo (vista di lavoro scelta dall'utente) o accorciare la tabella.

## 2026-10-22 — invio AD e inventario a DA-Vul-can (A-IPAM)

Piano: [`docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md`](docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md) (9 task, livello completo, eseguito il 22/10). Oggi l'AD arriva all'hub solo a mano (download qui, «Carica» là): il piano aggiunge l'invio automatico, inventario e battito; spento senza `VULCAN_TOKEN`.

- [x] Piano approvato da Riccardo — Riccardo 22/10: «andiamo avanti», eseguito qui
- [x] T1 chiavi `VULCAN_URL`/`VULCAN_TOKEN` da `oggetto.env` e cliente dell'invio — gettone mai in log/errori/risposte (18 prove); file rifiutato se non root, link simbolico o permessi ≠ 600
- [x] T2 coda `vulcan_coda` nel DB del cliente (segno `vulcan_coda_v21`), misura sulla copia 70791 — migrazione sulla copia 7 ms, integrity ok; revisione completa: 1 medio corretto (inventario superato non torna in coda)
- [x] T3 invio automatico AD Health a fine esecuzione (riusa `toHubExport`, il download resta) — l export AD va in coda a fine esecuzione solo col gettone; le 8 esecuzioni della copia passano lo schema dell hub
- [x] T4 inventario a lista bianca (prova dei campi «Mai»), misura dei byte sulla copia 70791 — copia 70791: 351 oggetti, 226 KB, 19 KB gzip, 3 ms; sentinella sui campi «Mai» vista fallire su un costruttore sbagliato; revisione completa: approvato
- [x] T5 trasporto HTTPS gzip verso l'hub (TLS normale) — TLS verificato sempre (prove rosse togliendolo), gettone solo nell intestazione, risposta limitata a 64 KB
- [x] T6 giro: coda, ping, battito, audit JSONL — giro entro 8 minuti, sospensione su gettone rifiutato salvata nel DB, audit senza dati personali; revisione completa: 1 importante corretto (invii doppi con hub lento)
- [x] T7 timer in `server.ts` (nessuna chiamata senza gettone) — senza gettone solo la lettura della config, timer una volta per processo, inventario alle 03:00 italiane + recupero oltre 26 h
- [x] T8 riquadro in «Cosa esce», «Invia ora», riga nella pagina AD — riquadro in «Cosa esce» (oggi «Spento: manca VULCAN_TOKEN»), «Invia ora» solo admin, riga nella pagina AD; revisione completa: approvato
- [x] T9 collaudo contro DA-Vul-can di sviluppo, documenti, copie cancellate — 22/10, DA-Vul-can origin/HEAD in locale (DB vuoto, CA di prova solo per il collaudo): spento 503 → in coda; acceso AD 201, battito 200, inventario 201 (351 oggetti), doppione 200 senza seconda riga, 401 e 403 → «sospeso»; worktree, CA e copie rimossi; CHANGELOG, CONTEXT §6, consuntivo nel piano
- [x] Rilascio su `dev` e verifica sul live (hub e cliente A «Spento», nessuna riga `[vulcan]` nel journal) — al controllore → hub v0.9.872 (22/10 13:16 ora italiana): migrazione vulcan_coda_v21 fatta, coda vuota, nessuna riga [vulcan] nel journal. Cliente A: arriva col suo aggiornamento da dev, non verificato da qui.
- [ ] Fuori piano, da seguire: A-Link (`tipo:"ipam"`, chiavi in `oggetto.env`, policy P9 con conferma), A3 sull'hub (rotta inventario, nessun piano su origin al 22/10), nome `da-vulcan.domarc.it` fissato sull'appliance

## 2026-10-22 — topologia: spazio in basso, cavi a mano, server non agganciati

Livello leggero. Worktree `.worktrees/da-ipam-topologia` da `origin/dev` (il `dev` locale ha 18 commit dei collector non pubblicati).

- [x] altezza della mappa: 4rem da scrivania, 6,5rem sul telefono (era 9rem, della barra tolta il 20/10)
- [x] partenza finale (hypervisor trascinato prima di collegarlo) che restava sola: radice solo se nessuno la raggiunge — prova vista rossa 2/4, poi verde
- [x] il cavo a mano vince sempre (decisione di Riccardo, 22/10): chiave del Prim e principale forzato degli oggetti finali; aggiornate 2 prove di `cavi-albero` che fissavano la regola vecchia
- [ ] server/hypervisor non agganciati dalla tabella MAC: da misurare sull'appliance 192.168.99.51 (l'impronta ssh è cambiata e il vault non la riporta: serve la conferma di Riccardo prima di fidarsi); la copia locale dei dati è di luglio
- [x] rilascio v0.9.845 su dev, hub aggiornato (01:59 ora italiana, salute ok); resa a 1920×1080 con `prova-claude`: la mappa finisce a 12 px dal fondo
- [x] `db-facade-ratchet` rosso già su origin/dev (265 funzioni in db.ts, soglia 262): non è di questo lavoro, l'ha lasciato la scheda MikroTik → sistemato il 22/10 (df2e7dc3: tre funzioni spostate in db-tenant, soglia 262 rispettata).

## 2026-10-21 — scheda MikroTik copiata dal Manager

Piano: [`docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md`](docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md) (blocchi P1-P4; P5 fuori). Tavole `Mk*` approvate il 21/10 nel canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv. Livello: P1-P2 leggero, P3-P4 completo.

- [x] T1 uscite vere del router dell'hub, fixture anonime in `src/lib/devices/__tests__/fixtures/mikrotik-*.txt`. DA-RT-CORE: 1 bridge con `vlan-filtering=yes`; `topologia.lettura.mikrotik` accesa sull'hub (15/10); apparato 1 con `physical_device_id`; pool DHCP: né (a) né (b), 8 server e 8 pool coerenti → causa ancora da trovare (T3). Trovato: i server DHCP disabilitati hanno il flag `X` in testa, il parser legge solo `disabled=` e li dà attivi
- [x] T2 risorse, hardware, firmware aggiornabile, seriale da routerboard (P1) — poi Riccardo preme «Aggiorna» su MK-RTR-CORE sull'hub — v0.9.832; i dati compaiono dopo un «Aggiorna» su MK-RTR-CORE
- [x] T3 interfacce con stato/MTU/commento dal giro ARP, stato ARP, versione dei vicini; migrazione `scheda_mikrotik_v21` v1 (P1) — v0.9.833; pool DHCP: i server spenti (flag X) risultavano accesi, ora corretti; la Panoramica mostra le barre solo dopo aver aperto la tab DHCP (scelta di interfaccia); migrazione misurata sulla copia dell hub: 25 ms, integrity ok; revisione completa fatta (1 importante corretto: commento interfaccia)
- [x] T4 Panoramica MikroTik (P2) — v0.9.834; resa a 1440 entra (dati di risorse/hardware dalla copia, dalle fixture vere)
- [x] T5 Interfacce raggruppate per tipo (P2) — v0.9.835; colonna Dettagli rimandata ai T9/T11 (bond, bridge, VLAN)
- [x] T6 Dispositivi visti dal router + `tabDelTipo(t, OpzioniTab)` (P2) — v0.9.836; GET `/api/devices/[id]/dispositivi`; `tabDelTipo(t, OpzioniTab)`
- [x] T7 Routing e ARP con lo stato, export ripulito (P2) — `ripulisciExport`, `nomeFileExport`, `statoArp`; ARP con Stato e Tipo (nascoste se vuote). Da fare con Riccardo sull'hub: tab Configurazione, «Leggi dal router»; sulla copia il router non risponde, la resa dell'export ripulito (intestazione, nota «tolte») non è vista
- [x] T8 tabelle `mikrotik_bridge`, `mikrotik_bridge_port`, `mikrotik_bond` + ADR 0027, migrazione v2, misura sulle copie (P3) — v0.9.838; migrazione v2 misurata sulla copia dell hub (18 ms, integrity ok; dal router dell hub: 1 bridge, 16 porte, 3 bond); copia del cliente A non misurata (non disponibile da qui); revisione completa: approvato, 0 gravi
- [x] T9 tab Bridge e VLAN (matrice dai PVID), dettagli bond/bridge (P3) — v0.9.839; matrice dai PVID (le T arrivano col T10); tab VLAN e Bridge solo con la lettura topologia accesa e ≥1 bridge; revisione completa: 1 importante + 3 minori corretti
- [x] T10 lettura `mikrotik_scheda` spenta: bridge vlan, vlan, dns, utenti; migrazione v3 (P4) — v0.9.840; lettura `mikrotik_scheda` nata spenta (nessun comando nuovo ai router finché non la accende un admin); migrazione v3 sulla copia dell hub 22 ms, integrity ok, segno v3; copia del cliente A non misurata; revisione completa: approvato
- [x] T11 matrice VLAN completa, VLAN con la madre, DNS e utenti (solo admin) (P4) — v0.9.841; utenti del router solo admin (provato via HTTP: admin 200 senza password, viewer 403); data per sezione; revisione completa: approvato, 1 importante + 3 minori corretti
- [x] T12 documenti (CHANGELOG, CONTEXT §6, scheda-mappa) — documenti fatti; verifica sull'hub: vedi sotto
- [x] T12 verifica sull'hub (22/10 01:00 ora italiana, v0.9.842): segno `scheda_mikrotik_v21` = v3, riga nel journal; `mikrotik_scheda` assente = spenta, tabelle VLAN/DNS/utenti vuote; interfacce del router con tipo (33/33). `/objects/227` con `prova-claude` (viewer): Panoramica entra in 1440×900, tab Panoramica · Interfacce · Routing e ARP · DHCP · Dispositivi · Configurazione (VLAN e Bridge ancora assenti: tabelle bridge vuote fino al prossimo giro della topologia, al più 1/ora), Interfacce raggruppate per tipo con commenti e versione dei vicini, niente Utenti per il viewer. SNS EVA2 e switch invariati. Da guardare dopo il giro: le tab VLAN e Bridge
- [ ] Aperti dopo il piano:
  - [x] accendere la lettura `mikrotik_scheda` sull'hub (decide Riccardo; nata spenta, nessun comando nuovo ai router finché non la accende un admin) → Riccardo (22/10): sì; accesa sull hub il 22/10 alle 01:43 ora italiana.
  - [x] sesta casella «pool DHCP più pieno» (v0.9.844): la casella Firmware c'è sempre col valore installato (Riccardo 22/10: «il firmware installato è importante»), in attenzione con «▲ aggiornabile a X» quando c'è un aggiornamento; il pool ≥85% (dalla cache della tab DHCP) prende il posto di «Acceso da», l uptime resta nel riquadro Risorse
  - [x] conteggi nelle etichette delle tab (dove il dato è già in pagina; mancano Interfacce, DHCP, Dispositivi, VLAN MikroTik) e vicini «non in IPAM» / link all host (v0.9.843, rotta `/api/devices/[id]/vicini-ipam`)
  - [ ] «Dettagli» della riga del bridge non visto a schermo (nome del bridge dei dati di prova diverso dal reale)
  - [ ] migrazioni v1-v3 misurate solo sulla copia dell'hub: la copia del cliente A non era accessibile, la prima apertura vera lì è anche la prima misura
  - [ ] «Aggiorna» su MK-RTR-CORE sull'hub, altrimenti risorse e hardware non compaiono

## 2026-10-21 — scheda apparato per tipo (proposta grafica)

Tavola: https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (oggi, scheletro comune, tab Gestione, switch, router/firewall, storage, hypervisor, Windows, Linux, application server). Riguarda `objects/[id]/page.tsx` (la scheda unica: `/devices/[id]` e `/hosts/[id]` ci rimandano).

- [x] Censita la scheda di oggi: 7 tab uguali per ogni tipo; credenziali in 5 punti, uptime in 4, classificazione con due editor (host in Generale, apparato in Asset); porte switch a 4 colonne su 9; MikroTik dal vivo, contatori firewall e utenti Windows persi col rimando da `/devices`; Zabbix, Wazuh (oltre alle vulnerabilità), AD, patch, `device_interfaces` e dipendenze nel DB ma non in scheda.
- [x] Scoperto sull'hub (tenant 70791): i server Windows e Linux hanno `network_devices.device_type = switch` con classificazione `server`; l'API decide le query su `device_type` (`api/devices/[id]/route.ts:67-73`). Da sistemare prima della scheda per tipo.
- [x] Tavola grafica: intestazione in una riga, striscia di 6 numeri per tipo, tab del tipo + Sicurezza · Gestione · Storico, Panoramica senza scorrimento, riga delle fonti al posto delle card vuote. Riccardo (21/10): **impostazione approvata**, le singole voci si rifiniscono dopo.
- [ ] Rifinire le voci con Riccardo, tavola per tavola (anche durante l'esecuzione).
- [x] Causa del `device_type = switch` sui server: lo schema vecchio non ammetteva `server` (workaround citato in `db-tenant.ts:6338`); le creazioni nuove passano da `resolveDeviceTypeForCreate` e sono giuste, restano le righe vecchie.
- [x] Riccardo (21/10): livello **leggero per tutto**. Piano: [`docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md`](docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md), 8 task. Le modifiche delle tappe 3-5 alla pagina sono già in `dev` (v0.9.821): niente da aspettare.
- [x] Eseguire il piano (T1-T8): v0.9.822-829 su dev, hub aggiornato a v0.9.829 il 21/10 alle 18:38 (codice servito verificato con grep sui chunk, journal senza errori). Pagine sull hub non aperte a schermo: manca un utente di prova sull hub, si guardano da Riccardo.
  - [x] T1 tipo di scheda e conversione di `device_type`: v0.9.822; SNS EVA2 diventa `device_type=server` (scheda `firewall` dal vendor); righe senza classificazione non toccate
  - [x] T2 mattoni comuni, scheletro, tab Gestione/Sicurezza/Storico: pagina da 2889 a 482 righe, innesto dei tipi in `components/scheda/tab-scheda.tsx`
  - [x] T3 switch: pannello frontale, porte da guardare (`lib/scheda/porte-da-guardare.ts`), VLAN, vicini e MAC. Il dato non ha errori CRC né storico della velocità: quelle due regole aspettano la raccolta (B2); vicini senza host id = testo senza link; conteggi nelle etichette delle tab non fatti
  - [x] T4 router e firewall: GET `/api/devices/[id]/interfacce`, export `mikrotik?action=config` ora solo admin (prima no). In locale il router non risponde (credenziali cifrate con la chiave dell hub): barre DHCP, lease dal vivo ed export da guardare sull hub
  - [x] T5 storage e NAS: verificato su un FIXTURE (forma di `nas-acquisition.ts`, `src/lib/scheda/__tests__/fixture-nas.ts`), nessun NAS sull hub. Da guardare su un NAS vero: codici Synology di stato disco/RAID/SMART scritti dalla MIB e mai visti dal vivo; riallocati e ore non raccolti
  - [x] T6 hypervisor: GET in sola lettura su `proxmox-match` (il POST resta admin) e `/api/hosts/[id]/proxmox-vm` per «VM n su <nodo>». CPU del cluster, quorum e CPU per nodo non raccolti; tab Rete lunga (scorre)
  - [x] T7 server Windows, Linux e ruoli: GET `/api/hosts/[id]/ad` e `/dipendenze`; tab Dipendenze non vista a schermo (la copia dell hub non ha dipendenze), coperta dalle prove. Mancano nel dato: CPU %, KB per nome, pacchetti di sicurezza Linux; i nomi delle sessioni Windows perdono il backslash (difetto del collettore)
  - [x] Utente di prova in sola lettura sull hub: `prova-claude` (viewer, tenant 70791), creato il 21/10 con ok di Riccardo; password in `~/.config/da-ipam/hub-utenza-prova.txt` (fuori da git, da spostare nel vault). Backup `data/hub.db.bak-20261021-164749-prima-utenza-prova`.
  - [x] Pagine viste sull hub il 21/10 sera (switch, router, SNS, hypervisor, DC01, wazuh): tutte entrano in 1440×900.
  - [x] Router DA-RT-CORE, tab DHCP: «il router non ha restituito server DHCP attivi con un pool leggibile», ma i lease (320, server DHCP_DEF) ci sono: capire perché `dhcp-pool` non legge i pool. → risolto (v0.9.833): i server spenti hanno il flag `X` e il parser li dava accesi.
  - [ ] DA-DC01: la casella «Active Directory» sta su una riga a sé sopra la striscia (la striscia va in due righe); «VM 401 s…» troncato in intestazione.
  - [x] VLAN degli switch UniFi cancellate ogni notte: la sincronizzazione del controller (03:00) riscriveva le porte con `vlan` vuota; ora conserva `vlan` e `stp_state` letti via SNMP (v0.9.830, hub aggiornato il 21/10 alle 19:18). Anche il ProMax senza `dot1dBasePortIfIndex` ora lega la VLAN alla porta.
  - [x] Verificare il 22/10: dopo un «Aggiorna» di SW-CED-48POE-242 le porte hanno la VLAN, e dopo il giro UniFi delle 03:00 ce l hanno ancora (`select count(*) from switch_ports where device_id=7 and vlan is not null`). Se i nomi SNMP e quelli del controller non combaciano e gli indici sono sfalsati, la VLAN non si conserva (mai su una porta sbagliata). → 22/10: 52 porte su 52 con la VLAN dopo il giro UniFi delle 03:00.
  - [x] Switch sull hub: un `ERR_TOO_MANY_RETRIES` + eccezione `Event` in console (probabile flusso SSE che si riconnette): da capire. → 22/10: 5 caricamenti di fila delle schede switch (con le tab) senza errori; le tre volte viste erano subito dopo un riavvio dell'hub (pezzi della pagina non scaricati mentre il servizio ripartiva), non un difetto della scheda.
  - [x] Da guardare sull hub, a schermo: router MK-RTR-CORE (barre DHCP: compaiono in Panoramica solo dopo aver aperto la tab DHCP, niente SSH a ogni apertura), export solo admin, una pagina per tipo. → fatto il 22/10 con `prova-claude` (pagine per tipo, Panoramica e Interfacce del router).
  - [x] Conversione `device_type`: i 14 server non sono più «switch» → non hanno più la riga SNMP forzata in «credenziali usate» né l attribuzione della porta switch per MAC (`db.ts:2802`); la lettura SNMP extra del cron (`jobs.ts:1013`, spenta di default) non parte più per loro. Decidere se serve. → Riccardo (22/10): va bene così.
  - [ ] Minori lasciati: SNS EVA2 resta `device_type=server` nel dato; `text-[10px]` nel codice spostato com era; costo di `proxmox-vm`; prove della migrazione su DB vero.
  - [x] T8 chiusura + revisione finale (0 gravi, 3 importanti corretti in v0.9.829: DA-VEEAM con classificazione `windows` ora server Windows; host non gestito con tab Gestione; riquadro «Rete e SNMP» in Gestione)
    - Chiusura, controllo «niente vive solo in `/devices/[id]`» (21/10). Lista dell'artboard «Oggi» (perso / c'è ma non si vede) e blocchi della pagina `/devices/[id]`; la pagina non è toccata:
      - Porte switch a 4 colonne su 9 → switch › Porte (PoE, STP, trunk, vicino, duplex) e Panoramica (porte da guardare)
      - MikroTik dal vivo (sistema, config, server DHCP, pool, lease) → router › Interfacce, DHCP, Configurazione; export `.rsc` in Configurazione (solo admin)
      - Contatori del firewall (filter/NAT/mangle, stato firewall Linux) → router/firewall › Configurazione «Regole del firewall»; firewall dei server → server › Sistema «Sicurezza e licenza»
      - Utenti Windows (ultimo utente, sessioni, profili) → server › Utenti
      - Zabbix → Gestione (collegamenti esterni); Wazuh e vulnerabilità → Sicurezza; Active Directory → server Windows DC › Active Directory; patch → server › Aggiornamenti
      - Interfacce dei router (`device_interfaces`) → router › Interfacce; abbinamento VM ↔ host → hypervisor › VM e container, «VM n su <nodo>» in intestazione
      - Etichette a 10 px e stati col solo colore pastello → riquadri nuovi: testo ≥13 px, stato con segno e parola; qualche 10-11 px resta solo in `components/scheda/dettagli/*` (spostati com'erano, ora solo `generico`)
      - Tabelle con scorrimento in pagina che scorre, nodi Proxmox uno sotto l'altro → tabelle che scorrono da sole nella tab, nodi in griglia a due colonne (hypervisor › Nodi)
      - `/devices` · Informazioni dispositivo (nome, host:porta, protocollo, badge «host #n») → intestazione e Gestione (Come ci arrivo, Identità e inventario)
      - `/devices` · Inventario asset (DeviceInventoryCard) → Gestione › Asset NIS2 (link a `/inventory/[id]`)
      - `/devices` · Dati tecnici acquisiti: sistema operativo, hardware → server › Sistema; NAS/dischi/volumi → storage › Dischi, Volumi, Servizi; rete, licenza, servizi e ruoli, sicurezza, cron, aggiornamenti, utenti, software/pacchetti → server › Sistema, Servizi, Aggiornamenti, Utenti, Software; porte in ascolto → Panoramica e Servizi; campi base di un SNMP generico → `generico` › Dettagli
      - `/devices` · Dati Proxmox (Host, VM e CT, Hardware e licenza) → hypervisor › Nodi (abbonamento), VM e container, Storage, Rete
      - `/devices` · STP e sue porte → switch › Porte (colonna STP) e Panoramica
      - `/devices` · Tab ARP, Schema porte, MAC table, Neighbors, Routing, DHCP leases → router › Routing e ARP, DHCP; switch › Porte, Vicini e MAC; neighbor di router › Interfacce
      - `/devices` · Neighbor LLDP/CDP in fondo e inventario software remoto → switch › Vicini e MAC; server › Software (scansione remota)
      - Non portato: contatore «Neighbor LLDP/CDP (n gruppi)» raggruppato per porta con badge `STP: …` (la tab Vicini li mostra in tabella, non raggruppati) — duplicato del dato, non serve
      - Non portato: un host non gestito (tipo `host`) non ha più «Dettagli» (LibreNMS, IP collegati, Sulla mappa, SNMP): ha Panoramica generica, Sicurezza e Storico — decisione del piano; si riapre solo se Riccardo lo chiede
      - Non portato: raccolta di VPN, regole firewall in elenco, database SQL, siti, posta, backup, inode/LVM, NTP/AppArmor, archivio delle configurazioni — fuori dal piano (B2/B4/B5 del piano `recupero-dadude3-mknet`)
    - T8 verificato: `TabDettagli` resta solo per `generico` (stampanti, AP, UPS, postazioni: inventario base, informazioni SNMP, IP collegati e software non stanno nella Panoramica generica); per gli altri tipi tolto. «Aggiungi a dispositivi da Discovery» tolto da `dettagli/software.tsx`; bug di precedenza `_total_vm_rows` già sparito in T6 (`numeroVm`, 3 prove).
- [ ] Coordinare col piano DADude3/MKNET: B2 (porte HP/MikroTik), B4 (Hyper-V, Windows, Linux), B5 (archivio configurazioni) riempiono i riquadri «dato da raccogliere» della tavola.

## 2026-10-21 — recupero da DADude3 e DA-MKNET (fase di piano)

Analisi del 20/10: canvas Cursor `progetti-fermi-DADude3-DA-MKNET-MKHA` (50 schede). Piano: [`docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md`](docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md). Niente codice finché Riccardo non approva.

- [x] Letti README dell'ecosistema, CONTEXT/AGENTS/CLAUDE di DA-IPAM, ADR 0018, le 50 schede e le prove comparative.
- [x] Donatori invariati dal 20/10 (DADude3 `569b416`, DA-MKNET `812b1ad`); funzioni donatrici alle righe citate.
- [x] Schede verificate sul codice di `dev`: HP, MikroTik, NAS, Windows, Linux, configurazioni, identità MAC, vicini, file «già coperti».
- [x] Scoperto: due elenchi di MAC virtuali diversi (`devices/physical-device-db.ts` conosce HSRPv2/HSRP IPv6, `topology/identity.ts` no).
- [x] Scoperto: il firmware QNAP via SSH (`uname`) **sovrascrive** quello letto via SNMP (`getDeviceInfo`, `{ ...result, ...sshInfo }`).
- [x] Scoperto: gli HP letti via SSH non scrivono vicini (`device_neighbors`); il loro LLDP finisce solo in `switch_ports.trunk_neighbor_*`.
- [x] Scoperto: ProCurve scrive in `speed` il tipo fisico («100/1000T»), non la velocità negoziata; nessuna prova sui lettori HP.
- [x] Scoperto: `upsertSwitchPorts` riscrive tutta la riga: una sotto-lettura fallita metterebbe null sopra un valore buono.
- [x] Scoperto: la GET `/api/devices/[id]/mikrotik?action=config` (export completo) non chiama `requireAuth`/`requireAdmin`: basta la sessione.
- [x] Scoperto: `DA-MKNET/backend/database.sqlite` è vuoto (0 byte): nei cloni non c'è storico da importare.
- [x] Piano scritto: classificazione delle 50 schede, blocchi B1-B6, task con donatori e destinatari, prove, livelli di controllo, decisioni.
- [x] Riccardo (21/10): niente in uso (DADude3, The Dude, QuTS hero, Docker, SCCM, DATIA: fuori); collaudi HP su una sede con Comware, ProCurve e ArubaOS, all'installazione di IPAM nei prossimi giorni. Piano aggiornato (§6).
- [x] Riccardo (21/10 sera): collector modulari come fonte nuova e principale, famiglie aggiunte nel tempo nello stesso JSON. Lette consegna, pacchetto (identico al codice nel `dev` locale), canvas del modello, ADR 0024-0026, manuale; 79 prove dei collector verdi (exit 0).
- [x] Scoperto: i collector `hp-procurve`/`hp-comware` coprono già M1, M2, M3 ed E02; resta l'aggancio all'app (unico chiamante oggi: la CLI).
- [x] Scoperto: `dev` locale (15 commit: collector e piano) e `origin/dev` (41 commit altrui) sono divergenti; la consegna vieta il push su `dev`.
- [x] Scoperto: tre meccanismi di acquisizione convivono (client storici, `devices/acquisition/registry.ts`, `src/lib/acquisition/`); elenco dei collector ripetuto in tre punti; versione unica `1.0.0`; niente SNMPv3 né WinRM nei trasporti dei collector.
- [x] Piano riscritto in v2 attorno ai collector: blocchi S, C0-C6, decisioni D1-D9 più la domanda su ArubaOS.
- [x] Riccardo (21/10 sera): «accetto le tue proposte» → decisioni D1-D9 scritte nel §7 del piano.
- [x] D1: collector pubblicati sul ramo `collector-modulari` (`6cca5a8a`); `origin/dev` non toccato.
- [x] Riccardo: sviluppo nel cloud finché non serve unire in locale. Prompt nel repo: `docs/handoff/2026-10-21-prompt-cloud-collector-modulari.md` (il cloud non vede `~/.claude`).
- [ ] Aperta: «ArubaOS» della sede nuova è ArubaOS-Switch o AOS-CX? Si vede al collaudo (`sysDescr`).
- [ ] Sessione cloud su `collector-modulari`: merge di `origin/dev`, poi S1 → S2 → C0 → C1 → C2 → C3 (S3 dopo il commit delle tappe 3-5).
- [ ] In locale (Riccardo): misure sul DB dell'hub, collaudo HP nella sede nuova, unione in `dev`.
- [ ] S3 (MAC virtuali) aspetta il commit della sessione delle tappe 3-5, che modifica `topology/identity.ts`.
- [x] Cloud (22/10), passo 0: i due donatori (`dadude-native`, `DA-MKNET`) sono leggibili come repository della sessione; nessuna password dei vecchi `OLDSCRIPT` copiata.
- [x] Cloud, merge di `origin/dev` in `collector-modulari` (`d41537e9`): conflitti solo in CHANGELOG, CONTEXT e TASKS, tenute le sezioni di entrambi i rami; 79 prove del modulo e `tsc` verdi (exit 0).
- [x] S1: l'export MikroTik solo admin **era già in `dev`** (sessione della scheda router, `9232b22d`: `mikrotik-guardia.ts`, contratto in `api-auth-guards`). Riletto come revisore: il 403 arrivava dopo la ricerca dell'apparato (un non admin poteva distinguere 404 da 403) e la lista degli admin era duplicata. Corretto (prova vista rossa, poi verde): guardia prima della ricerca, `eAdmin` unico.
- [ ] S1, in locale: GET `?action=config` con un viewer → 403, con un admin → 200 su un router vero; `scripts/verifica-permessi.sh` (serve l'app accesa e il DB hub).
- [ ] S1, nota: per un non admin `action=all` esegue comunque `getConfig` (l'export viene letto sul router e scartato). Non cambiato: serve `systemInfo` alla scheda; da separare in C3 (`mikrotik-routeros`).
- [x] S2: firmware QNAP nel percorso storico. Prova vista rossa (3 casi su codice di oggi: firmware = uname, SSH nullo che cancella l'SNMP), poi `devices/nas/qnap-versione.ts` (`getsysinfo firmver`, `/etc/version`, build), `identitaNasDaShell` ed `unisciInfoSsh` estratti puri. `kernel` resta in `nas_inventory.ssh.kernel`.
- [ ] S2, in locale: su un QNAP QTS vero leggere `getsysinfo firmver`, `/etc/version` e la build, e confrontare col firmware mostrato (formato `X.Y.Z build AAAAMMGG` ipotizzato dal donatore `qnap.py:193`, non visto su apparato).
- [x] C0.1-2: `acquisition/catalogo.ts` è l'elenco unico (id, versione, descrittore con credenziali, sezioni, allowlist, modelli collaudati); enum dell'input, enum dello snapshot, `COLLECTORS` e allowlist dei trasporti ne derivano; `collector_version` ora per collector (semver). `comandi.ts` foglia con le tre allowlist. 85 prove del modulo verdi (79 + 6 nuove, una vista rossa).
- [x] C0.3: sezioni opzionali `system`, `host_storage`, `software`, `services`, `security` (`sistema-schema.ts`); capacità e conteggi come stringhe decimali; snapshot 1.0 già prodotti restano validi; redazione che non tocca i conteggi.
- [x] C0.4: trasporti. SNMPv3 (`input.snmp` con `version: "3"`) aperto solo da `apriSessioneSnmp`; opzioni incoerenti = errore prima della rete (`SNMP_V3_OPTIONS_INVALID`), chiavi v3 redatte. WinRM: `input.winrm` + `createWinrmReader` su `devices/winrm-run.ts`, solo script a id fisso del descrittore (`script_winrm`, vuoto finché non c'è il collector `windows`), solo codici d'errore, lotto fermato dopo errore di rete/auth. Nessun collector li usa ancora.
- [ ] C0.4, in locale: SNMPv3 authPriv contro un apparato vero e WinRM contro un server di prova (nel cloud solo con moduli finti). Nota: `runWinrmCommand` ha un suo timeout di 120 s; lo scadere del totale non ferma il processo Python, ne smette di aspettare l'esito.
- [x] C0.5: prova di contratto comune `__tests__/contratto.test.ts` + `contratto-fixture.ts` (una fixture per collector, `Record<CollectorId,…>`: la voce mancante rompe `tsc` e la suite): snapshot valido con versione del catalogo, formato ignoto mai `ok`, senza SSH nessuna shell e sezioni solo-SSH `skipped`, trasporto guasto = `error` senza segreti e senza secondo tentativo, credenziali di altro tipo respinte per i collector API. Viste rosse: redazione spenta (4 prove cadono), fixture tolta (suite e `tsc` cadono).
- [x] C0.5, osservato (non cambiato): con uscite di formato ignoto `hp-procurve` e `hp-comware` danno `interfaces: error`, mentre `qnap-switch` dà `partial`; entrambi non sono `ok`, ma la regola del piano («partial») non è uniforme. Da decidere se allineare.
- [x] C0.6: guida «Aggiungere una famiglia» in `docs/modules/acquisition.md` (file da creare, descrittore, fixture anonimizzate, prove, modelli/firmware collaudati, trasporti).
- [x] C0.7: censimento di `devices/acquisition/registry.ts` in `docs/proposte/2026-10-22-censimento-registry-acquisizione.md`: nessun chiamante, `mikrotik.ts` mai caricato, codice morto di 282 righe; proposta di ritirarlo. **Nessun cambio**: aspetta la decisione di Riccardo.
- [ ] Decisione di Riccardo: ritirare `src/lib/devices/acquisition/` (C0.7)? Allineare `interfaces` a `partial` sui formati ignoti HP?
- [x] C1, solo proposta: tavola grafica `docs/proposte/2026-10-22-collector-interfaccia.html` (15 oggetti numerati, 5 stati distinti per segno e luminanza, resa verificata con Chromium a 1280 e 390 px, senza scroll orizzontale) e schema fisico `docs/proposte/2026-10-22-collector-snapshot-schema.md` (`acquisition_sources`, `acquisition_snapshots`, chiave `acquisizione_modulare.attiva`, rotte e prove previste). Nessuna rotta, tabella o schermata scritta.
- [x] Riccardo (22/10): tavola C1 approvata con correzioni (piano §7): acquisizione normale con un altro formato, i dati popolano l'apparato (C1+C2 insieme, niente «Applica»), fonte automatica, 5 righe, «anteprima» finché C2 non è chiuso. Tavola pubblicata: https://claude.ai/artifact/RNgNG1UYmXfk1WfXFTSwZE
- [x] Cancello di fine perimetro (22/10, cloud): `npm run lint` exit 0, `npx tsc --noEmit` exit 0, `npm run build` exit 0, prove del modulo 117/117. `npm test` exit 1 con 4956 pass e **1 fallita non nostra**: `db-facade-ratchet.test.ts` («db.ts definisce 265 funzioni, la soglia è 262»); `src/lib/db.ts` è identico a `origin/dev`, quindi la fallita arriva da `dev` (sessione MikroTik/scheda): serve alzare la soglia o spostare le funzioni in `db-tenant.ts`.
- [ ] Da fare in locale (Riccardo): decisioni sulla tavola C1 e sul censimento C0.7; prova S1 con viewer/admin su un router; prova S2 su un QNAP QTS; SNMPv3 e WinRM veri; la fallita del ratchet `db.ts`; unione in `dev` e rilascio (qui non c'è stato `version:release`: lo bumpa chi unisce).
- [x] Giro cloud 2 (22/10): C1 + C2 insieme. Merge di `origin/dev` (`ddaf7710`; conflitti in CONTEXT e `mikrotik-guardia.ts`, tenuti entrambi). `db-facade-ratchet` ancora rosso per funzioni di `dev` (265 contro 262): non nostro, le funzioni nuove stanno in `db-tenant.ts`.
- [x] C1.3 schema (`987a6531`): `acquisition_snapshots`, `acquisition_source_choices` (solo la scelta del caso dubbio), `acquisition_changes`; CREATE idempotenti in `TENANT_SCHEMA_SQL`; retention D5; interruttore spento di default.
- [x] C1.1-2 aggancio (`8c59c6ef`): il pulsante di sempre (`POST /api/devices/[id]/query`) legge col collector se l'interruttore è acceso e il prodotto ne ha uno; fonte ricavata, una credenziale per protocollo dai binding, un tentativo solo, lucchetto; spento = percorso di sempre (prova sul sorgente e sulle dipendenze).
- [x] C2.1-2.5 proiezioni e applicazione (`e1bf0437`): `switch_ports` per campo, vicini e fatti con fonte `collector`, manuale che vince sull'host, una transazione, T1 identica (prova con controprova).
- [x] Revisione indipendente del diff C1/C2: un bloccante (porte abbinate per indice prima del nome → dati sulla porta sbagliata) e due da correggere (snapshot rifiutato senza traccia; password di sole cifre trovata in `speed_bps`), corretti in `95c1e89e` con prove viste rosse.
- [x] C1.4 rotte (`274a70ca`): riquadro (sessione), scelta della fonte (admin), scarico JSON (admin, in ATTESI), interruttore.
- [x] C1.5 schermata (`7868442b`): riquadro in Gestione sotto «Credenziali», finestra del caso dubbio, interruttore in Impostazioni → Sistema; resa con dati finti a 1280 e 1920 (8 varianti, nessuno scroll orizzontale).
- [x] Cancello di fine C2 (22/10, cloud): `npm run lint` exit 0 (0 errori), `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npm test` exit 1 con 5167 pass e **1 fallita non nostra**: `db-facade-ratchet` («265 funzioni, soglia 262»; `src/lib/db.ts` identico a `origin/dev`). Al primo giro cadeva anche «I33 fuori dal giro» (guardia sul sorgente: le chiamate a `upsertNeighbors` devono dichiarare la fonte): aggiunto `collector` all'elenco delle fonti dichiarate della prova.
- [ ] **Da provare in locale (Riccardo):** acceso l'interruttore, «Aggiorna» su un HP della sede nuova (ProCurve, Comware, e l'«ArubaOS»: se il sysDescr dice AOS-CX non c'è collector e resta l'acquisizione di sempre); guardare nel riquadro cosa è cambiato e controllare porte, vicini e firmware nella scheda. Poi spegnerlo e verificare che «Aggiorna» torni come prima.
- [ ] **Da misurare in locale:** su una copia del DB dell'hub, applicare uno snapshot vero a uno switch già letto dal percorso di sempre e spiegare ogni riga di `acquisition_changes` (soprattutto porte «tolte» e «aggiunte»: i nomi SSH e SNMP delle porte possono differire).
- [x] Riccardo (22/10): decisioni (a)-(f) di fine giro 2 come proposte (piano §7, «Fine giro 2»): (a) giri pianificati non riscrivono le colonne del collector, (c) `collector` prova di ruolo, (e) bulk-scan salta i dubbi, (b)(d)(f) nessun cambio.
- [x] Ratchet `db.ts` rosso: già sistemato su `dev` da un'altra sessione (`df2e7dc3`), verde il 22/10.
- [x] Giro cloud 3 (22/10): merge di `origin/dev` (`7b97fc1f`, conflitto solo in CONTEXT §6, tenute le voci di entrambi).
- [x] (a) giri pianificati (`cba44003`): `cron/jobs.ts` passa da `scriviPorteDelGiro` (`acquisizione-modulare/giri.ts`). Acceso + collector + snapshot non in errore che ha scritto le porte: i campi che la proiezione scrive da quello snapshot (per porta) restano del collector, il giro scrive MAC per porta e il resto; le porte che solo il collector conosce restano. Spento, «classica», nessuno snapshot: `upsertSwitchPorts` come oggi. Prova vista rossa (il giro rimetteva «100/1000T» sopra «1000 Mbps»).
- [ ] (a), nota: `POST /api/networks/bulk-scan-devices` (ARP dei router dalla pagina Reti) scrive ancora con `upsertSwitchPorts`: non è un giro pianificato, lasciato com'è. Da decidere se allinearlo.
- [x] (c) `collector` in `leggeViciniDiRete` (`551c7da9`): prova vista rossa, topologia 916/916, T1 non lo legge.
- [x] (e) scansione in blocco (`acfb6fb8`): i dubbi si saltano prima del test delle credenziali, vanno in `skipped_devices` e nel nuovo elenco `dubbi`, con una frase nel messaggio. Spento = nessun salto.
- [x] C3 `qnap-nas` (`8d9e4c93`), con l'infrastruttura comune: `ssh_modo` nel descrittore (`console`/`exec`/`exec_per_comando`; Comware lo dichiara), uscita 127 = non supportato, `costruzione.ts`, `linux-parsers.ts`, sezione opzionale `shares`.
- [x] C3 `mikrotik-routeros` (`6eb216fe`): riusa i parser della scheda MikroTik; PoE solo da `poe-out-power` (mutante «tensione come potenza» visto rosso), `vlan-ids` con intervalli, monitor per colonne, errori di RouterOS su stdout. `parseRouterOsDurationSeconds` spostata in `devices/routeros-durata.ts` (router-client la riesporta) perché il core dei collector non importi il DB: prova nuova sugli import.
- [x] C3 `windows` (`64552015`): otto script PowerShell nell'allowlist WinRM, busta JSON, mai `Win32_Product`, Hyper-V col GUID (sezione opzionale `guests`), Defender/firewall senza riassunti. Prova di contratto generalizzata alle credenziali non SSH.
- [x] C3 `linux` (`7e3c493e`) e `synology-nas` (`8f91c919`).
- [x] Tutti e cinque **non collaudati** (versione `0.1.0`, `collaudo: non_collaudato`), fixture con la forma documentata e dati inventati, **non agganciati al riconoscimento del prodotto** (`riconosci.ts`): si usano dalla CLI. Motivo: le proiezioni scrivono `switch_ports` da `interfaces` per qualunque apparato; un NAS o un server non deve avere porte da switch. Da decidere prima dell'aggancio: proiezione delle porte solo per le famiglie switch/router.
- [x] Cancello di fine giro 3 (22/10, cloud): `npm run lint` exit 0 (0 errori, 65 avvisi), `npx tsc --noEmit` exit 0, `npm test` exit 0 (5336 prove, 5333 pass, 0 fail, 2 saltate, 1 TODO), `npm run build` exit 0. Prove del modulo dei collector 176/176.
- [ ] **Da provare in locale (Riccardo), collector nuovi dalla CLI** (`scripts/acquire-device.ts`, sola lettura), uno per famiglia:
  - `qnap-nas` su un QNAP QTS (e uno QuTS hero se c'è): firmware e build, `smb.conf`/`qpkg.conf` nei percorsi attesi, `ip`/`df -i` di BusyBox;
  - `mikrotik-routeros` su un CRS con PoE e su un CCR: monitor ethernet e PoE, tempi con molte interfacce, più canali exec sulla stessa connessione;
  - `windows` su un Windows Server 2016/2019/2022 con Hyper-V e su un client: gli otto script su PowerShell 5.1, forma vera degli array, tempi;
  - `linux` su un Debian/Ubuntu e su un RHEL: `systemctl show '*.service'`, LVM senza root;
  - `synology-nas` su una DSM 7: quale forma di `synoshare` risponde, `smb.share.conf`, `/var/packages/*/INFO`.
  Dopo il collaudo: modello e firmware in `collaudati`, `collaudo: "collaudato"`, versione `1.0.0`.
- [ ] **Da provare in locale, (a) ed (e):** interruttore acceso, uno switch HP acquisito col collector, poi un giro ARP pianificato (o «Esegui ora»): velocità, duplex, VLAN e stato STP devono restare quelli del collector, i MAC per porta aggiornati. Spento: il giro torna a scrivere tutto. Scansione in blocco con uno switch HP senza indizi (due collector possibili): saltato ed elencato, gli altri acquisiti.
- [ ] Etichetta «anteprima» nel titolo: si toglie a fine C2, dopo le prove in locale (Riccardo).

## 2026-10-21 — cose aperte dopo la notte del 20→21/10

Prompt: `~/.claude/prompts/da-ipam-sonde-e-aperti-2026-10-21.md`.

- [x] 0b. Riccardo: committarle. agentation 3.1.2 (devDependency, montato solo con `NODE_ENV=development`); tutti i percorsi d'installazione usano `--include=dev`. `agent/` tolto (solo un egg-info dell'agente rimosso). lint + build + tsc verdi.
- [x] 0. Albero: ci sono ancora le righe non committate di `agentation` (`package.json`, `package-lock.json`, `src/app/layout.tsx`) più `agent/` (solo `da_invent_agent.egg-info`, residuo dell'agente tolto). Non si mettono in stage; chiesto a Riccardo di chi sono.
- [x] 1. VM 103 `79993-ipam-2` (PVE di casa), letta: accesa, `onboot: 1`, tag `da-appliance`; **manca la tabella nft `inet dalink`** e **UFW non è installato** → R5 rosso. In ascolto su tutte le interfacce: 53 (solo IP NetBird), 80, 443, 3001, 4443, 5355, 8080, 8443, 10050, 10051, 1514/1515, 514, 6443, 51820.
- [x] 1b. Riccardo: togliere, dischi compresi (21/10). Revocata in DA-Link (oggetto 12: nodo NetBird, bridge 18, chiave Zabbix, token; prova a vuoto poi `--applica`, uscita 0), `qm destroy 103 --purge --destroy-unreferenced-disks` (0 dischi `vm-103-` rimasti su ZFS-LARGE). `dalink verifica` dopo: **verde**. Nota: alle 09:41 una sessione dell'immagine (worktree `deploy-appliance-immagine`) la stava ancora usando; Riccardo ha deciso di procedere.
- [x] 1c. Perché aveva le porte aperte: `dalink-firewall.service` saltato (`ConditionPathExists=/etc/dalink/firewall.env`). Il primo avvio dell'immagine (`primo-avvio/fasi/netbird.sh`, ramo `claude/appliance-immagine` di Deploy-Appliance) fa solo `netbird up` e **non chiama `scripts/dalink/prepara-netbird.sh`**, che scrive `firewall.env` e accende il servizio; l'installatore classico (`Deploy-Appliance/lib/netbird.sh`) invece lo chiama. In più l'immagine non ha UFW. Vale per ogni appliance nata dall'immagine.
- [x] 1d. Corretto dalla sessione dell'immagine in Deploy-Appliance `15bc3bb` (ramo `claude/appliance-immagine`): la fase netbird lancia `prepara-netbird.sh --applica --edge si|no` prima di `netbird up` e anche a macchina già in NetBird; script assente o uscita ≠ 0 = fase ferma; prova `tests/test_fase_netbird_firewall.sh` vista rossa prima. La stessa sessione si occupa di DALINK_TOKEN perso alla riconfigura e del firewall nell'esito. Nessun'altra appliance da immagine in esercizio.
- [x] 2. Stato rifotografato il 21/10: la **150 è di nuovo accesa** (al momento del prompt era spenta), 151 spenta, 152 non esiste più.
- [x] 2b. Riccardo: riaccendere anche la 151. Accesa alle 09:46, agente QEMU risponde su 150 e 151; in DA-Link `70175-ipam` (oggetto 1) è connesso, segnale delle 09:44. DA-Link non le associa una sonda dell'hub: il bridge 7 di DA-Vul-can resta da guardare.
- [x] 3. Annotato: da-invent (192.168.4.8) scarica male da internet (dettaglio in `DA-Vul-can/TASKS.md`).
- [x] 4. Ramo `sonde-integrate-20261020`: **già in `dev`** (merge `8c00134e`, il ramo non ha commit fuori da `origin/dev`); il quadro di «Cosa esce» ha `altri_flussi.edge`. Resta da guardarlo reso a schermo.
- [x] 5. Proposta d'interfaccia delle tappe 3-5 scritta: `docs/proposte/2026-10-21-tappe-3-5-interfaccia.md` (10 oggetti per la finestra, 4 per il wizard, 3 per la classificazione, 3 domande).
- [x] 5a. Riccardo (21/10): tetto 3 tentativi Windows/AD; credenziale già fallita esclusa e detta; creazione ammessa senza credenziale provata, con avviso. Scritto nella proposta.
- [x] 5b. Tavola grafica https://claude.ai/artifact/Bau7xtUrykchk2EsNQLPXZ, impostazione approvata (21/10); voci dei menu controllate sul codice (doppioni V1-V6 nella proposta).
- [x] 5c. Riccardo (21/10): V3 tre unioni, V4 ruoli dei server, V5 stampanti/storage/modem unite; conversioni senza cautele (hub e DTS sono di prova); esecuzione qui, un agente per tappa, livello leggero.
- [x] 5d. Piano `docs/superpowers/plans/2026-10-21-tappe-3-5-rendi-apparato.md`: T1 catalogo+ruoli+migrazione · T2 classificazione unica · T3 ricerca credenziali · T4 finestra · T5 scheda/liste/wizard · T6 chiusura.
- [x] 6. `CONTEXT.md` da 19 617 a ~10,5k caratteri; il testo integrale del 21/10 mattina in `docs/storia/CONTEXT-diario-ottobre-2026.md`. Il vecchio §9 è confluito nel §8 e nel diario (nessun file lo citava).
- [x] 7. Etichetta DTS: sull'appliance DTS (`ssh dts`, tenant 71734) la rete 1 è **già** «LAN BASE 172.16.0.0/17», aggiornata il 20/10 alle 20:13 italiane. Niente da scrivere in DA-IPAM. Il /18 sta nei **report storici di DA-Vul-can** (`reports.edge_scan_label` fissato all'upload, luglio-ottobre; `edge_scan_cidr` è sempre /17).
- [ ] 7b. Riccardo (21/10): strada A, i documenti di DA-Vul-can mostrano il CIDR vero (`edge_scan_cidr`), lo storico non si tocca. Passata alla sessione DA-VULCAN 21-10.
- [x] 8. Valutazione scritta: `docs/proposte/2026-10-21-dati-ad-verso-vulcan.md`. L'export `domarc-ad-health` esiste già in DA-IPAM, manca il lettore in DA-Vul-can; il ramo `feat/ad-health-ingest` non esiste in nessuno dei due repo. Consiglio: prima caricamento a mano + lettore, poi consegna via edge.
- [ ] 8b. Riccardo (21/10): **invio diretto da DA-IPAM all'hub, come fa la sonda edge**, più un **report dell'inventario degli oggetti rilevati** per un'analisi completa. DA-Vul-can sta già facendo un'integrazione in una sessione separata: chiesto a DA-VULCAN 21-10 il contratto (endpoint, autenticazione, formato). Risposta: lo scrive lei in DA-Vul-can `docs/superpowers/specs/2026-10-21-ad-sicurezza-e-documento-direzione-design.md`, sezione «Contratto per DA-IPAM»; **niente codice in DA-IPAM finché Riccardo non approva la specifica** (DA-VULCAN manda percorso e commit).
- [x] 5e. Eseguito il 21/10 con un agente per task: T1-T5 + correzioni della revisione finale + tendina «SNMP aggiuntivo» (persa in T4, ritrovata da una prova). v0.9.815-820 su dev; hub aggiornato alla v0.9.820 (16:27), conversione `classificazioni_v21` fatta (47 host, 13 apparati). Visto a schermo a 1440 su copia del DB dell'hub.
- [x] 5f. DTS: segno `classificazioni_v21` done (29 host, 2 apparati), alla v0.9.819 alle 16:11, la 820 arriva col timer.
- [x] 9. Export AD (`lib/ad/health/export.ts`), chiesto da DA-VULCAN: (a) `diagnostic: true` esplicito nel raw_json dei diagnostici; (b) DA-A-DomainScore con gravità e CVSS allineati. Collaudo sull'hub DA-Vul-can (21/10, esecuzione 9): (b) verificata, Critical/CVSS 10; (a) non visibile, perché l'esecuzione non ha diagnostici (la copre la prova). File di collaudo cancellato.
- [ ] 10. Invio diretto AD + inventario all'hub DA-Vul-can: il contratto delle rotte `/api/ipam/*` arriva dopo l'approvazione del piano A2 di DA-Vul-can (Riccardo). Fino ad allora niente codice qui.

## 2026-10-21 — Collector modulari QNAP

Piano: docs/superpowers/plans/2026-10-21-collector-modulari-qnap.md

- [x] Piano e controllo completo approvati; lettura regole e identificazione iniziale.
- [x] Spec e piano registrati; esecuzione locale senza push/deploy.
- [x] Contratto e parser con prove.
- [x] Trasporti limitati, registry e collector QNAP QSS.
- [x] CLI e adapter senza DB.
- [x] Collaudo reale: identità/porte/VLAN/FDB/LLDP/STP/LAG/sensori; IP/ARP errori espliciti e PVID non osservato.
- [x] 32 prove mirate/SNMP verdi, lint senza errori e typecheck/build verdi; manuale e ADR 0024.
- [x] Difetti scoperti e corretti: timeout durante output lungo, STP ruolo/stato scambiati, errore IP escluso dal risultato globale, fonti SNMP attribuite senza credenziali.
- [x] Commit locali selettivi e verifiche conclusi; nessun push/deploy.
- [ ] Rinviato: aggancio persistente/UI in DA-IPAM, altri firmware, LLDP esteso, PoE, API e SNMPv3; non approvati in questa tappa.
- [x] Trappola rilevata e gestita: SSH solo shell, SNMP per tabella; timeout di inattività + termine totale per output lungo.

## 2026-10-21 — Collector HP ProCurve / ArubaOS-Switch

Estensione richiesta da Riccardo, stesso contratto e perimetro locale della tappa QNAP.
Piano: docs/superpowers/plans/2026-10-21-collector-procurve.md

- [x] Lettura contesto e stato: working tree pulito; SNMP identifica Aruba 2540 JL357A.
- [x] Campioni read-only acquisiti con operator: porte/VLAN/LLDP dettagliati, STP, LAG, PoE e ventole.
- [x] Parser ProCurve e profilo console con regressioni QNAP; 46 prove verdi.
- [x] Collector hp-procurve, registry e adapter comuni; risorse/ambiente opzionali compatibili con QNAP.
- [x] Collaudo reale con 52 porte fisiche, 48 PoE, 24 VLAN e LLDP dettagliato; nessun segreto nell’output.
- [x] 47 test, lint senza errori e typecheck/build verdi; documentazione aggiornata.
- [x] Commit locali del 2540 e verifiche conclusi; nessun push/deploy.
- [ ] Rinviato: singole istanze MST, sensori numerici temperatura/RPM e altri modelli/firmware, non collaudati.

- [x] Difetto scoperto nel pager HP: “next line: Enter” incollato alla riga seguente perdeva una porta PoE e altre righe. Fix e prova vista rossa→verde; controllo dei conteggi per FDB/VLAN/LLDP.

- [x] Secondo apparato identificato HP J9850A 5406R zl2; raccolta modulare riuscita con lo stesso collector.
- [x] Modulare collaudato: 132 entità fisiche, 6 moduli osservati; interfacce/PoE predisposti senza modulo osservato marcati, non cancellati.

## 2026-10-21 — Collector Comware

Seguito richiesto da Riccardo dopo HP modulare: profilo separato, stesso JSON/CLI, sola lettura, niente push/deploy. Credenziali solo nel vault.

- [x] Identificato IRF HPE 5700, Comware 7.1.045 Release 2432P06; campioni display acquisiti.
- [x] Parser/collector hp-comware e profilo SSH exec; risorse per membro, 63 prove verdi (QNAP/HP/Comware/SNMP).
- [x] Collaudo reale completato: 4 membri IRF, 29 VLAN, 94 LLDP, 42 LAG, 12 temperature, 8 ventole/8 PSU; snapshot parziale esplicito per timeout SNMP. Lint/typecheck/build verdi, manuale aggiornato.

- [x] Difetto temperatura: nome «hotspot 1» contiene uno spazio; regressione vista rossa→verde.
- [x] Diagnostica preliminare: timeout 8 s con canali aperti bloccava il batch; una lettura corretta, poi exec separati con chiusura e stop su trasporto guasto.
- [ ] Rinviato: Comware 5/altri firmware, PoE abilitato, ottiche DOM/IPv6 e integrazione persistente; fuori dai casi collaudati.

- [ ] Comware: completare ifTable/ifXTable/ENTITY con strategia SNMP misurata; a 15 s anche blocchi 50 restano parziali (dati preservati, 307 entità osservate). Nessun inventario completo dichiarato.

- [x] Chiusura locale: 63 test, lint (0 errori/69 avvisi preesistenti), typecheck e build verdi; controllo segreti/permessi, compatibilità JSON QNAP/modulare e documentazione. Commit selettivo senza push/deploy.

## 2026-10-21 — Collector VMware ESXi diretto

Piano: `docs/superpowers/plans/2026-10-21-collector-vmware-esxi.md`; estensione richiesta da Riccardo, stesso perimetro locale senza push/deploy.

- [x] Working tree pulito e regole lette; preflight API identifica HostAgent ESXi 8.0.3, impronta TLS e credenziali solo nel vault.
- [x] Trasporto SOAP, contratto e collector con proprietà selezionate, CA/pin TLS, sessione singola e logout.
- [x] 76 prove verdi; CLI reale: 18 VM/8 datastore confrontati con riferimenti host, 30 vNIC/32 dischi/4 snapshot, 4 pNIC/2 vSwitch/12 portgroup/2 VMkernel e 59 sensori.
- [x] Lint (0 errori/69 avvisi preesistenti), typecheck e build verdi; manuale e contesto aggiornati, nessun push/deploy. Commit locali selettivi.

- [x] Regressioni viste rosse→verdi: type/xsi:type confusi cancellavano i riferimenti VM/datastore; logout vuoto; route come array diretto, pNIC per key e nome rete guest distinto da MoRef.
- [ ] Rinviato VMware: LLDP/CDP/ARP, ruoli VMkernel, policy vDS/vCenter/cluster, altri ESXi e aggancio UI/DB; questa tappa legge solo il singolo host.

## 2026-10-21 — Collector NetApp ONTAP / MetroCluster

Piano: `docs/superpowers/plans/2026-10-21-collector-netapp-ontap.md`; stesso perimetro locale dei collector, nessun push/deploy.

- [x] Working tree pulito; preflight e login REST riusciti su ONTAP 9.16.1P11, credenziali e pin nel vault.
- [x] Trasporto GET limitato e collector/schema storage/MetroCluster, stato per sottocollezione, byte esatti.
- [x] 87 prove verdi e CLI reale: storage ok, nodi/DR distinti, 36 dischi locali e 36 remoti, nessun segreto nel JSON.
- [x] Lint senza errori, typecheck/build verdi; manuale/ADR/consegna e contesto aggiornati, commit locali senza push/deploy.

- [x] Richiesta successiva: analisi vCenter per costruire il modello. Prova locale riuscita con 13 host/431 VM/38 datastore/5 cluster/2 DVS/21 DV portgroup, snapshot nel vault/dossier privato.
- [x] Consegna richiesta per l’agente DA-IPAM in `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`; modello e criteri di correlazione, separazione da installazione/persistenza ancora da eseguire.
- [x] Difetti scoperti: XML grande oltre limite entity parser; test rosso→verde con DTD sempre rifiutati. Proprietà derivate vCenter InvalidProperty: prototipo legge configurationEx e defaultPortConfig, selezione nel parser.
- [x] Analisi privata: 8 correlazioni NFS univoche su 25, 17 non correlate; dati identificativi restano nel dossier clienti, vista aggregata separata.
- [ ] Rinviato: profilo vCenter di prodotto, schema/anteprima/UI/importazioni dev, cluster ONTAP remoto diretto, mapping VMFS→LUN e rete fisica. Nessuna attivazione implicita.

- [x] Pacchetto `~/Documents/DA-IPAM-collector-e-modello-20261021.tar.gz`: 35 file, manifest con hash/commit, codice/test/manuale/consegna; nessun inventario o credenziale. Verificati hash e contenuto. Vista aggregata Canvas con typecheck verde.

## 2026-10-22 — giro 4 dei collector

- [x] Trovati nel `dev` locale di Riccardo due commit non pubblicati (`6395bfa9`, `6bf94155`): profili collaudati `unifi-controller`, `synology-dsm`, `qnap-nas`, `mikrotik-routeros`, `ubiquiti-device`, `proxmox-ve`, su base di prima di C0. Pubblicati sul ramo `collector-locali`.
- [x] Giro cloud 4 (leggero, cloud): merge di `dev` e `collector-locali`; un collector per famiglia sul catalogo unico; porte solo per switch/router; aggancio al riconoscimento; `bulk-scan-devices` allineato; manuale con stato di collaudo.
  - `qnap-nas`, `mikrotik-routeros`, `synology-dsm`: base collaudata (motore d'inventario); dal giro 3 solo firmware QNAP vero, condivisioni e pacchetti NAS, velocità/PoE/FDB/STP/stato MikroTik, modello e seriale Synology da SSH. `synology-nas` e i due collector paralleli sono tolti. `ubiquiti-device`, `proxmox-ve`, `unifi-controller` nel catalogo (credenziale `unifi` solo per la CLI).
  - Corretto nel motore collaudato: vicini e bond su un'uscita illeggibile erano `ok` con lista vuota, ora `partial` (la prova di contratto lo ha visto).
  - **Da provare in locale, su apparati veri** (tutto ciò che è «dal giro 3» non è mai stato visto su un apparato): QNAP NAS (firmware da `getsysinfo firmver`/`/etc/version`, condivisioni, QPKG); Synology (condivisioni, `synoshare --enum` o `-enum`, pacchetti INFO, modello da `/proc/sys/kernel`); MikroTik su un router e su un CRS con PoE (monitor ethernet, PoE, `bridge host`, STP per porta, oper/admin dalle bandiere); Ubiquiti: SSH da correggere, finora solo SNMP; Proxmox con credenziale `ssh` dell'archivio (non `local_ssh`) con l'interruttore acceso; poi premere «Aggiorna» su un NAS e verificare che l'apparato non riceva porte da switch.
  - **Decisioni aperte per Riccardo**: (1) `unifi-controller` NON è agganciato al pulsante: nessuna regola chiara (una console non è un apparato; serve una scheda o un'anagrafica «controller»). (2) `linux` e `windows` non sono agganciati perché non collaudati. (3) Proxmox con l'interruttore acceso e credenziale `ssh` sostituisce il Scan Proxmox storico (API :8006 + VM/CT): le VM non si importerebbero finché non si sceglie «classica» nella tavola della fonte; da decidere se il collector deve restare solo-hypervisor in sola lettura accanto allo scan. (4) VLAN MikroTik: il collaudato legge solo la membership corrente (`current-*`), il giro 3 ripiegava sulla configurata.

## 2026-10-21 — Collector dedicati NAS e Proxmox (seguito multivendor)

Livello Base, sola lettura e sviluppo locale; accessi NAS confermati da Riccardo, Proxmox da vault locale. Niente push/deploy o DB.

- [x] Identificati tre NAS raggiungibili e target Proxmox documentato; accessi/campioni solo nel vault. Quarto NAS irraggiungibile al preflight, collaudo rimandato.
- [x] Estratte letture/parser da nas-acquisition e Proxreporter/Proxmox, senza DB, cron o installazioni remote.
- [x] Aggiunti profili Synology DSM, QNAP NAS e Proxmox VE nello stesso contratto/CLI; manuale e consegna aggiornati, copertura parziale dichiarata.
- [x] 22/10: 123 prove verdi, lint 0 errori/69 avvisi storici, typecheck/build verdi; campioni reali e controllo segreti, commit locale selettivo.
- [x] MikroTik RouterOS: profilo dedicato, router 12 e switch 7 interfacce, VLAN/bridge/ARP/rotte/vicini; campioni e credenziali solo nel vault.
- [x] Ubiquiti diretto: profilo SNMP/SSH dedicato, AP con 13 interfacce SNMP; SSH rifiutata (auth_failed), tentativi fermati. Altro switch non acquisito per mancata risposta. Controller già collaudati; offline non equivale a rimosso.

## 2026-10-22 — UniFi controller, prima tappa multivendor

- [x] Collector `unifi-controller` integrato nel contratto/registry/CLI; riuso del client read-only e parser senza DB.
- [x] 90 prove verdi, typecheck verde; CLI su entrambi i controller, 17 e 11 apparati, pin conservati negli input del vault e segreti assenti dai JSON.
- [x] Lint (0 errori/69 avvisi preesistenti), typecheck, build e 24 regressioni del client UniFi verdi; commit selettivo locale, nessun push/deploy.
- [x] Prima copertura parziale degli altri cinque profili completata il 22/10; radio/client ancora da estendere.

## 2026-10-22 — Chiusura prima copertura multivendor

- [x] Allowlist statiche, sessione SSH per batch e OpenSSH locale opt-in Proxmox; errori, dati parziali e comandi unsupported distinti.
- [x] Regressione MikroTik capacità stringa→array corretta e verificata sul router reale; BigInt senza literal per target TS del progetto.
- [ ] Accesso SSH Ubiquiti da correggere/confermare: autenticazione rifiutata, nessun ulteriore tentativo automatico.
- [ ] NAS irraggiungibile da ricollaudare quando raggiungibile; vecchi NAS senza lsblk/ip JSON restano parziali, nessun tool installato.
- [ ] Estensioni future: radio/client avanzati, PoE/FDB/STP operativo completi, API native NAS/Proxmox e dettaglio dischi VM; integrazione UI/DB ancora separata.
- [x] Riccardo (22/10), fine giro 4: (1) controller UniFi = migliorare la sua sincronizzazione con più dati, non il pulsante; (2) collaudi Windows su 192.168.99.71, Linux su un nodo Proxmox o da-sftp; (3) Proxmox: prima il collector legge tutto (VM/CT) senza sostituire la scansione di oggi, intanto **fuori dal pulsante**; (4) VLAN MikroTik configurata e attiva, entrambe. Piano §7 «Fine giro 4».
- [x] Collaudi dalla CLI (22/10, sessione locale, codice `collector-modulari` a `b13894ef`, file d'ingresso del vault `collectors/`; uscite 2 = parziale, come dichiarato):
  - **QNAP .40.26** (SSH): modello TS-h765eU, **firmware 5.2.7 giusto** (non più il kernel), 17 QPKG, 6 condivisioni, memoria, RAID, 9 interfacce; `df` permesso negato con utente non root (dichiarato).
  - **QNAP .40.24** (solo SNMP): 4 dischi, 2 volumi, 19 interfacce come stanotte; **modello e firmware vuoti**: via SNMP non si leggono gli OID QNAP (`1.3.6.1.4.1.24681.1.2.x`, QTS5 `…24681.1.4`) che il profilo storico conosce.
  - **Synology .40.22**: DS723+, DSM 7.4.1, 24 pacchetti, 14 condivisioni (parziale: `synoshare` e NFS non letti senza root), 4 dischi, 4 RAID, 8 interfacce via SNMP; **difetto: il messaggio SSH «Could not chdir to home directory…» finisce nel nome host**; `ip -j` non esiste su DSM.
  - **Synology .40.23**: irraggiungibile (SSH e SNMP in timeout), come al preflight di stanotte; il suo file d'ingresso ha un blocco `api` che lo schema rifiuta.
- [x] Collaudi (22/10, pomeriggio), file d'ingresso nel vault `collectors/` (Windows e MikroTik compilati da Riccardo), Linux con la chiave di Riccardo in un ingresso temporaneo cancellato subito:
  - **Windows** `RGSERVER` 192.168.99.71, WinRM 5985: **esito ok** in 15 s. Windows Server 2022 Standard (20348), 42 programmi, 239 servizi, 1 disco, antivirus, 3 profili firewall separati, memoria, 2 IPv4, 1 scheda. Non letti: CPU, NTP, ARP, duplex (dichiarati). Non è un host Hyper-V: la sezione virtualizzazione resta da collaudare su un host col ruolo.
  - **MikroTik** `DA-RT-CORE` 192.168.15.254 (CCR2004, 7.24.5): parziale. Risorse, 8 IPv4, 1523 ARP, 33 interfacce, 12 VLAN (configurate e correnti distinte), 229 FDB, 39 vicini, RSTP su 9 porte, 3 bond. **Da correggere:** velocità/duplex non interpretati (`TERSE_FLAGS_AND_NEGOTIATED_SPEED_NOT_INTERPRETED`); PoE su un apparato senza PoE dà `FORMAT_UNRECOGNIZED_OR_EMPTY` invece di «non presente».
  - **Linux** `da-ftp` 192.168.20.14 (utente `domarc`, chiave): identità (Ubuntu 24.04.2, VM QEMU), sistema e memoria letti; **poi il lotto si interrompe** (`SSH_BATCH_ABORTED`): dischi, pacchetti, servizi, interfacce vuoti. Un comando fallito (probabilmente `timedatectl`) è trattato come guasto di trasporto.
- [ ] Giro 5: Proxmox fuori dal pulsante e collector esteso fino alla parità con la scansione di oggi; VLAN MikroTik configurata+attiva; dai collaudi: stderr/banner SSH mai nei campi (nome host Synology), identità QNAP via SNMP dagli OID enterprise, ripiego senza `ip -j` sui NAS vecchi; Linux: comando fallito ≠ trasporto guasto, il lotto continua; MikroTik: velocità/duplex dalle bandiere e dal monitor, PoE assente = non presente; poi aggancio di Windows e Linux dopo i loro collaudi.
- [x] Giro cloud 5 (leggero, 22/10): correzioni dai collaudi, Proxmox fuori dal pulsante ed esteso verso la parità, Windows e Linux agganciati (prompt, «Giro 5»).
  - **Linux/SSH a lotti** (`leggiLotto`, `transports.ts`): un comando fallito, assente, senza permesso, senza stato di uscita o oltre il limite di byte non ferma il lotto; si ferma per canale caduto, connessione fallita, tempo totale o due scadenze di fila. Prova `lotto-ssh.test.ts` (vista rossa con la lista vecchia).
  - **Synology**: stderr e «Could not chdir to home directory…» mai nei dati (`exec-reader.ts`, rossa vista); `ip -j` che esce 1 su DSM = `unsupported` con `IP_JSON_NOT_AVAILABLE_ON_DSM` + `SNMP_USED_INSTEAD`.
  - **QNAP solo SNMP**: modello, firmware e seriale da `…24681.1.2.1/2/3.0` (valori numerici o con «%» scartati). **Le varianti QTS5 (`…24681.1.4`) NON sono aggiunte**: non conosco gli OID esatti; serve uno `snmpwalk` su `.24` per scriverli.
  - **MikroTik**: tolto l'avviso «bandiere/velocità non interpretate» quando le bandiere e il monitor ethernet sono capiti; PoE senza righe `poe-out` = `unsupported` / `POE_NOT_PRESENT`. **Non so la forma vera** dell'uscita `poe monitor` su un CCR senza PoE: la prova usa una forma plausibile (solo `name:`). Se sul `192.168.15.254` resta `FORMAT_UNRECOGNIZED_OR_EMPTY`, serve l'uscita grezza.
  - **Proxmox** fuori dal riconoscimento del pulsante; il collector legge `guests` (VM e CT: stato, risorse, dischi, reti), `storage_pools`, `cluster_nodes` (nuove sezioni opzionali dello schema; due `grep -H` nell'allowlist). Tabella della differenza nel manuale: mancano dati hardware del nodo, IP delle VM (agent) e scrittura nell'inventario. L'aggancio torna solo con una tua decisione.
  - **Windows e Linux** agganciati al riconoscimento (vendor `windows`; vendor `linux` tranne hypervisor/scan_target proxmox); descrittori `collaudato`. Le porte da switch restano solo per switch e router.
  - **Non fatto**: VLAN MikroTik configurata+attiva distinte (decisione 4 del fine giro 4; il motore legge ancora solo la membership corrente).
  - **Da ricollaudare in locale**: Linux `da-ftp` (dischi, pacchetti, servizi, interfacce dopo la correzione del lotto), MikroTik `192.168.15.254` (velocità/duplex, PoE «non presente»), QNAP `.24` (modello e firmware via SNMP), Synology `.22` (nome host senza il messaggio, interfacce da SNMP senza errori `ip -j`), Proxmox da CLI (guest, storage, nodi; serve un utente che legga `/etc/pve`); poi premere «Aggiorna» su un Windows e su un Linux con interruttore acceso.
  - **Decisioni per Riccardo**: (1) Proxmox: si vuole la parità (IP VM, dati nodo, scrittura inventario) o il collector resta solo-lettura accanto alla scansione? (2) VLAN MikroTik configurata+attiva nel prossimo giro? (3) Servono gli OID QTS5 di QNAP: uno snmpwalk di `.24`.

## 2026-10-22 — ricollaudi del giro 5 (sessione locale, codice `9ef16c64`)

- [x] **Linux `da-ftp`**: lotto corretto, ora completo salvo LVM (permesso negato senza sudo, dichiarato): 3 dischi, 9 filesystem, 811 pacchetti, 64 servizi, 2 interfacce, Ubuntu 24.04.2.
- [x] **MikroTik `DA-RT-CORE` 192.168.15.254**: velocità e duplex su 12 porte su 33 (le collegate); PoE `unsupported` con `POE_NOT_PRESENT`. VLAN configurate e attive distinte (Riccardo, 22/10: «configurate e attive», entrambe).
- [x] **Synology `.22`**: nome host pulito («DA-FILES»).
- [x] **QNAP `.24` (solo SNMP): errore nuovo** — `firmware = "15979.0 MB"` (è la memoria). Gli OID `…24681.1.2.1/.2/.3` presi dal profilo storico qui sono CPU %, memoria totale, memoria libera, non modello/firmware/seriale. Walk limitato del 22/10 (QGD-1602P, valori corti, seriale mascherato):
  - modello: `1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.3.1` («QGD-1602P») e `1.3.6.1.4.1.55062.1.12.3.0`;
  - seriale: `…24681.1.4.1.1.1.1.1.2.1.4.1`; nome: `….2.1.6.1`; temperatura: `….2.1.7.1`;
  - ventole: tabella `1.3.6.1.4.1.55062.1.12.9.1` (indice `.1`, nome `.2`, giri `.3`);
  - firmware: **non trovato via SNMP** su questo modello → resta `null`, mai un valore preso da un altro OID.
- [x] Giro 6: identità QNAP via SNMP dagli OID sopra (con prova che un valore «… MB» o «… %» non diventa mai firmware/modello); stessa verifica sul **profilo storico** `scanner/snmp-vendor-profiles.ts` (`id: "qnap"`), che usa gli stessi OID sbagliati e oggi, su `dev`, può scrivere la memoria come firmware: correzione da portare anche su `dev`.
- [x] Giro 6: Proxmox fino alla parità (dati hardware del nodo, IP delle VM dall'agent, VM nell'inventario come fa la scansione). **Aggancio al pulsante: decisione di Riccardo**, tabella nel manuale (`docs/modules/acquisition.md`).
- [x] Riccardo (22/10): giro 6 sì; il profilo storico QNAP si corregge sul ramo e arriva su `dev` con l'unione.
- [x] Giro cloud 6 (leggero): QNAP via SNMP con gli OID giusti (collector e profilo storico), Proxmox fino alla parità (prompt, «Giro 6»).
- [ ] **Da ricollaudare in locale (giro 6)**: (1) QNAP `.24` solo SNMP: attesi modello `QGD-1602P`, firmware assente (`null`), seriale, temperatura e ventole; nessun «MB» o «%» nei campi. (2) Profilo storico `qnap` su un hub vero: dopo l'avvio la riga builtin ha i nuovi OID (una scansione di un QNAP non scrive più la memoria come firmware). (3) Proxmox da CLI con un utente che legga `/etc/pve` e il rapporto del nodo: nodi con CPU/kernel/disco root/seriale/abbonamento, VM accese con IP dall'agent; con un utente senza permessi attesi i codici `NODE_*_NOT_READ`. (4) Con interruttore acceso, applicare lo snapshot Proxmox a un apparato e confrontare `last_proxmox_scan_result` con quello della scansione di oggi (nodi, VM, IP).
- [ ] Decisione di Riccardo: agganciare `proxmox-ve` al pulsante? Differenze rimaste: schede di rete dei nodi (non proiettate), socket/core delle VM (`sockets` = 1).
- Nota del giro 6: il `v0.9.871` del giro 5 non è stato rialzato; il merge di `origin/dev` ha portato `VERSION` a 0.9.873 (versione di `dev`).
- Cancello del giro 6 (commit 07a4944e): lint=0, tsc=0, npm test=0 (DA_INVENT_DATA_DIR temporanea), build=0.

## 2026-10-22 — collaudi del giro 6 (sessione locale, codice `7e0b83a2`)

- [x] **QNAP `.24`** (solo SNMP): **corretto** — modello QGD-1602P, seriale letto, firmware `null` (non più la memoria), 6 sensori, 19 interfacce.
- [x] **Proxmox DA-PX-04** 192.168.40.4, root con la chiave di Riccardo (ingresso temporaneo cancellato): 76 s, parziale. Cluster visibile intero: 4 nodi (CPU, socket, core, kernel, disco root, abbonamento attivo), 52 guest (stato, risorse, dischi, reti; agent su 44), 28 storage, 34 interfacce.
- [ ] **Proxmox, mancano per la parità**: modello/seriale/produttore hardware dei nodi vuoti su tutti e 4 (la scansione li prende dall'API); IP dei guest su 24 di 52 con agent attivo su 44 (`GUEST_IP_ADDRESSES_PARTIAL`). Da completare prima dell'aggancio al pulsante.
