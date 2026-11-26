---
percorso: /vulnerabilities
titolo: Findings — tutte le vulnerabilità trovate, in un elenco solo
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in un elenco solo **tutti i rilievi di sicurezza** trovati sulle reti dell'istanza, qualunque sia lo
strumento che li ha visti: le prove di DA-IPAM e della sonda (IPAM / Nety), le scansioni di vulnerabilità dell'Edge,
Wazuh ed ESET. Ogni riga è un rilievo su un host: una CVE, un certificato scaduto, un servizio in chiaro, un allarme
del trunk. Da qui si decide cosa sistemare prima e si tiene traccia di cosa è già stato rivisto (il **triage**).

Si arriva da **Sicurezza › Findings** nel menu. Compaiono solo i rilievi **critici, alti e medi** di scansioni degli
ultimi 30 giorni: i bassi, gli informativi e gli host non scansionati di recente restano fuori (il titolo lo ricorda
passandoci sopra col mouse).

Ricerca, filtri, tabelle e pagine dell'elenco funzionano come altrove: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini di questa guida tengono chiusa la sintesi e non
mostrano i rilievi.

## La testata

![La testata di Findings](/manuale/vulnerabilities/testata.png)

Accanto al titolo: **Critici, alti e medi degli ultimi 30 giorni** (passa il mouse per la nota intera) e la data
dell'ultimo aggiornamento dei **dati sugli exploit** (CISA KEV, Exploit-DB, EPSS). Un amministratore ha accanto
`tasto:refresh` **Aggiorna ora**, che li riscarica subito. A destra **Lancia un giro** porta alle
[Scansioni interne](pagine/scans.md).

