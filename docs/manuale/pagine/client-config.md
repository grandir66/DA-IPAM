---
percorso: /client-config
titolo: Configurazione Cliente — la scheda infrastrutturale del cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È una **scheda descrittiva dell'infrastruttura del cliente**, compilata a mano: reti e VLAN, switch, firewall,
linee dati, WiFi, VPN, server, virtualizzazione, posta, centralino, backup, gestionali e licenze. Serve come
documentazione per chi interviene dal cliente, e si esporta in un documento di testo. Non c'è una voce nel menu:
si apre dall'indirizzo `/client-config`, con un'istanza scelta.

Per questa pagina non c'è una schermata nel manuale, per scelta: contiene dati del cliente e credenziali. Le parti
comuni sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## Le voci della pagina

In alto, il titolo **Configurazione Cliente** con il codice del cliente, e tre pulsanti:

- `tasto:upload` **Importa JSON**: carica una scheda da un file JSON preparato prima.
- `tasto:download` **Esporta MD**: scarica la scheda come documento Markdown, da stampare o allegare.
- `tasto:save` **Salva**: registra le modifiche. C'è anche in fondo alla pagina.

Le sezioni si aprono e chiudono con un clic sul titolo: `icona:chevron-right` chiusa, `icona:chevron-down` aperta.

**Sezioni sempre presenti**: **Dati Cliente** (nome, referenti tecnici, codice), **Accesso Servizi Cliente** (come
ci si collega: RDP, TeamViewer, VPN), **Network (VLAN)** (per ogni VLAN: ID, subnet, gateway, DNS, note),
**Switch**, **Firewall**, **Linee Dati** (provider, indirizzi, router).

**Sezioni opzionali** (sotto «Sezioni Opzionali»): **WiFi**, **VPN**, **Storage (NAS)**, **Active Directory**,
**Server Fisici**, **Virtualizzazione** (piattaforma, host, cluster, nodi), **VM**, **Posta**, **Centralino**,
**Software Domarc**, **Servizi Cloud**, **Stampanti**, **Backup**, **Gestionale / Software**, **Apparati
Aggiuntivi**, **Gestione Licenze**. Ognuna ha un pulsante accanto al titolo che la include o la esclude dalla
scheda: si legge **Attiva** quando è inclusa, **Disattiva** quando non lo è.

Negli elenchi (switch, VLAN, linee, nodi…) `tasto:plus` **Aggiungi** mette una voce nuova e `tasto:trash` **Rimuovi
ultimo** toglie l'ultima.

La pagina non distingue i ruoli: il salvataggio lo accetta il programma secondo le regole dell'istanza; chi è in sola
lettura usa la scheda per consultarla ed esportarla.

## Come si fa

- **Compilare la scheda di un cliente nuovo**: scegli la sua istanza in **Impostazioni › Istanza**, apri
  `/client-config`, compila **Dati Cliente**, **Network (VLAN)**, **Switch**, **Firewall** e **Linee Dati**,
  `tasto:save` **Salva**.
- **Aggiungere la parte di virtualizzazione**: sezione **Virtualizzazione**, pulsante **Disattiva** accanto al titolo
  (diventa **Attiva**), scegli la **Piattaforma** e aggiungi host o nodi con `tasto:plus` **Aggiungi**.
- **Registrare una VLAN nuova**: sezione **Network (VLAN)**, `tasto:plus` **Aggiungi**, scrivi ID, subnet, gateway,
  DNS, **Salva**.
- **Consegnare la scheda a un collega o al cliente**: `tasto:download` **Esporta MD** e allega il file.
- **Ripartire da una scheda preparata altrove**: `tasto:upload` **Importa JSON**, controlla, **Salva**.

## Da dove arrivano i dati

Dalla scheda salvata per quel cliente sull'hub, compilata a mano: DA-IPAM non la riempie dalle scansioni.

## Se la pagina è vuota

«Seleziona un tenant specifico» vuol dire che si sta guardando la vista di tutte le istanze insieme: scegline una.
