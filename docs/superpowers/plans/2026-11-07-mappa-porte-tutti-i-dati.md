# Mappa porte: tutti gli oggetti, router trattati come switch, nessun dato perso

**Stato:** chiuso su `dev` (0.9.1001), ok di Riccardo il 07/11 («Sì, procedi»). `main` non toccato. **Livello:** completo (nuove letture sugli apparati dei clienti).
**Richiesta (Riccardo, 07/11):** nella mappa mancano molti oggetti presenti in Topologia; controllare a fondo il match per Ubiquiti, MikroTik e HP; MikroTik deve leggere i dati host dei bridge; ARP e host da tutti gli apparati anche via SNMP; hypervisor e altri apparati hanno più MAC; router e firewall trattati come gli switch per porte e VLAN (MikroTik, UCG, RB5009 e altri); dai router tutte le rotte; non perdere dati.

## Misure (07/11, copie dei DB, sola lettura)

| | Hub | 79993-ipam-2 |
| --- | --- | --- |
| Oggetti in mappa / visibili di default | 488 / 304 | 68 / 68 |
| Nodi di Topologia / fuori mappa | 287 / 26 | 68 / 1 |
| Fuori mappa | 25 apparati (12 server, 5 hypervisor, 8 PC classificati switch) | 1 host |

- Una riga si crea solo da `mac_port_entries`, più le VM accese e gli apparati di rete. Server e hypervisor censiti come apparati spariscono: i loro MAC sono «propri», ma una riga per apparato l'hanno solo gli apparati di rete.
- 184 oggetti sull'hub sono nascosti di default perché vecchi.
- ARP, `dhcp_leases`, `librenms_mac_porta` e `librenms_arp` non entrano nel calcolo. `mac_ip_mapping` tiene un IP per MAC.
- RB5009 (`snmp_v2` con SSH valido): 0 MAC per porta, 0 VLAN, 63 ARP, 6 rotte. `getBridgeHosts` esiste solo per il client SSH.
- MK-RTR-CORE: 10 porte bridge e 12 VLAN in `mikrotik_bridge_*`, 0 in `switch_vlan_porte`.
- UCG e UDM: porte dal controller, 0 ARP, 0 rotte, 0 VLAN. `scriviNative` vale solo per `usw`.
- Switch: 0 ARP su tutti. `vlanSwitchDaLeggere` vale solo per `device_type = switch`, quindi router e firewall sono esclusi.
- 21 MAC hanno più IP in `hosts`.

## Scelte aggiunte da Riccardo (07/11, durante il lavoro)

- «Evitare che ad ogni iterazione si perdano dati»: registro per fonte (`mappa_porte_fonti`), ARP e rotte accumulati (`mappa_porte_visti`, `mappa_porte_rotte`). `switch_ports` non cambia, quindi la Topologia non si muove: è il motivo per cui `is_uplink` arriva alla mappa senza i 4 collegamenti falsi misurati sul ramo sospeso.
- «Per ogni tipologia venga utilizzato il parser»: sull'hub 0 snapshot, i parser partivano solo a mano. Giro ogni 6 ore dietro `mappa_dati`, un adattatore unico dallo schema degli snapshot.
- «Per gli switch la rappresentazione porte e vlan è perfetta, estendiamola a router e firewall»: stesse tab e stessi componenti.
- «Non testare nulla su 72729 … per hp usa 70151, solo dopo testeremo 72729»: la misura HP si fa su 70151.

## Tappe

