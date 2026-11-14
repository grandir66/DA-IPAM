# Brief per l’agente di controllo — controlli Findings (giri)

Copia da «Missione» in giù e dallo all’agente di revisione. Non è un piano di sviluppo:
è un **controllo** di quanto è già su `origin/dev` in **v0.9.1066** (`a141accb`).

---

## Missione

Sei l’agente di **controllo** (revisione in sola lettura, o con prove) dei controlli
Findings portati da idee Nety in **DA-IPAM**. Non implementare, non rifare, non copiare
Nety (GPL-3.0). Verifica: correttezza, sicurezza, falsi positivi, buchi, coerenza con
le regole del repo, e se i test coprono davvero il caso.

**Repo:** `/Users/riccardo/Progetti/Domarc/DA-IPAM` (questo lavoro è sul worktree
`.worktrees/nety-viste`, ramo `claude/nety-viste`, pushato su `origin/dev`).
**Mai push su `main`.** Node 22. Nety si legge solo come idea (`internal/checks/`),
mai da copiare.

**Perimetro autorizzato da Riccardo:** solo check Findings. Niente pagine Hosts/Assets,
niente missioni, niente SYN al posto di nmap, inventario `/inventory` resta cespite,
la vecchia vista Vulnerabilità resta come scheda.

**Esito atteso da te:** un rapporto strutturato (ok / da sistemare / buco / falso
positivo / fuori perimetro), con file e riga, senza patch a raffica. Se trovi un
difetto grave (auth, tenant, login nei giri automatici, AUTHENTICATE SMB, credenziali
nel JSON), segnalalo per primo.

---

## Come è fatto (architettura)

Niente tabella nuova. I giri sondano le porte già in `servizi_rete`. I controlli
scrivono `controllo_json` (e NTLM/SSH/HTTP/TLS già c’erano). Findings (`elencoRilievi`
in `src/lib/rilievi/unione.ts`) **deriva** a lettura da quei JSON + alcune porte
«da archivio». Stesso adapter: fonti `cve` + `trunk` + `giro`.

Flusso:

1. Lanciatore `/scans` (menu: **Sicurezza → Analisi interna (IPAM / Nety) → Scansioni interne**).
   Tipo Discovery o Solo controlli. POST `/api/scans/lancia` (`requireAdmin`).
2. `lancia-giro.ts` passa `proveFabbrica` solo se il body ha `prove_fabbrica: true`
   e il tipo è discovery|controlli.
3. `avviaGiro` (`src/lib/servizi-rete/giro.ts`): prima sonde (`sonde.ts`), poi
   `sondaControllo` se lo strumento `controllo` c’è. I giri automatici 6h
   (`job.ts`) **non** passano `proveFabbrica`.
4. Freno sempre: `PORTE_DA_NON_TOCCARE` e `PRODUTTORE_DI_CAMPO` (`daSaltare` in giro.ts).
   In quel set ci sono **515, 631, 9100** e le porte di campo: non si toccano.
5. Persistenza: `salvaControlloServizioRete` → colonna `controllo_json`.
6. UI Findings: `/vulnerabilities`, fonte giro.

**Levetta:** checkbox sotto Avvia su `/scans`. Default off. Testo: login di fabbrica,
EternalBlue, IPMI (cipher zero e RAKP), SNMP write, Jenkins Script Console.
Tetto login: `TETTO_FABBRICA_PER_HOST = 6`. SNMP write / Jenkins / IPMI **non**
consumano il tetto (non sono login).

**File toccati (ondate 1–3):**

| File | Ruolo |
|---|---|
| `src/lib/rilievi/controlli.ts` | Catalogo Findings: tipi, parser JSON, `rilieviDa*` |
| `src/lib/rilievi/da-servizi.ts` | TLS scaduto/vecchio/autofirmato + cifrario/chiave deboli |
| `src/lib/rilievi/sonde-controlli.ts` | Sonde rete ondata 1–2 + dispatcher `sondaControllo` |
| `src/lib/rilievi/sonde-extra.ts` | Sonde ondata 3 (DNS, TFTP, NTP, rsync, SMTP, NFS `*`, SSH password, Smart Install, IPMI RAKP) |
| `src/lib/rilievi/smb-controlli.ts` | SMBv1, null/guest/share, MS17. **Mai** `probes/smb2.ts` |
| `src/lib/rilievi/unione.ts` | Query + `porta IN` da archivio |
| `src/lib/servizi-rete/sonde.ts` | `InfoNtlm.rdp_tls`, mapping sonda RDP |
| `src/lib/scanner/probes/rdp-ntlm.ts` | Standard vs TLS/NLA |
| `src/lib/servizi-rete/giro.ts` | Chiama i controlli dopo le sonde |
| `src/app/(dashboard)/scans/scans-client.tsx` | Levetta |
| `src/types/modules.d.ts` | `Session.set` net-snmp |
| Prove | `src/lib/rilievi/__tests__/*`, `ntlm-spnego.test.ts`, `lancia-giro.test.ts` |

