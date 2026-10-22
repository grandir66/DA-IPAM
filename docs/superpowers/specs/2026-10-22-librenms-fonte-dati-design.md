# LibreNMS come fonte di dati degli apparati SNMP — design

**Data:** 2026-10-22 · **Autore:** Riccardo Grandi, con Claude · **Stato:** approvato da Riccardo il 22/10 («si procediamo col piano»)

## 1. Perché

LibreNMS è già installato nell'appliance (modulo locale, vincolo del 16/10: «LibreNMS solo locale integrato») e interroga
già via SNMP gli apparati che DA-IPAM gli manda. Raccoglie porte, vicini LLDP/CDP, VLAN, MAC per porta, ARP, inventario
fisico e sensori per centinaia di marche. DA-IPAM oggi ne usa solo i grafici. L'idea di Riccardo: **leggere quei dati
invece di costruire motori nostri** per gli oggetti che hanno SNMP, e farli aggiungere a LibreNMS da soli quando l'SNMP
risponde.

## 2. Misura sul dato vero (hub, 22/10 10:20 ora italiana, sola lettura)

LibreNMS dell'hub (`da-librenms`, `http://192.168.4.8:8090`, API `/api/v0`, token di DA-IPAM), 51 apparati, contro il DB
del cliente `70791` sullo stesso hub:

| Dato | LibreNMS (API o tabella) | DA-IPAM, motori propri |
| --- | --- | --- |
| Porte | 1088 (`/ports?columns=…`) | `switch_ports` 317 |
| Vicini LLDP/CDP | 109 da 14 apparati (`/resources/links`), tutti i MikroTik | `device_neighbors`: `device` 55 righe da **1** apparato; `unifi` 69 da 14; `host` 41 da 5 |
| MAC per porta | 3483 da 14 apparati (`/resources/fdb`) | `mac_port_entries` 1219 |
| VLAN | 76 da 6 switch (`/resources/vlans`); VLAN per porta 1479 righe in `ports_vlans` | `switch_ports.vlan`, tabelle ADR 0029 (lettura spenta) |
| ARP | 3069 da 35 apparati (tabella `ipv4_mac`) | `arp_entries` 334 |
| Inventario fisico | 227 righe da 15 apparati (`entPhysical`) | — |
| Sensori | 1160: 233 temperature, 32 ventole, 106 tensioni, 100 correnti, 198 dBm ottici, 417 stati, batteria e autonomia UPS | — |

Tempi: ogni chiamata sotto 0,21 s; tutto insieme circa 3 MB. LibreNMS aggiorna stato, contatori e sensori ogni 5 minuti,
porte, vicini, VLAN, FDB, ARP e inventario alla discovery (ogni 6 ore).

Trovato insieme:
- **5 apparati aggiunti a forza e mai interrogati** (`last_polled` nullo: `.4.10`, `.4.19`, `.4.40`, `.4.41`, `.4.42`), più
  7 giù da giorni o mesi: effetto di `force_add: true` (`librenms-sync.ts`, due punti) che fa accettare l'apparato anche
  se l'SNMP non risponde.
- **Solo v2c**: `campiSnmpPerLibreNms` manda sempre `snmpver: "v2c"`; una voce v3 diventa ping-only, una v1
  (`network_devices.snmp_version = '1'`, gli airFiber) parte come v2c.
