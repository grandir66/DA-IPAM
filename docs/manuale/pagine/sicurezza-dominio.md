---
percorso: /sicurezza-dominio
titolo: Sicurezza del dominio — eventi dei domain controller e Health di Active Directory
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Tiene d'occhio il **dominio Active Directory** in due modi, su due schede:

- **Eventi dei DC**: login, accessi falliti, account bloccati, modifiche ad account, gruppi, diritti e GPO, servizi
  installati, attacchi al dominio e malware, letti direttamente dai domain controller via WinRM, anche senza Wazuh.
- **Health AD**: lo stato di salute del dominio, letto via LDAP in sola lettura: rischio, rilievi da sistemare,
  privilegi, permessi e copertura della lettura.

Si arriva da **Sicurezza › Sicurezza del dominio**. Il vecchio indirizzo della Health nella pagina Active Directory
porta qui.

![La scheda Eventi dei DC](/manuale/sicurezza-dominio/eventi.png)

Le immagini del manuale nascondono gli eventi e i valori del grafico.

## Le voci della pagina

In cima il periodo: **Ultime 24 ore**, **Ultimi 7 giorni**, **Ultimi 30 giorni**.

1. **Eventi dei DC**: la scheda degli eventi letti via WinRM.
2. **Health AD**: la scheda della salute del dominio letta via LDAP.
3. **Lettura dei domain controller**: se la lettura è accesa, quanti DC, quando sono stati letti l'ultima volta, ogni
   quanto e in che modo. **Leggi i DC adesso** (solo amministratori) legge subito i registri Sicurezza, System e
   Defender di tutti i DC. **Come configurare i DC** spiega le voci della GPO di audit, in inglese e in italiano.
   **Opzioni ›** porta alle impostazioni della lettura.
4. **Allarmi nel tempo**: accessi falliti, blocchi, modifiche, attacchi e malware nel periodo, in colonne.
5. **Cerca account, IP, postazione, DC**: filtra gli eventi. Accanto, **Tutti gli eventi** sceglie un tipo solo.

Sotto la riga di lettura cinque riquadri: **Login** (accessi al dominio nel periodo), **Accessi falliti** (password
errate, utenti inesistenti, account scaduti; gli accessi delle nostre sonde sono esclusi e contati a parte),
**Account bloccati** (dopo troppi tentativi), **Modifiche** (account, gruppi e diritti, GPO, servizi; e i registri
cancellati, se ce ne sono), **Attacchi e malware** (DCSync, Kerberoasting, Defender).

A destra il riquadro **Domain controller**: quanti sono e quanti si leggono. Ogni DC registra solo i suoi accessi,
quindi vanno letti tutti. Per ognuno lo stato (**✓ letto**, **non letto**, **eventi persi** se il registro è troppo
piccolo) e quanti eventi all'ultimo giro. **Scegli i DC** (solo amministratori) apre l'elenco **Quali domain
controller leggere**: si cerca con **Cerca un DC**, si spuntano a mano, oppure **Scelta automatica**. Sotto si legge
quali diritti servono all'account usato per leggere.

## L'elenco degli eventi

I più recenti prima, nel periodo scelto; le nostre sonde sono escluse. Colonne: **Quando**, **Evento** (con il
codice Windows), **Account**, **Da dove**, **Motivo o autore**, **DC**. Le frecce in alto sfogliano le pagine.

## Come si usa

1. Guarda i riquadri: un picco di **Accessi falliti** o un **Account bloccato** sono i primi segnali.
2. Cerca l'account o l'indirizzo nell'elenco e leggi **Da dove** e **Motivo o autore**.
3. In **Modifiche** controlla chi ha cambiato gruppi privilegiati o GPO.
4. Se un DC è **non letto**, controlla la credenziale WinRM nell'integrazione Active Directory.

## La scheda Health AD

In cima **Dominio** sceglie quale dominio guardare, se ce n'è più d'uno. La riga **Lettura del dominio via LDAP**
dice quando è stato fatto l'ultimo healthcheck (o «mai eseguito») e lo stato dell'invio a Vulcan. **Esegui
healthcheck** (solo amministratori) legge il dominio in sola lettura e dura circa due minuti; intanto restano i dati
dell'ultima esecuzione riuscita. Gli amministratori possono anche scaricare le esportazioni.

Quattro riquadri: **Rischio del dominio** (più alto è peggio; contano solo i rilievi confermati), **Da sistemare**
(rilievi confermati, per gravità), **Da verificare** (indizi e raccolte incomplete, fuori dal punteggio), **Account
privilegiati** (in almeno un gruppo amministrativo).

Quattro sezioni:

- **Rilievi**: a sinistra **Aree** (si sceglie un'area per filtrare, o **Tutte le aree**), a destra l'elenco con
  stato (**confermato** conta nel punteggio, **da verificare** è un indizio) e **Cerca titolo o sigla della regola**.
  Un clic su una riga apre **Perché conta**, **Cosa fare**, il dettaglio del motore e gli oggetti coinvolti.
- **Privilegi**: la **Matrice dei privilegi**, una riga per utente e una colonna per gruppo amministrativo. Nelle
  celle **D** vuol dire membro diretto, **N** tramite un gruppo annidato, **P** gruppo primario. **Solo account
  abilitati** nasconde i disabilitati.
- **Permessi**: chi può fare cosa sugli oggetti del dominio. **Tipi di rischio** raggruppa i permessi delicati;
  scelto un tipo, **Chi può fare cosa** mostra attore, oggetto, tipo, permesso ed ereditarietà, con **Cerca attore,
  oggetto o permesso**. **Elenco grezzo** mostra tutto senza raggruppare. **Raccolta** dice se la lettura è
  completa o parziale.
- **Copertura**: **Cosa è stato letto**, voce per voce (DNS e infrastruttura, criteri e siti, certificati e
  password, permessi, domain controller via WinRM). Una regola che non scatta vale solo se il suo dato è «letto».

Sono regole Domarc su dati LDAP in sola lettura: non sostituiscono uno strumento di audit dedicato.

### Come si usa

1. Premi **Esegui healthcheck** e aspetta un paio di minuti.
2. Parti da **Da sistemare** e apri i rilievi critici: **Cosa fare** dice il rimedio.
3. In **Privilegi** controlla che negli amministratori ci sia solo chi deve.
4. In **Copertura** guarda le voci «non letto»: lì le regole non possono scattare.

## Cosa vogliono dire i segni

- **✓ letto**: il DC è stato letto. **non letto** o **eventi persi**: la lettura non è completa.
- **confermato** / **da verificare**: il rilievo conta nel punteggio, oppure è solo un indizio.
- **D**, **N**, **P** nella matrice: membro diretto, annidato, gruppo primario.

## Da dove arrivano i dati

Eventi dei DC: i registri Sicurezza, System e Defender dei domain controller, letti via WinRM uno alla volta ogni 5
minuti. Health AD: il dominio letto via LDAP dall'integrazione Active Directory, più alcune letture via WinRM sul DC.

## Se la pagina è vuota

Senza un'integrazione Active Directory accesa con un account, la pagina lo dice e rimanda a **Active Directory ›**.
**Nessun evento dai domain controller in questo periodo**: se i DC sono letti ma non arriva niente, controlla che la
GPO dei DC abbia il profilo di audit (accessi, gestione degli account) acceso. **Nessun healthcheck eseguito su
questo dominio**: premi **Esegui healthcheck**.
