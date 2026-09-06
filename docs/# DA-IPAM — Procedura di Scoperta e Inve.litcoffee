# DA-IPAM — Procedura di Scoperta e Inventario di Rete

## Toolbar — Pulsanti e Azioni

### Gestione dispositivi
- Aggiungi dispositivo singolo
- Aggiungi dispositivi multipli (import da lista, range IP o CSV)
- Elimina dispositivi (con conferma obbligatoria)

### Scansioni
- Avvia scoperta rete (Fase 1) — ICMP + NMAP leggero + ARP + DNS Reverse
- Avvia scansione approfondita (Fase 2) — NMAP completo + SNMPwalk
- Avvia profilazione OS (Fase 4) — scansione con credenziali per tipo device
- Avvia raccolta dati estesa (Fase 5) — acquisizione dati specifici per categoria

### Profilo di monitoraggio
- **Applica profilo monitoraggio (azione massiva)** — assegna il profilo "device conosciuto" a tutti i dispositivi selezionati (azione batch su checkbox)

---

## Fase 1 — Scoperta di Rete

Obiettivo: rilevare tutti gli host attivi, raccogliere MAC address, vendor OUI e hostname DNS. Nessuna classificazione ancora, nessun dato assegnato a profilo dispositivo.

### 1.1 Scansione ICMP (Ping Sweep)
- Invia ICMP Echo Request a tutti gli IP del range configurato
- Registra IP che rispondono e IP che non rispondono
- **Non dedurre nulla dall'assenza di risposta ICMP**: l'host può essere attivo con ICMP filtrato

### 1.2 Scansione NMAP Leggera (Port Probe)
- Scansione su porte base: 22, 23, 80, 443, 161, 445, 3389
- Scopo: verificare attività dell'host anche in assenza di risposta ICMP
- **Non assegnare classificazione in questa fase**
- Salvare le porte aperte rilevate nell'IP profile del device

### 1.3 Risoluzione ARP (MAC Address e Vendor ID)
- Per ogni IP attivo, risolvere il MAC address via ARP
- Consultare tabella OUI (IEEE) per risolvere i primi 3 byte al vendor produttore NIC
- Salvare MAC e vendor OUI nell'IP profile

### 1.4 Reverse DNS Lookup
- Eseguire query DNS PTR per ogni IP attivo
- Salvare hostname nell'IP profile
- Se la risoluzione fallisce, registrare "non risolto" — mai lasciare il campo vuoto

### 1.5 Lista Device Conosciuti e Monitoraggio Continuo
- I device con profilo dispositivo completo alimentano una lista dedicata per il monitoraggio
- **Questa pagina va creata ex novo nell'interfaccia** — non esiste ancora
- La pagina mostra raggiungibilità in tempo reale con indicazione dei device irraggiungibili e timestamp dell'ultima risposta
- Il monitoraggio avviene tramite polling periodico (ICMP + porta di controllo), configurabile per intervallo

---

## Fase 2 — Scansione Approfondita (NMAP + SNMPwalk)

Obiettivo: raccogliere dati dettagliati su ogni host attivo. Al termine ogni device ha un profilo IP completo e una prima classificazione per marca e tipo.

### 2.1 Scansione NMAP con Profilo Specifico

#### 2.1.1 Porte TCP
- porte definite dalla lista + porte vendor-specifiche (es. 8291 MikroTik Winbox, 8728/8729 RouterOS API, 4343 Ubiquiti, 8080/8443 Synology)
- Salvare porte aperte con servizio rilevato e banner grabbing se disponibile

#### 2.1.2 Porte UDP
- Scansione selettiva su: 161 (SNMP), 162 (SNMP trap), 500 (IKE), 514 (syslog), 5353 (mDNS), 67/68 (DHCP)
- Limitare la scansione UDP alle porte utili — è lenta

#### 2.1.3 SNMP via NMAP
- Usare script NMAP `snmp-brute` e `snmp-info` per verificare risposta SNMP
- Tentare con le community string configurate per la rete (minimo "public" come default)
- Se SNMP risponde, salvare la community string funzionante nell'IP profile

#### 2.1.4 SNMPwalk (se community trovata in 2.1.3)

**2.1.4.1 — Scansione OID da archivio**
- Interrogare OID standard: sysDescr, sysName, sysContact, sysLocation
- SNMPwalk sul sottoalbero enterprises (.1.3.6.1.4.1) per dati vendor-specifici

**2.1.4.2 — Acquisizione marca, modello, firmware, seriale**
- Usare OID vendor-specifici archiviati nel DB interno per ottenere: modello HW, versione firmware, numero seriale, part number
- Il sistema seleziona gli OID automaticamente in base al vendor OUI rilevato nella fase 1.3
- Se il vendor non ha OID in archivio, usare MIB-II standard come fallback

### 2.2 Archivio dati nel profilo IP del device
- Tutti i dati raccolti nelle fasi 2.1.x vanno nel profilo IP del device
- Il profilo IP è la struttura dati intermedia (grezzo) prima di creare il profilo dispositivo definitivo

