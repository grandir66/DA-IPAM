---
percorso: /vulnerabilities/scansioni
titolo: VA dall'Edge — lanciare e pianificare le scansioni di vulnerabilità
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Da qui si lanciano e si pianificano le **scansioni di vulnerabilità** (VA) fatte dall'**Edge**, la sonda di
scansione dell'istanza. Si sceglie cosa scansionare, quanto a fondo e quando; l'Edge esegue e i risultati finiscono
in [Findings](pagine/vulnerabilities.md). La pagina tiene conto degli **impianti** (PLC, HMI, apparati di campo,
IoT): una scansione può fermarli, quindi di serie restano fuori e si includono solo con un consenso scritto.

Si arriva da **Sicurezza › Scansioni**, scheda **VA dall'Edge**. Schede, tabelle e ricerca funzionano come altrove:
vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

Chi è in **sola lettura** vede tutto ma non lancia né salva: i pulsanti di avvio dicono **Solo lettura** e le
caselle di orari e giorni sono grigie. Ricognizioni, consensi, inclusioni e lanci li fa un **amministratore**.

## La testata e le schede

![La testata e le schede](/manuale/vulnerabilities-scansioni/testata.png)

In cima le schede di **Scansioni**: [Interne](pagine/scans.md) e **VA dall'Edge**. Accanto al titolo **Rapporti in
Vulnerabilità ›** porta ai risultati. Sotto, la riga **Edge**: acceso, non risponde o spento, con il nome e la versione
della sonda; se la sonda è vecchia compare ● **Sonda da aggiornare**. Se il modulo Edge è spento la pagina lo dice
(**Le scansioni VA partono da Edge**) con **Vai al modulo Edge ›**.

1. `tasto:rotate-cw` **Rileggi**: rilegge profili e stato delle reti dalla sonda.
2. **Per device**: un gruppo per tipo di device, anche nella stessa rete. È il modo consigliato: ogni famiglia di
   apparati ha il suo profilo.
3. **Un profilo solo**: lo stesso profilo su più reti insieme.
4. **Registro impianti**: consensi e scansioni sulle reti con impianti, in ordine di tempo.

## Per device

