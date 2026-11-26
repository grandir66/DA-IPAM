---
percorso: /zabbix/apparati
titolo: Apparati di DatIA Mon — monitoraggio, modelli e agente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la pagina di lavoro del monitoraggio **DatIA Mon**: un elenco solo, diviso per famiglia (Firewall, Switch, Router,
Server Windows…), con gli apparati che sono già in Zabbix e quelli che DA-IPAM conosce e Zabbix no. Si selezionano e si
agisce su più apparati insieme: aggiungerli a Zabbix, aggiungere o togliere un modello di monitoraggio, cambiare
famiglia, preparare il comando per installare l'agente su Windows e Linux. Ogni scrittura passa prima da una prova a
vuoto del centro e poi da una conferma. Si arriva da **DatIA Mon › Apparati** nel menu; la vedono gli amministratori.

In alto a destra, **Vista tecnica e abbinamenti ›** apre la pagina [Zabbix](pagine/zabbix.md). I cambi fatti qui
compaiono nell'elenco entro due minuti.

![La pagina Apparati di DatIA Mon, con un apparato selezionato](/manuale/zabbix-apparati/pagina.png)

## Le voci della pagina

1. **Le schede**: **Tutti**, **In monitoraggio** (già in Zabbix), **Da aggiungere** (DA-IPAM li conosce, Zabbix no),
   **Agente da installare** (Windows e Linux senza l'agente o con l'agente che non manda dati). Il numero dice quanti
   sono.
2. **Filtra per nome, IP o modello**: filtra mentre scrivi.
3. **La barra della selezione**: compare appena spunti un apparato e dice quanti sono selezionati. Si sceglie al massimo
   50 apparati alla volta. I pulsanti:
   - **Aggiungi a Zabbix (N)**: per quelli selezionati che non sono ancora in Zabbix. Si apre una finestra: prima il
     centro dice cosa farebbe per ognuno, poi si aggiungono solo quelli che accetta.
   - **Aggiungi un modello** / **Togli un modello**: per quelli già in Zabbix. Si sceglie il modello (template), si
     preme **Prova** per vedere cosa cambierebbe su ognuno («verrà aggiunto», «ce l'ha già», «verrà tolto, con le sue
     misure») e poi **Aggiungi a N** o **Togli da N**. Togliere un modello cancella le misure raccolte con quel modello.
   - **Cambia famiglia**: sposta gli apparati in un'altra famiglia; si sceglie la famiglia e si preme **Cambia**.
   - **Prepara l'agente**: per i Windows e i Linux selezionati prepara il comando di installazione dell'agente (vedi
     sotto).
   - **Togli la selezione**.

Se il centro si legge ma non si scrive (manca la chiave di scrittura), una riga tratteggiata lo dice e i pulsanti che
scrivono restano grigi.

## L'elenco per famiglia

Ogni famiglia è un riquadro con il conteggio «N in monitoraggio · M da aggiungere» e la casella che le seleziona tutte.
Le colonne:

- **Stato**: **✓ Funziona**, **▲ Attenzione**, **✕ Fermo**, **Non so**, **Da aggiungere**. Sotto il nome c'è il motivo,
  per esempio «non risponde».
- **Apparato**: il nome (un clic apre la scheda dell'host in DA-IPAM).
- **IP**.
- **Modelli**: i modelli di Zabbix applicati; per chi non è ancora in Zabbix «lo propone il centro all'aggiunta».
- **Agente**: **attivo**, **non manda dati**, **non so**, **non serve** (apparati che si leggono via SNMP), **da
  installare**.

## Preparare l'agente

La finestra **Prepara l'agente** spiega che l'agente manda i dati al proxy di questo cliente (nessuna porta da aprire) e
che l'installazione la fa sempre una persona. Si sceglie come:

- **Una macchina alla volta**: un comando per ognuna, da incollare o scaricare (.ps1, .sh).
- **Tutte le Windows del dominio**: un comando solo, da distribuire con GPO o Intune; ogni macchina si presenta col suo
  nome.
- **Tutti i Linux**: un comando solo, uguale per tutti.

Si indica **a quale indirizzo l'agente manda i dati** e si preme **Prepara**. Il comando unico funziona solo dove il
nome in Zabbix è il nome della macchina: la finestra elenca quelli da controllare. Il comando si copia o si scarica con i
pulsanti accanto.

## Come si usa

1. Apri **Da aggiungere**, spunta gli apparati da monitorare e premi **Aggiungi a Zabbix**; guarda cosa dice il centro e
   conferma.
2. Apri **Agente da installare**, seleziona i Windows e i Linux e premi **Prepara l'agente**; passa il comando a chi
   installa.
3. Per un apparato monitorato male, selezionalo e usa **Aggiungi un modello** o **Cambia famiglia**.

## Cosa vogliono dire i segni

- **✓ Funziona** (verde), **▲ Attenzione** (giallo), **✕ Fermo** (rosso): lo stato letto da Zabbix.
- **Non so** (contorno) e **Da aggiungere** (grigio tratteggiato): stato non noto, oppure non ancora in Zabbix.

## Da dove arrivano i dati

Dal centro Zabbix di Domarc (host, modelli, stato, agente) e dagli host di DA-IPAM per quelli ancora da aggiungere. Le
scritture passano dal centro, che decide modello e perimetro.

## Se la pagina è vuota

«Il centro non si legge» con il motivo vuol dire che il modulo non è configurato o il centro non risponde: guarda la
configurazione da **DatIA Mon › Configurazione**. «Nessun apparato» vuol dire che il filtro o la scheda non lasciano
niente: torna su **Tutti** e svuota il filtro.