Sopra il titolo possono comparire delle righe di stato: le fonti che non hanno risposto («Fonti non disponibili»),
quelle lette solo in parte («Risultati e contatori parziali») e, se c'è ESET, quante macchine sono state lette da
DA-Link, quante agganciate a un host e il collegamento **N macchine ESET da abbinare** (vedi
[Macchine ESET da abbinare](#eset)).

## La sintesi e la barra dell'elenco

![La sintesi chiusa e la barra dell'elenco](/manuale/vulnerabilities/barra.png)

1. `icona:chevron-right` **Dove guardare**: la fascia di sintesi. Si apre (`icona:chevron-down`) e si chiude con un
   clic sul titolo; la pagina ricorda la scelta. Chiusa, mostra i numeri in una riga. Dentro ci sono quattro riquadri, ognuno è anche un filtro:
   - **Da rivedere**: quanti rilievi nessuno ha ancora deciso, e quanti sono già decisi. Un clic mostra solo quelli.
   - **Sfruttate attivamente**: le CVE che la CISA dà come usate davvero negli attacchi, e su quanti host. Un clic
     filtra l'elenco su di loro.
   - **Aggiornamenti che pesano**: quanti aggiornamenti di programmi chiuderebbero da soli metà dei rilievi critici.
     Un clic passa alla vista **Cosa aggiornare** coi soli critici.
   - **Host più esposto**: l'host con più rilievi critici. Un clic filtra l'elenco su di lui.

   A destra, **Cose da sistemare per rete**: una barra per rete, divisa per gravità. Conta un pacchetto o un rilievo
   per host, non le singole CVE. Un clic su una rete filtra l'elenco; un secondo clic toglie il filtro.
2. `icona:search` **Cerca IP, titolo, rete**: scrivi e premi **Invio**. Cerca nell'indirizzo, nel titolo del rilievo
   e nel nome della rete. **Espandi tutto** apre il dettaglio di tutte le righe della pagina; accanto la legenda delle
   tacche di gravità.
3. **Raggruppa per**: come si legge l'elenco.
   - **Rilievo**: una riga per rilievo, la vista normale.
   - **Cosa aggiornare**: i rilievi raccolti per programma da aggiornare. Una riga dice quanti host tocca, le versioni
     installate e quante CVE chiude l'aggiornamento.
   - **Host**: un gruppo per host, dal più esposto.
   - **Rete**: un gruppo per rete.
4. **Fonte**: da quale strumento arriva il rilievo, col conteggio accanto. **Tutti**, **IPAM / Nety** (prove di
   DA-IPAM e allarmi della sonda trunk), **Edge (VA)** (scansioni di vulnerabilità), **Wazuh**, **ESET**. Con ESET
   compare la spunta **Anche le potenziali dal software**: aggiunge le vulnerabilità calcolate dalla versione dei
   programmi che ESET elenca. Non le ha viste l'agente, sono meno certe, e non entrano nei conteggi di gravità.
5. `tasto:filter` **Filtri**: apre il pannello dei filtri.

   ![Il pannello dei filtri](/manuale/vulnerabilities/filtri.png)

   - **Exploit**: **Sfruttate attivamente** (nella lista CISA KEV) ed **Exploit pubblico** (c'è un exploit in
     Exploit-DB).
   - **Stato**: lo stato del triage, **Da rivedere**, **In corso**, **Rivisto**, **Ignorato**.
   - **Sistema**: **Windows**, **Linux**, **Apple**, **Sistema non noto**.

   Il pulsante in fondo al pannello dice quanti rilievi restano («Mostra N rilievi»); **Togli tutti** li azzera. Ogni
   filtro acceso diventa un'etichetta accanto a `tasto:filter`, con la sua `icona:x` per toglierlo. A destra della barra ci sono i tre bollini di gravità
   (**Critica**, **Alta**, **Media**) con il loro numero: un clic filtra su quella gravità, un altro clic la toglie.

Sotto i filtri, a destra, **N di M rivisti** con la barra verde: quanti rilievi hanno già una decisione. Passando il
mouse si leggono i numeri per stato.

## Le colonne dell'elenco

![Le intestazioni dell'elenco](/manuale/vulnerabilities/colonne.png)

- **Stato**: lo stato del triage (● Da rivedere, In corso, Rivisto, Ignorato).
- **Rilievo**: il codice CVE o il titolo del problema.
- **Software**: il programma o il pacchetto vulnerabile, se c'è.
- **Fonte**: lo strumento che l'ha visto.
- **Gravità**: Critica, Alta, Media, con le tacche.
- **EPSS**: la probabilità che la CVE venga sfruttata nei prossimi 30 giorni, in percentuale.
- **Dove**: l'host (e quanti altri, se il rilievo è su più indirizzi) o la rete.
- **Visto**: quando è stato visto l'ultima volta.

Le colonne con `icona:arrow-up-down` si ordinano con un clic sull'intestazione; `icona:arrow-down` dice su quale
colonna è ordinato l'elenco (di serie, la gravità).

## Il dettaglio di una riga

`icona:chevron-right` all'inizio della riga apre il dettaglio (`icona:chevron-down` lo richiude):

- **Triage**: lo stato del rilievo e una nota. Chi è in sola lettura li vede soltanto, con chi e quando li ha
  cambiati. Un amministratore sceglie lo stato con i pulsanti **Da rivedere**, ▲ **In corso**, ✓ **Rivisto**,
  **Ignorato** (si salva al clic), scrive nel campo **Cosa hai provato, cosa hai trovato** e preme **Salva la nota**. Lo stato è lo stesso che si vede in
  [Porte e servizi](pagine/servizi-rete.md) per i rilievi di una porta.
- **Prova**: cosa ha visto lo strumento (la risposta, la versione, il dettaglio tecnico).
- **Rimedio**: cosa fare per chiuderlo.
- **Host › Scheda host**: apre la scheda dell'host.

## Lavorare su più rilievi insieme

Chi è amministratore vede una casella all'inizio di ogni riga. Spuntando delle righe (o la casella in testa, che
prende tutta la pagina) compare la barra **N selezionati · imposta stato:** con un pulsante per ogni stato del triage
e **Deseleziona**.

Nelle viste raggruppate ogni riga è un gruppo: `icona:chevron-right` lo apre e mostra i suoi rilievi. In fondo alla
riga **Apri l'elenco** torna alla vista **Rilievo** filtrata su quel gruppo («Riga per riga» quando il gruppo non si
può filtrare). In **Cosa aggiornare** un amministratore ha al suo posto **Prendi in carico**, che mette «In corso» sui
rilievi del gruppo ancora da rivedere. La colonna **Rivisti** dice quanti rilievi del gruppo hanno già una decisione
(«N di M», e quanti in corso).

## Macchine ESET da abbinare {#eset}

Se ESET conosce macchine che DA-IPAM non riesce ad agganciare a un host (nessun host con lo stesso MAC, seriale o
nome), nella riga di stato in cima compare il collegamento **N macchine ESET da abbinare**, che apre la finestra
**Macchine ESET da abbinare**. Finché restano lì, i loro rilievi e il loro software non compaiono nell'elenco. Per
ogni macchina: **Macchina**, **Servizio**, **IP in ESET**, **Seriale**, **Perché non è agganciata** e, nella colonna
**Host**, il campo **IP o nome dell'host** con **Abbina**. Gli altri pulsanti: **Riprova in automatico** rimette la
macchina nell'abbinamento automatico, **Non è fra gli host** la toglie dall'elenco. Sono azioni da amministratore.

## CVE potenziali

In fondo alla pagina c'è la tabella **CVE potenziali**: CVE dedotte dalla versione che un servizio dichiara quando
risponde, confrontata con l'archivio NVD. Sono da verificare e **non entrano nei report**. Colonne: **CVE**,
**Gravità**, **CVSS**, **Prodotto dichiarato**, **Host**, **Exploit**, **EPSS**. Si cerca con **CVE, prodotto,
IP…** (`icona:search`). L'archivio NVD si scarica ogni mattina; un amministratore ha `tasto:refresh` **Aggiorna NVD**,
che lo scarica subito (il primo scaricamento prende qualche minuto).

## Come si fa

- **Partire dalle più urgenti**: apri **Dove guardare** e clic su **Sfruttate attivamente**: l'elenco resta con le
  sole CVE usate davvero negli attacchi.
- **Decidere cosa aggiornare per primo**: **Raggruppa per › Cosa aggiornare**: in cima i programmi il cui
  aggiornamento chiude più rilievi; un amministratore li assegna con **Prendi in carico**.
- **Vedere tutto di un server**: scrivi il suo indirizzo in `icona:search` **Cerca** e premi **Invio**, oppure
  **Raggruppa per › Host** e apri il suo gruppo.
- **Portare in riunione i critici di una rete**: clic sulla rete in **Cose da sistemare per rete**, poi il bollino
  **Critica** a destra della barra dei filtri.
- **Chiudere un rilievo sistemato** (amministratore): apri la riga con `icona:chevron-right`, ✓ **Rivisto**, scrivi
  cosa hai fatto e **Salva la nota**. Per molti insieme: spunta le righe e, nella barra **N selezionati**, il
  pulsante dello stato.
- **Guardare solo quello che ha visto l'Edge**: **Fonte › Edge (VA)**.

## Cosa vogliono dire i segni

- Tacche di gravità: **Critica** (quattro tacche), **Alta**, **Media**, **Bassa**. Il colore va dal rosso scuro al
  giallo, ma conta il numero di tacche.
- ● **Da rivedere**: nessuno l'ha ancora deciso. **In corso**: qualcuno ci sta lavorando. **Rivisto**: deciso.
  **Ignorato**: accettato, non si sistema.
- **Sfruttate attivamente** ed **Exploit pubblico**: etichette sulla riga quando la CVE è nella lista CISA KEV o
  quando esiste un exploit pubblicato.

## Da dove arrivano i dati

Dalle scansioni interne di DA-IPAM e della sonda, dalle scansioni VA dell'Edge
([VA dall'Edge](pagine/vulnerabilities-scansioni.md)), da Wazuh e da ESET, se i moduli sono accesi. I dati sugli
exploit (CISA KEV, Exploit-DB, EPSS) si scaricano ogni giorno; lo scaricamento si spegne in Opzioni.

## Se la pagina è vuota

Compare **Nessun finding**: serve almeno un giro di rete o una scansione VA. Si lancia da **Lancia un giro**. I
certificati scaduti e gli allarmi del trunk compaiono da soli. Se ci sono filtri accesi, toglili con la loro `icona:x`.
