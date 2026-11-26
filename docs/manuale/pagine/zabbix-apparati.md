---
percorso: /zabbix/apparati
titolo: Apparati di DatIA Mon
versione: 0.9.1369
aggiornata: 2026-11-26
---

## A cosa serve

È il punto da cui si gestisce Zabbix senza aprire DA-Zabbix: un elenco solo con gli apparati **già in Zabbix** e quelli
che DA-IPAM conosce e Zabbix **non ancora**. Si filtra, si raggruppa, si scelgono le colonne, e si agisce su uno o più
apparati: aggiungerli, cambiare i modelli, cambiare la famiglia, preparare l'agente. Solo per amministratori.

![La pagina Apparati di DatIA Mon](/manuale/zabbix-apparati/pagina.png)

## Le voci della pagina

**Le schede in cima** sono quelle di DatIA Mon: Apparati, [Modelli](pagine/zabbix-modelli.md),
[Agenti](pagine/zabbix-agenti.md), [Abbinamenti](pagine/zabbix.md), Per il cliente,
[Centro e proxy](pagine/zabbix-centro.md).

**La riga di stato** dice se Zabbix «si legge e si scrive» o è in «sola lettura», con il motivo e lo stato dei proxy.
Quando manca la chiave di scrittura c'è **Inserisci la chiave**, che porta alla configurazione del modulo. **Rileggi**
chiede di nuovo i dati al centro.

**I filtri**:

- **Cerca nome, IP, MAC, marca, modello**: filtra mentre scrivi.
- I pulsanti di stato con i conteggi: **Tutti**, **In monitoraggio**, **Da aggiungere**, **Con problemi**,
  **Agente da installare**.
- Le tendine **Famiglia**, **Rete**, **Marca**, **Modello Zabbix**, **Agente**, **Credenziale**: ogni voce porta
  quanti apparati ha; «(nessuno)» sceglie chi quel dato non ce l'ha. Una tendina con un filtro acceso ha il bordo spesso.
- **Togli i filtri** li azzera. A destra «N di M apparati».

**Raggruppa per** divide l'elenco per Famiglia, Rete, Marca, Stato, o non lo divide. Un clic sul nome del gruppo lo
richiude o lo riapre; la casella del gruppo sceglie tutti i suoi apparati.

**Colonne** apre la finestra dove si accendono, si spengono e si spostano (frecce su e giù). «Come all'inizio» rimette
quelle di serie. La scelta, il gruppo e l'ordinamento restano salvati per il tuo utente. Un clic sull'intestazione di una
colonna ordina per quella; un secondo clic inverte.

**Le colonne**: Stato, Apparato, IP, Rete · VLAN, Marca, Modello, Famiglia, Modello Zabbix (il primo), Altri (quanti
altri modelli ha: il nome compare passando sopra), Agente, Credenziale (i protocolli con una credenziale provata valida in
DA-IPAM), Problemi. Da accendere: Proxy, MAC, Nome in Zabbix, Sistema.

**Le azioni sui selezionati** (al massimo 50 alla volta): **Aggiungi a Zabbix (N)**, **Aggiungi un modello…**,
**Togli un modello…**, **Cambia famiglia…**, **Prepara l'agente…**, **Togli la selezione**. Un pulsante grigio dice
perché passando sopra. Ogni scrittura passa prima da una prova del centro e poi da una conferma.

**Il tasto destro** su una riga dà le stesse azioni (sulla riga, o sui selezionati se la riga è fra quelli), più
«Apri la scheda in DA-IPAM», «Filtra per famiglia / rete / marca» e «Copia l'IP».

**Un clic su una riga** apre la **scheda di lato**: stato e motivo, IP, nome in Zabbix, famiglia, i modelli uno per
riga, agente e sistema, credenziale valida in DA-IPAM, proxy, problemi aperti, rete, marca e modello, e i pulsanti delle
azioni su quel solo apparato.

## Come si usa

1. Scegli **Da aggiungere** e, se serve, una **Rete** o una **Famiglia**.
2. Spunta gli apparati (o la casella del gruppo) e premi **Aggiungi a Zabbix**: la finestra mostra la prova, poi conferma.
3. Per Windows e Linux premi **Prepara l'agente…** e fai lanciare il comando sulla macchina.
4. Per cambiare modelli o famiglia di chi è già in Zabbix: selezione, poi il pulsante; oppure tasto destro sulla riga.

## Da dove arrivano i dati

Dal centro Zabbix di Domarc (apparati, famiglie, modelli, agente, problemi, proxy) e dagli host di DA-IPAM (rete, marca,
modello, MAC, credenziali). I cambi fatti in Zabbix compaiono entro due minuti.

## Se la pagina è vuota

«Il centro non si legge» con il motivo: manca la configurazione o il centro non risponde; **Apri la configurazione**.
«Nessun apparato» con i filtri accesi: **Togli i filtri**.
