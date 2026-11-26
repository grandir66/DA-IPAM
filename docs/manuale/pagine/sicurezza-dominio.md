---
percorso: /sicurezza-dominio
titolo: Sicurezza del dominio — eventi dei domain controller e Health di Active Directory
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Tiene d'occhio il **dominio Active Directory** in due modi, su due schede:

- **Eventi dei DC**: login, accessi falliti, account bloccati, modifiche ad account, gruppi, diritti e GPO, servizi
  installati, attacchi al dominio e malware, letti direttamente dai domain controller via WinRM, anche senza Wazuh.
- **Health AD**: lo stato di salute del dominio, letto via LDAP in sola lettura: rischio, rilievi da sistemare,
  privilegi, permessi e copertura della lettura.

Si arriva da **Sicurezza › Sicurezza del dominio**. Il vecchio indirizzo della Health nella pagina Active Directory
porta qui. Ricerca, tabelle e pagine dell'elenco funzionano come altrove: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini del manuale non mostrano eventi né rilievi.

## Il periodo e le schede

![Il periodo e le schede](/manuale/sicurezza-dominio/schede.png)

1. **Ultime 24 ore**, **Ultimi 7 giorni**, **Ultimi 30 giorni**: il periodo di numeri, grafico ed eventi.
2. **Eventi dei DC**: la scheda degli eventi letti via WinRM (vedi sotto).
3. **Health AD**: la scheda della salute del dominio letta via LDAP (vedi [La scheda Health AD](#health)).

La scheda scelta resta nell'indirizzo della pagina: un collegamento salvato riapre la stessa scheda.

## Eventi dei DC

### La lettura dei domain controller

![La riga della lettura dei DC](/manuale/sicurezza-dominio/lettura.png)

La riga dice se la lettura è accesa, quanti DC, quando sono stati letti l'ultima volta, ogni quanto e in che modo; se
non legge, dice perché.

1. `tasto:refresh` **Leggi i DC adesso**: legge subito i registri Sicurezza, System e Defender di tutti i DC. Solo un
   amministratore; per chi è in sola lettura è grigio («Solo un amministratore»).
2. `tasto:book` **Come configurare i DC**: apre la finestra con le voci della GPO di audit da accendere, in inglese e
   in italiano.
3. **Opzioni ›**: porta alle impostazioni della lettura in [Opzioni](pagine/settings-opzioni.md).

### I numeri e il grafico

Cinque riquadri: **Login** (accessi al dominio nel periodo), **Accessi falliti** (password errate, utenti inesistenti,
account scaduti; gli accessi delle nostre sonde sono esclusi e contati a parte), **Account bloccati** (dopo troppi
tentativi), **Modifiche** (account, gruppi e diritti, GPO, servizi; e i registri cancellati, se ce ne sono), **Attacchi
e malware** (DCSync, Kerberoasting, Defender).

**Allarmi nel tempo**: accessi falliti, blocchi, modifiche, attacchi e malware nel periodo, in colonne.

### Il riquadro Domain controller

Quanti DC ci sono e quanti si leggono: ognuno registra solo i suoi accessi, quindi vanno letti tutti. Per ogni DC lo
stato (✓ **letto**, **non letto**, **eventi persi** se il registro è troppo piccolo, **errore**) e quanti eventi
all'ultimo giro. Sotto si legge quali diritti servono all'account usato per leggere.

**Scegli i DC** (solo amministratori) apre la finestra **Quali domain controller leggere**:

- **Cerca un DC** filtra l'elenco; una casella per DC da spuntare;
- **Scelta automatica** torna a leggere i DC trovati dal programma;
- **Tutti** li spunta tutti;
- **Salva (N)** salva la scelta.

Senza un'integrazione Active Directory accesa il riquadro lo dice e rimanda ad
[Active Directory](pagine/active-directory.md) › Modifica integrazione.

### L'elenco degli eventi

![La barra dell'elenco degli eventi](/manuale/sicurezza-dominio/eventi.png)

I più recenti prima, nel periodo scelto; le nostre sonde sono escluse.

1. **Tutti gli eventi**: sceglie un tipo solo, col numero accanto.
2. `icona:search` **Cerca account, IP, postazione, DC**.

A destra `icona:chevrons-left` `icona:chevron-left` `icona:chevron-right` `icona:chevrons-right` sfogliano le pagine.

| Colonna | Che cosa dice |
|---|---|
| **Quando** | Data e ora dell'evento. |
| **Evento** | Che cosa è successo, con il codice Windows. La riga è più marcata se l'evento è da guardare (un blocco, un'aggiunta ai gruppi amministrativi). |
| **Account** | L'account coinvolto. |
| **Da dove** | Indirizzo e postazione di provenienza. |
| **Motivo o autore** | Perché è fallito, o chi ha fatto la modifica. |
| **DC** | Il domain controller che l'ha registrato. |

## La scheda Health AD {#health}

In alto a destra **Dominio** sceglie quale dominio guardare, se ce n'è più d'uno.

La riga **Lettura del dominio via LDAP** dice quando è stato fatto l'ultimo healthcheck (o «mai eseguito») e lo stato
dell'invio a Vulcan. A destra:

- `tasto:activity` **Esegui healthcheck**: legge il dominio in sola lettura; dura circa due minuti e intanto compare
  **Healthcheck in corso**, mentre sotto restano i dati dell'ultima esecuzione riuscita. È spento se l'integrazione è
  spenta;
- `tasto:download` **Esporta JSON**: scarica l'esito dell'ultima esecuzione riuscita. Solo un amministratore.

Quattro riquadri: **Rischio del dominio** (su 100, più alto è peggio; contano solo i rilievi confermati), **Da
sistemare** (rilievi confermati, per gravità), **Da verificare** (indizi e raccolte incomplete, fuori dal punteggio),
**Account privilegiati** (abilitati, in almeno un gruppo amministrativo).

Sotto, le **Sezioni della Health AD**, quattro schede:

- **Rilievi**: a sinistra **1. Aree** (si sceglie un'area per filtrare, o **Tutte le aree**), a destra l'elenco con i
  pulsanti **Tutti**, **Confermati**, **Da verificare** e `icona:search` **Cerca titolo o sigla della regola**. Ogni
  rilievo ha lo stato: **confermato** conta nel punteggio, **da verificare** è un indizio. Un clic su una riga
  (`icona:chevron-right`) apre **Perché conta**, **Cosa fare**, il dettaglio del motore e gli oggetti coinvolti.
- **Privilegi**: la **Matrice dei privilegi**, una riga per utente e una colonna per gruppo amministrativo. Nelle
  celle **D** vuol dire membro diretto, **N** tramite un gruppo annidato, **P** gruppo primario. **Solo account
  abilitati** nasconde i disabilitati.
- **Permessi**: chi può fare cosa sugli oggetti del dominio. **Tipi di rischio** raggruppa i permessi delicati e dice
  se la **Raccolta** è completa o parziale; scelto un tipo, **Chi può fare cosa** mostra attore, oggetto, tipo,
  permesso ed ereditarietà, con `icona:search` **Cerca attore, oggetto o permesso**. **Elenco grezzo** mostra tutto
  senza raggruppare.
- **Copertura**: **Cosa è stato letto**, voce per voce (DNS e infrastruttura, criteri e siti, certificati e password,
  permessi, domain controller via WinRM), con le ricerche LDAP fallite se ce ne sono. Una regola che non scatta vale
  solo se il suo dato è «letto».

Sono regole Domarc su dati LDAP in sola lettura: non sostituiscono uno strumento di audit dedicato.

## Come si fa

- **Capire perché un utente si blocca**: **Eventi dei DC**, **Ultimi 7 giorni**, scrivi il suo nome in **Cerca**:
  **Da dove** dice da quale postazione partono i tentativi sbagliati (spesso un telefono o un'unità di rete con la
  password vecchia).
- **Controllare chi è stato aggiunto ai gruppi amministrativi**: **Tutti gli eventi** › il tipo delle modifiche ai
  gruppi; **Motivo o autore** dice chi l'ha fatto.
- **Accorgersi che un DC non viene letto**: riquadro **Domain controller**: un DC **non letto** va controllato nella
  credenziale WinRM dell'integrazione [Active Directory](pagine/active-directory.md); **eventi persi** vuol dire che
  il suo registro Sicurezza è troppo piccolo.
- **Fare il controllo di salute del dominio**: scheda **Health AD**, `tasto:activity` **Esegui healthcheck**, aspetta
  un paio di minuti, poi **Rilievi** › **Confermati** e apri i più gravi: **Cosa fare** dice il rimedio.
- **Verificare chi è amministratore**: **Health AD** › **Privilegi**, con **Solo account abilitati** acceso.
- **Sapere se la GPO di audit è giusta**: `tasto:book` **Come configurare i DC**.

## Cosa vogliono dire i segni

- ✓ **letto**: il DC è stato letto. **non letto**, **eventi persi** o **errore**: la lettura non è completa.
- **confermato** / **da verificare**: il rilievo conta nel punteggio, oppure è solo un indizio.
- **D**, **N**, **P** nella matrice: membro diretto, annidato, gruppo primario.

## Da dove arrivano i dati

Eventi dei DC: i registri Sicurezza, System e Defender dei domain controller, letti via WinRM uno alla volta ogni 5
minuti. Health AD: il dominio letto via LDAP dall'integrazione Active Directory, più alcune letture via WinRM sul DC.

## Se la pagina è vuota

- Senza un'integrazione Active Directory accesa con un account, la pagina lo dice e rimanda ad **Active Directory ›**.
- **Nessun evento dai domain controller in questo periodo**: se i DC sono letti ma non arriva niente, controlla che
  la GPO dei DC abbia il profilo di audit (accessi, gestione degli account) acceso. Se la lettura è spenta, il
  riquadro dice perché.
- **Nessun healthcheck eseguito su questo dominio**: premi **Esegui healthcheck**.
