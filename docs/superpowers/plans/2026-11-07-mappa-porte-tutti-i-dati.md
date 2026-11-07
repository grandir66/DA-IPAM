# Mappa porte: tutti gli oggetti, router trattati come switch, nessun dato perso

**Stato:** in corso, ok di Riccardo il 07/11 («Sì, procedi»). **Livello:** completo (nuove letture sugli apparati dei clienti).
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

## Tappe

- [x] **1. Tutti gli oggetti (solo calcolo).** *(Verifica su copia del DB dell'hub: 790 oggetti contro 488, 0 nodi di Topologia assenti contro 26, 0 client di porta assenti contro 6; 199 posizioni fidate su 203 identiche, le altre 4 sono oggetti con più schede.)* Ogni host, apparato e VM ha una riga. Un oggetto fisico raggruppa tutti i suoi MAC e IP (`topology_device_macs`, scansioni Proxmox, `device_interfaces`, ARP, DHCP). Le fonti ARP, DHCP e LibreNMS entrano nel calcolo. Senza porta si dice dove è stato visto (router, VLAN). I vecchi si vedono, col segno. Fatto quando: 0 nodi di Topologia fuori mappa su hub e 79993-ipam-2, confronto col controller non peggiorato.
- [~] **2. Letture MikroTik e ARP.** SSH quando è valido anche se il protocollo è SNMP: bridge host, porte e VLAN del bridge sui router. ARP via SNMP (`ipNetToMedia`, poi `ipNetToPhysical`) su tutti gli apparati che rispondono. Nessuna scrittura sugli apparati, levette spente di default. Fatto quando: la RB5009 ha MAC per porta e VLAN.
- [ ] **3. UniFi.** Porte, reti, VLAN e rotte del gateway dal controller, native anche su `ugw`/`udm`; client con `sw_mac`/`sw_port` nel calcolo. Prima una lettura a vuoto degli endpoint sul controller vero. Vicini scritti col nome della porta, non `eth0` (anche il difetto di 79993-ipam-2).
- [ ] **4. HP.** Match su ProCurve e Comware: FDB, ARP e LLDP dai collector verso la mappa. Da misurare sul 72729, col sì di Riccardo.
- [ ] **5. Router, firewall e switch uguali.** Stessa rappresentazione di porte e VLAN nella scheda «Porte»: bond, bridge e VLAN logiche distinte dalle fisiche. Scheda nuova «Rotte» con tutti i router. Rotte: si tiene lo storico, un giro vuoto non cancella.
- [ ] **6. Verifica.** Cancello, resa ≥1280, misure ripetute su hub e 79993-ipam-2, dev. `main` solo col sì.

## Da decidere

Decise il 07/11 coi consigli («Sì, procedi»):
- SSH sui router impostati come SNMP: sì, se la credenziale è già valida.
- Oggetti vecchi: si mostrano col segno.
- 72729: sì a una misura in sola lettura sugli HP.
- «Regole di routing»: tabella di routing (connected, static, BGP, OSPF). Firewall, NAT e policy routing a un secondo giro.
- UCG: si parte dal controller; SSH diretto solo se non basta, e allora si chiede la credenziale.
- `is_uplink`: resta sospeso, questo piano non lo riapre.
