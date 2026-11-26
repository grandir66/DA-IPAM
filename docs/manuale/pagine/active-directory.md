---
percorso: /active-directory
titolo: Active Directory — computer, utenti, gruppi, DHCP e DNS del dominio
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Collega DA-IPAM al **dominio Active Directory** del cliente e ne mostra il contenuto: i computer iscritti, gli utenti,
i gruppi, i lease del DHCP di Windows e il DNS. I computer vengono abbinati agli host trovati in rete, così si sa quale
PC del dominio corrisponde a quale indirizzo, e quali PC sono in rete ma non nel dominio o al contrario. Si arriva da
**Network › Active Directory**.

Menu e tabelle funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md). Qui
sotto c'è quello che Active Directory ha di suo.

## La barra in cima

![La barra di Active Directory](/manuale/active-directory/barra.png)

A sinistra, se ci sono più domini, il menu **Seleziona integrazione** sceglie quello da guardare.

1. **Ultima sincronizzazione**: data e ora dell'ultima lettura (passa il mouse per l'esito). «WinRM non configurato»
   dice che manca la credenziale per leggere DHCP ed eventi dai domain controller.
2. **✓ Abilitata** / **– Disabilitata**: l'interruttore accende o spegne l'integrazione. Accesa, si sincronizza da
   sola ogni 6 ore.
