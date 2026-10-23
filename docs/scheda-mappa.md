---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: "Assegnatari da AD: provare «Accetta» sull'hub e capire perché WinRM non dà utenti; VLAN switch: confermare i cluster 10/11, IP attuale di SW-UFLEX-RG-10GB (fuori dal job #25), rivedere la lettura Q-BRIDGE della ProMax; decidere se `arp_poll` serve ancora dopo il job `apparati_scelti`; ADR 0030; provare «Rendi apparato» e la ricerca credenziali sul vero; export AD: diagnostic esplicito e gravità del punteggio di dominio"
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job senza rete (`arp_poll`, oggi sull'hub il job `apparati_scelti` #25), perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).
