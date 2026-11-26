---
percorso: /dhcp
titolo: DHCP — scope, lease e IP statici
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Gestisce il **DHCP** erogato dalla VM Network Services dell'appliance (Kea): le reti in cui distribuisce indirizzi
(**scope**), gli indirizzi dati in questo momento ai client (**lease dinamici**) e gli indirizzi fissi riservati a un
apparato (**IP statici**). Si arriva da **Network Services › DHCP** nel menu, o da **Apri hub** nella
[panoramica](pagine/network-services.md).

In cima ci sono due schede: **DHCP** (questa pagina) e [Sorgenti](pagine/dhcp-sources.md), i lease letti dai router e
dai server DHCP che non sono la VM.

Nessuna schermata: sull'istanza usata per le immagini del manuale il modulo non è installato.

## Le voci della pagina

In cima il titolo, l'indirizzo della VM e il pulsante per rileggere lo stato. Sotto, cinque schede.

### Panorama

- **Servizio Kea DHCP4** con il segno **Attivo** o **Off**; un amministratore ha il pulsante **Abilita** /
  **Disabilita**.
- Tre riquadri con i numeri: **Scope configurati** (con **Gestisci scope →**), **Lease attivi** (con **Vedi lease →**),
  **IP statici** (con **Gestisci statici →**).
- **Lease da router MikroTik / Active Directory**: il pulsante **Tabella sorgenti esterne** apre
  [Sorgenti](pagine/dhcp-sources.md).

### Scope

**Scope e parametri DHCP**: per ogni rete Kea si vedono e si cambiano **Subnet (CIDR)**, **Pool inizio** e **Pool fine**
(il blocco di indirizzi da distribuire), **Gateway (routers)**, **DNS server**, **Dominio** e **Valid lifetime (s)** (per
quanti secondi vale un indirizzo dato). **Salva** scrive le modifiche.

### Lease dinamici

I client che hanno preso un indirizzo dal DHCP, con MAC, Hostname, Subnet, Stato. Dalla riga si può **convertire in
statico** un client con un clic: il suo indirizzo diventa una riserva fissa.

### IP statici

**IP statici (reservation)**: gli apparati con indirizzo fisso. Si crea una riserva con **IP**, **MAC**, **Hostname**; dalla
riga la si modifica (finestra **Modifica reservation**) o la si elimina.

### Sorgenti esterne

Porta alla pagina [Sorgenti](pagine/dhcp-sources.md).

Le modifiche le fa solo un amministratore. Se il servizio è spento, le schede dicono «DHCP disabilitato».

## Come si usa

1. Nel **Panorama** controlla che Kea sia **Attivo**.
2. Per una rete nuova, in **Scope** indica rete, pool, gateway e DNS, poi **Salva**.
3. Per dare sempre lo stesso indirizzo a una stampante, trovala in **Lease dinamici** e convertila in statico.

## Da dove arrivano i dati

Dal bridge della VM Network Services, che legge e scrive la configurazione di Kea.

## Se la pagina è vuota

«Modulo non disponibile» vuol dire che la VM Network Services non è configurata: il pulsante **Tabella sorgenti
esterne** porta comunque ai lease letti dai router, e gli amministratori hanno **Impostazioni moduli**. «Nessun lease
attivo» o «Nessuna reservation configurata» vogliono dire che quella parte è vuota.
