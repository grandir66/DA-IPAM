---
percorso: /inventory/assignees/import-ad
titolo: Importa gli assegnatari da Active Directory
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Propone gli **utenti di Active Directory** da portare fra gli [Assegnatari](pagine/inventory-assignees.md): quelli nuovi
da creare e quelli già presenti con dati da aggiornare (mail, reparto, ruolo). Esclude da sola gli account di servizio,
gli amministrativi, i disattivati, quelli senza nome e cognome e quelli che non si collegano da tempo. **Nessun asset
viene toccato**: si importano solo le persone. Si arriva dal pulsante **Importa da Active Directory** della pagina
Assegnatari; la freccia in alto a sinistra ci torna.

In alto a destra c'è il dominio letto e quando sono stati letti gli utenti l'ultima volta. **Rileggi da AD** apre la
pagina **Active Directory**, da dove si rilegge il dominio se gli utenti sono vecchi.

![La pagina Importa da Active Directory](/manuale/inventory-assignees-import-ad/pagina.png)

## Le voci della pagina

1. **I filtri**: **Solo account abilitati** (lascia fuori gli account spenti), **Con nome e cognome** (lascia fuori
   gli account senza nome, che di solito sono tecnici), **Accesso negli ultimi** 30, 90, 180 giorni o sempre (lascia
   fuori chi non si collega da più tempo), **Unità organizzativa** (solo gli utenti di una OU di AD). Cambiando un
   filtro la spunta torna quella di serie.
2. **I quattro riquadri**: **nuovi, proposti** (persone da creare), **già presenti, dati da aggiornare**, **▲ da
   controllare** (casi dubbi, per esempio un nome già usato da un'altra persona), **esclusi** (servizio, disattivati,
   senza nome…).
3. **Rileggi da AD**: porta alla pagina Active Directory per leggere di nuovo gli utenti dal dominio.

L'elenco **Utenti proposti** ha la casella di scelta (quella in testa prende tutti quelli della pagina) e le colonne
Nome, Cognome, Account, Mail, Reparto, Ruolo, Ultimo accesso, **PC dove si collega** (i computer dove l'utente è stato
visto, o «nessuno visto») ed **Esito** (cosa succede importandolo). La spunta è già messa sui nuovi e su quelli da
aggiornare. Sotto, «1–50 di N» con **pagina precedente** e **pagina successiva**.

**Esclusi — perché non sono proposti** si apre con un clic e dice quanti ne sono stati lasciati fuori per ogni motivo
(account di servizio, amministrativi, disattivati, senza nome e cognome, senza accessi nel periodo), con qualche esempio.

## La barra in fondo

Riassume la scelta: quanti selezionati, quanti da creare, quanti da aggiornare. **Annulla** torna agli Assegnatari senza
importare; **Importa N utenti** crea e aggiorna le persone scelte e poi torna all'elenco.

## Come si usa

1. Se gli utenti sono vecchi, premi **Rileggi da AD** e rileggi il dominio, poi torna qui.
2. Lascia i filtri di serie (abilitati, con nome e cognome, accesso negli ultimi 90 giorni).
3. Guarda i **▲ da controllare** e togli la spunta da chi non va.
4. Premi **Importa N utenti**.

## Cosa vogliono dire i segni

Nella colonna **Esito**: verde per i nuovi, grigio per gli aggiornamenti e per chi resta com'è, **▲** giallo per i casi
da controllare.

## Da dove arrivano i dati

Dagli utenti che DA-IPAM ha letto da Active Directory e dagli accessi ai PC (per la colonna «PC dove si collega»).

## Se la pagina è vuota

«Nessuna integrazione Active Directory su questo cliente» vuol dire che AD non è configurata: il collegamento
**Configurala** porta alla pagina Active Directory. «Nessun utente da proporre con questi filtri» vuol dire che i filtri
lasciano fuori tutti: prova **Accesso negli ultimi › sempre** o togli **Con nome e cognome**.
