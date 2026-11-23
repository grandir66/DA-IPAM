# Sonda avanzata con Zeek — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** Zeek come profilo di serie del collector di traffico, con le stesse tabelle e la stessa API di oggi, letto da IPAM senza cambiare il suo modo di leggere.
**Architettura:** sulla VM Zeek scrive registri JSON che chiude ogni 5 minuti; un adattatore Python (nel servizio `collector-traffico` che c'è già) li traduce nelle tabelle dell'archivio e li cancella. `collector-ascolto` resta acceso per l'identità (ARP, CDP, LLDP) e per i controlli che Zeek non copre, scelti da un elenco unico. IPAM riceve due colonne facoltative in più e qualche tipo di fatto nuovo.
**Spec:** `docs/superpowers/specs/2026-11-23-sonda-avanzata-zeek-design.md`
**Livello di controllo:** leggero (approvato da Riccardo il 23/11/2026 con la spec). La tappa 5 della spec (utenti, zona rossa) è **fuori da questo piano**.
**Stato:** approvato · **Ultimo aggiornamento:** 2026-11-23

## Vincoli globali

- Repo DA-IPAM, ramo `dev`. **Mai push su `main`.** Rilascio a fine task che tocca IPAM: `npm run version:release -- --staged-only`, poi `git push origin dev`.
- L'albero è condiviso con altre sessioni: si mette in stage solo per nome, mai `git add -A`, mai `git reset --hard`, mai `git stash` del lavoro altrui.
- Collector: Python 3.11, **solo libreria standard**; prove `unittest` in `collector-traffico/tests/` (`python3 -m unittest discover -s collector-traffico/tests -t collector-traffico`).
- Zeek 9.x LTS, pacchetto `zeek-lts-core` dal repository del progetto `http://download.opensuse.org/repositories/security:/zeek/Debian_12/`, versione fissata in `installa.sh` (`ZEEK_VERSIONE=9.0.1-0`). Niente `zkg`, niente pacchetti aggiuntivi.
- Registri JSON (`LogAscii::use_json=T`), chiusi ogni 300 secondi (`Log::default_rotation_interval = 300 sec`), stessa finestra del collector (`archivio.FINESTRA_S`).
- **Mai su disco**: password, comunità SNMP, hash, biglietti Kerberos, nomi utente. Esclusione con `Log::Filter$exclude` dentro `collector-traffico/zeek/sonda.zeek`, **prima** della scrittura.
- Profilo: `PROFILO=avanzato|leggero` in `/etc/collector-traffico/collector.env`. Di serie `avanzato`; `installa.sh` scende a `leggero` se la VM ha meno di 2 vCPU o meno di 1900 MB di RAM, e lo stampa.
- Risorse di riferimento del profilo avanzato: 2 vCPU, 2 GB, 16 GB di disco.
- Freno sul disco: Zeek si ferma sopra il 70% del filesystem di `DATI`, riparte sotto il 50%.
- Copertura in `/v1/stato` dai contatori di Zeek (`stats.log`: `pkts_link`, `pkts_dropped`), **mai** da `capture_loss`.
- IPAM: colonne nuove solo con migrazione additiva dentro `assicuraTabelleTraffico` (`src/lib/traffico/schema.ts`), guardata da `PRAGMA table_info`; nessun CHECK. Un collector che non manda i campi nuovi = «non so», mai 0.
- Banco: VM 109 `collector-banco` sul PX-NAS (`192.168.99.1`, via diretta `root@192.168.99.1` con `HostKeyAlias=192.168.99.1`; dalla VM `root@192.168.99.89`). Snapshot prima di ogni prova, ripristino dopo. **Mai sul 72729 né su reti di clienti.** Se la VM 109 è in uso da un'altra sessione, ci si accorda prima.
- Ufficio: `DA-COLLECTOR-PX03` = VM 114 su DA-PX-03 (`root@192.168.40.3`; la VM `root@192.168.4.186`). Snapshot `qm snapshot 114 pre-<attività>-<AAAAMMGG>` prima; nel resoconto nome e nodo.
- Verifiche entro 2 minuti; la giornata intera del Task 5 gira in sottofondo, approvata da Riccardo con questo piano.
- Interfaccia: nessuna pagina nuova. Se un task richiede un cambio di layout, si propone a Riccardo prima di scriverlo.

## Casi da non dimenticare

1. **Registro letto mentre Zeek lo scrive**: l'adattatore prende solo i file chiusi (nome con la data, vedi Task 3) e salta quelli la cui ultima riga non finisce con `\n`. Task 3.
2. **Arresto a metà fra scrittura nell'archivio e cancellazione del file**: il nome del registro tradotto si scrive in `stato` (`zeek_ultimo_<registro>`) nella stessa transazione delle righe; un file già tradotto si cancella senza ritradurlo. Task 3.
3. **Connessioni lunghe**: Zeek scrive la riga di `conn` alla fine della connessione, quindi un trasferimento di ore cade tutto in una finestra. Si verifica sul banco se lo script per le connessioni lunghe di Zeek 9 c'è (`policy/frameworks/conn/long` o simile: nome da controllare con `ls /opt/zeek/share/zeek/policy`); se c'è si carica, se no si scrive nel README come limite. Task 3.
4. **Una VM sotto le risorse**: `installa.sh` scende al profilo leggero e lo dice; `/v1/stato` porta `profilo`, così IPAM non mostra «avanzato» per una VM che non lo è. Task 5.
5. **Lo stesso controllo da due fonti**: `profili.py` è l'unico posto che dice chi fa cosa; una prova controlla che ogni tipo di `TIPI_FATTO` sia coperto da esattamente una fonte per profilo. Task 4.

---

### [ ] Task 1 — `sonda.zeek` e dati di prova dal banco

**File**
- Crea: `collector-traffico/zeek/sonda.zeek`
- Crea: `collector-traffico/tests/dati/zeek/grezzi/*.log`, `collector-traffico/tests/dati/zeek/filtrati/*.log`, `collector-traffico/tests/dati/zeek/LEGGIMI.md`
- Crea: `collector-traffico/banco/cattura-zeek.sh` (gira sul nodo PX-NAS)

**Cosa fare**

`sonda.zeek` carica un elenco esplicito, non `local`:

```zeek
@load base/protocols/conn
@load base/protocols/dns
@load base/protocols/ssl
@load base/files/x509
@load base/protocols/http
@load base/protocols/ftp
@load base/protocols/snmp
@load base/protocols/modbus
@load base/protocols/smb
@load base/protocols/ntlm
@load base/protocols/krb
@load base/protocols/ldap
@load base/protocols/ssh
@load base/frameworks/software
@load base/frameworks/notice
@load policy/protocols/ssh/detect-bruteforcing
@load policy/protocols/http/detect-sqli
@load policy/protocols/ssl/validate-certs
@load misc/stats

redef LogAscii::use_json = T;
redef Log::default_rotation_interval = 300 sec;
redef HTTP::default_capture_password = F;
redef FTP::default_capture_password = F;
```

Più, in `zeek_init` con priorità -5, un `Log::get_filter` / `$exclude` / `Log::add_filter` per ciascuno: `SNMP::LOG` → `community`; `HTTP::LOG` → `username`, `password`; `FTP::LOG` → `user`, `password`; `NTLM::LOG` → `username`, `hostname`, `domainname`; `KRB::LOG` → `client`, `server`; `LDAP::LOG` (e `LDAP::LOG_SEARCH` se esiste) → i campi con l'oggetto del bind e gli argomenti (nomi esatti da leggere in `/opt/zeek/share/zeek/base/protocols/ldap/main.zeek` sulla VM; se il modulo non c'è in 9.0.1 lo si scrive nel LEGGIMI). Uno script nostro aggiunge a `snmp.log` il campo `comunita_nota: bool` (vero se la comunità è `public` o `private`), calcolato prima dell'esclusione. I moduli che Zeek 9.0.1 non ha si tolgono dall'elenco e si annotano nel LEGGIMI: il caricamento deve dare zero errori (`zeek -a sonda.zeek`).

