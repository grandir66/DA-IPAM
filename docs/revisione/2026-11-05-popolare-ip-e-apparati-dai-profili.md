# Usare i dati dei profili per popolare la tabella degli IP e quella degli apparati — valutazione

**Richiesta di Riccardo (05/11/2026):** «andrebbe valutato come usare i dati acquisiti per popolare
la tabella degli ip e dei devices».

**Metodo:** misurato sull'appliance del **72729** (l'unica dove i profili sono girati: IoT/OT il
04/11 alle 16:51, Approfondito alle 17:07), in sola lettura, entrando dal Proxmox del cliente.
Nessuna modifica fatta: questo documento è una valutazione, non un piano approvato.

## 1. Com'è oggi, in numeri

**Tabella degli IP (`hosts`), 132 righe:**

| colonna | piene | |
| --- | --- | --- |
| `classification` | 132 | ma 45 sono `unknown` |
| `vendor` | 116 | dall'OUI del MAC |
| `device_manufacturer` | 108 | |
| `mac` | 118 | |
| `hostname` | 46 | 35% |
| `os_info` | 46 | 35% |
| **`model`** | **14** | 11% |
| **`serial_number`** | **11** | 8% |
| **`firmware`** | **6** | 5% |

**Tabella degli apparati (`network_devices`), 22 righe:** `model` 11, `serial_number` 10,
`firmware` 8, `sysdescr` 12. Metà vuote.

**Classi:** `unknown` 45 · `iot` 18 · `workstation` 18 · `hmi` 11 · `server` 10 · `stampante` 10 ·
`rete_ot` 8 · `access_point` 3 · `switch` 3 · `hypervisor` 2 · `firewall` 1 · `nas` 1.

## 2. Perché le tabelle restano vuote: tre cause distinte

### (a) Il profilo è girato dove non serviva — la più importante

I rilievi esistono su **13 host**: 10 server, un hypervisor, un NAS, un VoIP. Fra gli host che
hanno davvero bisogno di essere identificati, i rilievi sono **zero**:

| classe | host | con rilievi | con porte aperte |
| --- | --- | --- | --- |
| `unknown` | 45 | **0** | 17 |
| `iot` | 18 | **0** | 13 |
| `workstation` | 18 | **0** | 17 |
| `hmi` | 11 | **0** | 11 |
| `rete_ot` | 8 | **0** | 6 |

Il profilo si lancia **sugli host scelti a mano nella lista** (decisione del 04/11), e la scelta è
caduta sui server. Gli 11 HMI hanno tutti porte aperte e nessuno è stato interrogato. Finché il
giro non punta lì, nessuna lettura, per buona che sia, riempirà le colonne.

### (b) La lettura copre 15 script, e lascia fuori proprio quelli del modello

`fattiDaScript` conosce 15 script. Nel giro del 72729 hanno risposto **18 tipi**, e **15 tipi non
producono nessun campo**: `http-headers` (15 host), `http-server-header` (10), `fingerprint-strings`
(7), `banner` (6), `smb2-security-mode` e `smb2-time` (5), `ldap-rootdse` e `ntp-info` (3),
`http-favicon` e **`snmp-info`** (2), `rpcinfo`, **`vmware-version`** (1). Il grezzo è in
`host_profilo_rilievi`, nessuno lo legge: la lettura ha il caso `snmp-sysdescr`, non `snmp-info`.
È qui che si perdono modello, firmware e sistema operativo di NAS, ESXi/vCenter e domain controller.

### (c) Gli apparati non li tocca nessuno

`src/lib/scanner/profili/salva.ts` scrive su `hosts` e sulle evidenze dell'attribuzione. In tutto
`src/lib/scanner/profili/` **non c'è un riferimento a `network_devices`**: il modello e il seriale
che il profilo legge non arrivano all'apparato, che li prende solo dai collector, da SNMP, da ONVIF
o dall'impronta. Un apparato con l'host già rilevato resta con le sue colonne vuote.

## 3. Cosa si potrebbe popolare, e da cosa

| colonna da riempire | da quale script | oggi |
| --- | --- | --- |
| `model`, `firmware`, `os_info` di NAS e stampanti | `snmp-info` (sysDescr, sysObjectID) | buttato |
| `model`, `firmware` di ESXi/vCenter | `vmware-version` | buttato |
| `dominio`, nome del dominio, ruolo DC | `ldap-rootdse` | buttato |
| prodotto e versione dei servizi web | `http-server-header`, `http-headers`, `banner` | buttato |
| `model`, `serial_number`, `firmware` di PLC e HMI | `s7-info`, `enip-info`, `omron-info`, `bacnet-info` | **già letti**, mai arrivati a un apparato vero |
| nome, dominio, NetBIOS, OS dei Windows | `rdp-ntlm-info`, `nbstat` | già letti e scritti |
| produttore e nome da certificato | `ssl-cert` | già letti e scritti |

## 4. Tre interventi, in ordine di resa

1. **Puntare il profilo dove mancano i dati** (nessun codice nuovo, solo esercizio): un giro
   Approfondito + IoT/OT sui 45 `unknown` e sui 19 fra `hmi` e `rete_ot` che hanno porte aperte.
   Costo: ~64 host, con `--version-intensity 7` è la voce da misurare prima (oggi non misurata).
   Resa attesa: è l'unico intervento che riempie qualcosa **senza toccare il codice**.
2. **Estendere la lettura ai tre script che contano** (`snmp-info`, `vmware-version`,
   `ldap-rootdse`): funzioni pure, si provano con fixture, nessun rischio sul dato — la scrittura
   resta «riempie e non sovrascrive». Mezza giornata, prove comprese.
3. **Propagare all'apparato** quello che il profilo ha letto sull'host (`model`, `serial_number`,
   `firmware`), con le stesse regole della classificazione: solo colonne vuote, mai sopra un dato
   messo a mano, e l'apparato si trova dall'`host_id`. È il pezzo più delicato: `serial_number` è
   la chiave degli apparati fisici (`devices/seriale-valido.ts` scarta le stringhe IEEE 1284 e i
   nomi di serie), quindi un seriale sbagliato non è un campo sbagliato, è un apparato sbagliato.

## 5. Rischi e regole da non violare

- **Riempie e non sovrascrive**, già così per gli host: va mantenuto anche per gli apparati, e
  `classification_manual` / i dati messi a mano vincono sempre.
- **Il seriale è una chiave**: prima di propagarlo agli apparati va passato da `serialeValido` e
  misurato su quanti host cambierebbero, con prova a vuoto.
- **Niente script `intrusive`** in nessun profilo (vincolo del 04/11, e una prova lo fissa).
- **Costo del giro**: `--version-intensity 7` vive solo dentro il profilo, ma su 64 host non è
  stato misurato. Prima di un giro largo serve il tempo per host su un campione.
- **Dati del cliente**: `mqtt-subscribe` porta payload di processo (conseguenza già a verbale il
  04/11); su un giro largo il tetto in byte va verificato, non assunto.

## 6. Domande aperte per Riccardo

1. Il giro largo sui 64 host indecisi: si lancia a mano una volta per vedere la resa, o si vuole
   prima la misura del costo per host?
2. La propagazione agli apparati la vogliamo **automatica** (il profilo riempie l'apparato) o
   **proposta** (si vede nella scheda e si accetta), come per l'assegnatario?
3. I tre script nuovi: li leggiamo tutti e tre, o si parte da `snmp-info`, che è quello che tocca
   più apparati (NAS, stampanti, switch)?
