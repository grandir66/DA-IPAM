---
percorso: /vulnerabilities
titolo: Findings — tutte le vulnerabilità trovate, in un elenco solo
versione: 0.9.1363
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

![La pagina Findings](/manuale/vulnerabilities/pagina.png)

## Le voci della pagina

Sopra il titolo possono comparire delle righe di stato: le fonti che non hanno risposto («Fonti non disponibili»),
quelle lette solo in parte («Risultati e contatori parziali») e, se c'è ESET, quante macchine sono state lette e
quante sono **da abbinare** a un host (vedi più sotto). Accanto al titolo c'è la data dell'ultimo aggiornamento dei
**dati sugli exploit** (CISA KEV, Exploit-DB, EPSS) e, per chi è amministratore, **Aggiorna ora**. A destra **Lancia
un giro** porta alle [Scansioni interne](pagine/scans.md).

1. **Dove guardare**: la fascia di sintesi. Si chiude e si riapre con un clic sul titolo (la pagina ricorda la
   scelta). Dentro ci sono quattro riquadri, ognuno è anche un filtro:
   - **Da rivedere**: quanti rilievi nessuno ha ancora deciso, e quanti sono già decisi. Un clic mostra solo quelli.
   - **Sfruttate attivamente**: le CVE che la CISA dà come usate davvero negli attacchi, e su quanti host. Un clic
     filtra l'elenco su di loro.
   - **Aggiornamenti che pesano**: quanti aggiornamenti di programmi chiuderebbero da soli metà dei rilievi critici.
     Un clic passa alla vista **Cosa aggiornare** coi soli critici.
   - **Host più esposto**: l'host con più rilievi critici. Un clic filtra l'elenco su di lui.

   A destra, **Cose da sistemare per rete**: una barra per rete, divisa per gravità. Conta un pacchetto o un rilievo
   per host, non le singole CVE. Un clic su una rete filtra l'elenco; un secondo clic toglie il filtro.
2. **Cerca IP, titolo, rete**: scrivi e premi Invio. Cerca nell'indirizzo, nel titolo del rilievo e nel nome della
   rete. **Espandi tutto** apre il dettaglio di tutte le righe della pagina.
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
5. **Filtri**: apre il pannello dei filtri.
   - **Exploit**: **Sfruttate attivamente** (nella lista CISA KEV) ed **Exploit pubblico** (c'è un exploit in
     Exploit-DB).
   - **Stato**: lo stato del triage, **Da rivedere**, **In corso**, **Rivisto**, **Ignorato**.
   - **Sistema**: **Windows**, **Linux**, **Apple**, **Sistema non noto**.

   Il pulsante in fondo al pannello dice quanti rilievi restano («Mostra N rilievi»). Ogni filtro acceso diventa
   un'etichetta sopra l'elenco, con la ✕ per toglierlo. A destra della barra ci sono i tre bollini di gravità
   (**Critica**, **Alta**, **Media**) con il loro numero: un clic filtra su quella gravità, un altro clic la toglie.

Sotto i filtri, a destra, **N di M rivisti** con la barra verde: quanti rilievi hanno già una decisione. Passando il
mouse si leggono i numeri per stato.

## Le colonne dell'elenco

- **Stato**: lo stato del triage (● Da rivedere, In corso, Rivisto, Ignorato).
- **Rilievo**: il codice CVE o il titolo del problema.
- **Software**: il programma o il pacchetto vulnerabile, se c'è.
- **Fonte**: lo strumento che l'ha visto.
- **Gravità**: Critica, Alta, Media, con le tacche.
- **EPSS**: la probabilità che la CVE venga sfruttata nei prossimi 30 giorni, in percentuale.
- **Dove**: l'host (e quanti altri, se il rilievo è su più indirizzi) o la rete.
- **Visto**: quando è stato visto l'ultima volta.

Le colonne con le frecce si ordinano con un clic sull'intestazione.

## Il dettaglio di una riga

La freccia **›** all'inizio della riga apre il dettaglio:

- **Triage**: lo stato del rilievo e una nota. Chi è amministratore sceglie lo stato, scrive nel campo **Cosa hai
  provato, cosa hai trovato** e preme **Salva la nota**. Lo stato è lo stesso che si vede in
  [Porte e servizi](pagine/servizi-rete.md) per i rilievi di una porta.
- **Prova**: cosa ha visto lo strumento (la risposta, la versione, il dettaglio tecnico).
- **Rimedio**: cosa fare per chiuderlo.
- **Host › Scheda host**: apre la scheda dell'host.

## Lavorare su più rilievi insieme

Chi è amministratore vede una casella all'inizio di ogni riga. Spuntando delle righe (o la casella in testa, che
prende tutta la pagina) compare la barra **N selezionati · imposta stato:** con un pulsante per ogni stato del triage
e **Deseleziona**.

Nelle viste raggruppate ogni gruppo ha in fondo alla riga **Prendi in carico** (mette «In corso» sui rilievi del
gruppo ancora da rivedere, solo amministratori) e **Apri l'elenco**, che torna alla vista **Rilievo** filtrata su quel gruppo. La colonna **Rivisti**
dice quanti rilievi del gruppo hanno già una decisione.

## Macchine ESET da abbinare

Se ESET conosce macchine che DA-IPAM non riesce ad agganciare a un host (nessun host con lo stesso MAC, seriale o
nome), compare il riquadro **Macchine ESET da abbinare**. Finché restano lì, i loro rilievi e il loro software non
compaiono nell'elenco. Per ogni macchina: **Macchina**, **Servizio**, **IP in ESET**, **Seriale**, **Perché non è
agganciata** e, per l'amministratore, il campo **IP o nome dell'host** con **Abbina**. Gli altri pulsanti: **Riprova
in automatico** rimette la macchina nell'abbinamento automatico, **Non è fra gli host** la toglie dal riquadro.

## CVE potenziali

In fondo alla pagina c'è la tabella **CVE potenziali**: CVE dedotte dalla versione che un servizio dichiara quando
risponde, confrontata con l'archivio NVD. Sono da verificare e **non entrano nei report**. Colonne: **CVE**,
**Gravità**, **CVSS**, **Prodotto dichiarato**, **Host**, **Exploit**, **EPSS**. Si cerca con **CVE, prodotto,
IP…**. L'archivio NVD si scarica ogni mattina; **Aggiorna NVD** lo scarica subito (il primo scaricamento prende
qualche minuto).

## Come si usa

1. Apri **Dove guardare** e parti da **Sfruttate attivamente**: sono le più urgenti.
2. Passa a **Raggruppa per › Cosa aggiornare**: spesso un aggiornamento solo chiude decine di rilievi.
3. Per un host o una rete, usa la barra della rete o **Raggruppa per › Host**.
4. Apri una riga, leggi **Prova** e **Rimedio**, poi segna lo stato nel **Triage** con una nota.
5. Quando un gruppo è affidato a qualcuno, **Prendi in carico**: gli altri vedono «In corso».

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
certificati scaduti e gli allarmi del trunk compaiono da soli. Se ci sono filtri accesi, toglili con la ✕.
