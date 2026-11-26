---
percorso: /client-config
titolo: Configurazione Cliente — la scheda infrastrutturale del cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È una **scheda descrittiva dell'infrastruttura del cliente**, compilata a mano: reti e VLAN, switch, firewall,
linee dati, WiFi, VPN, server, virtualizzazione, posta, centralino, backup, gestionali e licenze. Serve come
documentazione per chi interviene dal cliente, e si esporta in un documento di testo. Non c'è una voce nel menu:
si apre dall'indirizzo `/client-config`, con un'istanza scelta.

Per questa pagina non c'è una schermata nel manuale: contiene dati del cliente e credenziali.

## Le voci della pagina

In alto, il titolo **Configurazione Cliente** con il codice del cliente, e tre pulsanti:

- **Importa JSON**: carica una scheda da un file JSON preparato prima.
- **Esporta MD**: scarica la scheda come documento Markdown, da stampare o allegare.
- **Salva**: registra le modifiche. C'è anche in fondo alla pagina.

Le sezioni si aprono e chiudono con un clic sul titolo.

**Sezioni sempre presenti**: **Dati Cliente** (nome, referenti tecnici, codice), **Accesso Servizi Cliente** (come
ci si collega: RDP, TeamViewer, VPN), **Network (VLAN)** (per ogni VLAN: ID, subnet, gateway, DNS, note),
**Switch**, **Firewall**, **Linee Dati** (provider, indirizzi, router).

**Sezioni opzionali** (sotto «Sezioni Opzionali»): **WiFi**, **VPN**, **Storage (NAS)**, **Active Directory**,
**Server Fisici**, **Virtualizzazione** (piattaforma, host, cluster, nodi), **VM**, **Posta**, **Centralino**,
**Software Domarc**, **Servizi Cloud**, **Stampanti**, **Backup**, **Gestionale / Software**, **Apparati
Aggiuntivi**, **Gestione Licenze**. Ognuna ha un pulsante accanto al titolo che la include o la esclude dalla
scheda: si legge **Attiva** quando è inclusa, **Disattiva** quando non lo è.

Negli elenchi (switch, VLAN, linee, nodi…) **Aggiungi** mette una voce nuova e **Rimuovi ultimo** toglie l'ultima.

## Come si usa

1. Scegli l'istanza del cliente in **Impostazioni › Istanza**, poi apri `/client-config`.
2. Compila le sezioni sempre presenti, includi le opzionali che servono, **Salva**.
3. Per consegnare la scheda: **Esporta MD**.

## Da dove arrivano i dati

Dalla scheda salvata per quel cliente sull'hub, compilata a mano: DA-IPAM non la riempie dalle scansioni.

## Se la pagina è vuota

«Seleziona un tenant specifico» vuol dire che si sta guardando la vista di tutte le istanze insieme: scegline una.
