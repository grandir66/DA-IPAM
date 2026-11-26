---
percorso: /inventory/assignees
titolo: Assegnatari — le persone a cui si assegnano gli asset
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco delle **persone** a cui si assegnano gli asset: chi usa un PC, chi è responsabile di un server. Le persone
arrivano da Active Directory oppure si inseriscono a mano. Da qui le si vede tutte, si scopre chi è uscito dall'azienda
e ha ancora asset assegnati, e si correggono i dati. Si arriva da **Inventario › Assegnatari** nel menu. La pagina non
ha schede in cima.

Tabelle e segni funzionano come in tutte le pagine ([parti comuni dell'interfaccia](../INTERFACCIA.md)); qui c'è
quello che Assegnatari ha di suo.

## La testata

![La testata di Assegnatari](/manuale/inventory-assignees/testata.png)

1. `icona:arrow-left` torna ad [Asset](pagine/inventory.md).
2. `tasto:users` **Importa da Active Directory**: apre la pagina che propone gli utenti di AD da importare
   ([Importa da Active Directory](pagine/inventory-assignees-import-ad.md)).
3. `tasto:plus` **Nuovo assegnatario**: apre la finestra per inserire una persona a mano (sotto).

## Le fasce sopra l'elenco

![La fascia degli abbinamenti e la barra dell'elenco](/manuale/inventory-assignees/fasce.png)

- **● N PC hanno un utente prevalente da abbinare**: ci sono PC per cui DA-IPAM sa chi li usa ma l'assegnazione non è
  ancora fatta. **Abbinamenti ›** apre [Abbinamenti](pagine/inventory-abbinamenti.md).
- **▲ Attenzione — N assegnatari sono disattivati in Active Directory** e hanno ancora degli asset: vanno riassegnati.
  **Mostra solo questi** lascia in elenco solo loro; **Mostra tutti** torna all'elenco intero. La fascia c'è solo
  quando serve.

## L'elenco

![L'elenco degli assegnatari](/manuale/inventory-assignees/tabella.png)

Il titolo dice quante persone ci sono («Elenco (19)»).

1. **Origine**: Tutte, Active Directory, Inserito a mano.
2. **Cerca nome, mail, reparto**: filtra mentre scrivi.
3. **Stato in AD**: se la persona è ancora attiva in Active Directory (vedi i segni più sotto).
4. `icona:pencil` apre la finestra di modifica.
5. `icona:trash` elimina la persona, dopo una conferma: gli asset che aveva restano senza assegnatario.

| Colonna | Che cosa dice |
|---|---|
| **Nome e cognome** | La persona. |
| **Mail** | L'indirizzo di posta. |
| **Reparto**, **Ruolo** | Come scritti in Active Directory. |
| **Origine** | Active Directory o Inserito a mano. |
| **Stato in AD** | ✓ Attivo, ▲ Disattivato il …, ● Non in AD. |
| **Asset** | Quanti asset ha assegnati. |

Una persona disattivata in AD che ha ancora asset ha la riga gialla chiara e, in fondo, **Riassegna**: apre sotto la
riga l'elenco dei suoi asset, ognuno col collegamento alla [scheda dell'asset](pagine/inventory-id.md), dove si
cambia l'assegnatario.

Sotto l'elenco, «1–50 di N» con **pagina precedente** e **pagina successiva**. La pagina non ha il menu
`icona:more-vertical` né il tasto destro.

## La finestra Nuovo assegnatario

![La finestra Nuovo assegnatario](/manuale/inventory-assignees/nuovo.png)

Campi: **Nome** (obbligatorio), **Email**, **Telefono**, **Note**. **Crea** salva. La stessa finestra, aperta con
`icona:pencil`, si chiama **Modifica assegnatario** e salva con **Salva**. Per una persona importata da Active Directory
la finestra lo ricorda: nome, mail e telefono si riallineano a ogni lettura di AD, quindi una correzione fatta qui
verrebbe sovrascritta.

Creare, modificare ed eliminare cambia i dati: riesce solo a un amministratore.

## Come si fa

- **Portare dentro le persone la prima volta**: `tasto:users` **Importa da Active Directory**.
- **Aggiungere un consulente che non è in AD**: `tasto:plus` **Nuovo assegnatario**, nome e mail, **Crea**.
- **Ripulire chi è uscito dall'azienda**: nella fascia gialla **Mostra solo questi**, poi **Riassegna** su ogni riga e
  cambia l'assegnatario nella scheda di ciascun asset.
- **Trovare tutti quelli dell'amministrazione**: scrivi il reparto in **Cerca**.
- **Assegnare i PC a chi li usa**: **Abbinamenti ›** nella fascia, o la pagina
  [Abbinamenti](pagine/inventory-abbinamenti.md).

## Cosa vogliono dire i segni

- ✓ **Attivo** (verde): la persona c'è in Active Directory ed è abilitata.
- ▲ **Disattivato il …** (giallo): l'account è stato disattivato in AD in quella data.
- ● **Non in AD** (grigio): inserita a mano, AD non la conosce.

## Da dove arrivano i dati

Dagli utenti letti da Active Directory (pagina [Active Directory](pagine/active-directory.md) del menu Network) e dagli inserimenti a
mano. Il numero di asset viene dall'inventario.

## Se la pagina è vuota

Non è stata ancora importata nessuna persona: usa **Importa da Active Directory** o **Nuovo assegnatario**. «Nessun
assegnatario con questi filtri» vuol dire che c'è un filtro di Origine, una ricerca o «Mostra solo questi» attivo:
toglili.
