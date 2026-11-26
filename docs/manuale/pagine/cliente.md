---
percorso: /cliente
titolo: La tua rete — la vista del cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la **pagina iniziale della vista cliente**: una versione semplice di DA-IPAM, senza menu laterale e in sola lettura,
pensata per chi lavora dal lato del cliente e vuole sapere come sta la sua rete senza entrare nei dettagli tecnici. In
cima i numeri di ogni modulo, al centro i grafici, a destra l'elenco di **cosa richiede attenzione**.

**Chi la vede.** Un utente con il ruolo **Cliente** (nelle impostazioni degli utenti è un «Solo lettura» con il segno
della vista cliente) entra direttamente qui e non può uscire dall'area `/cliente`: ogni altra pagina lo riporta qui. Gli
amministratori la aprono dal pulsante **Vista cliente** della Dashboard, per vedere quello che vede il cliente, e hanno in
più **Torna alla Dashboard** e la possibilità di comporre la pagina. Serve un cliente scelto: con «Tutti i clienti» si
torna alla Dashboard.

![La pagina La tua rete; a destra l'elenco Cosa richiede attenzione, sfocato](/manuale/cliente/pagina.png)

## Le voci della pagina

1. **La testata**: «La tua rete · nome del cliente», l'ora dei dati, **Stampa** (stampa la pagina così com'è, senza i
   pulsanti), **Tema scuro** / **Tema chiaro**, il nome dell'utente, **Torna alla Dashboard** (solo amministratori) ed
   **Esci**.
2. **Cosa richiede attenzione**: l'elenco delle cose da guardare, dalle più gravi, con il numero di voci. Ogni voce dice
   cosa succede e da quale modulo viene (per esempio un apparato che non risponde, un programma da aggiornare, un
   rilievo del dominio). Ha la sua barra di scorrimento.

**I riquadri piccoli in cima**: uno per ogni modulo attivo per il cliente, con il numero principale e una riga di
contesto. Un clic apre la pagina del modulo: [Reti](pagine/cliente-reti.md),
[DATIA MONITORING](pagine/cliente-monitoring.md), [Apparati](pagine/cliente-apparati.md),
[Da sistemare](pagine/cliente-da-sistemare.md), [Dominio e accessi](pagine/cliente-dominio.md),
[Log di sicurezza](pagine/cliente-log-sicurezza.md). Il segno in alto a destra (▲ o !) dice che in quel modulo c'è
qualcosa da guardare. Due riquadri aprono una finestra invece di una pagina: **Porte di rete** (le porte degli switch,
libere e usate, con il collegamento all'apparato) e **Topologia di rete** (la mappa di come sono collegati gli
apparati, in sola lettura).

**I riquadri sotto**, gli stessi della Dashboard: Numeri della rete (Health, Subnet, Indirizzi, Offline, Assenti,
Archiviati, Monitorati), Sicurezza (critiche e alte da sistemare, accessi falliti, account bloccati, avvisi, salute di
Active Directory), Accessi falliti nelle ultime 24 ore (per ora, per utente, da dove), Stato host nel tempo (con 24h, 7d,
30d), Transizioni recenti, Subnet, Rischio del dominio, Cose da sistemare per rete, Apparati nuovi in rete, Apparati
importanti spenti, Disponibilità degli ultimi 30 giorni, Sistemi operativi, Certificati. Ogni riquadro ha in alto a
destra il collegamento alla pagina che lo spiega (es. **Reti →**, **Dominio e accessi →**). Un riquadro senza dati
quel giorno non compare.

## Comporre la pagina (solo amministratori)

Sotto i riquadri, **Componi la casa** mette la pagina in modifica per quel cliente. Una fascia spiega i comandi: si
trascina un riquadro sopra un altro per cambiargli posto, sopra ogni riquadro le frecce lo spostano, ↔ ne cambia la
larghezza, ↕ l'altezza, l'occhio barrato lo nasconde; sotto compaiono i riquadri nascosti da rimettere. **Salva la
disposizione** la scrive, **Torna a quella predefinita** riparte dalla disposizione di serie, **Annulla** esce senza
salvare. Alcuni riquadri (per esempio **Moduli**) sono solo per gli amministratori e il cliente non li vede mai.

## Come si usa

1. Guarda prima **Cosa richiede attenzione**: le voci in cima sono le più urgenti.
2. Per capire una voce apri il riquadro piccolo del modulo da cui viene.
3. Per portare la situazione in riunione usa **Stampa**.

## Cosa vogliono dire i segni

- **✕** rosso: grave. **▲** giallo: da guardare. **●** grigio o nessun segno: tutto a posto.
- Nei grafici le parti a righe gialle indicano gli host offline.

## Da dove arrivano i dati

Dagli stessi dati di DA-IPAM per quel cliente: scansioni delle reti, apparati, vulnerabilità, Active Directory, log di
sicurezza e, se c'è, il monitoraggio Zabbix. I moduli che compaiono dipendono da quelli attivi per il cliente.

## Se la pagina è vuota

Se mancano dei riquadri, il cliente non ha quei moduli attivi o non ci sono dati per quel giorno. Se si torna alla
Dashboard, non è scelto un cliente: sceglilo in alto nel menu e riapri **Vista cliente**.