**Intoccabile:** `src/lib/scanner/probes/smb2.ts` — solo CHALLENGE, mai AUTHENTICATE.

---

## Catalogo implementato

Id Findings = `giro:<id>:<host_id>:<porta>`. Gravità come sotto.

### Sempre (senza levetta) — da JSON già salvato o sonda senza login

| Id | Gravità | Porta / fonte | Cosa prova | Dove |
|---|---|---|---|---|
| tls-scaduto | High | `tls_json` | cert scaduto | da-servizi.ts |
| tls-vecchio | Medium | `tls_json` | SSL3 / TLS 1.0 / 1.1 | da-servizi.ts |
| tls-autofirmato | Low | `tls_json` | self-signed, non se già scaduto | da-servizi.ts |
| tls-cifrario | Medium | `tls_json.cipher` | RC4, 3DES, NULL, EXPORT, MD5, IDEA | da-servizi.ts |
| tls-chiave | Medium | `tls_json.key_bits` | RSA 512/1024/1536 **non** EC 256 | da-servizi.ts |
| smb-signing | Medium | NTLM fonte smb | `smb_signing === false` | controlli.ts / sonde smb2 (solo challenge) |
| rdp-nla | Medium | NTLM fonte rdp | `rdp_nla === false` e TLS presente | rdp-ntlm.ts |
| rdp-standard | High | NTLM fonte rdp | `rdp_tls === false` (vince su NLA) | rdp-ntlm.ts |
| ssh-vecchio | Medium | `ssh_json.ident` | SSH-1 o OpenSSH < 8 | controlli.ts |
| ssh-debole | Low | kex/cifrari/mac | group1, 3DES, RC4, hmac-md5 | controlli.ts |
| ssh-password | Low | 22 | ssh2 `authHandler`: dichiara password/k-i, `cb(false)`, nessun login | sonde-extra.ts |
| consola-web | Low | `http_json` title/server/location | phpMyAdmin, Tomcat, Jenkins, Grafana, iLO, iDRAC, … + CUPS/JetDirect/Xerox/Kyocera/Brother | controlli.ts |
| ldap-anonimo | Medium | 389 | bind v3 DN/password vuoti, resultCode 0 | sonde-controlli.ts |
| ldap-firma | Medium | 389 | resultCode ≠ 13 (confidentialityRequired) | sonde-controlli.ts |
| redis-aperto | High | 6379 | PING → PONG, no NOAUTH | sonde-controlli.ts |
| mongo-aperto | High | 27017 | listDatabases senza auth | sonde-controlli.ts |
| nfs-aperto | Medium | 2049 | RPC NULL nfs 100003 | sonde-controlli.ts |
| nfs-stella | High | 111 o 2049 | MOUNT EXPORT, `*` nel dump | sonde-extra.ts |
| snmp-public | Medium | 161 UDP | GET sysDescr community `public` (via `provaVersioniSnmp`) | sonde-controlli.ts |
| vnc-aperto | High | 5900/5901 | security type 1 (None) | sonde-controlli.ts |
| vnc-debole | Medium | 5900/5901 | type 2, solo se non c’è None | sonde-controlli.ts |
| smbv1 | Medium | 445/139 | dialetto NT LM 0.12 | smb-controlli.ts |
| smb-null | Medium | 445/139 | session setup anonimo | smb-controlli.ts |
| smb-guest | Medium | 445/139 | Guest password vuota | smb-controlli.ts |
| smb-share | High | 445/139 | tree connect share senza credenziali | smb-controlli.ts |
| memcached | Medium | 11211 | `stats` | sonde-controlli.ts |
| zookeeper | Medium | 2181 | `ruok` → imok | sonde-controlli.ts |
| elasticsearch | High | 9200 | GET / senza auth | sonde-controlli.ts |
| docker | High | 2375 | GET /version | sonde-controlli.ts |
| etcd | High | 2379 | GET /version | sonde-controlli.ts |
| couchdb | High | 5984 | GET / | sonde-controlli.ts |
| kubelet | High | 10250 TLS | GET /runningpods/ | sonde-controlli.ts |
| actuator | High | HTTP | GET /actuator/health | sonde-controlli.ts |
| git-env | High | HTTP | GET /.git/HEAD o /.env | sonde-controlli.ts |
| x11 | High | 6000 | connection setup accepted | sonde-controlli.ts |
| dns-axfr | High | 53 | AXFR TCP, zona `in-addr.arpa` del /24 (non il dominio reale) | sonde-extra.ts |
| tftp | Medium | 69 UDP | RRQ → DATA o ERROR | sonde-extra.ts |
| ntp-monlist | High | 123 UDP | mode 7 code 42, payload > 48 B | sonde-extra.ts |
| rsync | Medium | 873 | `@RSYNCD` + EXIT o riga modulo; `@ERROR` no | sonde-extra.ts |
| smart-install | High | 4786 | handshake, risposta che inizia per 0x00 | sonde-extra.ts |
| smtp-vrfy | Low | 25 | VRFY postmaster 250/252 | sonde-extra.ts |
| adcs | High | HTTP | GET /certsrv/ → 200 con hint o **401** | sonde-controlli.ts |

