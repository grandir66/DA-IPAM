# Uscite vere di LibreNMS, anonimizzate

Raccolte il 22/10/2026 dall'API `v0` del LibreNMS dell'hub, in sola lettura (solo GET), per il task 3 del piano
`docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md`. Totali all'origine: 51 apparati, 1088 porte, 109 vicini,
76 VLAN, 3483 righe FDB, 1160 sensori, 3069 righe ARP (`/resources/ip/arp/all`); `/resources/ip/arp/0.0.0.0/0`
risponde senza righe; `/resources/ports_vlans` dà **404** (la VLAN per porta non ha una rotta: spec §4.7).

Anonimizzazione **a chiusura**, fatta sull'hub prima che i file uscissero:

- ogni array è tagliato a 25 righe (i conteggi qui sopra sono quelli veri);
- IP → `192.0.2.N`, MAC → `020000xxxxxx` (stesso formato dell'originale), coerenti fra i file: lo stesso valore vero
  ha lo stesso segnaposto ovunque, così i join si possono provare;
- ogni altra stringa → `<campo>-N`, tranne un elenco breve di campi non identificativi (stati, tipi, `os`,
  `hardware`, `version`, nomi di porta standard); nei `hardware` i nomi di macchina e gli ID fra parentesi sono
  segnaposto, i nomi di interfaccia non standard (VLAN con nomi parlanti) sono `ifname-N`.

Non contengono token, IP, MAC, nomi o seriali veri. Non rigenerarle a mano dal DB: rifarle con lo stesso criterio.

## `forma-sconosciuta/`

Risposte **inventate** (nessun dato vero), una per parte, con la forma che un aggiornamento dell'API potrebbe dare: lista
come oggetto, id come testo, chiave rinominata (`data`, `mac`, `ip`), campo chiave assente (`vlan_vlan`), numero come
testo, lista nulla. Ogni lettore deve rispondere «non so» (spec §4.2, caso 1 del piano), mai una lista a metà.
