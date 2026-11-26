---
percorso: /cliente
titolo: La tua rete — la vista del cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la **prima pagina che vedi** quando entri: dice in un colpo d'occhio come sta la tua rete, senza entrare nei dettagli
tecnici. In cima ci sono i numeri di ogni servizio che hai attivo, al centro i grafici, a destra l'elenco di **cosa
richiede attenzione**. Tutto è in sola lettura: puoi guardare, stampare e aprire i dettagli, non puoi cambiare niente.

**Chi la vede.** Chi ha il ruolo **Cliente** entra direttamente qui e resta in questa parte del programma: ogni altra
pagina lo riporta qui. Il personale tecnico la apre dal pulsante **Vista cliente** della Dashboard, per vedere quello che
vedi tu, e ha in più **Torna alla Dashboard** e la possibilità di comporre la pagina (vedi in fondo).

![La pagina La tua rete; a destra l'elenco Cosa richiede attenzione, sfocato](/manuale/cliente/pagina.png)

## La testata

In alto, sulla fascia blu scuro:

- **La tua rete · nome della tua azienda**, e l'ora a cui si riferiscono i dati;
- `tasto:printer` **Stampa** (①): stampa la pagina così com'è, senza i pulsanti, per portarla in riunione;
- `tasto:moon` **Tema scuro** / `tasto:sun` **Tema chiaro**: cambia i colori della pagina; il browser ricorda la
  scelta;
- il tuo nome;
- `tasto:log-out` **Esci**: chiude la sessione.

## Cosa richiede attenzione

A destra (②), l'elenco delle cose da guardare, dalle più gravi in giù, con il numero di voci. Ogni voce dice cosa
succede e da quale servizio viene: per esempio un apparato che non risponde, un programma da aggiornare, un'impostazione
del dominio da rivedere. Se l'elenco è lungo, scorre da solo dentro il suo riquadro.

## I riquadri piccoli in cima

Uno per ogni servizio attivo, con il numero principale e una riga di spiegazione. Un clic apre la pagina di quel
servizio:

| Riquadro | Si apre |
|---|---|
| **Reti** | [Le tue reti](pagine/cliente-reti.md), quanto sono piene e quanti apparati rispondono. |
| **DATIA MONITORING** | [Il monitoraggio](pagine/cliente-monitoring.md) degli apparati controllati di continuo. |
| **Apparati** | [L'elenco dei tuoi apparati](pagine/cliente-apparati.md). |
| **Da sistemare** | [I problemi di sicurezza](pagine/cliente-da-sistemare.md) trovati sugli apparati. |
| **Dominio e accessi** | [Come sta il dominio](pagine/cliente-dominio.md) (Active Directory) e chi entra. |
| **Log di sicurezza** | [Gli eventi di sicurezza](pagine/cliente-log-sicurezza.md) registrati. |

Il segno in alto a destra del riquadro (▲ o !) dice che in quel servizio c'è qualcosa da guardare.

Due riquadri aprono una finestra invece di una pagina:

- **Porte di rete**: le porte degli switch, libere e usate, con l'apparato collegato a ciascuna;
- **Topologia di rete**: la mappa di come sono collegati gli apparati, da guardare.

## I riquadri sotto

Mostrano la tua rete con numeri e grafici: **Numeri della rete** (stato di salute, reti, indirizzi, apparati spenti o
assenti, monitorati), **Sicurezza** (problemi critici e alti, accessi falliti, account bloccati, avvisi, salute di
Active Directory), **Accessi falliti nelle ultime 24 ore** (per ora, per utente, da dove), **Stato host nel tempo** (con
24h, 7d, 30d per scegliere il periodo), **Transizioni recenti** (chi si è acceso e chi si è spento), **Subnet**,
**Rischio del dominio**, **Cose da sistemare per rete**, **Apparati nuovi in rete**, **Apparati importanti spenti**,
**Disponibilità degli ultimi 30 giorni**, **Sistemi operativi**, **Certificati**.

Ogni riquadro ha in alto a destra il collegamento alla pagina che lo spiega (per esempio **Reti →**, **Dominio e accessi
→**). Un riquadro che quel giorno non ha dati non compare.

## Come si fa

- **Capire se oggi c'è qualcosa di urgente**: guarda le prime voci di **Cosa richiede attenzione**.
- **Sapere perché un riquadro ha il ▲**: aprilo con un clic e leggi la pagina del servizio.
- **Portare la situazione in riunione**: `tasto:printer` **Stampa**.
- **Vedere se un apparato importante è spento**: riquadro **Apparati importanti spenti**, o la pagina
  [Apparati](pagine/cliente-apparati.md).
- **Controllare gli accessi falliti di stanotte**: riquadro **Accessi falliti nelle ultime 24 ore**.

## Cosa vogliono dire i segni

- **✕** rosso: grave. **▲** giallo: da guardare. **●** grigio o nessun segno: tutto a posto.
- Nei grafici le parti a righe gialle indicano gli apparati spenti.

## Comporre la pagina (solo per il personale tecnico) {#componi}

Il cliente non vede questa parte. Sotto i riquadri, **Componi la casa** mette la pagina in modifica per quel cliente
(«Lo vedi solo tu»). Una fascia spiega i comandi: si trascina un riquadro sopra un altro per cambiargli posto; sopra
ogni riquadro `tasto:arrow-left` `tasto:arrow-right` lo spostano, `icona:move-horizontal` con `tasto:minus`
`tasto:plus` ne cambia la larghezza, `icona:move-vertical` con `tasto:minus` `tasto:plus` l'altezza, `tasto:eye-off` lo
nasconde; sotto compaiono i riquadri nascosti da rimettere. **Salva la disposizione** la scrive, **Torna a quella
predefinita** riparte dalla disposizione di serie, **Annulla** esce senza salvare. Alcuni riquadri (per esempio
**Moduli**) sono solo per il personale tecnico e il cliente non li vede mai.

## Da dove arrivano i dati

Dai controlli che DA-IPAM fa sulla tua rete: le scansioni delle reti, gli apparati, i problemi di sicurezza, Active
Directory, i log di sicurezza e, se c'è, il monitoraggio continuo. I servizi che compaiono sono quelli attivi per te.

## Se la pagina è vuota

Se mancano dei riquadri, quel servizio non è attivo per te o quel giorno non ci sono dati. Se la pagina non si apre o
ti riporta alla Dashboard, sei entrato senza un cliente scelto: per il personale tecnico, sceglilo in alto nel menu e
riapri **Vista cliente**.
