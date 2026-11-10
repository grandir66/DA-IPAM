# DA-IPAM ← Nety: cosa c'è già e prompt per Codex sui pezzi aperti (10/11/2026)

Due parti: (1) **inventario** di cosa è stato portato da Nety in DA-IPAM (così non si rifà), e
(2) **prompt per Codex** sui pezzi ancora aperti — quelli che un classificatore di sicurezza
ferma quando li scrivo io, quindi li sviluppa Codex.

> **Licenza.** Nety è GPL-3.0 (anche la sua `web/`). DA-IPAM va sulle appliance dei clienti:
> **non si copia codice da Nety**, si riprendono idee e disposizione, riscritte da zero coi
> mattoni di DA-IPAM (`src/components/shared/console.tsx`, `docs/STILE-UI.md`). Vale per tutto.

---

## 1. Cosa c'è già su `dev` (v0.9.1060) e su `main` di DA-Vul-can — NON rifare

### Acquisizione senza credenziali (`src/lib/servizi-rete/`)
- `sonde.ts` — banner, HTTP, TLS, SSH (KEXINIT + impronta host key da KEX_ECDH_REPLY).
- `ntlm-spnego.ts` — nome computer / dominio / versione OS dalla CHALLENGE NTLM su SMB 445,
  HTTP `WWW-Authenticate: NTLM` e RDP (CHANGELOG 10/11). Nessun Type 3, nessuna password.
- `identita.ts` — due IP con la stessa impronta SSH/TLS/engineID o lo stesso nome Windows
  diventano **proposta** «stesso apparato»; conferma collega `physical_device_id`, rifiuto no,
  **niente fusioni automatiche**.
- `porte.ts` — giro leggero sulle 1000 porte TCP più usate (`nmap-services`) + porte di gestione
  fuori standard; freno su porte di campo/stampa e produttori di campo.
