---
percorso: /zabbix/aggiungi
titolo: Aggiungi a Zabbix
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Aggiunge al monitoraggio Zabbix **più apparati insieme**, scelti fra quelli che DA-IPAM conosce e che non sono ancora
abbinati a un host di Zabbix. Prima si fa una **prova**: il centro dice per ognuno cosa farebbe, senza scrivere niente.
Poi si **aggiungono** solo quelli che il centro accetta. È la pagina per amministratori; oggi lo stesso lavoro si fa
anche, insieme a modelli e agente, da [Apparati di DatIA Mon](pagine/zabbix-apparati.md). In alto a sinistra **← Zabbix**
torna alla pagina [Zabbix](pagine/zabbix.md).

![La pagina Aggiungi a Zabbix](/manuale/zabbix-aggiungi/pagina.png)

## Le voci della pagina

Il riquadro **Apparati non abbinati**, con il numero di apparati, ha in alto a destra:

- **Filtra per nome, IP o tipo**: filtra l'elenco mentre scrivi.
- **Prova (N)**: chiede al centro cosa farebbe per gli apparati selezionati. Non scrive niente.
- **Aggiungi (N)**: aggiunge davvero quelli che il centro ha accettato nella prova. Resta grigio finché non c'è una
  prova con almeno un apparato accettato.

Le colonne:

- **La casella**: si scelgono al massimo 50 apparati alla volta.
- **Apparato**: il nome (un clic apre la scheda dell'host).
- **IP**, **Tipo** (la classificazione in DA-IPAM: Access Point, Firewall, Hypervisor…), **Stato** (acceso, spento, non
  so).
- **Cosa dice il centro**: l'esito della prova o dell'aggiunta. Per esempio «Entra con …» (il modello che userebbe),
  «Entra con …, poi serve l'agente», «Fuori perimetro» con il motivo, «Aggiunto», «C'era già», «Aggiunto, manca
  l'agente». Quando serve l'agente compare **script ›**, che apre la finestra **Agente per …** con lo script da lanciare
  a mano sulla macchina.

Il centro accetta un numero limitato di aggiunte al minuto: se dice di aspettare, la pagina aspetta il tempo indicato e
riprende da sola.

## Come si usa

1. Spunta gli apparati da monitorare (usa il filtro per trovarli).
2. Premi **Prova** e leggi la colonna **Cosa dice il centro**.
3. Premi **Aggiungi**: entrano solo quelli accettati.
4. Per Windows e Linux apri **script ›** e fai lanciare lo script sulla macchina.

## Da dove arrivano i dati

Dagli host di DA-IPAM non ancora abbinati a Zabbix. La prova e l'aggiunta passano dal centro Zabbix di Domarc, che
decide modello e perimetro.

## Se la pagina è vuota

«Non si può aggiungere da qui» con il motivo vuol dire che manca la configurazione o la chiave di scrittura del modulo
Zabbix. «Nessun apparato da aggiungere» vuol dire che sono già tutti abbinati, oppure che il filtro non lascia niente.
