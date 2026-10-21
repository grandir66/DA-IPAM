---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: "provare «Rendi apparato» e la ricerca delle credenziali sul vero (hub, DTS); scheda MikroTik: verifica sull'hub e accensione della lettura `mikrotik_scheda` (decide Riccardo); export AD: diagnostic esplicito e gravità del punteggio di dominio"
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job `arp_poll` senza rete, perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).
