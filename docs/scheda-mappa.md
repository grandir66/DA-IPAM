---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: "Profili di scansione: Riccardo lancia il campione di 5 host sul 72729, poi si decide il giro sui ~64 indecisi; accesso Windows automatico: collaudo sul 72729 con l'account dedicato e gruppi su un DC vero; assegnatari da AD e VLAN switch restano aperti"
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job senza rete (`arp_poll`, oggi sull'hub il job `apparati_scelti` #25), perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).

Acquisizione modulare: collector dedicato Aruba AOS-CX, collaudato su 6100; limiti espliciti e sezioni parziali nel manuale di acquisizione.
