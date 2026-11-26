---
percorso: /security-alerts
titolo: Alert sicurezza — gli eventi di sicurezza da prendere in carico
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie gli **allarmi di sicurezza** che arrivano da Wazuh (o, senza Wazuh, dal registro Sicurezza dei domain
controller): accessi falliti, cambi sugli account privilegiati, ransomware, attacchi al dominio, registri manomessi.
È una selezione curata: gli alert ripetuti dallo stesso agent sulla stessa regola diventano un evento solo. A
sinistra c'è la **coda degli eventi** da prendere in carico, a destra l'analisi: l'andamento nel tempo e chi è
bersagliato.

Si arriva da **Sicurezza › Alert sicurezza**. La voce compare nel menu solo se l'istanza ha la raccolta degli alert
attiva.

![La pagina Alert sicurezza](/manuale/security-alerts/pagina.png)

Le immagini del manuale nascondono eventi, account e indirizzi.

## Le voci della pagina

Nella testata, accanto al titolo, lo stato della fonte (per esempio **✓ Wazuh a posto**, oppure **Lettura non
riuscita** se l'ultima lettura è fallita), l'ora dell'ultimo aggiornamento, **Auto** (aggiorna da solo ogni minuto;
un clic lo mette in pausa) e **Aggiorna ora**.

1. **I numeri**: **Alert nel periodo** (solo quelli ostili; passando il mouse si legge quanti non ostili sono stati
   esclusi), **Eventi aperti** (da prendere in carico: un clic mostra solo gli aperti, un altro tutti gli stati),
   **Agent coinvolti** (o **DC coinvolti**), **Regole distinte** (o **Tipi di evento**).
2. **Filtri**: apre il pannello con **Periodo** (**Ultima ora**, **Ultime 24 ore**, **Ultimi 7 giorni**, **Ultimi 30
   giorni**), **Sistema** (**Tutti i sistemi**, Windows, Microsoft 365, Linux…) e lo stato (**Solo aperti** o **Tutti
   gli stati**). I filtri accesi diventano etichette con la ✕; **Togli tutti** li azzera.
3. **Categoria**: **Tutte** e una scheda per categoria con il numero di eventi: **Autenticazione**, **Account
   privilegiati**, **Cloud M365**, **Apparati e VPN**, **Registri manomessi**, **Attacchi al dominio**, **Malware sui
   DC**, **Ransomware**, **Rilevamenti ESET** (se c'è ESET), **Agent** (salute della raccolta), **Nostre sonde** (attività delle nostre scansioni). Le
   categorie senza eventi si raccolgono in **Senza eventi**: un clic le mostra, **Nascondi quelle senza eventi** le
   rimette via. Passando il mouse su una scheda si legge il nome intero.
4. **Nel tempo**: gli alert ostili per categoria nel periodo scelto. Le nostre sonde e la salute della raccolta
   restano fuori dal grafico e sono elencate sotto («Fuori dai grafici perché non è un attacco»).
5. **Classifiche**: tre schede.
   - **Account bersagliati**: chi subisce i tentativi di accesso falliti e da dove partono, su Windows, Microsoft 365
     e Linux. Colonne **Account bersagliato**, **Sistema**, **Tentativi falliti**, **Da dove parte il tentativo**,
     **Rilevato da**. Gli account che finiscono con `$` sono account computer, non persone.
   - **Dove avviene**: gli host su cui il tentativo fallito viene registrato.
   - **Da dove parte**: l'origine della richiesta, IP pubblici o interni e postazioni.

   L'attività delle reti e degli account dichiarati come nostri (sonde, account di servizio) è esclusa.

## La coda degli eventi

Sopra la tabella: quanti eventi, in quale periodo, quanti aperti in tutto. Colonne:

- **Liv.**: il livello della regola Wazuh, con un segno (vedi sotto).
- **Regola**: la descrizione dell'evento.
- **Agent** (o **DC**): la macchina dove è successo.
- **Dettagli**: utente, provenienza e altri campi dell'evento; **Dettagli ›** apre la scheda.
- **Occorrenze**, **Ultimo**: quante volte e quando l'ultima.
- **Azione**: **Prendi in carico** (solo amministratori).

**La scheda dell'evento** (clic sulla riga): **Categoria**, **Regola** e livello, **Dove**, **Event ID**,
**Utente**, **Provenienza**, **Quante volte**, **Prima volta**, **Ultima volta**, **Stato** (aperto o preso in carico
da chi) e i campi **Dall'evento originale**. Un evento nato prima che DA-IPAM salvasse i dettagli li prende da solo
alla sua prossima ripetizione.

## Come si usa

1. Lascia **Solo aperti** e parti dagli eventi di livello più alto.
2. Apri l'evento, leggi utente e provenienza, verifica sulla macchina.
3. Quando te ne occupi, **Prendi in carico**: l'evento esce dagli aperti.
4. Per capire un attacco in corso guarda **Account bersagliati** e **Da dove parte**.

## Cosa vogliono dire i segni

- ✕ livello 12 e oltre: grave.
- ▲ livello 10-11.
- ● sotto 10.
- Il pallino colorato accanto a una categoria la identifica nel grafico.

## Da dove arrivano i dati

Da Wazuh, riletto ogni 15 minuti e raggruppato in eventi. Senza Wazuh, dal registro Sicurezza dei domain
controller letto via WinRM ogni 5 minuti; in fondo alla pagina una riga dice quando è stato letto e se si sono persi
eventi perché il registro è troppo piccolo.

## Se la pagina è vuota

**Nessun evento in questo periodo**: allarga il periodo o togli i filtri. Se l'integrazione Wazuh è appena stata
configurata, usa **Aggiorna ora** per la prima lettura.
