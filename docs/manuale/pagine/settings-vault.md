---
percorso: /settings/vault
titolo: Vault — le credenziali dell'appliance, chi le ha viste, l'esportazione in KeePass
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in un posto lo **stato dell'archivio delle credenziali** dell'appliance, il **registro di chi ha visto
quale password** e l'**esportazione in KeePass**. Si arriva da **Config › Sistema › Vault ›**. È riservata agli
amministratori dell'istanza.

Per questa pagina non c'è una schermata nel manuale, per scelta: mostrerebbe lo stato delle chiavi e i nomi di chi
ha visto le password. Chi non è amministratore vede solo «Pagina riservata agli amministratori di questa istanza».
Le parti comuni sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## Le voci della pagina

**Stato**:

- **Archivio locale**: **spento** (le credenziali sono cifrate con la chiave dell'appliance, come sempre; il vault
  si accende sul server, un'appliance alla volta), **sbloccato** (con il modo in cui si è aperto: TPM, passphrase o
  chiave Domarc) oppure **bloccato**, con il motivo. La riga **Slot** dice con quali chiavi si può aprire
  l'archivio: quella del cliente, quella di Domarc (se il cliente non l'ha esclusa) e il TPM della macchina.
- **L'archivio remoto**, se configurato: **pronto**, **con la cache** (non raggiungibile, si usano le copie
  locali) o **non disponibile**.
- Se l'archivio è bloccato compare **Scansioni in pausa**: finché non si sblocca, le scansioni che usano le
  credenziali aspettano.

**Sblocca** (compare solo quando serve): senza TPM l'archivio si apre con la **Passphrase del cliente**; si scrive e
si preme **Sblocca**. Le scansioni riprendono.

**Esporta in KeePass**: un file KeePass (formato KDBX 4) con tutte le credenziali, che si apre con la passphrase del
cliente più un file chiave.

- **Passphrase del cliente**: va scritta per esportare.
- **Scarica .kdbx**: l'archivio.
- **Scarica key file**: il file chiave. È sempre lo stesso: si scarica una volta e si tiene separato dall'archivio.

**Chi ha visto cosa**: ogni password mostrata, ogni esportazione e ogni file chiave scaricato, con **Quando**,
**Chi**, **Cosa** e **Credenziale**. **Precedenti** e **Successivi** scorrono le pagine.

## Come si fa

- **Le scansioni sono in pausa dopo un riavvio**: l'archivio è bloccato (macchina senza TPM). Scrivi la **Passphrase
  del cliente** nel riquadro **Sblocca** e premi **Sblocca**; la riga **Scansioni in pausa** sparisce.
- **Consegnare le credenziali al cliente**: scrivi la passphrase in **Esporta in KeePass**, **Scarica .kdbx** e,
  una volta sola, **Scarica key file**; consegnali separati.
- **Sapere chi ha guardato una password**: leggi **Chi ha visto cosa**; **Precedenti** e **Successivi** scorrono le
  pagine più vecchie.
- **Capire con quali chiavi si apre l'archivio**: leggi la riga **Slot** del riquadro Stato.
- **L'archivio remoto non risponde**: se lo stato dice **con la cache**, le scansioni continuano con le copie locali;
  se dice **non disponibile**, avvisa chi gestisce il server.

## Da dove arrivano i dati

Dall'archivio cifrato delle credenziali sull'appliance e dal suo registro degli accessi.

## Se la pagina è vuota

«Nessuna visualizzazione registrata» vuol dire che nessuno ha ancora mostrato una password. Con il vault spento
si vede solo il riquadro Stato con la spiegazione.
