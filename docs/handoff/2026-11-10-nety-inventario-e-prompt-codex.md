# DA-IPAM ← Nety: cosa c'è già e prompt per Codex sui pezzi aperti (10/11/2026)

Due parti: (1) **inventario** di cosa è stato portato da Nety in DA-IPAM (così non si rifà), e
(2) **prompt per Codex** sulle 5 idee ancora utili, in ordine di priorità — compresi i controlli
(firme), anche quelli autenticati, che un classificatore di sicurezza ferma quando li scrivo io.

> **Licenza.** Nety è GPL-3.0 (anche la sua `web/`). DA-IPAM va sulle appliance dei clienti:
> **non si copia codice da Nety**, si riprendono idee e flussi, riscritti da zero coi mattoni di
> DA-IPAM (`src/components/shared/console.tsx`, `docs/STILE-UI.md`) e i motori che ci sono già.
> DA-IPAM è inventario multi-tenant con nmap e autenticazione; Nety è un pentest in un binario Go.

---

## 1. Già in DA-IPAM (v0.9.1060 / DA-Vul-can main) — NON rifare

| Nety | Dove da noi | Nota |
|---|---|---|
| Services | `/servizi-rete` (`lib/servizi-rete/sonde.ts`) | sonde senza password, riga che si apre |
| Matrix | `/segmentazione` + sonda `raggiungibilita.py` (DA-Vul-can) | raggiungibilità da dentro ogni VLAN via trunk |
| Findings + launcher | `/vulnerabilities` e `/scans` | due schede; 4 tipi × 5 profili |
| Hosts/Assets (prima lettura) | cassetto in Discovery e Subnet | OS da NTLM/SNMP/SSH; niente pagine nuove |
| Identity NTLM/SSH/TLS/engineID | «stesso apparato» in Servizi di rete (`lib/servizi-rete/identita.ts`, `ntlm-spnego.ts`) | CHALLENGE senza login; solo proposte |
| Networks + sniff L2 | Subnet + «reti dal trunk» (`lib/trunk/`) | proposte da confermare, non create da sole |
| Gravità a tacche, Espandi tutto | Findings e badge (`console.tsx`) | overview per rete conta ancora solo i CVE |

**Non serve**: pagine Hosts/Assets a sé, missioni, SYN nativo, WebSocket.

---

## 2. Prompt per Codex — le 5 idee ancora utili, in ordine

Copia da qui in giù e dallo a Codex.

---

Sei su **DA-IPAM** (`~/Progetti/Domarc/DA-IPAM`, Next.js 16 / React 19 / TS strict /
better-sqlite3; ramo `dev`, mai push su `main`) e, dove serve la sonda, su **DA-Vul-can**
(`~/Progetti/Domarc/DA-Vul-can`, ramo `main`, `infra/scanner-edge/app/scanner_edge/`). Leggi
prima `CLAUDE.md`, `AGENTS.md`, `docs/STILE-UI.md`, `.claude/rules/`, `CONTEXT.md` di ciascun
repo. Cancello (`lint && tsc && build`), versioning (`version:release -- --staged-only` + push),
`withTenantFromSession` su ogni route, stile UI su ogni pagina. Tutto è analisi/inventario
**difensivo** sulle reti dei clienti Domarc. **Nety è GPL-3.0: idee, non codice.** L'inventario
«già fatto» è sopra: non rifarlo. Sviluppa in quest'ordine, ogni voce come task a sé con ciclo
test→codice→commit e fixture come fa Nety (`internal/checks/*_test.go`).

### 1 — Catalogo controlli (firme), il motore che riempie Findings senza Edge
Nety ha ~45 controlli per servizio che girano subito, legati alla porta, con la prova. Diventano
controlli leggeri della sonda che scrivono un rilievo (porta/protocollo/prova/rimedio) legato al
servizio in `servizi_rete`, mostrato nelle viste di Vulnerabilità con gravità a tacche.

