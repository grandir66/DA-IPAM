# Servizi di rete — le tre parti rimaste (handoff, 09/11/2026)

Prompt per una sessione nuova (altro modello o Codex). La sessione del 09/11 ha già
aggiunto a DA-IPAM, su `dev` (da v0.9.1039 a v0.9.1043): pagina «Servizi di rete», sonde
senza credenziali (banner/HTTP/TLS/SSH), giro leggero sulle 1000 porte più usate, reti del
trunk proposte da confermare, giro automatico. **Leggere prima** `TASKS.md` (sezioni del
09/11) e `CHANGELOG.md`. Tre parti sono rimaste fuori; qui il piano per riprenderle.

Tutto è analisi/inventario difensivo sulle reti dei clienti Domarc, dentro il prodotto DA-IPAM.
Rispettare le regole del repo (CLAUDE.md, STILE-UI.md, `withTenantFromSession`, versioning).

## Codice da riusare (non riscrivere)
- `src/lib/servizi-rete/{sonde,db,giro,porte}.ts` — sonde, tabella `servizi_rete`, giro, porte.
- `src/lib/trunk/*` — la sonda trunk legge già NetBIOS, mDNS, SNMP (sysName/engineID), LLDP, CDP.
- DA-Vul-can `infra/scanner-edge/app/scanner_edge/sensore/` — `giro.py` (funzione del ping per
  VLAN) e `services/vlan.py` (sotto-interfaccia col tag nello spazio di rete `trunk`).

## 1. Identità senza credenziali (proposte, mai fusioni automatiche)
Obiettivo: riconoscere lo stesso apparato su più IP. Le sonde già salvano l'impronta della
chiave SSH e l'SHA-256 del certificato TLS; la sonda trunk salva NetBIOS, mDNS, SNMP engineID.
Da fare: una tabella di «prove di identità» per host e un calcolo che, quando due IP portano la
stessa impronta forte, le mostra come proposta «stesso apparato» in un pannello da confermare.
Accettazione: due IP con la stessa chiave SSH compaiono come proposta; conferma collega, rifiuto
no; nessuna fusione automatica; isolamento tenant.

## 2. Matrice di segmentazione (misurare quali reti raggiungono quali)
Sonda (DA-Vul-can): un endpoint nuovo sul socket della sonda che, data una VLAN sorgente e una
lista di bersagli `ip:porta` già noti, riusa lo schema del ping per VLAN (sotto-interfaccia col
tag nello spazio `trunk`, IP libero verificato, rotta verso il gateway della VLAN, poi tutto
tolto) e riferisce per ciascun bersaglio l'esito: raggiunto / chiuso / filtrato / senza rotta.
Un lavoro alla volta (stesso lock del giro). Livello completo: manda traffico nelle reti cliente.
DA-IPAM: tabella delle prove; un giro che per ogni VLAN sorgente sceglie i servizi già noti delle
altre reti (max 40 per cella, prima i servizi di gestione) e chiama la sonda; pagina «Matrice di
segmentazione» (menu Sicurezza): tessere coi numeri, matrice rete×rete «raggiunti/totale · chiusi
· filtrati», clic su una cella → elenco, seconda vista servizio × rete sorgente.
Collaudo: rendere trunk la scheda della VM 963 sul Proxmox di casa con le VLAN 102 e 103, snapshot
prima. Oggi la 963 vede solo la VLAN nativa.

**Richiede una riconfig del deploy (Riccardo, 10/11/2026).** La matrice non gira sulla scheda
condivisa: il sensore in modo «condivisa» (NIC dell'IP ufficiale) la rifiuta con 400 «usa la NIC
trunk dedicata» — provato sulla sonda 963, `modo: condivisa` su eth0. Perché funzioni dai clienti
serve che ogni appliance nasca con una **porta trunk dedicata**, non su richiesta:
- **Deploy-Appliance**: seconda scheda in trunk di serie (`config.yaml`, installer con `--trunk-nic`
  dedicata / su Proxmox `--trunk-bridge` + `--trunk-vlans`); oggi `trunk_sensore` è opzionale.
- **Immagini / provisioning (DA-Link)**: la VM va creata con quella seconda scheda su un bridge
  VLAN-aware in trunk.
- **Conseguenza nota**: con il sensore su NIC dedicata le sorgenti ARP `vlan-subif` su quella
  scheda non valgono più (doc del sensore trunk) — decidere come conviverci.
Finché il deploy non cambia, la matrice si prova solo dove c'è già un trunk dedicato.

## 3. NTLM (pezzo opzionale dell'identità)
Un server SMB/RDP/HTTP-negotiate riporta nome, dominio e versione del sistema nella risposta di
negoziazione, prima dell'autenticazione. È una prova in più per l'identità del punto 1. Da
valutare dopo 1 e 2.

## Decisioni già prese da Riccardo (09/11)
IP libero verificato via ARP (niente lease DHCP) · uscita dal gateway della VLAN visto dal trunk ·
servizi noti, max 40 per cella, prima i servizi di gestione · ripetizione settimanale accesa di
serie, spegnibile per cliente · collaudo con trunk 102/103 sulla 963 · livello completo sulla
sonda, leggero su DA-IPAM.
