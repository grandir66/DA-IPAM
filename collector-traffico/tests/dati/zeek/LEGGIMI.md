# Registri di Zeek dal banco (23/11/2026)

Seconda cattura (13:22-13:31 UTC), fatta con `collector-traffico/banco/cattura-zeek.sh` sul banco del PX-NAS: VM 109
`collector-banco` col collector installato da `installa.sh --profilo avanzato` (Zeek 9.0.1), copia di `veth110i0`
(contenitore 110 `banco-carico`, 192.168.99.88); snapshot prima, ripristino dopo. La prima cattura (12:57) era fatta
con uno Zeek installato a mano e senza il campo `accesso_chiaro` di LDAP né i programmi: sostituita da questa.
La stessa copia letta due volte:

- `grezzi/`: Zeek **senza** i nostri filtri e con le password catturate anche dai suoi (`HTTP/FTP/LDAP::default_capture_password=T`).
  Serve solo a dimostrare che `test_non_fuga.py` i segreti li saprebbe trovare. Tenuti solo `http`, `ftp`, `ldap`, `snmp`.
- `filtrati/`: Zeek con `collector-traffico/zeek/sonda.zeek`. Sono i dati di prova dell'adattatore.

Nel repo solo le righe fra `banco-carico` (192.168.99.88) e i server del banco (221, 222, 223, il DNS 254, 192.0.2.1),
più `x509` (il certificato del server finto), `stats` e i programmi di quegli host. Tolti: il multicast di tutta la
rete 99 (mDNS, SSDP, nomi di apparati dell'ufficio), il traffico di un'altra sessione che usava `banco-carico` nello
stesso momento (LDAP, NTLM, Kerberos, SMB verso 192.168.99.91, client «ProvaAgente») e gli scaricamenti di `apt`.

## Valori di prova (inventati)

| Dove | Valore |
|---|---|
| HTTP Basic verso 192.168.99.222:80, FTP e bind LDAP semplice verso 192.168.99.223 | utente `prova-utente`, password `Prova-Segreto-7731` |
| SNMP v2c verso 192.168.99.223:161 | comunità `comunita-di-prova-7731`, poi `public` |

## Traffico

HTTP con accesso Basic; FTP (server finto `banco/server-finti.py`, tolto dopo); SNMP v2c, due comunità; Modbus
scrittura di un registro (funzione 6) verso 192.168.99.221:502; LDAP bind semplice (server finto); TLS 1.0 con
certificato autofirmato (`openssl s_server -tls1` sulla 4443); DNS (`prova-zeek.banco.test`, `www.debian.org`); una
connessione rifiutata (192.168.99.222:81) e una senza risposta (192.0.2.1:9); 40 accessi SSH con password sbagliata
(`sshpass`, verso 103); 60 richieste HTTP con un'iniezione SQL nell'indirizzo.

## Cosa si è visto

- `notice`: `SSL::Invalid_Server_Cert` (autofirmato), `HTTP::SQL_Injection_Attacker` e `_Victim`.
  **`SSH::Password_Guessing` non è uscito**: Zeek ha dato `auth_success=false` a 10 accessi su 40, gli altri 30 senza
  tentativo visto. Il server SSH del contenitore 103 è OpenSSH 10.0, che di serie (`PerSourcePenalties`) rifiuta chi
  ha sbagliato prima ancora dell'autenticazione: la soglia di Zeek (30 falliti) non si raggiunge. Si rifà verso un
  OpenSSH 9.
- Nel collector installato (stessa prova, registri dal vivo): `chiaro_ftp`, `chiaro_http_basic`, `chiaro_ldap`,
  `snmp_vecchio`, `impianto_scrittura`, `sql_injection`, `tls_certificato` (autofirmato), `tls_vecchio`; programmi;
  coppie tutte con `byte_ritorno`; `/v1/stato` con profilo, motore, versione, freno, scartati 0.
- `stats`: letti da una cattura su file, `pkts_link` e `pkts_dropped` sono vuoti (li dà solo l'ascolto dal vivo).
- Nomi dei file chiusi: `conn.2026-11-23-13-00-00.log` (ora di apertura, chiusura ogni 5 minuti allineata all'orologio).

## Moduli e limiti di Zeek 9.0.1

- Tutti i moduli dell'elenco di `sonda.zeek` ci sono (`zeek -a` senza errori). `detect-sqli` si chiama
  `policy/protocols/http/detect-sql-injection`.
- Nessuno script per le connessioni lunghe (`policy/frameworks/conn/` non esiste; c'è come pacchetto esterno): una
  connessione di ore cade tutta nella finestra in cui finisce.
- Nessun parser S7 o BACnet di serie.

- NTLM, Kerberos e SMB: nella copia c'erano (traffico dell'altra sessione, tolto dal repo); i campi con utenti,
  macchine e domini non sono nei filtrati.