### 2.3 Assegnazione marca e classificazione
- Usare tutti i dati disponibili (OUI, sysDescr, banner porte, OID SNMP) per assegnare marca e categoria
- Categorie: Switch, Router, Firewall, Access Point, Server, NAS, Hypervisor, Stampante, Telecamera IP, Telefono IP, UPS, Altro
- Algoritmo a punteggio: vince la categoria con più evidenze convergenti
- Se il punteggio è sotto soglia, il device resta "non classificato" per revisione manuale

---

## Fase 4 — Profilazione OS e Acquisizione Credenziali

Obiettivo: collegarsi ai device con credenziali autenticate per raccogliere dati non ottenibili via SNMP/NMAP. Le credenziali funzionanti vengono archiviate per evitare ri-tentativi futuri.

> ⚠️ Le credenziali archiviate sono dati sensibili: devono essere salvate cifrate e mai esposte in chiaro nell'interfaccia.

### 4.1 Windows (WinRM / WMI)
- Connessione WinRM (5985/5986) o WMI con credenziali Windows configurate
- Raccogliere: hostname, dominio, versione OS, RAM, CPU, disco, servizi in esecuzione

### 4.2 Linux (SSH)
- Connessione SSH (porta 22 o custom se rilevata in Fase 2)
- Raccogliere: hostname, distro, versione kernel, CPU, RAM, disco, servizi attivi, interfacce di rete

### 4.3 Proxmox (SSH o API)
- Autenticazione API Proxmox (porta 8006) con token API o username/password, oppure SSH root
- Raccogliere: versione PVE, lista nodi, lista VM/CT con stato, risorse allocate vs. disponibili

### 4.4 Synology e QNAP (SNMP + SSH)
- SNMP v2c/v3 + SSH per entrambi
- Raccogliere: versione OS (DSM/QTS), pool/volumi, stato RAID, spazio usato/libero, temperatura, stato dischi S.M.A.R.T.

### 4.5 MikroTik (SNMP + SSH + API RouterOS)
- SNMP per dati base e OID MikroTik specifici
- SSH per CLI RouterOS, API RouterOS (8728/8729) se disponibile
- Raccogliere: versione RouterOS, modello, seriale, licenza, interfacce, VLAN

### 4.6 UniFi / Omada (SNMP + SSH)
- SNMP + SSH per AP e switch gestiti
- Raccogliere: modello, firmware, SSID configurati, client associati, stato porte PoE

### 4.7 HP ProCurve / Comware (SNMP + SSH)
- SNMP v2c/v3 con OID HP specifici + SSH per CLI
- Raccogliere: modello, firmware, seriale, stato porte, tabella MAC, STP status

### 4.8 Altri device (profili generici o personalizzati)
- Tentare i profili di scansione presenti in archivio
- Se nessun profilo corrisponde: stato "scansione parziale" con i dati raccolti fino a quel punto
- L'operatore può creare profili di scansione personalizzati per categorie non previste

---

## Fase 5 — Raccolta Dati Estesa per Categoria

Obiettivo: scansioni profonde e specifiche per tipo di device per raccogliere tutti i dati di inventario rilevanti.

### 5.0 Prerequisito: spostamento nel gruppo dispositivi
- I device classificati devono essere spostati nel loro gruppo prima di eseguire la Fase 5
- Lo spostamento può essere automatico (se la classificazione è confidente) o manuale
- Le scansioni di Fase 5 usano profili dedicati specifici per ogni gruppo

### 5.1 Switch e Router
- Tabella porte: stato (up/down), velocità, duplex, VLAN, PoE budget
- STP: ruolo porta (root, designated, blocking), bridge ID
- Tabella ARP locale
- Numero seriale e part number

### 5.2 Hypervisor (Proxmox, VMware ESXi, Hyper-V)
- Hardware host: CPU (modello, core, thread, clock), RAM, storage (tipo, capacità)
- Licenza: tipo, scadenza, funzionalità abilitate
- Versione e aggiornamenti disponibili
- Lista VM/CT: nome, stato, vCPU, vRAM, disco, IP, OS guest
- Numero seriale e part number host (via DMI/SMBIOS o iLO/iDRAC)

### 5.3 Access Point WiFi
- Modello, firmware, seriale, part number
- SSID per AP: nome, banda (2.4/5/6 GHz), standard WiFi, canale, potenza TX
- Numero client associati per SSID
- Stato porte cablate sull'AP (se presenti)

### 5.4 Macchine Windows e Linux
- Hardware: CPU, RAM, disco (tipo, capacità, SMART), schede di rete
- Numero seriale chassis e product name (WMI `Win32_ComputerSystem` o `dmidecode`)
- Servizi attivi (lista top servizi, non dump completo)
- Windows: versione OS, build, patch level, dominio AD
- Linux: distribuzione, versione kernel, uptime, utenti con accesso SSH

### 5.5 Altri device (telefoni IP, telecamere, UPS, ecc.)
- Numero seriale via SNMP (sysSerialNumber o OID vendor-specifico)
- Telefoni IP: modello, firmware, MAC, estensione (se ottenibile via SNMP/HTTP)
- Telecamere IP: modello, firmware, risoluzione (se ottenibile via SNMP o ONVIF)
- UPS: stato batteria, carico, autonomia stimata via SNMP (MIB RFC 1628)
- Documentare sempre i limiti di ciò che non è automatizzabile per questa categoria