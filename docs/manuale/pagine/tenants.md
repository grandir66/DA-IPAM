---
percorso: /tenants
titolo: Istanze — un'istanza per cliente sull'hub (Profili sul PC del tecnico)
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Sull'hub ogni cliente ha la sua **istanza**: un insieme di dati separato da quello degli altri (reti, apparati,
credenziali, scansioni). Questa pagina elenca le istanze e ne tiene l'anagrafica. La vede solo il **super
amministratore**, dalla voce **Istanze** in cima al menu; per tutti gli altri la voce non c'è.

Per scegliere su quale istanza lavorare non si usa questa pagina ma **Impostazioni › Istanza** (vedi
[Impostazioni e Config](pagine/settings.md#istanza)).

Per questa pagina non c'è una schermata nel manuale, per scelta: mostra i nomi dei clienti. Le parti comuni
(menu, tabelle) sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## Le voci della pagina

- `tasto:plus` **Nuovo Cliente**, in alto a destra: apre il modulo per creare un'istanza. Obbligatori **Codice Cliente** (per
  esempio ACME01) e **Ragione Sociale**; facoltativi **Indirizzo**, **Città**, **Provincia**, **CAP**,
  **Telefono**, **Email**, **Partita IVA**, **Codice Fiscale**, **Referente** e **Note**. La levetta **Cliente
  attivo** dice se l'istanza è in uso. Il codice non si cambia dopo la creazione: è il nome dell'istanza.
- **Clienti (N)**: la tabella con **Codice**, **Ragione Sociale**, **Città**, **Referente**, **Email**, **Stato**
  (**Attivo** o **Disattivato**) e **Azioni**.
- **Azioni** di ogni riga:
  - `tasto:wand` **Configura**: passa a quell'istanza e apre la configurazione guidata del primo avvio (credenziali, router,
    DNS, Active Directory, prima subnet).
  - `icona:pencil` **Modifica anagrafica** riapre il modulo con i dati del cliente;
  - `icona:trash` **Elimina** cancella il cliente **con tutti i suoi dati**, dopo una conferma. Non si torna
    indietro.

## Sul PC del tecnico: Profili

Sull'installazione portatile del tecnico la stessa voce di menu si chiama **Profili** e la pagina cambia: un
profilo per cliente, col codice del gestionale, e i dati restano su quel PC, cifrati.

- In cima: **Profili** (quanti sono), **Host in tutti i profili**, **Ultimo invio al centrale**.
- `tasto:plus` **Nuovo profilo**: si scrivono **Codice cliente** e **Ragione sociale**.
- La tabella: **Codice**, **Ragione sociale**, **Host**, **Ultima scansione**, **Invio al centrale**, **Azioni**.
  **Apri** passa a quel cliente per lavorarci; la modifica cambia la ragione sociale (**Salva il profilo**).

## Come si fa

- **Aggiungere un cliente all'hub**: `tasto:plus` **Nuovo Cliente**, scrivi **Codice Cliente** e **Ragione
  Sociale**, salva; poi `tasto:wand` **Configura** sulla sua riga per i primi passi (credenziali, router, prima
  subnet).
- **Lavorare su un cliente già presente**: scegli l'istanza in **Impostazioni › Istanza**, non da qui.
- **Aggiornare il referente o l'email**: `icona:pencil` sulla riga, cambia i campi, salva.
- **Mettere in pausa un cliente senza cancellarlo**: `icona:pencil`, spegni **Cliente attivo**, salva: lo stato
  diventa **Disattivato** e i dati restano.
- **Sul PC del tecnico, cominciare da un cliente nuovo**: `tasto:plus` **Nuovo profilo** col codice del gestionale,
  poi **Apri**.

## Da dove arrivano i dati

Dal registro delle istanze nel database dell'hub. I dati di ogni cliente stanno nel suo database separato.

## Se la pagina è vuota

«Nessun cliente configurato» su un hub nuovo: crea il primo con **Nuovo Cliente**. Se la pagina è bianca, il tuo
utente non è super amministratore.