- [x] **1. Tutti gli oggetti (solo calcolo).** *(Verifica su copia del DB dell'hub: 790 oggetti contro 488, 0 nodi di Topologia assenti contro 26, 0 client di porta assenti contro 6; 199 posizioni fidate su 203 identiche, le altre 4 sono oggetti con più schede.)* Ogni host, apparato e VM ha una riga. Un oggetto fisico raggruppa tutti i suoi MAC e IP (`topology_device_macs`, scansioni Proxmox, `device_interfaces`, ARP, DHCP). Le fonti ARP, DHCP e LibreNMS entrano nel calcolo. Senza porta si dice dove è stato visto (router, VLAN). I vecchi si vedono, col segno. Fatto quando: 0 nodi di Topologia fuori mappa su hub e 79993-ipam-2, confronto col controller non peggiorato.
- [x] **2. Letture MikroTik e ARP.** *(Prove in `arp-mappa-dati.test.ts`; sugli apparati veri: da misurare dopo l'accensione.)* SSH quando è valido anche se il protocollo è SNMP: bridge host, porte e VLAN del bridge sui router. ARP via SNMP (`ipNetToMedia`, poi `ipNetToPhysical`) su tutti gli apparati che rispondono. Nessuna scrittura sugli apparati, levette spente di default. Fatto quando: la RB5009 ha MAC per porta e VLAN.
- [x] **3. UniFi.** Porte, reti, VLAN e rotte del gateway dal controller, native anche su `ugw`/`udm`; client con `sw_mac`/`sw_port` nel calcolo. Prima una lettura a vuoto degli endpoint sul controller vero. Vicini scritti col nome della porta, non `eth0` (anche il difetto di 79993-ipam-2).
- [x] **4. HP.** Su 70151, non sul 72729 (Riccardo): adattatore unico dagli snapshot, nessuna regola per marca. *(ProCurve via SSH e SNMP e Comware letti davvero dal giro delle 18:25: 47 ProCurve e 5 Comware; 2 snapshot in errore.)*
- [x] **5. Router, firewall e switch uguali.** Stessa rappresentazione di porte e VLAN nella scheda «Porte»: bond, bridge e VLAN logiche distinte dalle fisiche. Scheda nuova «Rotte» con tutti i router. Rotte: si tiene lo storico, un giro vuoto non cancella.
- [x] **6. Verifica.** Cancello, resa ≥1280, misure ripetute su hub e 79993-ipam-2, dev. `main` solo col sì.

## Da decidere

Decise il 07/11 coi consigli («Sì, procedi»):
- SSH sui router impostati come SNMP: sì, se la credenziale è già valida.
- Oggetti vecchi: si mostrano col segno.
- 72729: sì a una misura in sola lettura sugli HP.
- «Regole di routing»: tabella di routing (connected, static, BGP, OSPF). Firewall, NAT e policy routing a un secondo giro.
- UCG: si parte dal controller; SSH diretto solo se non basta, e allora si chiede la credenziale.
- `is_uplink`: resta sospeso, questo piano non lo riapre.

## Consuntivo (07/11)

**Fatto.** Tappe 1-6, 0.9.1001 su `dev`, hub e 70151 aggiornati, `mappa_dati` accesa su tutti e due. Registro per fonte, parser ogni 6 ore, adattatore unico, rotte del gateway UniFi, tab Porte/VLAN/Vicini su router e firewall, scheda Rotte.

**Verifica, ricalcolo delle 19:05 UTC sul servizio.** Hub: 791 oggetti contro 488, 0 nodi di Topologia assenti contro 26 (misurato sulla copia), 34 oggetti con più MAC, 70 con più IP, Topologia identica (287 nodi, 71 collegamenti), 115 certe, 73 spiegate, 33 da capire, 106 non so. 70151: 6.999 oggetti, 1.720 con una porta, 62 con più MAC, 4.332 porte di switch (2.359 trunk, 725 accesso). Cancello: esito 0, 7.559 prove. Viste a 1280 sulla copia dei dati dell'hub, senza scorrimento orizzontale.

**Mancante.**
- Non verificato: lo strato del controller e le rotte del gateway UniFi, che arrivano col sync delle 03:00; il PoE dei due switch; RB5009 via SSH (79993-ipam-2 segue `main`). La UDM sulla scheda nuova dipende dallo stesso sync.
- 70151: 5.271 «non so», MAC visti solo su porte di passaggio. Serve seguire i vicini fino all'ultimo switch.
- Router: 0 VLAN via SNMP sull'hub. SNS e simili non rispondono al Q-BRIDGE. I switch UniFi via SNMP danno solo interfacce e ARP.
- MikroTik CRS: tabella MAC del parser in errore su CORE1-A-211 al primo giro manuale; il giro SNMP la copre. PoE `SSH_COMMAND_FAILED` su CORE2-242.
- Firewall, NAT e policy routing: secondo giro, come deciso.

**Scostamenti.** Su richiesta di Riccardo si sono aggiunti registro per fonte e parser a giro. HP su 70151 invece che sul 72729, mai toccato. Un `.env.local` di 79993-ipam-2 caricato con la shell ha stampato un pezzo di un valore; la console UCG ha risposto 429 per troppi login di una sonda.

**Consigli.** Seguire i vicini per i «non so» di 70151. `arpViaSnmp` su server Linux va in timeout a ogni giro: limitarlo agli apparati di rete se pesa. Il rientro di 70151 su `main` va deciso: ora sta su `dev` con `da-ipam-update.timer` spento.
