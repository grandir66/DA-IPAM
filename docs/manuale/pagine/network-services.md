---
percorso: /network-services
titolo: Network Services — panoramica di DNS e DHCP
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Mostra lo stato dei **servizi di rete** che l'appliance Domarc può erogare da una macchina virtuale dedicata (la VM
Network Services): il **Resolver** (Unbound, risolve i nomi verso Internet), l'**AdBlock** (AdGuard Home, il filtro DNS
che blocca pubblicità e siti malevoli), il **DNS autoritativo** (PowerDNS, le zone interne) e il **DHCP** (Kea, assegna
gli indirizzi). Da qui si vede se ognuno gira e, per gli amministratori, lo si accende o lo si spegne. Si arriva da
**Network Services › Panoramica** nel menu; il gruppo c'è solo se il modulo è acceso. Le altre voci del gruppo sono
[DNS](pagine/dns.md) e [DHCP](pagine/dhcp.md).

## Quando il modulo non c'è

Se la VM Network Services non è installata, la pagina dice **Modulo non disponibile**: il modulo si registra da solo
durante l'installazione dell'appliance Domarc, quando nella configurazione è chiesta l'installazione dei servizi di
rete. Agli amministratori la pagina mostra anche il comando di recupero da lanciare sul Proxmox se la registrazione non
è andata a buon fine.

![La pagina quando il modulo non è installato](/manuale/network-services/pagina.png)

## Le voci della pagina, con il modulo attivo

- In cima l'indirizzo della VM bridge e i collegamenti a **DNS** e **DHCP**. Se la configurazione viene dalle variabili
  d'ambiente e non dal database, una riga lo dice.
- **Refresh**: rilegge subito lo stato (la pagina lo rilegge da sola ogni 30 secondi).
- La scheda **Panorama**, con quattro riquadri, uno per servizio: **Resolver**, **AdBlock**, **DNS Authoritative**,
  **DHCP**. In ogni riquadro:
  - il segno di stato in alto a destra: **attivo**, **spento**, **fermo ma abilitato** (doveva girare e non gira: è un
    guasto) oppure **assente dalla risposta del bridge** (non si sa);
  - **Apri hub**: porta alla pagina dove si gestisce quel servizio (le schede Resolver, Filtro DNS e Zone DNS di
    [DNS](pagine/dns.md), oppure [DHCP](pagine/dhcp.md));
  - **Abilita** / **Disabilita**: accende o spegne il servizio sulla VM. Lo vede solo un amministratore; gli altri
    leggono «Solo admin».
- **Configurazione modulo** (solo amministratori): l'indirizzo del bridge in uso e il pulsante **Disinstalla modulo**,
  che toglie la registrazione del modulo da DA-IPAM (non spegne la VM). Se la configurazione viene dalle variabili
  d'ambiente il pulsante non c'è e una nota spiega come cambiarla.

## Come si usa

1. Guarda i quattro segni: tutti **attivo** vuol dire che la VM eroga tutto.
2. Un **fermo ma abilitato** è un guasto: prova **Disabilita** e poi **Abilita**, oppure apri la pagina del servizio con
   **Apri hub** per capire.
3. Per gestire zone, filtri e indirizzi usa [DNS](pagine/dns.md) e [DHCP](pagine/dhcp.md).

## Cosa vogliono dire i segni

- **attivo** (pieno): il servizio gira.
- **spento** (grigio): il servizio è spento per scelta.
- **fermo ma abilitato** (rosso): doveva girare e non gira.
- **assente dalla risposta del bridge** (contorno): la VM non ha detto niente di quel servizio.

## Da dove arrivano i dati

Dal bridge della VM Network Services, che DA-IPAM interroga con un gettone registrato dall'installazione
dell'appliance.

## Se la pagina è vuota

«Modulo non disponibile» vuol dire che la VM Network Services non è installata o non è registrata. Un riquadro rosso con
un messaggio d'errore in cima vuol dire che la VM non risponde: controlla che sia accesa.
