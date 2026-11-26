---
percorso: /settings/schedulazioni
titolo: Schedulazioni — tutto ciò che parte da solo
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco unico di **tutto quello che DA-IPAM fa da solo a orari fissi**: scansioni delle reti, letture degli
apparati, sincronizzazioni dei moduli, controlli dell'appliance. Le righe sono ordinate per **prossimo giro**: in
cima c'è quello che parte per primo. Si arriva da **Impostazioni › Schedulazioni**.

Qui si accende, si spegne e si fa partire subito; la configurazione vera di ogni lavoro sta nella sua pagina, a cui
porta il collegamento nella colonna Azioni. La pagina la vedono tutti; cambiare può solo un amministratore.

In alto si legge il cliente su cui si lavora, quante schedulazioni ci sono (**pianificate**), quante sono
**accese** e qual è il **prossimo giro**.

Le parti comuni (menu, ricerca, filtri a pulsanti) sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra in cima

![La barra di Schedulazioni](/manuale/settings-schedulazioni/barra.png)

1. **Filtro per stato**: **Tutte**, **Accese**, **Spente**, **✕ In errore**.
2. **Filtro per famiglia**: **Tutte le famiglie**, **Reti**, **Apparati**, **Moduli**, **Appliance**.
3. `icona:search` **Cerca…**: filtra mentre scrivi, sul nome e su che cosa lavora.
4. `tasto:plus` **Nuovo job**: crea un lavoro pianificato su una rete (sotto). Lo vede solo un amministratore; chi è
   in sola lettura vede al suo posto l'etichetta **Solo un amministratore può cambiarle**.

### La finestra Nuovo job

![La finestra Nuovo job schedulato](/manuale/settings-schedulazioni/nuovo-job.png)

**Nuovo job schedulato** chiede:

- **Tipo**:
  - **Monitoraggio host registrati** (consigliato): controlla se gli host già noti rispondono.
  - **ARP Poll** (passivo via SNMP switch): legge chi c'è in rete dalle tabelle degli switch, senza mandare niente
    agli host.
  - **SNMP Scan**, **DNS Resolve**, **Pulizia tabelle MAC**.
  - **Ping Sweep**, **Scoperta veloce subnet**, **Nmap Scan**: provano tutti gli indirizzi della rete. Sono pesanti:
    su reti grandi (da /22 in su) possono caricare molto il server, e la finestra lo ricorda.
- **Rete**: la rete su cui lavora (per la pulizia è facoltativa: **Tutte le reti**).
- **Intervallo**: da ogni 5 minuti a ogni 24 ore.

**Crea job** lo registra; compare subito nell'elenco.

## Le righe

![Le colonne di Schedulazioni](/manuale/settings-schedulazioni/righe.png)

1. **Stato**: la levetta **ACCESA**/**SPENTA**; un clic chiede conferma. **SEMPRE** con `icona:lock` vuol dire che
   quel lavoro non si spegne da qui (passa il mouse per leggere perché).
2. **Prossimo ▲**: fra quanto parte il prossimo giro («adesso», «fra 4 min», «oggi 04:00»). Le righe sono ordinate
   così; il più vicino è in grassetto.
3. **Ultimo esito**: **✓ ok**, **▲ guarda**, **✕** errore o **● niente**, con l'ora e che cosa ha trovato. Per i job
   su apparati scelti un clic sull'esito (▸) apre l'esito apparato per apparato.
4. **Azioni**: il collegamento alla pagina dove si configura (**Rete ›**, **Opzioni ›**, **Controller ›**…); per un
   amministratore anche **Esegui ora**, che lo fa partire subito, e `tasto:trash` **Elimina job** per un job creato a
   mano.

Le altre colonne: **Famiglia** (solo sugli schermi molto larghi), **Cosa** (il nome del lavoro, con una riga di
spiegazione), **Su cosa** (la rete, gli apparati o il modulo), **Quando** (il ritmo, per esempio «ogni 15 minuti»).

Spegnendo, la finestra dice **Si ferma**, **Resta** e che dopo gli aggiornamenti resta spento; si conferma con
**Spegni** o si torna indietro con **Annulla**. Eliminando, la finestra dice che cosa **si perde**: se vuoi solo
fermarlo, spegnilo.

## Come si fa

- **Sapere che cosa sta per partire**: guarda le prime righe e la colonna **Prossimo ▲**.
- **Trovare i lavori che non vanno**: filtro **✕ In errore**, poi leggi **Ultimo esito**.
- **Rifare subito il controllo di una rete**: trova la riga con `icona:search` **Cerca…**, **Esegui ora**; l'esito
  arriva nella stessa riga dopo qualche secondo.
- **Controllare una VLAN nuova ogni 15 minuti**: `tasto:plus` **Nuovo job**, Tipo **Monitoraggio host registrati**,
  la Rete, Intervallo 15 minuti, **Crea job**.
- **Fermare un lavoro senza perderlo**: clic sulla levetta **ACCESA**, **Spegni**.
- **Togliere un job creato per errore**: `tasto:trash` sulla sua riga, leggi che cosa si perde, conferma.

## Cosa vogliono dire i segni

- **ACCESA** su fondo scuro, **SPENTA** su fondo chiaro, **SEMPRE** con `icona:lock` (non si spegne da qui).
- **✓ ok**, **▲ guarda**, **✕** errore, **● niente** (non è ancora girato).

## Da dove arrivano i dati

Dai job pianificati dell'istanza, dalle opzioni accese in [Opzioni](pagine/settings-opzioni.md) e dai lavori fissi
dell'appliance. L'esito è quello scritto dall'ultimo giro. Ciò che sta girando adesso si vede in
[In esecuzione](pagine/in-esecuzione.md).

## Se la pagina è vuota

Se un filtro non trova niente si legge «Nessuna schedulazione con questo filtro»: torna su **Tutte**. Se non c'è
nessuna rete, i lavori sulle reti non compaiono: si aggiungono dalla pagina delle subnet.