3. `tasto:refresh` **Sincronizza**: legge subito il dominio.
4. `tasto:more-horizontal` **Altre azioni sull'integrazione** (vedi sotto).
5. `tasto:book` **Guide** (vedi sotto).
6. `tasto:plus` **Nuova integrazione**: apre la [finestra dell'integrazione](#finestra).

I pulsanti 2, 3, 4 e 6 si vedono anche in sola lettura, ma cambiare l'integrazione, sincronizzarla e crearne una nuova
spetta a un **amministratore**.

### Altre azioni

![Il menu Altre azioni](/manuale/active-directory/menu-azioni.png)

- `icona:pencil` **Modifica**: riapre la finestra con i dati dell'integrazione;
- `icona:test-tube` **Prova la connessione**: prova a collegarsi al domain controller e dice in basso a destra se è
  riuscito;
- `icona:trash` **Elimina l'integrazione**: toglie il collegamento al dominio (chiede conferma).

### Le guide

![Il menu Guide](/manuale/active-directory/menu-guide.png)

- `icona:list-checks` **Cosa serve**: la pagina con diritti, script e configurazione per le analisi
  ([Cosa serve per le analisi](pagine/active-directory-cosa-serve.md));
- `icona:book` **Guida DC (LDAPS, WinRM, DHCP)**: si apre in una finestra, con i passi per preparare il domain
  controller;
- `icona:shield-check` **Audit dei DC**: nella stessa finestra, la scheda sull'audit degli eventi.

## Le schede del dominio

![Le schede e la tabella dei computer](/manuale/active-directory/computer.png)

Nella schermata nomi, indirizzi e unità organizzative sono sfocati.

1. **Le schede**: `icona:monitor` **Computer**, `icona:users` **Utenti**, `icona:shield` **Gruppi**, `icona:wifi`
   **DHCP**, `icona:globe` **DNS**, con il numero di voci accanto.
2. **Cerca**: filtra la scheda aperta (Cerca computer…, Cerca utenti…, Cerca gruppi…, Cerca per IP, MAC, hostname,
   scope…).
3. **Attivi (90gg)**: nelle schede Computer e Utenti mostra solo chi ha fatto un accesso negli ultimi 90 giorni; un
   clic passa a **Tutti**. Accanto la frase dice quanti sono su quanti. A destra, `icona:chevron-left`
   `icona:chevron-right` sfogliano le pagine.
4. **Collegato**: `icona:link` **Host #…** è l'host di DA-IPAM abbinato a quel computer; un clic apre la sua
   [scheda](pagine/objects-id.md). Un trattino vuol dire che il computer non è stato trovato in rete.

| Scheda | Colonne |
|---|---|
| **Computer** | **Nome** (nel dominio), **DNS / IP**, **OS**, **OU** (l'unità organizzativa), **Ultimo logon**, **Stato** (attivo o disabilitato), **Collegato**. |
| **Utenti** | **Username**, **Nome**, **Email**, **Reparto / Ruolo**, **Telefono**, **Ultimo logon**, **Stato**. |
| **Gruppi** | **Nome**, **Display Name**, **Descrizione** (passa il mouse per leggerla intera), **Tipo**. |
| **DHCP** | **IP**, **MAC**, **Hostname**, **Scope**, **Stato**, **Scadenza**: i lease letti dai server DHCP di Windows. Serve la credenziale WinRM: senza, la scheda dice «DHCP non configurato». |
| **DNS** | Le zone e i record del DNS del dominio, confrontati con quello che DA-IPAM vede in rete (sotto). |

### La scheda DNS

In cima, quando il DNS è stato letto l'ultima volta («DNS mai letto» se ancora no: si legge a ogni sincronizzazione).
Poi due riquadri:

- **Anomalie**: solo i record degli host (A, AAAA, CNAME, PTR) che non tornano, con **Anomalia**, **IP**, **Nomi nel
  DNS**, **Cosa non torna** e **Record**. Un clic su un tipo di anomalia mostra solo quello. Un amministratore può
  segnare un'anomalia come voluta («Va bene così»: si scrive solo in DA-IPAM); quelle finiscono in **Segnate come
  volute**, da cui **Rimetti fra le anomalie**.
- **Record**: tutti i record, con **Nome**, **Tipo**, **Valore**, **Zona**, **Rinnovo**; si cerca per nome, IP o
  destinazione e si filtra per tipo e per zona.

Se le correzioni del DNS sono accese per questo dominio (**Consenti le correzioni su questo dominio**, con un'utenza
dedicata al DNS), l'amministratore vede anche la colonna **Correzione**: sceglie una correzione per riga, poi
`tasto:wrench` **Correggi…** mostra l'anteprima e chiede conferma (al massimo 50 per volta); `tasto:plus` **Nuova
voce…** crea un record (Nome → indirizzo, Indirizzo → nome, Alias → nome). Fino alla conferma sul domain controller
non si scrive niente.

## La finestra dell'integrazione {#finestra}

Si apre con **Nuova integrazione** o **Modifica** (solo amministratori). I campi:

- **Nome** (per esempio «Dominio principale») e **Dominio** (per esempio example.local);
- **Domain Controller** e **Porta**, con **Usa LDAPS (SSL)**;
- **Base DN** (per esempio DC=example,DC=local);
- l'**account** con cui leggere il dominio: una credenziale di tipo Active Directory presa da
  [Credenziali](pagine/credentials.md), oppure utente e password scritti qui (`DOMINIO\admin` o `admin@dominio`);
- **Credenziale WinRM del DC**: una credenziale Windows per importare i lease del DHCP; **Nessuna (DHCP spento)** se il
  domain controller non fa da DHCP.

In fondo **Annulla** e **Salva**, spento finché mancano nome, domain controller, Base DN o account.

## Come si fa

- **Collegare un dominio nuovo**: leggi **Guide › Cosa serve** e prepara gli account; crea le credenziali, poi
  `tasto:plus` **Nuova integrazione**, poi `tasto:more-horizontal` › **Prova la connessione**, infine
  `tasto:refresh` **Sincronizza**.
- **Trovare i PC del dominio che non si vedono in rete**: scheda **Computer**, **Attivi (90gg)**, e guarda le righe
  con il trattino in **Collegato**.
- **Trovare i PC spenti da mesi**: scheda **Computer**, passa a **Tutti**, guarda **Ultimo logon**.
- **Sapere a chi è stato dato un indirizzo dal DHCP di Windows**: scheda **DHCP**, cerca l'indirizzo o il MAC.
- **Sistemare i nomi DNS che puntano a indirizzi sbagliati**: scheda **DNS**, riquadro **Anomalie**; con le correzioni
  accese, scegli la correzione e **Correggi…**.

## Cosa vogliono dire i segni

- `icona:check-circle` in **Stato**: account attivo; un account disabilitato ha il suo segno diverso.
- `icona:link` **Host #…**: abbinato a un host. **—**: nessun abbinamento.

## Da dove arrivano i dati

Dal domain controller, letto con LDAP o LDAPS con l'account di sola lettura indicato; DHCP, DNS ed eventi con WinRM.
La lettura gira ogni 6 ore se l'integrazione è accesa, oppure a mano con **Sincronizza**.

## Se la pagina è vuota

«Nessuna integrazione Active Directory configurata»: un amministratore preme **Nuova integrazione**. Se c'è ma le
schede sono vuote, premi **Sincronizza** e guarda l'esito accanto a «Ultima sincronizzazione».
