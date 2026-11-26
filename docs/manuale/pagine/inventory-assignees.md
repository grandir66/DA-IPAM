---
percorso: /inventory/assignees
titolo: Assegnatari — le persone a cui si assegnano gli asset
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'elenco delle **persone** a cui si assegnano gli asset: chi usa un PC, chi è responsabile di un server. Le persone
arrivano da Active Directory oppure si inseriscono a mano. Da qui le si vede tutte, si scopre chi è uscito dall'azienda
e ha ancora asset assegnati, e si correggono i dati. Si arriva da **Inventario › Assegnatari** nel menu; la freccia in
alto a sinistra torna ad [Asset](pagine/inventory.md).

![La pagina Assegnatari](/manuale/inventory-assignees/pagina.png)

## Le voci della pagina

1. **Importa da Active Directory**: apre la pagina che propone gli utenti di AD da importare
   ([Importa da Active Directory](pagine/inventory-assignees-import-ad.md)).
2. **Nuovo assegnatario**: apre la finestra per inserire una persona a mano, con Nome (obbligatorio), Email, Telefono,
   Note.
3. **Origine**: filtra l'elenco per provenienza: Tutte, Active Directory, Inserito a mano. Accanto, **Cerca nome, mail,
   reparto** filtra mentre scrivi.
4. **Stato in AD**: dice se la persona è ancora attiva in Active Directory (vedi i segni più sotto).

Le altre colonne: **Nome e cognome**, **Mail**, **Reparto**, **Ruolo**, **Origine** (Active Directory o Inserito a mano),
**Asset** (quanti asset ha assegnati). In fondo alla riga, la **matita** apre la modifica e il **cestino** elimina la
persona: gli asset che aveva restano senza assegnatario.

Per una persona importata da Active Directory, la finestra di modifica lo ricorda: nome, mail e telefono si riallineano
a ogni lettura di AD, quindi una correzione fatta qui verrebbe sovrascritta.

## Le fasce sopra l'elenco

- **● N PC hanno un utente prevalente da abbinare**: ci sono PC per cui DA-IPAM sa chi li usa ma l'assegnazione non è
  ancora fatta. **Abbinamenti ›** apre la pagina [Abbinamenti](pagine/inventory-abbinamenti.md).
- **Attenzione — N assegnatari sono disattivati in Active Directory** e hanno ancora degli asset: vanno riassegnati.
  **Mostra solo questi** lascia in elenco solo loro; **Mostra tutti** torna all'elenco intero.

Sotto l'elenco, «1–50 di N» con **pagina precedente** e **pagina successiva**.

## Come si usa

1. La prima volta usa **Importa da Active Directory** per portare dentro le persone.
2. Per chi non è in AD (un consulente, un fornitore) usa **Nuovo assegnatario**.
3. Quando compare la fascia gialla, premi **Mostra solo questi**, apri gli asset di ogni persona uscita e assegnali a
   qualcun altro.
4. Per assegnare i PC a chi li usa, vai in [Abbinamenti](pagine/inventory-abbinamenti.md).

## Cosa vogliono dire i segni

- **✓ Attivo** (verde): la persona c'è in Active Directory ed è abilitata.
- **▲ Disattivato il …** (giallo): l'account è stato disattivato in AD in quella data.
- **● Non in AD** (grigio): inserita a mano, AD non la conosce.

## Da dove arrivano i dati

Dagli utenti letti da Active Directory (pagina **Active Directory** del menu Network) e dagli inserimenti a mano. Il
numero di asset viene dall'inventario.

## Se la pagina è vuota

Non è stata ancora importata nessuna persona: usa **Importa da Active Directory** o **Nuovo assegnatario**. Se c'è un
filtro di Origine o una ricerca, toglili.
