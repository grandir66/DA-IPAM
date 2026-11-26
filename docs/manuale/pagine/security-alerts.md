---
percorso: /security-alerts
titolo: Alert sicurezza — gli eventi di sicurezza da prendere in carico
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie gli **allarmi di sicurezza** che arrivano da Wazuh (o, senza Wazuh, dal registro Sicurezza dei domain
controller): accessi falliti, cambi sugli account privilegiati, ransomware, attacchi al dominio, registri manomessi.
È una selezione curata: gli alert ripetuti dallo stesso agent sulla stessa regola diventano **un evento solo**. A
sinistra c'è la **coda degli eventi** da prendere in carico, a destra l'analisi: l'andamento nel tempo e chi è
bersagliato.

Si arriva da **Sicurezza › Alert sicurezza**. La voce compare nel menu solo se l'istanza ha la raccolta degli alert
attiva. Ricerca, filtri e tabelle funzionano come nelle altre pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini di questa guida nascondono eventi, account e
indirizzi.

## La testata e i numeri

![La testata di Alert sicurezza](/manuale/security-alerts/testata.png)

Accanto al titolo, lo stato della fonte: **✓ Wazuh a posto** (o i problemi della raccolta), oppure, senza Wazuh, quali
domain controller sono stati letti e quando. A destra l'ora dell'ultimo aggiornamento e:

1. `tasto:pause` **Auto**: la pagina si aggiorna da sola ogni minuto; un clic la mette in pausa e l'icona diventa
   `icona:play`. Un altro clic riprende.
2. `tasto:refresh` **Aggiorna ora**: rilegge subito la fonte, senza aspettare il giro automatico.
3. **I numeri**: **Alert nel periodo** (solo quelli ostili; passa il mouse per leggere quanti non ostili sono stati
   esclusi), **Eventi aperti** (da prendere in carico: un clic mostra solo gli aperti, sottolineato quando è acceso; un
   altro clic tutti gli stati), **Agent coinvolti** (o **DC coinvolti**), **Regole distinte** (o **Tipi di evento**).
4. `tasto:filter` **Filtri**: apre il pannello dei filtri. Accanto, i filtri accesi come etichette con la loro `icona:x`
   e **Togli tutti**, che torna alle ultime 24 ore, tutti i sistemi, tutti gli stati.

Se la lettura non è riuscita, sotto compare ✕ **Ultimo poll fallito** (o **Lettura non riuscita**) con il motivo;
▲ **Grafici non disponibili** vuol dire che i dati per i grafici non sono arrivati.

### Il pannello dei filtri

![Il pannello dei filtri](/manuale/security-alerts/filtri.png)

- **Periodo**: **Ultima ora**, **Ultime 24 ore**, **Ultimi 7 giorni**, **Ultimi 30 giorni**.
- **Sistema**: **Tutti i sistemi**, oppure Windows, Microsoft 365, Linux e gli altri sistemi da cui arrivano alert.
- **Stato**: **Solo aperti** o **Tutti gli stati**.

**Chiudi** (o `icona:x`) chiude il pannello; i filtri valgono subito.

## Le categorie

![Le schede delle categorie](/manuale/security-alerts/categorie.png)

