---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: Collaudo matrice su VM 963 (trunk 102/103), interruttore in Opzioni, NTLM opzionale
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job senza rete (`arp_poll`, oggi sull'hub il job `apparati_scelti` #25), perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).

Mappa porte (`/port-map`): cosa c'è in rete e su quale porta, con confidenza e fonti; aggregati e VLAN per porta. Fra porte di passaggio non sceglie: dice «non so».

CVE potenziali (`/vulnerabilities`, spente di serie): dedotte dalle versioni che nmap legge, confrontate con un archivio NVD tenuto sull'appliance; nessun dato dei clienti esce (ADR 0036).

Acquisizione modulare: collector dedicato Aruba AOS-CX, collaudato su 6100; limiti espliciti e sezioni parziali nel manuale di acquisizione.