- `giro.ts` / `job.ts` — giro automatico (all'avvio e ogni 6 ore), porte comuni sugli host senza
  porte, poi sonde; levetta `servizi_rete.automatico`.
- `os-da-prove.ts` — prima lettura dell'OS dalle sonde.
- Tabelle tenant: `servizi_rete`, `servizi_rete_prove`, `identita_prove`, `identita_proposte`.
- Pagine: `/servizi-rete` (+ `identita-client.tsx`, `servizi-rete-schede.tsx`); rotte
  `/api/servizi-rete`, `/api/identita`.

### Matrice di segmentazione (`src/lib/segmentazione/` + DA-Vul-can)
- DA-IPAM: `bersagli.ts`, `db.ts`, `giro.ts`, `job.ts`; pagina `/segmentazione`; rotte
  `/api/segmentazione`, `/cella`, `/giro`; levetta `segmentazione.automatico`.
- DA-Vul-can (`infra/scanner-edge/app/scanner_edge/sensore/raggiungibilita.py` + test): la sonda
  prova i servizi noti **da dentro ogni VLAN** (sotto-interfaccia col tag nello spazio `trunk`,
  IP libero verificato, poi tolta) e torna raggiunto/chiuso/filtrato/senza rotta.

### Rappresentazione (idee da Nety, mattoni Domarc)
- `BadgeGravita`/`LegendaGravita`/`BarraGravita` (gravità a tacche, `console.tsx`) in lista
  Vulnerabilità, CVE potenziali, scheda host, dashboard.
- Triage per riga + riepilogo (`src/lib/triage/`, `triage-riga.tsx`, `/api/triage`).
- Rilievi per rete (barre) in Vulnerabilità e dashboard (`getRilieviPerRete`).
- Copia-IP (`copia.tsx`) e tempo relativo (`TempoRelativo`) in Servizi di rete, ARP, Software,
  Host monitorati, scheda asset.
- «Reti viste, da confermare» (dal trunk) **sotto** l'elenco delle subnet definite.

### Deploy / infra
- Sonda trunk già esistente (`src/lib/trunk/`, DA-Vul-can `sensore/`): ascolta CDP/LLDP/DTP/STP,
  ARP, DHCP, mDNS, NetBIOS, LLMNR.
- NIC trunk dedicata di serie: annotato come riconfig del deploy (consegna matrice).
- Test di guardia nginx→`Host` in Deploy-Appliance (PR #91).

---

## 2. Prompt per Codex — pezzi ancora aperti

Copia da qui in giù e dallo a Codex.

---

Sei su **DA-IPAM** (`~/Progetti/Domarc/DA-IPAM`, Next.js 16 / React 19 / TS strict /
better-sqlite3, ramo di lavoro `dev`, mai push su `main`) e su **DA-Vul-can**
(`~/Progetti/Domarc/DA-Vul-can`, ramo `main`, sonda in `infra/scanner-edge/app/scanner_edge/`).
Leggi prima `CLAUDE.md`, `AGENTS.md`, `docs/STILE-UI.md`, `.claude/rules/` e `CONTEXT.md` di
ciascun repo. Rispetta cancello (`lint && tsc && build`), versioning (`npm run version:release
-- --staged-only` + push) e le regole anti-regressione. Tutto è analisi/inventario **difensivo**
sulle reti dei clienti Domarc, dentro il prodotto. **Nety è GPL-3.0: idee, non codice.**

Gran parte del lavoro ispirato a Nety è già fatto (vedi l'inventario sopra): **non rifarlo**.
Restano questi pezzi, da sviluppare come task separati, ognuno col suo ciclo test→codice→commit:

**1. Ascolto all'avvio → reti proposte da sole.**
Oggi la sonda trunk (`src/lib/trunk/`, DA-Vul-can `sensore/`) sente CDP/LLDP/DTP/STP, VLAN
etichettate e lease DHCP, e le reti viste si confermano a mano in Subnet. Obiettivo: appena il
sistema parte, da quei dati passivi **proporre** le reti (VLAN + sottorete + gateway) senza
scansioni esplicite, popolando la lista «Reti viste, da confermare» già presente. Riusa
`lib/trunk/*` e `reti-proposte.ts`; non creare reti in automatico, restano proposte.
Accettazione: su una sonda con trunk attivo, le VLAN sentite compaiono come proposte con
sottorete e gateway dedotti; nessuna rete creata senza conferma; isolamento tenant.

**2. Collaudo end-to-end della matrice di segmentazione.**
Il motore c'è (DA-IPAM `lib/segmentazione/`, sonda DA-Vul-can `sensore/raggiungibilita.py`), ma
non è mai girato su un trunk vero: la sonda 963 (192.168.99.2) vede solo la VLAN nativa. Serve
un trunk con più VLAN (piano: VLAN 102 e 103 sul Proxmox di casa, scheda della VM 963 resa
trunk, snapshot prima). Lancia un giro vero, verifica che la matrice rete×rete si riempia con
raggiunto/chiuso/filtrato/senza-rotta, e che i numeri tornino con quelli di Nety sulla stessa
rete. Correggi quel che il collaudo mostra. Non è codice nuovo di motore ma verifica + fix.

**3. Confronto con Nety sulla stessa sonda (facoltativo).**
Prima di spegnere la VM di Nety (192.168.99.83 / .178), un confronto a parità: stessa rete,
stesse porte, senza credenziali — tempo al primo host, copertura, versioni riconosciute, matrice.
Serve solo a tarare; nessun codice da rilasciare se non piccoli fix.

**4. Rifinitura identità (se il collaudo lo chiede).**
`lib/servizi-rete/identita.ts` propone «stesso apparato» da impronte forti. Verifica su dati veri
che le proposte siano giuste (niente falsi accostamenti da WORKGROUP/localhost/community
`public` condivise) e che conferma/rifiuto scrivano `physical_device_id` come atteso.

Vincoli trasversali: il freno su porte di campo/stampa e apparati di campo vale **sempre**; le
scansioni restano sull'IP ufficiale, la sonda trunk solo ascolta e prova da dentro le VLAN; mai
PII o credenziali nei log o verso l'esterno; `withTenantFromSession` su ogni route nuova; stile
`docs/STILE-UI.md` su ogni pagina. Per il deploy della NIC trunk dedicata di serie vedi la
consegna della matrice e la decisione del 21/10 su `AUTH_URL`/NetBird (non reintrodurre AUTH_URL
sull'IP nel provisioning).

Riferimenti: `CHANGELOG.md` e `TASKS.md` di DA-IPAM (sezioni 09-10/11),
`docs/handoff/2026-11-09-servizi-rete-parti-rimaste.md`, e questo file.

---

## 3. Collaudo che resta (lato Riccardo / fork, non Codex da solo)
- Guardare a schermo tutto il lavoro sull'hub (accesso ora sistemato, `AUTH_URL`) e promuovere
  `dev`→`main` dalla UI.
- Trunk 102/103 sulla 963 per il collaudo della matrice (snapshot prima).