**Tutte** e una scheda per categoria, con il numero di eventi e il pallino del suo colore nel grafico:
**Autenticazione**, **Account privilegiati**, **Cloud M365**, **Apparati e VPN**, **Registri manomessi**, **Attacchi al
dominio**, **Malware sui DC**, **Ransomware**, **Rilevamenti ESET** (se c'è ESET), **Agent** (la salute della
raccolta) e **Nostre sonde** (l'attività delle nostre scansioni). Passa il mouse su una scheda per il nome intero.

Le categorie senza eventi si raccolgono nella scheda tratteggiata **Senza eventi · N**: un clic le mostra, **Nascondi
quelle senza eventi** le rimette via.

## La coda degli eventi

Sopra la tabella: quanti eventi, in quale periodo, quanti aperti in tutto.

| Colonna | Che cosa dice |
|---|---|
| **Liv.** | Il livello della regola Wazuh con il suo segno: ✕ 12 e oltre, ▲ 10-11, ● sotto 10. |
| **Regola** | La descrizione dell'evento e, sotto, la categoria. |
| **Agent** (o **DC**) | La macchina dove è successo. |
| **Dettagli** | Event ID, utente, indirizzo di provenienza; **Dettagli ›** (o «Altri N dettagli ›») apre la scheda. |
| **Occorrenze** | Quante volte si è ripetuto. |
| **Ultimo** | Quando l'ultima volta. |
| **Azione** | `tasto:check` **Prendi in carico**, oppure «preso in carico da» chi. |

**Prendi in carico** toglie l'evento dagli aperti e segna chi se ne occupa: è un'azione da amministratore.

### La scheda dell'evento

Un clic sulla riga apre a destra la scheda: **Categoria**, **Regola** e livello, **Dove**, **Event ID**, **Utente**,
**Provenienza**, **Quante volte**, **Prima volta**, **Ultima volta**, **Stato** (aperto, o preso in carico da chi) e i
campi **Dall'evento originale**, cioè i dati dell'ultima ripetizione. Un evento nato prima che DA-IPAM salvasse i
dettagli li prende da solo alla ripetizione successiva. Si chiude con `icona:x` o **Esc**.

## Nel tempo e le classifiche

**Nel tempo**: gli alert ostili per categoria nel periodo scelto. Le nostre sonde e la
salute della raccolta restano fuori dal grafico e sono elencate sotto («Fuori dai grafici perché non è un attacco»).

![Le classifiche](/manuale/security-alerts/classifiche.png)

**Classifiche**, tre schede (passa il mouse su una scheda per la spiegazione):

- **Account bersagliati**: chi subisce i tentativi di accesso falliti e da dove partono, su Windows, Microsoft 365 e
  Linux. Colonne **Account bersagliato**, **Sistema**, **Tentativi falliti**, **Da dove parte il tentativo**,
  **Rilevato da**. Gli account che finiscono con `$` sono account computer, non persone.
- **Dove avviene**: gli host su cui il tentativo fallito viene registrato.
- **Da dove parte**: l'origine della richiesta, indirizzi pubblici o interni e postazioni.

L'attività delle reti e degli account dichiarati come nostri (sonde, account di servizio) è esclusa.

## Come si fa

- **Lavorare la coda del mattino**: lascia **Solo aperti** e **Ultime 24 ore**, ordina a occhio per **Liv.**: parti dai
  ✕. Apri l'evento, verifica utente e provenienza sulla macchina, poi **Prendi in carico**.
- **Capire se c'è un attacco alle password in corso**: categoria **Autenticazione**, poi **Classifiche › Account
  bersagliati**: un account con centinaia di tentativi da un indirizzo esterno è il segnale. **Da dove parte** dice
  da quali indirizzi.
- **Controllare chi ha cambiato i gruppi privilegiati**: categoria **Account privilegiati**, `tasto:filter` › Periodo ›
  **Ultimi 7 giorni**.
- **Vedere solo Microsoft 365**: `tasto:filter` › Sistema › Microsoft 365, oppure la categoria **Cloud M365**.
- **Ritrovare un evento già preso in carico**: `tasto:filter` › Stato › **Tutti gli stati**; la colonna Azione dice
  chi l'ha preso.
- **Forzare la prima lettura dopo aver collegato Wazuh**: `tasto:refresh` **Aggiorna ora**.

## Cosa vogliono dire i segni

- ✕ livello 12 e oltre: grave. ▲ livello 10-11. ● sotto 10.
- Il pallino colorato accanto a una categoria la identifica nel grafico.
- Numero sottolineato: quel filtro è acceso.

## Da dove arrivano i dati

Da Wazuh, riletto ogni 15 minuti e raggruppato in eventi. Senza Wazuh, dal registro Sicurezza dei domain controller
letto via WinRM ogni 5 minuti; in fondo alla pagina una riga dice quando è stato letto e se si sono persi eventi
perché il registro è troppo piccolo. Quali categorie e quali soglie contano si regola in **Config › Alert sicurezza**.

## Se la pagina è vuota

**Nessun evento in questo periodo**: allarga il periodo o togli i filtri. Se l'integrazione Wazuh è appena stata
configurata, usa `tasto:refresh` **Aggiorna ora** per la prima lettura.