### Sempre — solo da inventario (nessuna sonda extra)

| Id | Gravità | Porta | Nota |
|---|---|---|---|
| telnet | Medium | 23 | `unione.ts` `porta IN` |
| winrm | Low | 5985/5986 | 5985 nota «senza TLS» |
| wsus-http | High | 8530 | solo se **non** c’è TLS |
| rpc-135 | Medium | 135 | mapper RPC; non distingue lo spooler |
| r-services | High | 512/513/514 | rexec / rlogin / rsh |
| ipp | Low | 631 | **probabilmente morto**: 631 è in `PORTE_DA_NON_TOCCARE`, il giro la salta |

### Dietro levetta (`proveFabbrica === true`)

| Id | Gravità | Porta | Cosa fa | Tetto 6 |
|---|---|---|---|---|
| login-fabbrica ftp | High | 21 | USER anonymous | sì |
| login-fabbrica http | High | 80/443/8080/… | Basic admin/admin e admin/password su 401 | sì |
| login-fabbrica mysql | High | 3306 | root password vuota | sì |
| login-fabbrica postgres | High | 5432 | postgres/postgres | sì |
| login-fabbrica mssql | High | 1433 | LOGIN7 `sa` password vuota | sì |
| ms17-010 | Critical | 445/139 | PeekNamedPipe TRANSACTION 0x25 `\\PIPE\\` FID 0 | no (stessa levetta, non è un login) |
| ipmi | Medium | 623 UDP | RMCP ping | no |
| ipmi-cipher0 | High | 623 UDP | Open Session cipher suite 0, status 0 (nasconde il ping) | no |
| ipmi-rakp | High | 623 UDP | RAKP1 utente `admin` **solo se** cipher0 ok | no |
| snmp-write | High | 161 | GET sysName con `private`, SET **stesso** valore | no |
| jenkins-script | High | HTTP | GET /script, corpo Script Console/Groovy/Jenkins | no |

MS17 è il 4° argomento di `sondaSmb(..., proveFabbrica)`: SMBv1/null/guest/share restano **sempre**.

---

## Cosa potrebbe mancare o essere debole (da verificare tu)

### Collaudo dal vivo (non fatto)

- SQL Server vero (LOGIN7 / LOGINACK).
- Windows 7 non patchato (MS17).
- Hub 533: un giro Solo controlli su una LAN nota, Findings popolato.
- IPMI BMC vero (cipher0 + RAKP).
- NFS con export `*`.
- AD CS IIS `/certsrv/`.
- SSH che offre solo password vs solo chiavi.

### Limiti di disegno (non necessariamente bug)

1. **UDP solo se esiste la gemella TCP in `servizi_rete`.** TFTP 69, NTP 123, IPMI 623:
   il giro itera porte già in tabella (di solito TCP da nmap). Un servizio solo-UDP non
   parte. Stesso limite della 623 ondata 2.
2. **AXFR** prova solo `x.y.z.in-addr.arpa` dell’IP, non la zona del dominio NTLM/DNS.
   Molti server AXFR-aperti sulla zona diretta non scattano.
3. **IPP 631** in `rilieviDaPorta` ma 631 è in `PORTE_DA_NON_TOCCARE` (con 9100 e 515):
   il giro non la sonda. Pannello stampante resta solo se CUPS è su 80/443 (CONSOLE_WEB).
   **9100 non si GET-ta**, voluto.
4. **LDAP 636** (LDAPS) non c’è. Solo 389.
5. **SMTP open relay** non fatto (scelta: troppo vicino a un invio). Solo VRFY.
6. **DNS recursion / version.bind / EXPN / FTP bounce** non fatti.
7. **Spooler** = solo «135 aperta», niente RPC OpenPrinter.
8. **Smart Install:** `buf[0]===0x00` è largo (falsi positivi).
9. **AD CS:** 401 su GET `/certsrv/` conta come sì, anche senza body «Certificate Services».
10. **rsync:** `@RSYNCD: EXIT` senza moduli è comunque Finding.
11. **SNMP write:** SET dello stesso sysName: un agente che accetta SET no-op passa;
    `sysDescr` notWritable era il falso positivo evitato.
