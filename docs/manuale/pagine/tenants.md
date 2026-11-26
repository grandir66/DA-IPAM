---
percorso: /tenants
titolo: Istanze — un'istanza per cliente sull'hub (Profili sul PC del tecnico)
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Sull'hub ogni cliente ha la sua **istanza**: un insieme di dati separato da quello degli altri (reti, apparati,
credenziali, scansioni). Questa pagina elenca le istanze e ne tiene l'anagrafica. La vede solo il **super
amministratore**, dalla voce **Istanze** in cima al menu; per tutti gli altri la voce non c'è.

Per scegliere su quale istanza lavorare non si usa questa pagina ma **Impostazioni › Istanza** (vedi
[Impostazioni e Config](pagine/settings.md#istanza)).

Per questa pagina non c'è una schermata nel manuale: mostra i nomi dei clienti.

## Le voci della pagina

- **Nuovo Cliente**, in alto a destra: apre il modulo per creare un'istanza. Obbligatori **Codice Cliente** (per
  esempio ACME01) e **Ragione Sociale**; facoltativi **Indirizzo**, **Città**, **Provincia**, **CAP**,
  **Telefono**, **Email**, **Partita IVA**, **Codice Fiscale**, **Referente** e **Note**. La levetta **Cliente
  attivo** dice se l'istanza è in uso.
- **Clienti (N)**: la tabella con **Codice**, **Ragione Sociale**, **Città**, **Referente**, **Email**, **Stato**
  (**Attivo** o **Disattivato**) e **Azioni**.
- **Azioni** di ogni riga:
  - **Configura**: passa a quell'istanza e apre la configurazione guidata del primo avvio (credenziali, router,
    DNS, Active Directory, prima subnet).
  - la **matita** (**Modifica anagrafica**) riapre il modulo con i dati del cliente;
  - il **cestino** (**Elimina**) cancella il cliente **con tutti i suoi dati**, dopo una conferma. Non si torna
    indietro.

## Sul PC del tecnico: Profili

Sull'installazione portatile del tecnico la stessa voce di menu si chiama **Profili** e la pagina cambia: un
profilo per cliente, col codice del gestionale, e i dati restano su quel PC, cifrati.

- In cima: **Profili** (quanti sono), **Host in tutti i profili**, **Ultimo invio al centrale**.
- **Nuovo profilo**: si scrivono **Codice cliente** e **Ragione sociale**.
- La tabella: **Codice**, **Ragione sociale**, **Host**, **Ultima scansione**, **Invio al centrale**, **Azioni**.
  **Apri** passa a quel cliente per lavorarci; la modifica cambia la ragione sociale (**Salva il profilo**).

## Come si usa

1. Nuovo cliente sull'hub: **Nuovo Cliente**, codice e ragione sociale, salva.
2. Premi **Configura** sulla sua riga per fare i primi passi.
3. Per lavorarci in seguito, scegli l'istanza in **Impostazioni › Istanza**.

## Da dove arrivano i dati

Dal registro delle istanze nel database dell'hub. I dati di ogni cliente stanno nel suo database separato.

## Se la pagina è vuota

«Nessun cliente configurato» su un hub nuovo: crea il primo con **Nuovo Cliente**. Se la pagina è bianca, il tuo
utente non è super amministratore.