`cattura-zeek.sh`, sul banco, con snapshot della VM 109 prima e ripristino dopo: installa Zeek, lo lancia due volte sulla stessa copia, prima **senza** filtri (cartella `grezzi`) e poi con `sonda.zeek` (cartella `filtrati`), e intanto dal contenitore 110 manda traffico di prova con valori inventati e riconoscibili: HTTP con accesso Basic `prova-utente`/`Prova-Segreto-7731`; FTP con lo stesso utente e password verso un server FTP di prova (`python3 -m pyftpdlib` o `vsftpd` nel contenitore 103, tolto dopo); SNMP v2c con comunità `comunita-di-prova-7731` e una con `public`; Modbus in scrittura (funzione 6) verso `192.168.99.221:502`; un saluto TLS 1.0 (`openssl s_client -tls1`) se il server lo accetta; DNS; una connessione rifiutata e una senza risposta. Si copiano nel repo **solo** i registri di questo traffico (filtrati per gli IP del banco), non il resto della rete 99.

`LEGGIMI.md`: cosa c'è, i valori di prova inventati, i moduli mancanti, la data della cattura.

**Interfacce prodotte:** `sonda.zeek`; i registri di prova usati dai Task 2, 3 e 4.

**Verifica:** `zeek -a collector-traffico/zeek/sonda.zeek` senza errori sulla VM; `grep -rl Prova-Segreto-7731 collector-traffico/tests/dati/zeek/grezzi` trova almeno un file; lo stesso su `filtrati` non trova niente.