12. **SSH password:** kex incluso group1/3des per i box vecchi; timeout 2,5 s; se il kex
    fallisce, niente Finding anche se password è offerta.
13. **RDP Standard:** Connection Confirm TPKT + 0xD0 senza NEG_RSP ⇒ `tls: false`.
    Un CC troncato potrebbe falsare.
14. **HTTP extra** (`.git`, actuator, AD CS) su `httpish` **o** porte non in `PORTE_CONTROLLO`.
    Una 8081 già vista come HTTP sì; una 445 no (bene).
15. **Jenkins** solo su httpish (80/443/8080/8443/8000/8888/631) **e** levetta. Jenkins su
    porta strana (es. 9090 in PORTE_CONTROLLO? no, 9090 non è nel set: ci arrivano i
    percorsi HTTP. 9090 non è httpish → AD CS sì, Jenkins no senza levetta e senza httpish).
    Attento: 9090 `!PORTE_CONTROLLO` fa `.git` e AD CS sempre; Jenkins solo se httpish.
16. **Falsi positivi SMB null/guest:** sessione reale, rischio MDR. Voluto (ondata 2,
    «sempre come Redis»).
17. **Nessuna riga Findings se `controlloHaEsito` è falso:** un JSON tutto-false non si
    salva (`sondaControllo` ritorna `info: null`).
18. **Fuori perimetro Nety (non check):** diff tra giri, Completo che riprende, ascolto
    all’avvio, tecniche matrice oltre al connect.

### Invarianti da spezzare (se uno cade, è un difetto)

- `probes/smb2.ts` non contiene AUTHENTICATE / session setup con password.
- `job.ts` non passa `proveFabbrica`.
- POST `/api/scans/lancia` è admin; GET Findings è auth.
- `prove_fabbrica` nel body arriva al giro solo per discovery|controlli
  (`scans-client.tsx` + `lancia-giro.ts`). Test: `lancia-giro.test.ts`.
- Sessioni SNMP community solo via `apriSessioneCommunity` (niente `createSession(`
  fuori da `snmp-sessione.ts`).
- `JSON.parse` dei JSON sonde in try/catch (`*DaJson`).
- Testo UI/errori in italiano; Nety non importata.
- Tenant: `withTenantFromSession` / `withTenant` sul giro; unione legge il tenant corrente.
- Nessuna credenziale in `controllo_json` (solo `{ servizio, utente }` se fabbrica).

---

## Prove già verdi (non alzare le soglie per farle passare)

Da lanciare con Node 22:

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/.worktrees/nety-viste
source ~/.nvm/nvm.sh && nvm use 22
node --import tsx --test \
  src/lib/rilievi/__tests__/sonde-extra.test.ts \
  src/lib/rilievi/__tests__/controlli.test.ts \
  src/lib/rilievi/__tests__/da-servizi.test.ts \
  src/lib/rilievi/__tests__/sonde-controlli.test.ts \
  src/lib/rilievi/__tests__/smb-controlli.test.ts \
  src/lib/rilievi/__tests__/unione.test.ts \
  src/lib/servizi-rete/__tests__/ntlm-spnego.test.ts \
  src/lib/scanner/__tests__/lancia-giro.test.ts
```

Coprono soprattutto **parser e server finti**, non BMC/SQL/Win7 veri.

Lint/tsc/build erano verdi al momento del push 1066. I warning ESLint preesistenti
non sono di questi file.

---

## Come lavorare

1. Leggi i file della tabella, poi le prove. Non rianalizzare tutto DA-IPAM.
2. Confronta il catalogo qui sopra col dispatcher `sondaControllo` e con
   `rilieviDaControllo` / `rilieviDaPorta` / `rilieviDaNtlm` / `rilieviDaTls`:
   ogni flag persistito deve diventare un Finding, e viceversa.
3. Cerca buchi: porta in `PORTE_CONTROLLO` senza ramo; ramo senza campo in
   `controlloDaJson`; campo senza riga in `rilieviDaControllo`; riga senza test.
4. Cerca falsi positivi nei parser (AXFR, Smart Install, AD CS 401, LDAP code 13,
   TLS `key_bits` 256, DES vs AES).
5. Cerca path invasivi **senza** `proveFabbrica` (MS17, SET SNMP, RAKP, Jenkins,
   login DB/FTP/HTTP).
6. Rapporto in italiano, strutturato:

```
## Giudizio
(una frase)

## Difetti (se ci sono)
- file:riga — cosa — perché è un problema — gravità

## Falsi positivi / negativi probabili
- …

## Buchi di catalogo (manca rispetto a quanto dichiarato, non rispetto a tutto Nety)
- …

## Fuori perimetro (non fare)
- …
```

Non aprire PR, non bump versione, non push, non «migliorare» Nety. Se serve una
patch, elenca i file e ferma: la decide Riccardo.
