---
percorso: /vulnerabilities/scansioni
titolo: VA dall'Edge — lanciare e pianificare le scansioni di vulnerabilità
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Da qui si lanciano e si pianificano le **scansioni di vulnerabilità** (VA) fatte dall'**Edge**, la sonda di
scansione dell'istanza. Si sceglie cosa scansionare, quanto a fondo e quando; l'Edge esegue e i risultati finiscono
in [Findings](pagine/vulnerabilities.md). La pagina tiene conto degli **impianti** (PLC, HMI, apparati di campo,
IoT): una scansione può fermarli, quindi di serie restano fuori e si includono solo con un consenso scritto.

Si arriva da **Sicurezza › Scansioni**, scheda **VA dall'Edge** in cima (l'altra scheda è
[Interne](pagine/scans.md)). In alto a destra **Rapporti in Vulnerabilità ›** porta ai risultati.

![La pagina VA dall'Edge](/manuale/vulnerabilities-scansioni/pagina.png)

## La riga dell'Edge

Sotto il titolo una riga dice lo stato dell'Edge: **acceso**, **non risponde** o spento, con il nome e la versione
della sonda. **Rileggi** rilegge profili e stato delle reti dalla sonda. Se il modulo Edge è spento la pagina lo dice
(**Le scansioni VA partono da Edge**) con il collegamento **Vai al modulo Edge ›**. Se la sonda è vecchia compare
**● Sonda da aggiornare**.

## Le voci della pagina

Tre schede scelgono come lavorare:

1. **Per device**: un gruppo per tipo di device, anche nella stessa rete. È il modo consigliato: ogni famiglia di
   apparati (rete, Windows, Linux e server, periferiche, IoT e OT, da chiarire) ha il suo profilo.
2. **Un profilo solo**: lo stesso profilo su più reti insieme.
3. **Registro impianti**: consensi e scansioni sulle reti con impianti, in ordine di tempo.

### Per device

In cima quattro riquadri: **Device online** (con la rete scelta), **Inclusi**, **Restano fuori** e **Gruppi aperti**
(l'Edge fa una scansione alla volta).

- **1. Rete**: l'elenco delle reti. Sotto ogni rete un'etichetta dice a che punto è: **● Senza proposta** (non è
  ancora stata fatta la ricognizione), **▲ Da confermare**, **✓ N confermati**, **▶ In corso**, **● In coda**.
- **2. Famiglie**: una riga per tipo di device, con la proposta del giorno indicato in alto a destra. Colonne:
  **Lancia** (la spunta sceglie quali gruppi lanciare), **Famiglia**, **Device**, **Inclusi** (con i «forzati» a
  mano), **Greenbone**, **Nuclei** e **Moduli** (i tre motori di scansione e la profondità scelta per ciascuno),
  **Stato**. Gli stati: **✓ Pronto**, **✓ Profilo prudente** (da chiarire: si scansiona piano), **✕ Mai
  scansionati** (impianti esclusi di serie), **● Tutti esclusi**, **▲ Fuori finché non si chiarisce**. Il segno ▼
  accanto a una profondità vuol dire che è scesa rispetto alla proposta: basta un device con una scelta più bassa e
  scende tutto il gruppo.
- **Rifai ricognizione** rifà il giro delicato che costruisce la proposta (costruttori dal router, poi solo porte
  aperte); a fine giro **Rigenera proposta**. Una rete senza proposta lo dice: **Questa rete non ha ancora una
  proposta**.
- **Device a rischio**: si apre da una famiglia e mostra gli impianti, i «da chiarire» e gli esclusi, uno per uno.
  Si cerca con **Cerca IP o nome**, si spuntano e si usano **Includi** o **Escludi**, con una nota facoltativa. Per
  ognuno **Perché questa famiglia** e **Stato e firma** (chi ha deciso). **Cambia tipo ›** porta a correggere la
  classificazione. **↺ Torna alla tabella** chiude la vista.
- **Autorizza gli impianti** (solo amministratore): registra il consenso del cliente a scansionare gli impianti.
  Chiede **Autorizzazione scritta del cliente** (mail, ticket o firma: chi e quando) e **Quanto vale**: **4 ore da
  adesso**, **Per la prossima finestra** o **Definitiva** (possibile solo dopo un giro col consenso finito senza
  che la sentinella sia intervenuta). Se un impianto smette di rispondere l'Edge ferma il giro e blocca la rete:
  **Sblocca la rete** la libera. **Revoca** ritira il consenso.
- **Quando lanciare**: **Immediata** (parte adesso, un gruppo alla volta), **Pianificata** (**Ogni giorno** o
  **Settimanale**, all'ora scelta DA-IPAM lancia i gruppi con i device confermati in quel momento) o **A finestra**
  (giorni e fascia oraria **dalle**/**alle**: a fine fascia la sonda si ferma e alla fascia dopo riprende da dove
  era). Se esiste già un'altra pianificazione sulla stessa rete compare **▲ Attenzione** con **Spegni quella e salva
  questa**.
- **Gruppi di questa rete**: i gruppi partiti, con lo stato (**▶ In corso**, **● In coda**, **✓ Finito**, **✕ In
  errore**) e l'avanzamento. **Esito del lancio** spiega cosa è successo, quali device sono stati **Tolti dal lancio**
  e gli **Avvisi** (gruppo partito con meno controlli).

### Un profilo solo

A destra il riepilogo: **Reti scelte**, **In corso**, **Pianificate**, **A finestra**.

- **Profilo**: cosa cercare e quanto a fondo. **Un altro profilo della sonda** apre l'elenco completo dei profili
  dell'Edge.
- **Reti**: si cercano con **Cerca una rete** e si spuntano (anche **Scegli tutte le reti**). Colonne: **Host
  online**, **Ultima VA**, **Piano attuale**, **Profilo attuale**, **Cosa cambia**. Le reti con impianti si
  scansionano da **Per device**; da qui solo con un consenso registrato. **Quali indirizzi** sceglie
  cosa scansionare in ogni rete: **Tutto il CIDR**, **Solo /24 popolati** o **Solo IP che rispondono**.
- **Quando**: **Immediata** (l'Edge ne fa una alla volta, le altre restano in coda), **Pianificata** (**Ogni
  settimana** o **Ogni mese**, stessa ora su tutte le reti scelte) o **A finestra** (dalle/alle, giorni, e cosa fare a
  fine fascia: **A fine passaggio**, **A fine fascia**, **A ogni gruppo**), con **IP per gruppo** e **Tentativi**.
- Se il lancio cambia una pianificazione già salvata compare **▲ Cambia ciò che è salvato su** e l'elenco delle
  reti toccate. L'esito di ogni rete si legge nella colonna **Esito**: **✓ Avviata**, **✓ Salvata** o **▲** col
  motivo; **Riprova** rilancia quelle fallite.

### Registro impianti

Consensi e scansioni sulle reti con impianti, in ordine di tempo. **Non si cancella.** **Esporta CSV** scarica il
registro.

## Come si usa

1. Apri **Per device** e scegli la rete. Se è **Senza proposta**, premi **Rifai ricognizione** e a fine giro
   **Rigenera proposta**.
2. Controlla le **Famiglie**: profondità e stato. Apri i **Device a rischio** per decidere impianti e «da chiarire».
3. Spunta in **Lancia** i gruppi che vuoi e scegli **Quando lanciare**.
4. Segui l'avanzamento in **Gruppi di questa rete**. I risultati arrivano in [Findings](pagine/vulnerabilities.md).
5. Per una scansione uguale su molte reti usa **Un profilo solo**.

Chi è in sola lettura vede tutto ma non lancia: i pulsanti dicono **Solo lettura**.

## Cosa vogliono dire i segni

- **✓** pronto, confermato, finito. **●** in coda o senza proposta. **▶** in corso.
- **▲** da confermare o da guardare. **✕** mai scansionati, in errore.
- **▼** profondità scesa rispetto alla proposta.

## Da dove arrivano i dati

Dall'Edge: profili, gruppi, stato delle scansioni. La classificazione dei device in famiglie viene dall'inventario
di DA-IPAM (vedi [Apparati](pagine/discovery.md)); le reti dalla pagina Reti.

## Se la pagina è vuota

Se dice **Nessuna rete**, le reti si aggiungono dalla pagina Reti. Se l'Edge **non risponde**, controlla il modulo
Edge e premi **Rileggi**. Se manca la proposta di una rete, serve la ricognizione.
