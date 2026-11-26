---
percorso: /inventory/abbinamenti
titolo: Abbinamenti — chi usa quale PC
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Propone **a chi assegnare ogni PC**, guardando chi ci si è collegato negli ultimi 30 giorni e, dove gli accessi non
bastano, l'ultimo utente che Active Directory ha scritto nella descrizione del computer. Con un clic si confermano
molti abbinamenti insieme: DA-IPAM crea l'asset se manca, importa la persona da Active Directory se non è ancora fra gli
[Assegnatari](pagine/inventory-assignees.md) e scrive l'assegnazione. Si arriva da **Inventario › Abbinamenti** nel
menu, o dal collegamento **Abbinamenti ›** nella pagina degli Assegnatari.

In alto a destra **Giro degli accessi ›** apre l'impostazione dell'automatismo che legge gli accessi ai PC.

![La pagina Abbinamenti](/manuale/inventory-abbinamenti/pagina.png)

## Le voci della pagina

1. **I quattro riquadri**: un clic mostra quel gruppo.
   - **proposti**: PC con un utente prevalente chiaro; il sottotitolo dice quanti hanno già un asset e quanti no.
   - **▲ da rivedere**: PC già assegnati a un'altra persona rispetto a chi li usa davvero.
   - **pochi dati**: PC con troppo pochi accessi per decidere; accanto, quanti sono **già abbinati**.
   - **esclusi**: server, apparati e PC condivisi, che non si assegnano a una persona.
2. **Mostra**: lo stesso filtro dei riquadri, con in più **Tutti**. La casella **Solo PC senza asset** lascia solo i
   PC che non hanno ancora una riga in inventario.
3. **Cerca PC o persona**: filtra per nome del PC o della persona.

Le colonne dell'elenco:

- **La spunta**: nel gruppo **Proposti** è già messa su tutti; si toglie da quelli che non vanno.
- **PC**: nome e indirizzo.
- **Asset**: l'asset collegato. Se manca, si sceglie la **categoria** dell'asset da creare (Desktop, Laptop, VM,
  Other). Se in inventario esiste già un asset con lo stesso nome compare «▲ esiste già un asset con questo nome»: si
  sceglie se **collegare** quello o **crearne uno nuovo**.
- **Usato da**: la persona che usa il PC.
- **Assegnatario**: **✓ Già assegnatario** se la persona è già fra gli Assegnatari, **● Si importa da AD** se verrà
  importata alla conferma. Nei PC già abbinati c'è il nome, con «· a mano» se l'assegnazione l'ha fatta una persona.
- **Accessi**: quante volte su quante si è collegato quella persona («7 su 7 di rete», «14 su 14 alla tastiera»), oppure
  **da AD (ultimo accesso)** quando il dato viene dalla descrizione del computer in Active Directory.
- **Ultima volta**: l'ultimo accesso visto.
- **Perché** (nei gruppi Esclusi, Pochi dati e Tutti): il motivo per cui il PC non è proposto.

## Sotto l'elenco

- **▲ Da rivedere — assegnato a un altro**: la tabella dei PC già assegnati a qualcun altro, con la casella
  **Sostituisci**. Di serie non è spuntata: l'assegnazione resta finché non la sostituisci tu.
- **Esclusi — perché non sono proposti**: un clic apre l'elenco dei PC esclusi con il motivo.
- **La barra in fondo** riassume la scelta: quanti asset si creano, quanti si collegano, quanti assegnatari si importano
  da AD, quante assegnazioni si scrivono. Il pulsante **Conferma N abbinamenti** applica tutto. Resta grigio se c'è un
  asset senza categoria o un omonimo senza la scelta «collega / crea nuovo»: la barra dice quale manca.

## Come si usa

1. Apri il gruppo **proposti** e scorri l'elenco.
2. Togli la spunta dai PC che non vanno; per quelli senza asset scegli la categoria.
3. Se compare un omonimo, scegli se collegarlo o crearne uno nuovo.
4. Guarda la sezione **Da rivedere** e spunta **Sostituisci** solo dove sei sicuro.
5. Premi **Conferma N abbinamenti**. Ogni asset scrive una riga nel suo storico.

## Cosa vogliono dire i segni

- **▲** (giallo): da guardare, una scelta che manca o un'assegnazione che non torna.
- **✓ Già assegnatario** (verde): la persona c'è già.
- **● Si importa da AD** (grigio): la persona verrà creata alla conferma.

## Da dove arrivano i dati

Dagli accessi ai PC letti dal giro degli accessi (WinRM e registri di Active Directory) e, in mancanza, dall'ultimo
utente scritto da Active Directory nella descrizione del computer. Le persone vengono dagli utenti letti da Active
Directory.

## Se la pagina è vuota

«Nessun PC in questo gruppo» vuol dire che il gruppo scelto non ha voci: prova **Tutti**. Se tutti i gruppi sono a
zero, il giro degli accessi non ha ancora letto niente: controllalo da **Giro degli accessi ›** e verifica che Active
Directory sia configurata.