**Commit:** `Sonda Zeek: script con i filtri dei campi e dati di prova dal banco`

---

### [ ] Task 2 — Prova di non-fuga

**Dipende da:** Task 1.

**File**
- Crea: `collector-traffico/tests/test_non_fuga.py`

**Cosa fare**

Prova scritta **prima** dell'adattatore e vista fallire:

```python
SEGRETI = ("Prova-Segreto-7731", "comunita-di-prova-7731", "prova-utente")
```

1. `test_i_grezzi_li_contengono`: almeno un file di `grezzi/` contiene ciascun segreto. Dimostra che la prova li saprebbe trovare.
2. `test_i_filtrati_no`: nessun file di `filtrati/` ne contiene uno, né in chiaro né in base64 (`base64.b64encode(b"prova-utente:Prova-Segreto-7731")`).
3. `test_l_archivio_no`: tradotti i `filtrati/` con l'adattatore (Task 3 e 4) in un archivio temporaneo, nessuna riga di nessuna tabella contiene un segreto. Finché l'adattatore non c'è, questa prova è marcata `skip` col motivo; si toglie lo `skip` nel Task 4.

Vista rossa: si esegue la 2 puntandola a `grezzi/` (variabile d'ambiente `NON_FUGA_CARTELLA` solo per questo controllo) e si annota l'esito nel Registro.

**Verifica:** `python3 -m unittest collector-traffico/tests/test_non_fuga.py` → verde (con la 3 in `skip`); la riga «vista rossa» nel Registro.

**Commit:** `Sonda Zeek: prova che i segreti non arrivano su disco`

---

### [ ] Task 3 — Adattatore: connessioni, DNS, TLS

**Dipende da:** Task 1.

**File**
- Crea: `collector-traffico/collector/zeek_adattatore.py`, `collector-traffico/tests/test_zeek_adattatore.py`
- Modifica: `collector-traffico/collector/piega.py` (rende pubblico `_lato` come `lato`, lasciando `_lato = lato`)
- Modifica: `collector-traffico/collector/archivio.py` (colonne `byte_ritorno`, `risposta` in `coppia`)
- Modifica: `collector-traffico/collector/__main__.py` (nel profilo avanzato il giro legge i registri di Zeek invece della cartella di `pmacctd`)
- Modifica: `src/lib/traffico/schema.ts`, `src/lib/traffico/lettura.ts`, `src/lib/traffico/__tests__/lettura.test.ts`

**Cosa fare**

In `zeek_adattatore.py`, funzioni pure, **prove prima del codice** con i registri `filtrati/` del Task 1:

```python
def leggi_registro(testo: str) -> list[dict]
    """Righe JSON; salta righe vuote e un'ultima riga senza a capo."""
def traduci_conn(righe: list[dict], reti: list[str]) -> dict
    """-> {"coppie": [...], "esterni": [...], "connessioni": [...]}
    client = id.orig_h, server = id.resp_h (lati passati da piega.lato: esterno, diffusione).
    porta = id.resp_p se < piega.PORTA_ALTA, altrimenti 0; proto da piega.numero_proto(proto).
    byte = orig_ip_bytes + resp_ip_bytes; byte_ritorno = resp_ip_bytes; pacchetti = orig_pkts + resp_pkts;
    flussi = numero di righe; risposta = 1 se resp_pkts > 0 in almeno una riga.
    esterni: stessa forma di piega.esterni (interno, ip, verso, proto, porta, byte, pacchetti, flussi), tetto per host uguale.
    connessioni: stessa forma della tabella `connessione`; conn_state S0 = senza_risposta, REJ = rifiutate,
    SF/S1/S2/S3/RSTO/RSTR = riuscite; ms_minimo e ms_mediano = -1 (Zeek non li dà: «non misurato»)."""
def traduci_dns(righe, adesso: str) -> tuple[dict, list[dict]]
    """-> (conteggi per scrivi_nomi {(visto, client, "dns", nome): n}, voci per scrivi_nomi_ip dagli `answers` A/AAAA)"""
def traduci_ssl(righe, adesso: str) -> tuple[dict, list[dict]]
    """-> nomi tipo "sni" da `server_name`, voci nome_ip per id.resp_h"""
def giro_zeek(db, cartella: str, reti: list[str], tetto_esterni: int) -> int
    """Prende i file chiusi di conn, dns, ssl in `cartella`, li traduce, scrive, li cancella.
    Il nome del file chiuso si legge sul banco al Task 1 e si fissa in NOME_CHIUSO (regex).
    Caso 1 e caso 2 del piano. Un file che non si legge va in `cartella/scartati/` e incrementa
    `stato.zeek_scartati`. Ritorna le righe scritte."""
```

`inizio` della finestra = l'ora nel nome del file chiuso meno 300 secondi, nel formato di `archivio.ora_utc`.

Archivio: `ALTER TABLE coppia ADD COLUMN byte_ritorno INTEGER` e `risposta INTEGER` (NULL di serie), guardate da `PRAGMA table_info`; `scrivi_finestra` le scrive se la coppia le porta; `leggi_coppie` le restituisce (NULL resta `null` nel JSON).

`__main__.py`: se `PROFILO == "avanzato"` il giro chiama `zeek_adattatore.giro_zeek(db, f"{DATI}/zeek", reti, tetto_esterni)` invece di leggere `in/`; il resto (sfoltire, contatori) non cambia.

IPAM: in `traffico_coppie` (e `traffico_ore` se ha la stessa forma) le colonne `byte_ritorno INTEGER` e `risposta INTEGER`, NULL di serie; `RigaCollector` le ha facoltative; sul conflitto `byte_ritorno` si somma solo se tutti e due non sono NULL, `risposta = MAX`. Nessun uso nelle regole in questo task.

Caso 3: sul banco si controlla lo script per le connessioni lunghe; se c'è, si aggiunge a `sonda.zeek`.

**Interfacce prodotte:** `giro_zeek`, `traduci_*`; le colonne nuove in collector e IPAM.

**Verifica:** `python3 -m unittest discover -s collector-traffico/tests -t collector-traffico` verde (coppie dal `conn` del banco col verso giusto, la connessione rifiutata e quella senza risposta in `connessione`, i nomi DNS e SNI, file parziale saltato, file già tradotto non ritradotto); `node --import tsx --test "src/lib/traffico/**/*.test.ts"` e `npx tsc --noEmit` verdi.

**Commit:** `Sonda Zeek: adattatore per connessioni, DNS e TLS`, poi rilascio.

---

### [ ] Task 4 — Controlli sul contenuto da Zeek e chi fa cosa

**Dipende da:** Task 2, Task 3.

**File**
- Crea: `collector-traffico/collector/profili.py`, `collector-traffico/tests/test_profili.py`
- Modifica: `collector-traffico/collector/zeek_adattatore.py`, `collector-traffico/collector/ascolto.py`, `collector-traffico/tests/test_zeek_adattatore.py`, `collector-traffico/tests/test_non_fuga.py` (toglie lo `skip`)

**Cosa fare**

`profili.py`:

```python
TIPI = ("chiaro_telnet", "chiaro_ftp", "chiaro_posta", "chiaro_http_basic", "chiaro_ldap", "snmp_vecchio",
        "smb1", "tls_vecchio", "ntlm1", "nome_conteso", "impianto_scrittura", "dns_anomalo")  # = TIPI_FATTO di IPAM
DA_ZEEK: frozenset[str]   # i tipi che nel profilo avanzato fa Zeek
def fonte(tipo: str, profilo: str) -> str   # "zeek" | "ascolto"
```

Partenza proposta per `DA_ZEEK`, da correggere con quello che i registri del banco mostrano davvero: `chiaro_ftp`, `chiaro_http_basic`, `snmp_vecchio`, `tls_vecchio`, `impianto_scrittura` (solo Modbus), `smb1` e `ntlm1` se `smb_*`/`ntlm` li distinguono, `chiaro_ldap` se `ldap` c'è. Restano ad `ascolto`: `chiaro_telnet`, `chiaro_posta`, `nome_conteso`, `dns_anomalo` e la scrittura S7. Un tipo che Zeek fa solo in parte (Modbus sì, S7 no) resta ad `ascolto` per la parte che Zeek non fa: in quel caso `ascolto` controlla solo la porta 102.

`ascolto.py`: con `PROFILO=avanzato` non esegue i controlli il cui `fonte(...) == "zeek"`; identità, connessioni e nomi da LLMNR/NetBIOS restano.

`zeek_adattatore.py`: `traduci_fatti(registri: dict[str, list[dict]]) -> list[dict]` nella forma di `archivio.scrivi_fatto` (`visto, tipo, client, server, porta, dettaglio`), con le stesse regole e lo stesso `dettaglio` di `controlli.py` (es. `snmp_vecchio` con `comunita_nota`). Lo stesso fatto fra gli stessi due host si scrive una volta l'ora, come fa `ascolto`. `giro_zeek` legge anche `snmp`, `http`, `ftp`, `modbus`, `ssl`, `smb_files`/`smb_mapping`, `ntlm`, `ldap`.

**Verifica:** `test_profili.py`: ogni tipo di `TIPI` ha una sola fonte per profilo, e `TIPI` coincide con `TIPI_FATTO` letto da `src/lib/traffico/anomalie.ts` (regex sul file). `test_zeek_adattatore.py`: dai registri del banco escono una volta sola `chiaro_ftp`, `chiaro_http_basic`, `snmp_vecchio` (con `comunita_nota` vero per `public`), `impianto_scrittura`, `tls_vecchio` se la cattura l'ha. `test_non_fuga.py` intera verde.

**Commit:** `Sonda Zeek: controlli sul contenuto dai registri, un controllo una fonte`

---

### [ ] Task 5 — Installazione, freno sul disco, stato, una giornata sul DA-PX-03

**Dipende da:** Task 4.

**File**
- Crea: `collector-traffico/zeek-collector.service`, `collector-traffico/collector/zeek_stato.py`, `collector-traffico/tests/test_zeek_stato.py`
- Modifica: `collector-traffico/installa.sh`, `collector-traffico/collector/api.py`, `collector-traffico/collector/__main__.py`, `collector-traffico/README.md`
- Modifica: `src/lib/traffico/lettura.ts` (`StatoCollector` con `profilo`, `motore`, `versione_motore`), schema e interfaccia della riga del collector

**Cosa fare**

`installa.sh`: opzione `--profilo avanzato|leggero` (di serie `avanzato`); controllo delle risorse (`nproc` < 2 o `MemTotal` < 1900 MB → `leggero`, con un messaggio); nel profilo avanzato aggiunge il repository di Zeek con la sua chiave, installa `zeek-lts-core=$ZEEK_VERSIONE`, copia `zeek/` in `$APP/zeek`, crea `$DATI/zeek` (proprietario `collector`), abilita `zeek-collector.service` e disabilita `pmacctd-collector.service`; nel leggero il contrario. Scrive `PROFILO=` nell'env. Lanciato di nuovo con un altro profilo, cambia senza toccare l'archivio.

`zeek-collector.service`: `WorkingDirectory=$DATI/zeek`, `ExecStart=/opt/zeek/bin/zeek -C -i ${MIRROR_IF} $APP/zeek/sonda.zeek`, `Restart=on-failure`, `Nice=5`, `MemoryMax=1500M`; parte solo se `PROFILO=avanzato` (`ExecCondition`).

`zeek_stato.py`, funzioni pure con prove: `copertura_da_stats(righe: list[dict]) -> tuple[int, int]` (somma `pkts_link` e `pkts_dropped` dalle righe di `stats.log`); `freno(percento_usato: float, fermo: bool) -> str` (`"ferma"` sopra 70, `"riparti"` sotto 50 se fermo, altrimenti `"niente"`). `__main__.py` a ogni giro applica il freno (`systemctl stop|start zeek-collector`, il servizio `collector-traffico` ha il permesso con una regola polkit o un `sudoers` stretto scritti da `installa.sh`; scegliere la via più semplice e scriverla nel README) e mette in `stato` `pacchetti_visti`/`pacchetti_persi` da `stats.log`.

`api.py`, `/v1/stato`: in più `profilo`, `motore` (`pmacct` o `zeek`), `versione_motore`, `freno` (vero se Zeek è fermo per il disco), `scartati`.

IPAM: la riga del collector nella pagina Traffico mostra profilo e versione del motore, e «fermo per il disco» se `freno` è vero. È un testo nella riga che c'è già, non un cambio di layout.

**Prova sull'ufficio**, approvata da Riccardo con questo piano: snapshot `qm snapshot 114 pre-sonda-zeek-<AAAAMMGG>` su DA-PX-03, VM 114 portata a 2 vCPU e 2 GB (`qm set 114 --memory 2048`, i core sono già 2), `installa.sh --profilo avanzato`, poi 24 ore. Ci si ferma e si torna allo snapshot se: il disco supera il 50%, `scartati` cresce, IPAM dà errori di lettura su quel collector, o la VM finisce la memoria. Si misura: CPU e RAM di Zeek, disco, righe per tabella rispetto al giorno prima col profilo leggero, copertura.

**Verifica:** prove verdi (collector e IPAM); dopo 24 ore sul DA-PX-03: disco sotto il 50%, `scartati` 0, nessun `ultimo_errore` in IPAM per quel collector. Numeri nel README, sezione «Profilo avanzato».

**Commit:** `Sonda Zeek: installazione col profilo, freno sul disco e stato`, poi rilascio.

---

### [ ] Task 6 — Fatti nuovi: certificati, avvisi di Zeek, programmi

**Dipende da:** Task 4 (può andare in parallelo al 5).

**File**
- Modifica: `collector-traffico/collector/zeek_adattatore.py`, `collector-traffico/collector/profili.py`, `collector-traffico/tests/test_zeek_adattatore.py`
- Modifica: `src/lib/traffico/anomalie.ts` (`TIPI_FATTO`), `src/lib/traffico/frasi.ts`, `src/lib/traffico/__tests__/anomalie.test.ts`, `src/lib/traffico/__tests__/frasi.test.ts`

**Cosa fare**

Tipi nuovi di fatto, uno per riga di `TIPI_FATTO` e di `profili.TIPI`:

| Tipo | Da | Gravità |
|---|---|---|
| `certificato_non_valido` | `notice` `SSL::Invalid_Server_Cert` | 2 |
| `certificato_scaduto` | `x509` con `certificate.not_valid_after` passato | 2 |
| `password_ssh_provate` | `notice` `SSH::Password_Guessing` | 3 |
| `sql_injection` | `notice` `HTTP::SQL_Injection_Attacker` | 3 |

`software.log` non è un fatto: si mette nella tabella `nome` col tipo `software` (`nome` = `<tipo>:<nome> <versione>`) solo se la tappa 7 del piano `2026-11-23-collector-dati-in-piu.md` non l'ha già fatto in un'altra forma: **prima** si legge lo stato di quel piano e ci si accorda con la sessione che lo esegue.

**Coordinamento**: la tappa 6 dello stesso piano fa i certificati per il profilo leggero. Stesso nome di tipo per tutti e due i profili; se l'ha già scritto, si usa quel nome.

Le sonde note di IPAM escludono già questi fatti quando il client è una sonda (`creaRegistratoreFatti`): `password_ssh_provate` e `sql_injection` dalle scansioni di IPAM non escono.

**Verifica:** prove verdi; sul banco un `ssh` con password sbagliata ripetuto dal contenitore 110 produce `password_ssh_provate` in IPAM (VM 109 col profilo avanzato, snapshot prima e ripristino dopo).

**Commit:** `Sonda Zeek: certificati, avvisi di Zeek e programmi visti in rete`, poi rilascio.

---

## Registro

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo
