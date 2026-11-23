# Registri di Zeek dal banco (23/11/2026)

Cattura fatta con `collector-traffico/banco/cattura-zeek.sh` sul banco del PX-NAS: VM 109 `collector-banco` con
Zeek 9.0.1 (`zeek-lts-core=9.0.1-0`), copia di `veth110i0` (contenitore 110 `banco-carico`, 192.168.99.88); snapshot
prima, ripristino dopo. La stessa copia letta due volte:

- `grezzi/`: Zeek **senza** i nostri filtri e con le password catturate anche dai suoi (`HTTP/FTP/LDAP::default_capture_password=T`).
  Serve solo a dimostrare che `test_non_fuga.py` i segreti li saprebbe trovare. Tenuti solo `http`, `ftp`, `ldap`, `snmp`.
- `filtrati/`: Zeek con `collector-traffico/zeek/sonda.zeek`. Sono i dati di prova dell'adattatore.

Nel repo solo le righe di `banco-carico` (192.168.99.88 come chi apre, chi risponde, `src` o `dst`), più `x509` (il
certificato del server finto) e `stats`. La copia portava anche il multicast di tutta la rete 99 (mDNS, SSDP, nomi di
apparati dell'ufficio): tolto.

## Valori di prova (inventati)

| Dove | Valore |
|---|---|
| HTTP Basic verso 192.168.99.222:80, FTP e bind LDAP semplice verso 192.168.99.223 | utente `prova-utente`, password `Prova-Segreto-7731` |
| SNMP v2c verso 192.168.99.223:161 | comunità `comunita-di-prova-7731`, poi `public` |

## Traffico

HTTP con accesso Basic; FTP (server finto `banco/server-finti.py`, tolto dopo); SNMP v2c, due comunità; Modbus
scrittura di un registro (funzione 6) verso 192.168.99.221:502; LDAP bind semplice (server finto); TLS 1.0 con
certificato autofirmato (`openssl s_server -tls1` sulla 4443); DNS (`prova-zeek.banco.test`, `www.debian.org`); una
connessione rifiutata (192.168.99.222:81) e una senza risposta (192.0.2.1:9); 40 accessi SSH con password sbagliata;
60 richieste HTTP con un'iniezione SQL nell'indirizzo.

## Cosa si è visto

- `notice`: `SSL::Invalid_Server_Cert` (autofirmato), `HTTP::SQL_Injection_Attacker` e `_Victim`.
  **`SSH::Password_Guessing` non è uscito**: Zeek ha dato `auth_success=false` solo a 6 accessi su 40 (34 senza
  tentativo visto); la soglia di Zeek è 30. Da rifare nel Task 6.
- `stats`: letti da una cattura su file, `pkts_link` e `pkts_dropped` sono vuoti (li dà solo l'ascolto dal vivo).
- Nomi dei file chiusi: `conn.2026-11-23-13-00-00.log` (ora di apertura, chiusura ogni 5 minuti allineata all'orologio).

## Moduli e limiti di Zeek 9.0.1

- Tutti i moduli dell'elenco di `sonda.zeek` ci sono (`zeek -a` senza errori). `detect-sqli` si chiama
  `policy/protocols/http/detect-sql-injection`.
- Nessuno script per le connessioni lunghe (`policy/frameworks/conn/` non esiste; c'è come pacchetto esterno): una
  connessione di ore cade tutta nella finestra in cui finisce.
- Nessun parser S7 o BACnet di serie.
- NTLM, SMB, Kerberos: sul banco non c'è un server, non provati.

## Dopo la cattura

`sonda.zeek` ha avuto un'aggiunta dopo questa cattura: il campo `accesso_chiaro` in `ldap.log` (bind semplice con
password non vuota). La riga `ldap` di `filtrati/` non lo ha ancora: si rifà la cattura nel Task 6.
