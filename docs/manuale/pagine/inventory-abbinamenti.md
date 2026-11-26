---
percorso: /inventory/abbinamenti
titolo: Abbinamenti — chi usa quale PC
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Propone **a chi assegnare ogni PC**, guardando chi ci si è collegato negli ultimi 30 giorni e, dove gli accessi non
bastano, l'ultimo utente che Active Directory ha scritto nella descrizione del computer. Con un clic si confermano
molti abbinamenti insieme: DA-IPAM crea l'asset se manca, importa la persona da Active Directory se non è ancora fra gli
[Assegnatari](pagine/inventory-assignees.md) e scrive l'assegnazione. Si arriva da **Inventario › Abbinamenti** nel
menu, o dal collegamento **Abbinamenti ›** nella pagina degli Assegnatari. La pagina non ha schede in cima.

In alto a destra **Giro degli accessi ›** apre, in [Opzioni](pagine/settings-opzioni.md), l'automatismo che legge gli
accessi ai PC.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## I riquadri e i filtri

![I riquadri e i filtri](/manuale/inventory-abbinamenti/riquadri.png)

1. **proposti**: PC con un utente prevalente chiaro; il sottotitolo dice quanti hanno già un asset e quanti no.
2. **▲ da rivedere**: PC già assegnati a una persona diversa da quella che li usa davvero.
3. **pochi dati**: PC con troppo pochi accessi per decidere; accanto, quanti sono **già abbinati**.
4. **esclusi**: server, apparati e PC condivisi, che non si assegnano a una persona.
5. **Mostra**: lo stesso filtro dei riquadri, con in più **Già abbinati** e **Tutti**.
6. **Solo PC senza asset**: lascia solo i PC che non hanno ancora una riga in inventario.
7. **Cerca PC o persona**: filtra per nome del PC o della persona.

Un clic su un riquadro mostra quel gruppo, come la tendina **Mostra**.

## L'elenco

![L'elenco dei PC proposti](/manuale/inventory-abbinamenti/tabella.png)

Sopra l'elenco c'è il nome del gruppo. Nel gruppo **Proposti** la spunta è già messa su tutti: si toglie da quelli che
non vanno.

| Colonna | Che cosa dice |
|---|---|
| La spunta | Il PC entra nella conferma. C'è solo nei gruppi Proposti e Da rivedere. |
| **PC** | Nome e indirizzo. Se manca la categoria, anche come il programma l'ha classificato. |
| **Asset** | L'asset collegato (un clic apre la [scheda](pagine/inventory-id.md)). **● Si crea: Desktop** vuol dire che alla conferma nasce un asset di quella categoria. Se la categoria non si capisce, la tendina **▲ categoria da scegliere** (Desktop, Laptop, VM, Other). Se in inventario c'è già un asset con lo stesso nome, la tendina **▲ esiste già un asset con questo nome**: **Collega a n. …** usa quello, **Crea nuovo** ne fa un altro. |
| **Usato da** | La persona che usa il PC, con il ruolo. |
| **Assegnatario** | ✓ **Già assegnatario** se la persona è già fra gli Assegnatari, ● **Si importa da AD** se verrà importata alla conferma. Nei PC già abbinati (e nel gruppo Da rivedere la colonna si chiama **Assegnato a**) c'è il nome, con «· a mano» se l'assegnazione l'ha fatta una persona. |
| **Accessi** | Quante volte su quante si è collegata quella persona («7 su 7 di rete», «14 su 14 alla tastiera»), oppure **da AD (ultimo accesso)** quando il dato viene dalla descrizione del computer. |
| **Ultima volta** | L'ultimo accesso visto. |
| **Perché** | Nei gruppi Esclusi, Pochi dati e Tutti: il motivo per cui il PC non è proposto. |

Una riga con una scelta ancora da fare ha il fondo giallo chiaro. L'elenco va a pagine di 50: sotto la tabella «1–50
di 120» e i collegamenti **pagina precedente** e **pagina successiva**.

## Sotto l'elenco

Nel gruppo Proposti ci sono anche:

- **▲ Da rivedere — assegnato a un altro**: la tabella dei PC già assegnati a qualcun altro (Sostituisci, PC, Assegnato
  a, Usato da, Accessi). La casella **Sostituisci** di serie non è spuntata: l'assegnazione resta finché non la
  sostituisci tu.
- **Esclusi — perché non sono proposti**: un clic apre l'elenco dei PC esclusi, con il motivo e chi li usa.

### La barra della conferma

![La barra della conferma](/manuale/inventory-abbinamenti/conferma.png)

Riassume la scelta: quanti PC sono selezionati, quanti asset si creano, quanti si collegano, quanti assegnatari si
importano da AD, quante assegnazioni si scrivono. **Conferma N abbinamenti** applica tutto e un messaggio dice
l'esito, con i PC eventualmente saltati e il motivo. Il pulsante resta grigio se c'è un asset senza categoria o un
omonimo senza la scelta «Collega / Crea nuovo»: la barra dice quale manca, con ▲. La conferma cambia l'inventario:
riesce solo a un amministratore.

## Come si fa

- **Assegnare in un colpo i PC con un utente chiaro**: riquadro **proposti**, scorri, togli le spunte sbagliate,
  **Conferma**.
- **Creare l'asset per un PC che non è in inventario**: nella colonna Asset scegli la categoria, poi **Conferma**.
- **Un PC ha lo stesso nome di un asset già registrato**: tendina **▲ esiste già un asset con questo nome** › **Collega
  a n. …** se è lo stesso oggetto, **Crea nuovo** se è un altro.
- **Correggere un PC passato a un altro collega**: sezione **▲ Da rivedere**, spunta **Sostituisci**, **Conferma**.
- **Capire perché un PC non viene proposto**: **Mostra** › Tutti, colonna **Perché**.

## Cosa vogliono dire i segni

- **▲** (giallo): da guardare, una scelta che manca o un'assegnazione che non torna.
- ✓ **Già assegnatario** (verde): la persona c'è già.
- ● **Si importa da AD**, ● **Si crea** (grigio): verrà creato alla conferma.

## Da dove arrivano i dati

Dagli accessi ai PC letti dal giro degli accessi (Wazuh, WinRM, agente) e, in mancanza, dall'ultimo utente scritto da
Active Directory nella descrizione del computer. Le persone vengono dagli utenti letti da Active Directory.

## Se la pagina è vuota

«Nessun PC in questo gruppo» vuol dire che il gruppo scelto non ha voci: prova **Tutti**. Se tutti i gruppi sono a
zero, il giro degli accessi non ha ancora letto niente: controllalo da **Giro degli accessi ›** e verifica che Active
Directory sia configurata.
