---
percorso: /active-directory
titolo: Active Directory — computer, utenti, gruppi, DHCP e DNS del dominio
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Collega DA-IPAM al **dominio Active Directory** del cliente e ne mostra il contenuto: i computer iscritti, gli utenti,
i gruppi, i lease del DHCP di Windows e il DNS. I computer vengono abbinati agli host trovati in rete, così si sa quale
PC del dominio corrisponde a quale indirizzo, e quali PC sono in rete ma non nel dominio o al contrario. Si arriva da
**Network › Active Directory**.

![La pagina Active Directory](/manuale/active-directory/pagina.png)

## Le voci della pagina

1. **Il dominio**: il menu in alto sceglie l'integrazione da guardare, se ce n'è più di una. Accanto c'è l'ora
   dell'**Ultima sincronizzazione**; la nota «WinRM non configurato» dice che manca la credenziale per leggere DHCP ed
   eventi dai domain controller.
2. **Abilitata**: l'interruttore accende o spegne l'integrazione. Accesa, si sincronizza da sola ogni 6 ore.
3. **Sincronizza**: legge subito il dominio. Il pulsante **⋯** accanto apre **Modifica**, **Prova la connessione** ed
   **Elimina l'integrazione**.
4. **Guide**: un menu con **Cosa serve** (la pagina con diritti, script e configurazione per le analisi, vedi
   [Cosa serve per le analisi](pagine/active-directory-cosa-serve.md)), **Guida DC (LDAPS, WinRM, DHCP)** e **Audit
   dei DC**, che si aprono in una finestra.
5. **Le schede**: **Computer**, **Utenti**, **Gruppi**, **DHCP**, **DNS**, ognuna col suo numero.
6. **Attivi (90gg)**: nelle schede Computer e Utenti mostra solo chi ha fatto un accesso negli ultimi 90 giorni; un
   clic passa a **Tutti**. Accanto la frase dice quanti sono su quanti. Le frecce a destra sfogliano le pagine.
7. **Collegato**: l'host di DA-IPAM abbinato a quel computer. Un clic su «Host #…» apre la sua
   [scheda](pagine/objects-id.md); un trattino vuol dire che il computer non è stato trovato in rete.

**Nuova integrazione** apre la finestra per collegare un dominio: **Nome**, **Dominio**, **Domain Controller**,
**Porta**, **Base DN** e le credenziali (una di tipo Active Directory per leggere il dominio, e una Windows per WinRM),
prese da [Credenziali](pagine/credentials.md).

## Le schede

- **Computer**: **Nome** (il nome del computer nel dominio), **DNS / IP**, **OS**, **OU** (l'unità organizzativa in cui
  sta), **Ultimo logon**, **Stato** (attivo o disabilitato), **Collegato**. La casella **Cerca computer…** filtra.
- **Utenti**: **Username**, **Display Name**, **Email**, **Reparto / Ruolo**, **Telefono**, ultimo accesso e stato.
- **Gruppi**: nome, **Descrizione**, **Tipo** e membri.
- **DHCP**: i lease letti dai server DHCP di Windows: **IP**, **MAC**, **Hostname**, **Scope**, **Scadenza**. Serve
  WinRM configurato.
- **DNS**: i nomi del DNS del dominio confrontati con quello che DA-IPAM vede in rete: host senza nome nel DNS, nomi
  diversi, nomi che puntano a indirizzi spenti, con le correzioni proposte.

Sincronizzare, modificare, eliminare e creare integrazioni spetta a chi ha il ruolo di amministratore.

## Come si usa

1. La prima volta leggi **Guide › Cosa serve** e prepara gli account nel dominio.
2. Crea le credenziali, poi **Nuova integrazione**, poi **⋯ › Prova la connessione**.
3. Premi **Sincronizza** e guarda la scheda **Computer**: la colonna **Collegato** dice quali PC sono stati trovati in
   rete.
4. Lascia l'interruttore **Abilitata** acceso perché la lettura si ripeta da sola.

## Cosa vogliono dire i segni

- Il cerchio con la spunta in **Stato**: account attivo. Un account disabilitato ha il suo segno diverso.
- **Host #…** col segno del collegamento: abbinato a un host. **—**: nessun abbinamento.

## Da dove arrivano i dati

Dal domain controller, letto con LDAP o LDAPS con l'account di sola lettura indicato; DHCP ed eventi con WinRM. La
lettura gira ogni 6 ore se l'integrazione è accesa, oppure a mano con **Sincronizza**.

## Se la pagina è vuota

Non c'è ancora nessuna integrazione: premi **Nuova integrazione** (serve il ruolo di amministratore). Se c'è ma le
schede sono vuote, premi **Sincronizza** e guarda l'esito accanto a «Ultima sincronizzazione».
