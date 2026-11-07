# ADR 0035 — Installazione snella dal cliente, collegata a un centrale che riceve e ordina

**Stato:** Accepted
**Data:** 2026-11-07
**Autore:** Riccardo Grandi, con Claude

## Contesto

Riccardo vuole dai clienti qualcosa di più leggero dell'appliance attuale, che chiede 16 GB (32 con altri moduli) e un'immagine di ~15 GB di cui ~11 di Greenbone. Lo scopo: dati centralizzati, inventario distribuito per cliente, monitoraggio dei sistemi, scansione delle reti col trunk, scansione dei device coi motori studiati, config di switch, router, Proxmox, MikroTik e altri prodotti. Nient'altro.

Il primo disegno era una VM con solo un esecutore, comandata da un DA-IPAM centrale. L'agente Python remoto fece la stessa cosa e fu tolto il 20/10 perché nessuno lo usava. Il costo vero di quel disegno sta in DA-IPAM: `lib/executor` copre solo ping, nmap e DNS, mentre `ssh2` e `net-snmp` sono usati diretti in 20 file.

## Decisione

**L'installazione DA-IPAM resta dal cliente, snella, e fa tutto il lavoro. Un DA-IPAM centrale ridotto, con un DB per `codcli`, riceve le copie, le mostra e manda ordini da un elenco chiuso.** Riccardo, 07/11: «Installazione snella».

- Snella vuol dire senza Edge, Greenbone e LibreNMS quando il cliente non li ha, e se si riesce senza Docker. Restano DA-IPAM, `sensore-trunk` e il proxy Zabbix, che è opzionale e di DA-Zabbix.
- Il centrale non scansiona, non pianifica e non tiene credenziali degli apparati.
- Il trasferimento generalizza `lib/vulcan/coda.ts`. Quanto esce lo decide l'installazione, con un terzo livello accanto a `solo_stato` e `stato_inventario`.
- Ogni connessione la apre l'installazione: l'ADR 0011 non cambia. Gli ordini sono firmati, scadono, sono scritti in un elenco chiuso nel codice dell'installazione e finiscono nel giornale locale. Viaggiano su una chiamata a parte, non sulla risposta del segnale.
- Sul centrale il `codcli` viene dal gettone, mai dai dati inviati, e non esiste ripiego su `DEFAULT`.

Un'installazione resta un cliente: la decisione del 12/10 vale ancora. Il tenant è un confine solo nel centrale.

## Alternative scartate

- **VM con solo esecutore** — risparmia circa 2 GB e 20 GB per cliente (stime), al prezzo di riscrivere la frontiera dello scanner, perdere la pagina locale e rallentare ogni lettura nuova.
- **Un DA-IPAM centrale per cliente** — confine più forte, ma N macchine in più a Domarc. Non serve con un centrale che riceve soltanto.
- **Rotta NetBird verso la LAN del cliente** — vietata dall'ADR 0011 e incompatibile con un elenco chiuso di azioni.

## Conseguenze

### Positive

- Scanner, motori e acquisizioni non si toccano.
- Se cade NetBird le installazioni continuano, con la pagina locale.
- Una violazione del centrale non espone le credenziali degli apparati.

### Negative

- Una copia di DA-IPAM per cliente: aggiornamenti e falle dell'applicazione restano N volte.
- Lo stesso codice ha due modi di funzionare, installazione e centrale.

## Cosa diventa difficile in futuro

- Il centrale vede con ritardo e le due copie possono divergere: una cancellazione dal cliente va propagata.
- Le config sono il dato più delicato del centrale, segreti compresi.
- Il notebook dei tecnici non nasce da qui: servirà estrarre `lib/acquisition` in un programma a parte.
- Una VM più sottile, in futuro, richiederebbe di portare scansioni e pianificazione nel centrale.
