---
percorso: /settings/schedulazioni
titolo: Schedulazioni — tutto ciò che parte da solo
versione: 0.9.1363
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

![La pagina Schedulazioni](/manuale/settings-schedulazioni/pagina.png)

## Le voci della pagina

1. **Filtro per stato**: **Tutte**, **Accese**, **Spente**, **✕ In errore**.
2. **Filtro per famiglia**: **Tutte le famiglie**, **Reti**, **Apparati**, **Moduli**, **Appliance**. Accanto,
   **Cerca…** filtra mentre scrivi.
3. **Nuovo job**: crea un lavoro pianificato su una rete. Si sceglie il **Tipo**, la **Rete** e l'**Intervallo**
   (da ogni 5 minuti a ogni 24 ore), poi **Crea job**. I tipi:
   - **Monitoraggio host registrati** (consigliato): controlla se gli host già noti rispondono.
   - **ARP Poll**: legge chi c'è in rete dalle tabelle degli switch via SNMP, senza mandare niente agli host.
   - **SNMP Scan**, **DNS Resolve**, **Pulizia tabelle MAC**.
   - **Ping Sweep**, **Scoperta veloce subnet**, **Nmap Scan**: provano tutti gli indirizzi della rete. Sono
     pesanti: su reti grandi (da /22 in su) possono caricare molto il server, e la finestra lo ricorda.
4. **Prossimo ▲**: fra quanto parte il prossimo giro («adesso», «fra 4 min», «oggi 04:00»). Il più vicino è in
   grassetto.

Le altre colonne:

- **Stato**: la levetta **ACCESA**/**SPENTA**; un clic chiede conferma. **SEMPRE**, col lucchetto, vuol dire che
  quel lavoro non si spegne da qui (passa il mouse per leggere perché).
- **Famiglia** (sugli schermi larghi), **Cosa** (il nome del lavoro, con una riga di spiegazione), **Su cosa**
  (la rete, gli apparati o il modulo), **Quando** (il ritmo, per esempio «ogni 15 minuti»).
- **Ultimo esito**: **✓ ok**, **▲ guarda**, **✕** errore o **● niente**, con l'ora e che cosa ha trovato. Per i job
  su apparati scelti un clic sull'esito apre l'esito apparato per apparato.
- **Azioni**: il collegamento alla pagina dove si configura (**Rete ›**, **Opzioni ›**, **Controller ›**…),
  **Esegui ora** per farlo partire subito, e il cestino per eliminare un job creato a mano.

## Come si usa

1. Per sapere che cosa sta per partire guarda le prime righe e la colonna **Prossimo**.
2. Per fermare un lavoro senza perderlo clicca la levetta: la finestra dice **Si ferma**, **Resta** e che dopo gli
   aggiornamenti resta spento. Conferma con **Spegni**.
3. Per eliminare un job creato a mano usa il cestino: la finestra dice che cosa **si perde**. Se vuoi solo fermarlo,
   spegnilo.
4. Per vedere i lavori che non vanno usa il filtro **✕ In errore**.

## Cosa vogliono dire i segni

- **ACCESA** su fondo scuro, **SPENTA** su fondo chiaro, **SEMPRE** col lucchetto (non si spegne da qui).
- **✓ ok**, **▲ guarda**, **✕** errore, **● niente** (non è ancora girato).

## Da dove arrivano i dati

Dai job pianificati dell'istanza, dalle opzioni accese in [Opzioni](pagine/settings-opzioni.md) e dai lavori fissi
dell'appliance. L'esito è quello scritto dall'ultimo giro. Ciò che sta girando adesso si vede in
[In esecuzione](pagine/in-esecuzione.md).

## Se la pagina è vuota

Se un filtro non trova niente si legge «Nessuna schedulazione con questo filtro»: torna su **Tutte**. Se non c'è
nessuna rete, i lavori sulle reti non compaiono: si aggiungono dalla pagina delle subnet.