- `/resources/ip/arp/0.0.0.0%2F0` risponde vuoto: la forma va provata (`/resources/ip/arp/all` o `…/0.0.0.0/0`), il dato c'è.
- Vicini con `remote_device_id = 0`: apparati che LibreNMS vede ma non interroga (UCG-Fiber, due switch di gestione).
- Il token di LibreNMS non si legge dal suo DB (`personal_access_tokens` ne tiene l'impronta): l'unica copia è quella
  cifrata di DA-IPAM (`integration_librenms_api_token` nelle settings dell'hub).

## 3. Cosa si fa

**A. Aggiunta corretta degli apparati.** Niente `force_add`: LibreNMS prova l'SNMP e rifiuta se non risponde; il rifiuto
si scrive con il motivo (`librenms_host_map.last_status`) e si vede a schermo. Versione dalla credenziale vera: v1 se
`snmp_version = '1'`, v2c, v3 con utente, livello e algoritmi (`credenzialeSnmpApparatoDb`, forma `v3`). Gli apparati già
in LibreNMS e mai interrogati si mostrano come tali, **non si tolgono da soli**.

**B. Lettura dei dati di LibreNMS** in tabelle proprie di DA-IPAM (`librenms_*`), fotografia dell'ultima lettura buona
(come ADR 0027/0029): porte, vicini, VLAN, VLAN per porta (se l'API la dà), MAC per porta, ARP, inventario, sensori, dati
dell'apparato. Dietro un interruttore **spento di default** per cliente; il giro sta nel job `librenms_sync` già esistente
(niente tipo di job nuovo, niente CHECK da ricostruire), al più ogni 15 minuti.

**C. La scheda dell'oggetto** mostra questi dati: tab nuova «Sensori» (ambiente), righe di LibreNMS nelle tab Porte e
Vicini come fonte dichiarata, LibreNMS nella riga «Dati da:» con l'ora. Tavola grafica da approvare prima del codice.

**D. Candidati dai vicini**: i vicini che LibreNMS vede ma non interroga, risolti a un host di DA-IPAM, compaiono come
«da aggiungere a LibreNMS»; si aggiungono con un clic (admin), con la stessa prova SNMP di A.

**E. (zona rossa, separata) LibreNMS nella mappa**: i vicini di LibreNMS entrano in `device_neighbors` con
`source = 'librenms'` e T1 li legge, dietro un secondo interruttore spento, solo dopo la misura del prima/dopo sulla copia
dell'hub con `scripts/misura-cavi.ts`.

## 4. Regole (da non rivedere per simmetria)

1. **Nessun traffico nuovo verso gli apparati dei clienti**: si legge solo l'API di LibreNMS locale. L'unica azione verso
   gli apparati resta quella di LibreNMS, che già c'è.
2. **«Non so» non cancella**: una parte che non risponde, risponde con un codice diverso da 200, o con una forma non
   capita, non tocca la sua tabella (restano le righe dell'ultima lettura buona, con la loro data). Una risposta 200 con
   lista vuota è un fatto (fotografia vuota). La regola sta nella funzione che scrive, che lancia su un esito diverso da
   `letto` (come `scriviVlanSwitch`, ADR 0029).
3. **Le tabelle `librenms_*` non le legge la mappa** finché E non è accesa; E scrive in `device_neighbors`, e T1 spento
   resta bit per bit quello di prima (`misura-cavi`).
4. Le chiavi sono di LibreNMS (`librenms_device_id`, `port_id`); l'aggancio all'oggetto di DA-IPAM passa da
   `librenms_host_map` (IP) e, per la scheda, dall'IP dell'host o dell'apparato. Nessuna `FOREIGN KEY` verso
   `network_devices`: la maggior parte degli oggetti di LibreNMS sono host senza apparato.
5. Il token non esce dal server; nei log nessun IP, nome, community o MAC (esito con numeri e codici).
6. Le migrazioni sono additive (`librenms_fonte_v21`), le CREATE solo nella migrazione, senza `IF NOT EXISTS` (ADR 0029 §4);
   migrazione fallita = il tenant si apre, la lettura non scrive.
7. Una parte che l'API non dà (per esempio la VLAN per porta) **si dichiara assente**, non si ricava da altro.

## 5. Precedenza fra le fonti (per dato)

| Dato | Chi vince nella scheda | Perché |
| --- | --- | --- |
| Sensori, inventario fisico | LibreNMS (unica fonte) | non li abbiamo |
| Porte (stato, velocità, alias) | il nostro dato se più recente di 1 h, altrimenti LibreNMS | i nostri motori leggono a ogni giro ARP |
| Vicini | si mostrano entrambi, con la fonte; righe uguali (porta locale, nome, porta remota) una volta sola con le due fonti | il disaccordo si vede |
| MAC per porta, ARP | il nostro dato (la mappa e Discovery lo usano già); LibreNMS solo dove noi non abbiamo niente per quell'apparato | non si toccano i giri esistenti |
| VLAN | tabelle ADR 0029 se lette, altrimenti LibreNMS | la matrice U/T sta lì |

Con Zabbix acceso nessun cambio: questa spec non tocca le misure di disponibilità (proposta del 16/10).

## 6. Fuori

Grafici (ci sono già), allarmi di LibreNMS, configurazione di LibreNMS (moduli, autodiscovery), un LibreNMS esterno,
spegnere i nostri motori (si decide dopo E con la misura), il telefono (scheda da scrivania).

## 7. Cosa diventa difficile

- Due copie degli stessi fatti con età diverse (le nostre e quelle di LibreNMS): la scheda deve sempre dire la fonte e l'ora.
- LibreNMS cambia la sua API tra le versioni (`librenms/librenms:latest`): i lettori devono rifiutare una forma non
  capita invece di scrivere a metà; le prove usano uscite vere salvate (senza nomi né IP).
- `port_id` di LibreNMS cambia se l'apparato si toglie e si riaggiunge: la fotografia si rifà, la storia non c'è.