In cima quattro numeri: **Device online** (con la rete scelta), **Inclusi**, **Restano fuori** e **Gruppi aperti**
(l'Edge fa una scansione alla volta). Se un impianto ha smesso di rispondere durante un giro, la rete è bloccata e un
amministratore ha **Sblocca la rete**.

![La rete e le famiglie](/manuale/vulnerabilities-scansioni/per-device.png)

**1. Rete**: l'elenco delle reti, con un'etichetta che dice a che punto è ciascuna: ● **Senza proposta** (non è
ancora stata fatta la ricognizione), ▲ **Da confermare**, ✓ **N confermati**, ▶ **In corso**, ● **In coda**.

**2. Famiglie**: una riga per tipo di device (Rete, Windows, Linux e server, Periferiche, IoT e OT, Da chiarire), con
la data della proposta in alto a destra.

| Colonna | Che cosa dice |
|---|---|
| **Lancia** | La spunta sceglie quali gruppi lanciare. |
| **Famiglia** | Il tipo di device; un clic apre i suoi device nel pannello 3. |
| **Device** | Quanti device della famiglia sono online. |
| **Inclusi** | Quanti entrano nel giro, con «N forzati» se sono stati inclusi a mano. |
| **Greenbone**, **Nuclei**, **Moduli** | I tre motori di scansione e la profondità scelta per ciascuno; «mai» = non si scansiona. |
| **Stato** | ✓ **Pronto**, ✓ **Profilo prudente** (da chiarire: si scansiona piano), ✕ **Mai scansionati** (impianti esclusi di serie), ● **Tutti esclusi**, ▲ **Fuori finché non si chiarisce**. |

Il segno ▼ accanto a una profondità vuol dire che è scesa rispetto alla proposta: basta un device con una scelta più
bassa e scende tutto il gruppo.

Un amministratore ha in alto nel pannello **Rifai ricognizione** (o **Avvia ricognizione**, se la rete non ha
proposta), che rifà il giro delicato che costruisce la proposta (costruttori dal router, poi solo porte aperte), e
**Rigenera proposta**, da premere a fine giro. Una rete senza proposta lo dice: **Questa rete non ha ancora una
proposta**.

**Gli impianti**: sulla riga IoT e OT si legge se c'è un consenso. Un amministratore ha **Autorizza gli impianti**
(o **Revoca**, se il consenso c'è già). La finestra **Autorizza gli impianti di** chiede l'**Autorizzazione scritta
del cliente** (mail, ticket o firma: chi e quando) e **Quanto vale**: **4 ore da adesso**, **Per la prossima
finestra** o **Definitiva** (possibile solo dopo un giro col consenso finito senza che la sentinella sia
intervenuta). Se un impianto smette di rispondere l'Edge ferma il giro e blocca la rete.

### 3. Device a rischio

Si apre da una famiglia e mostra gli impianti, i «da chiarire» e gli esclusi, uno per uno. Si cerca con
`icona:search` **Cerca IP o nome**; colonne **IP**, **Nome**, **Perché questa famiglia**, **Web**, **Profondità**,
**Stato e firma** (chi ha deciso), **Azioni**. Un amministratore spunta i device (anche **Seleziona tutti quelli in
elenco**) e usa **Includi** o **Escludi**, con una nota **facoltativa**; per gli impianti c'è **Includi impianti…**,
che chiede il consenso. **Cambia tipo ›** porta a correggere la classificazione. **↺ Torna alla tabella** chiude la
vista.

### 4. Quando

![Il pannello Quando](/manuale/vulnerabilities-scansioni/quando.png)

Tre modi:

- **Adesso**: parte subito, un gruppo alla volta, gli altri restano in coda. Il pulsante dice cosa parte («Avvia N
  gruppi su …»).
- **A orario**: **Frequenza** (**Settimanale**, **Ogni giorno**, **Mensile**), **Giorno** o **Giorno del mese**,
  **Ora**. All'ora fissata DA-IPAM lancia i gruppi con i device confermati in quel momento. **Salva la
  pianificazione su …**.
- **A finestra**: **dalle** / **alle** e i giorni della settimana: a fine fascia la sonda si ferma e alla fascia dopo
  riprende da dove era. **Salva la finestra su …**.

A sinistra **Restano fuori** dice quanti impianti non entrano. Una pianificazione già salvata compare con il suo stato
(✓ Pianificata, ✓ A finestra, ● Spenta), la prossima e l'ultima esecuzione e l'esito; un amministratore ha
**Spegni**. Se esiste già un'altra pianificazione sulla stessa rete compare ▲ **Attenzione** con **Spegni quella e
salva questa** o **Annulla**. Gli impianti entrano solo se il loro consenso copre l'ora del giro.

### Gruppi di questa rete

I gruppi partiti, con lo stato (▶ **In corso**, ● **In coda**, ✓ **Finito**, ✕ **In errore**) e l'avanzamento.
**Esito del lancio** spiega cosa è successo, quali device sono stati **Tolti dal lancio** (confermati ma non
scansionati) e gli **Avvisi** (gruppo partito con meno controlli).

## Un profilo solo

A destra il riepilogo: **Reti scelte**, **In corso**, **Pianificate**, **A finestra**.

![Il profilo](/manuale/vulnerabilities-scansioni/profilo-solo.png)

- **1. Profilo**: cosa cercare e quanto a fondo: **Veloce**, **Bilanciato**, **Profondo**, **Verifica formale**
  (▲ **Autorizzazione**: serve un'autorizzazione scritta). Ogni riquadro dice la profondità di Greenbone, i moduli e il
  tempo per ogni /24. Gli altri profili della sonda non stanno qui: si scelgono dal pannello VA Scan della rete, in
  [Subnet](pagine/networks.md).
- **Reti**: si cercano con `icona:search` **Cerca una rete** e si spuntano (anche **Scegli tutte le reti**). Colonne:
  **Rete**, **Host online**, **Ultima VA**, **Piano attuale**, **Profilo attuale**, **Cosa cambia**. Le reti con
  impianti si scansionano da **Per device**; da qui solo con un consenso registrato. **Quali indirizzi** sceglie cosa
  scansionare in ogni rete: **Tutto il CIDR**, **Solo /24 popolati** o **Solo IP che rispondono**.
- **Quando**: **Immediata** (l'Edge ne fa una alla volta, le altre restano in coda), **Pianificata** (**Ogni
  settimana** o **Ogni mese**, stessa ora su tutte le reti scelte) o **A finestra** (dalle/alle, **Giorni**, e cosa
  fare a fine fascia: **A fine passaggio**, **A fine fascia**, **A ogni gruppo**), con **IP per gruppo** e
  **Tentativi**.

Se il lancio cambia una pianificazione già salvata compare ▲ **Cambia ciò che è salvato su** con l'elenco delle reti
toccate. L'esito di ogni rete si legge nel pannello **Esito**: ✓ **Avviata**, ✓ **Salvata** o ▲ col motivo;
`tasto:rotate-cw` **Riprova su N reti** rilancia quelle fallite.

## Registro impianti

Consensi e scansioni sulle reti con impianti, in ordine di tempo. **Non si cancella.** **Esporta CSV**
scarica il registro.

## Come si fa

- **Fare la prima VA di una rete**: **Per device**, scegli la rete in **1. Rete**; se è **Senza proposta**, un
  amministratore preme **Avvia ricognizione** e a fine giro **Rigenera proposta**. Poi controlla le famiglie, lascia
  spuntati i gruppi in **Lancia** e in **4. Quando** scegli **Adesso**.
- **Scansionare di notte, fuori orario**: **4. Quando › A finestra**, dalle 22:00 alle 06:00, i giorni lavorativi,
  **Salva la finestra**: la sonda riprende ogni notte da dove era rimasta.
- **Includere un impianto con il consenso del cliente**: clic sulla famiglia **IoT e OT**, spunta il device in
  **Device a rischio**, **Includi impianti…**, scrivi chi ha autorizzato e quando, scegli **4 ore da adesso**.
- **Mettere fuori un device delicato**: apri la sua famiglia, spunta il device, **Escludi** con una nota.
- **Lanciare lo stesso controllo su tutte le reti**: **Un profilo solo**, **Bilanciato**, **Scegli tutte le reti**,
  **Quando › Pianificata**, **Ogni mese**.
- **Dimostrare a un cliente quando sono stati toccati i suoi impianti**: **Registro impianti**,
  **Esporta CSV**.

## Cosa vogliono dire i segni

- ✓ pronto, confermato, finito. ● in coda, senza proposta o spento. ▶ in corso.
- ▲ da confermare o da guardare. ✕ mai scansionati, in errore.
- ▼ profondità scesa rispetto alla proposta.

## Da dove arrivano i dati

Dall'Edge: profili, gruppi, stato delle scansioni. La classificazione dei device in famiglie viene dall'inventario
di DA-IPAM (vedi [Apparati](pagine/discovery.md)); le reti da [Subnet](pagine/networks.md).

## Se la pagina è vuota

Se dice **Nessuna rete**, le reti si aggiungono da [Subnet](pagine/networks.md). Se l'Edge **non risponde**, controlla
il modulo Edge e premi `tasto:rotate-cw` **Rileggi**. Se manca la proposta di una rete, serve la ricognizione.