**Prima ondata GIÀ FATTA (10/11 — non rifare):** SMB senza firma obbligatoria, RDP senza NLA, SSH
vecchio (SSH-1 o OpenSSH < 8), LDAP bind anonimo, Redis e MongoDB senza password, NFS che risponde,
SNMP community `public`, VNC senza auth, pannelli web esposti; con la levetta: FTP anonymous e
`admin`/`admin` sui pannelli in 401. (TLS scaduto/vecchio/autofirmato c'era già.)

**Seconda ondata GIÀ FATTA (10/11 — non rifare):** SMBv1, sessione SMB anonima/Guest/share (sempre,
probe in `smb-controlli.ts`; `probes/smb2.ts` resta solo CHALLENGE); SSH KEX/cifrari/MAC deboli;
Telnet 23, WinRM 5985/5986, WSUS HTTP 8530; Memcached, ZooKeeper, Elasticsearch, Docker API, etcd,
CouchDB, Kubelet, X11, `.git`/`.env`/Spring Actuator anche su porte HTTP non standard; con la
stessa levetta: EternalBlue (MS17-010, TRANSACTION PeekNamedPipe), IPMI RMCP ping **e cipher-zero**,
MySQL/MSSQL (LOGIN7 `sa`) / Postgres di fabbrica (tetto 6). Prove su server finti verdi; collaudo
dal vivo su SQL Server / Windows 7 non patchato ancora da fare sull'hub.

**Terza ondata GIÀ FATTA (10/11 — non rifare):** RDP Standard (senza TLS), SSH password offerta
(ssh2, nessun login), LDAP signing non obbligatorio, NFS export `*`, TLS cifrario/chiave deboli,
DNS AXFR, TFTP, NTP monlist, rsync, Smart Install, r-services, RPC 135, IPP, AD CS `/certsrv/`,
SMTP VRFY, VNC tipo 2, pannelli stampante; con la levetta: SNMP write (`private` SET sysName),
Jenkins `/script`, IPMI RAKP dopo cipher-zero. SMTP relay aperto non fatto (troppo vicino a un
invio). Collaudo dal vivo su hub ancora da fare.

**Resto Nety NON check (fuori perimetro Findings):** diff tra giri, Completo che riprende,
ascolto all'avvio, matrice tecniche.

**Vincolo tassativo sugli autenticati/intrusivi** (default di fabbrica DB, `admin`/`admin`, SNMP
write): spenti di serie, si accendono solo con la levetta «prove intrusive» del lanciatore, si
concordano col cliente, **pochi default noti** (no brute force, no lockout), **non salvano mai le
credenziali** (solo l'esito «accetta default X»), finiscono nell'audit. Prima di portare un
controllo, verifica che non duplichi Greenbone/Nuclei: dove c'è già, lascialo all'Edge.

Accettazione: ogni controllo ha fixture e test (verde sul caso vero, rosso se si toglie la riga
vulnerabile); il rilievo compare in Findings legato al servizio; gli intrusivi non partono senza
la levetta; nessuna credenziale nei log o nel DB.

### 2 — Diff tra due giri («cosa è cambiato» sulla subnet)
`scan_history` oggi è un evento per giro, non un confronto. Dai due giri di una subnet: host
aggiunti / tolti / spostati (una macchina che cambia IP è **spostata**, non nuova, riconosciuta
dall'identità già presente), porte aperte/chiuse, versioni cambiate, rilievi alzati/chiusi.
Pagina «Cosa è cambiato» (riusa storico, porte e identità). Accettazione: due giri confrontabili
mostrano le quattro categorie; la copertura incompleta si dichiara prima di dire «sparito».

### 3 — Pausa / ripresa del giro (il Completo che riprende)
Il profilo Completo (65.535 porte) oggi si può solo fermare. Persisti le unità di lavoro del giro
così il Completo **riprende da dove si è fermato**, anche dopo un riavvio/crash (schema di Nety:
work units per fase). Accettazione: un Completo fermato e ripreso non riparte da zero e non perde
le porte già fatte.

### 4 — Ascolto all'avvio → reti proposte da sole
La Sonda L2 oggi è un sync, non un listener all'avvio. Appena parte il processo, da CDP/LLDP/DHCP/
802.1Q **proponi** le reti (VLAN + sottorete + gateway) nella lista «Reti viste, da confermare»,
senza scansioni (riusa `lib/trunk/` e `reti-proposte.ts`). Richiesta di Riccardo del 09/11:
«appena partito molte cose si popolano». Accettazione: su una sonda con trunk, le VLAN sentite
compaiono come proposte; nessuna rete creata senza conferma; isolamento tenant.

### 5 — Tecniche di segmentazione (solo se serve il taglio «auditor»)
Oltre al connect diretto che la matrice già fa: porta sorgente 53/88/123, frammenti, IPv6, DTP,
double-tag 802.1Q. Utile se la matrice deve rispondere da auditor; per l'inventario quella di oggi
può bastare. Da fare per ultimo, e solo se Riccardo lo chiede.

Vincoli trasversali: freno su porte di campo/stampa e apparati di campo **sempre**; le scansioni
restano sull'IP ufficiale, la sonda trunk solo ascolta e prova da dentro le VLAN; mai PII o
credenziali nei log o verso l'esterno; decisione del 21/10 su `AUTH_URL`/NetBird (non reintrodurre
AUTH_URL sull'IP nel provisioning). Riferimenti: `CHANGELOG.md`/`TASKS.md` di DA-IPAM (09-10/11),
`docs/handoff/2026-11-09-servizi-rete-parti-rimaste.md`, il sorgente di Nety `internal/checks/`
(solo da leggere, GPL).

---

## 3. Collaudo che resta (lato Riccardo / fork)
- Guardare a schermo tutto sull'hub (accesso ora sistemato) e promuovere `dev`→`main` dalla UI.
- Trunk 102/103 sulla 963 per il collaudo pieno della matrice (snapshot prima).
