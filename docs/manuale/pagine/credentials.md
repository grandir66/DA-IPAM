---
percorso: /credentials
titolo: Credenziali — l'archivio degli accessi agli apparati
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È l'**archivio delle credenziali** che DA-IPAM usa per entrare negli apparati e leggerli: SSH per router, switch e
Linux, community SNMP, account Windows per WinRM e WMI, chiavi API, controller UniFi e Omada, Active Directory. Una
credenziale si scrive una volta qui e poi si assegna a quante reti e apparati si vuole. Le password non si vedono mai:
nell'elenco compaiono solo i pallini, e non tornano mai al browser.

Si arriva da **Network › Credenziali**. In cima ci sono due schede: **Credenziali** (questa pagina) e
[Controller di rete](pagine/controllers.md). Menu, schede e tabelle funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). Qui non ci sono ricerca, filtri né tasto destro.

## L'elenco delle credenziali

![L'elenco delle credenziali](/manuale/credentials/tabella.png)

1. `tasto:plus` **Nuova credenziale**: apre la [finestra della credenziale](#finestra).
2. **Tipo**: che cos'è la credenziale (l'elenco dei tipi è sotto).
3. **Usata da**: quante reti, apparati, host, controller o domini la usano. Un clic sul numero apre
   [Dove è usata](#dove-usata). Un trattino: non la usa nessuno.
4. **Test**: prova la credenziale su un apparato (solo per SSH, SNMP e Windows). Vedi [Il test](#test).
5. `icona:pencil` **Modifica**: riapre la finestra con i dati della credenziale.
6. `icona:trash` **Elimina**: toglie la credenziale, dopo una conferma. Se è in uso apre invece **Dove è usata**:
   una credenziale in uso **non si elimina e non cambia tipo**, prima va tolta da lì.

| Colonna | Che cosa dice |
|---|---|
| **Nome** | Il nome dato alla credenziale. |
| **Tipo** | SSH (password o chiave), SNMP v1/v2c, SNMP v3, Windows (WinRM e WMI), API (token o utente), Controller UniFi, Controller Omada, Active Directory. |
| **Username** | Sempre nascosto dai pallini; un trattino se il tipo non ha utente (SNMP v1/v2c). |
| **Porta** | La porta scritta a mano, oppure **standard** (22 per SSH, 161 per SNMP, 5985 per WinRM). Controller e Active Directory hanno la porta nella loro configurazione: trattino. |
| **Usata da** | Il numero degli usi, o un trattino. |
| **Azioni** | Diritti, Test, Modifica, Elimina. |

Per gli account **Windows**, un amministratore vede anche `tasto:shield-check` **Diritti** («Cosa può fare questo
account e cosa va abilitato»): sotto l'elenco si apre un riquadro con i diritti che l'account ha e quelli che
mancano per leggere i computer.

I pulsanti **Nuova credenziale**, Test, Modifica ed Elimina si vedono anche in sola lettura, ma salvare, provare ed
eliminare spettano a un **amministratore**.

## La finestra della credenziale {#finestra}

![La finestra Nuova credenziale](/manuale/credentials/nuova.png)

Si apre con **Nuova credenziale** o con `icona:pencil`. I campi cambiano col tipo:

- **Nome** (per esempio «Admin MikroTik») e **Tipo**;
- per SSH, **Metodo**: utente e password, oppure chiave privata con la sua **passphrase**;
- **Username**: per gli account Windows si scrive `DOMINIO\nomeutente` o `utente@dominio`;
- **Password** (per SNMP v1/v2c è la community, per esempio «public»);
- per SNMP v3: **Username SNMPv3**, **Livello di sicurezza** (noAuthNoPriv senza autenticazione, authNoPriv con
  autenticazione, authPriv con autenticazione e cifratura), **Protocollo di autenticazione** e **Chiave di
  autenticazione**, **Protocollo di privacy** e **Chiave di privacy**;
- **Porta**: vuota vuol dire quella standard; serve per SSH su una porta diversa o SNMP fuori dalla 161.

In modifica, i segreti già salvati compaiono come pallini: lascia il campo vuoto per non cambiarli. In fondo
**Annulla** e **Salva**.

## Dove è usata {#dove-usata}

![La finestra Dove è usata](/manuale/credentials/dove-usata.png)

Si apre con un clic sul numero in **Usata da**. Elenca gli usi divisi per tipo (**Apparati**, **Reti**, **Host**,
**Controller**, **Active Directory**), ognuno col collegamento alla sua pagina. Quando non è più in uso dice «Non è
più in uso: si può eliminare» e offre `tasto:trash` **Elimina**; se è servita a scansioni software passate, la loro
storia resta, senza la credenziale.

## Il test {#test}

![La finestra Test connessione](/manuale/credentials/test.png)

**Test** apre **Test connessione**: si scrive l'**IP o hostname** dell'apparato e, se non è quella standard, la
**Porta**. **Esegui test** tenta l'accesso e dice in basso a destra se è riuscito. Se un account Windows non entra, il
messaggio d'errore offre il pulsante **Guida WinRM**, con i passi per abilitare WinRM sul computer.

## Come si fa

- **Aggiungere la community SNMP degli switch**: `tasto:plus` **Nuova credenziale**, tipo SNMP v1/v2c, la community
  nel campo Password, **Salva**; poi **Test** su uno switch.
- **Assegnarla a una rete intera**: dalla pagina [Subnet](pagine/networks.md) spunta le reti e usa **Assegna
  credenziali**; per un apparato solo, dalla sua [scheda](pagine/objects-id.md).
- **Cambiare la password di un account dopo una rotazione**: `icona:pencil`, scrivi la password nuova, **Salva**: tutte
  le reti e gli apparati che la usano prendono quella nuova.
- **Togliere una credenziale vecchia**: clic sul numero in **Usata da**, toglila da ogni rete o apparato elencato,
  poi `icona:trash`.
- **Capire perché un account Windows non legge i PC**: `tasto:shield-check` **Diritti** e abilita quello che manca;
  vedi anche [Cosa serve per le analisi](pagine/active-directory-cosa-serve.md).

## Da dove arrivano i dati

Le credenziali le scrive una persona. Le password restano cifrate nel database dell'istanza e non tornano mai al
browser.

## Se la pagina è vuota

«Nessuna credenziale»: premi **Nuova credenziale**. Senza credenziali DA-IPAM vede gli apparati in rete ma non può
leggerne modello, porte, software e collegamenti.
