# DA-IPAM — il prodotto

*Questa è la prima pagina del manuale. Ogni pagina del programma ha la sua guida, che si apre col **?** in alto a
destra della pagina stessa; qui c'è il quadro d'insieme e l'elenco di tutte le voci del menu, con il rimando alla
guida di ciascuna.*

## Che cos'è DA-IPAM

DA-IPAM è il programma che Domarc installa presso un cliente per **sapere cosa c'è nella sua rete, com'è fatto e
quanto è esposto**. Gira su una piccola macchina dedicata (l'«appliance»), dentro la rete del cliente, e da lì:

- **trova** ogni apparato collegato: PC, telefoni, stampanti, server, switch, access point, telecamere, impianti;
- **lo riconosce**: che cos'è, chi lo produce, che sistema ha, su quale porta dello switch è attaccato, chi lo usa;
- **ne tiene l'inventario**: asset, assegnatari, ubicazioni, licenze, software installato, servizi critici per NIS2;
- **ne controlla la sicurezza**: vulnerabilità, porte aperte e servizi esposti, segmentazione fra le reti, traffico
  anomalo, salute di Active Directory, aggiornamenti mancanti;
- **lo tiene d'occhio nel tempo**: cosa cambia, cosa si spegne, cosa compare di nuovo.

Un'installazione corrisponde a un cliente. Chi entra vede i dati di quel cliente; i tecnici Domarc possono avere
un'installazione con più profili cliente.

## Come è organizzato

In cima al menu a sinistra c'è la [Dashboard](pagine/dashboard.md), poi i gruppi. Ognuno risponde a una domanda.

| Gruppo | La domanda | Dove si comincia |
|---|---|---|
| **Network** | Cosa c'è nella rete e com'è collegato? | [Apparati](pagine/discovery.md) |
| **Sicurezza** | Cosa c'è da sistemare e quanto è esposta la rete? | [Findings](pagine/vulnerabilities.md) |
| **DatIA Mon** | Gli apparati monitorati stanno bene? (Zabbix) | [Apparati monitorati](pagine/zabbix.md) |
| **Inventario** | Di chi è, dove sta, a cosa serve? | [Asset](pagine/inventory.md) |
| **Network Services** | DNS e DHCP funzionano? | [Panoramica](pagine/network-services.md) |
| **Applicativi** | Aggiornamenti, controllo remoto e le console dei prodotti collegati | [Patch Management](pagine/patch-management.md) |
| **Sistema** | Cosa sta girando, e come è configurata l'installazione? | [Impostazioni](pagine/settings.md) |

I gruppi Inventario, Network Services e Applicativi compaiono, o restano grigi, secondo i moduli accesi.

Molte pagine hanno in cima una **fila di schede**: sono le pagine sorelle della stessa sezione (per esempio Apparati ha
Elenco, Attribuzione, Cambiamenti, IP esclusi). Ogni scheda ha la sua parte di guida.

## I moduli

Alcune funzioni dipendono da moduli che si accendono per cliente, da [Impostazioni › Moduli](pagine/settings.md#moduli).
Senza il modulo la voce del menu resta grigia.

- **Scanner-Edge**: la sonda di vulnerability assessment (Greenbone) che fa le scansioni profonde.
- **Patch Management**: aggiornamenti mancanti e CVE per apparato e per software.
- **Network Services**: controllo dei servizi DNS e DHCP.
- **LibreNMS** e **Zabbix**: monitoraggio degli apparati nel tempo.
- **Graylog** e **Wazuh**: raccolta dei log e allarmi di sicurezza dei computer.
- **MeshCentral**: controllo remoto dei computer.
- **Inventory Agent (GLPI)**: inventario letto dall'interno dei computer.
- **Inventario NIS2**: asset, servizi critici e classificazione richiesti dalla norma.
- **Controller UniFi** e **MDM (Headwind)**: dati dai controller Wi-Fi e dai telefoni aziendali.

## Network

- [Subnet](pagine/networks.md): le reti del cliente. Da qui si aggiunge una rete e si decide come scansionarla. Ogni
  rete ha la sua [pagina di dettaglio](pagine/networks-id.md) e i suoi [cambiamenti](pagine/network-changes.md).
- [Apparati](pagine/discovery.md): l'elenco di tutto quello che c'è in rete. Le schede sorelle sono
  [Attribuzione](pagine/controllo-classificazione.md), che serve a controllare e correggere che cos'è ogni apparato,
  [Cambiamenti](pagine/network-changes.md) e [IP esclusi](pagine/excluded-ips.md). Ogni apparato ha la sua
  [scheda](pagine/objects-id.md).
- [Topologia](pagine/topology.md): la mappa di come sono collegati gli apparati. Le schede sorelle sono la
  [Tavola di cablaggio](pagine/topology-tavola.md), le [Porte](pagine/port-map.md) degli switch, la
  [Tabella ARP](pagine/arp-table.md) e i [Dati della mappa](pagine/topology-dati.md).
- [Software](pagine/software.md): i programmi installati sui computer.
- [Active Directory](pagine/active-directory.md): il dominio Windows del cliente (computer, utenti, DNS, DHCP).
- [Credenziali](pagine/credentials.md): le chiavi con cui DA-IPAM legge gli apparati, con i
  [Controller di rete](pagine/controllers.md).
- Le pagine dei [dispositivi gestiti](pagine/devices.md), dei [router](pagine/devices-id.md) e degli
  [switch](pagine/devices-id.md).

## Sicurezza

- [Findings](pagine/vulnerabilities.md): tutto quello che c'è da sistemare, dal più grave.
- [Scansioni](pagine/scans.md): le scansioni interne e quelle di [vulnerability assessment dall'Edge](pagine/vulnerabilities-scansioni.md).
- [Rete](pagine/servizi-rete.md): com'è esposta la rete. Le schede sorelle sono
  [Chi raggiunge cosa](pagine/segmentazione.md), [Traffico](pagine/traffico.md) e quello che sente la sonda sul trunk
  ([Allarmi, VLAN e apparati annunciati](pagine/arp-table-trunk.md)).
- [Protezione](pagine/protezione.md): come è difesa l'installazione stessa. È visibile solo agli amministratori.
- [Alert sicurezza](pagine/security-alerts.md): gli allarmi dei computer (Wazuh).
- [Sicurezza del dominio](pagine/sicurezza-dominio.md): la salute di Active Directory.

## DatIA Mon

Il monitoraggio con Zabbix, dove il modulo è acceso: la [pagina del cliente](pagine/cliente-monitoring.md), gli
[apparati monitorati](pagine/zabbix.md), per gli amministratori l'[elenco da gestire](pagine/zabbix-apparati.md) e
l'[aggiunta di un apparato](pagine/zabbix-aggiungi.md). Gli [host conosciuti](pagine/monitoring-known-hosts.md) sono
gli apparati che DA-IPAM stesso tiene d'occhio.

## Network Services

La [Panoramica](pagine/network-services.md), il [DNS](pagine/dns.md) e il [DHCP](pagine/dhcp.md) con le sue
[sorgenti](pagine/dhcp-sources.md).

## Applicativi

- [Patch Management](pagine/patch-management.md): aggiornamenti mancanti, [CVE](pagine/patch-management-cve.md) e
  [storico](pagine/patch-management-history.md).
- [Controllo remoto](pagine/rmm.md): i computer raggiungibili con MeshCentral.
- Le console dei prodotti collegati (LibreNMS, Graylog, Wazuh e gli altri) si aprono in una scheda nuova del browser.

## Inventario

- [Asset](pagine/inventory.md), [Assegnatari](pagine/inventory-assignees.md),
  [Abbinamenti](pagine/inventory-abbinamenti.md), [Ubicazioni](pagine/inventory-locations.md),
  [Licenze](pagine/inventory-licenses.md) e [Servizi NIS2](pagine/services.md).

## Sistema

- [Impostazioni](pagine/settings.md): utenti, aggiornamenti, moduli, notifiche, scansione, identificazione, HTTPS e
  sistema. A parte ci sono le [Opzioni](pagine/settings-opzioni.md), le [Schedulazioni](pagine/settings-schedulazioni.md)
  e [Cosa esce](pagine/settings-cosa-esce.md).
- [In esecuzione](pagine/in-esecuzione.md): i lavori in corso (scansioni, letture, sincronizzazioni).
- Integrazioni e Appliance: oggi sono schede di [Impostazioni](pagine/settings.md).
- Il **Manuale**, cioè queste pagine.

## La vista cliente

Chi ha il ruolo **Cliente** vede una versione semplice, con poche pagine: [la prima pagina](pagine/cliente.md),
[gli apparati](pagine/cliente-apparati.md), [cosa c'è da sistemare](pagine/cliente-da-sistemare.md),
[le reti](pagine/cliente-reti.md), [il dominio](pagine/cliente-dominio.md),
[il monitoraggio](pagine/cliente-monitoring.md) e [il registro di sicurezza](pagine/cliente-log-sicurezza.md).

## Come si tiene aggiornato questo manuale

Ogni guida è un file a sé, in `docs/manuale/pagine/`, e porta la versione del programma a cui è aggiornata. Quando
cambia una pagina si riscrive solo la sua guida. Le schermate si rifanno con
`node scripts/manuale/schermate.cjs <nome-guida>`. Una prova del cancello segnala le pagine che non hanno ancora la
guida. Il manuale unico di prima resta in **Archivio**.
