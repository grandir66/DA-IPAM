---
percorso: /inventory/[id]
titolo: Scheda di un asset
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la scheda completa di **un asset dell'inventario**: identificazione, ubicazione, chi ne è responsabile, ciclo di
vita, dati tecnici, compliance NIS2, servizi che ne dipendono, licenze assegnate e storico delle modifiche. Qui si
compilano i campi che la NIS2 chiede e si correggono quelli letti in automatico. Si apre da `icona:pencil` in fondo a
una riga di [Asset](pagine/inventory.md).

Campi, tendine e tabelle funzionano come in tutte le pagine ([parti comuni dell'interfaccia](../INTERFACCIA.md)): qui
c'è quello che la scheda ha di suo.

## La testata e le schede

![La testata della scheda](/manuale/inventory-id/testata.png)

In cima c'è l'asset tag (o il nome del prodotto) e, sotto, il codice univoco dell'asset.

1. `icona:arrow-left` torna all'elenco degli [Asset](pagine/inventory.md).
2. `tasto:refresh` **Sync da discovery**: riempie i campi **vuoti** con i dati dell'host o dell'apparato collegato
   (modello, numero di serie, sistema operativo, firmware, IP, MAC).
3. **Force**: fa lo stesso ma **sovrascrive** anche i valori già scritti a mano. Sync e Force sono spenti se l'asset
   non è collegato a niente.
4. **Vista NIS2**: l'interruttore cambia le schede mostrate, come nell'elenco. La scelta vale anche lì.
5. **Le schede**. Con la vista NIS2 accesa sono quattro: `icona:shield` **Scheda NIS2**, **Servizi**, **Licenze**,
   **Storico**. Con la vista spenta (inventario ITAM completo) sono undici: Identificazione, Ubicazione,
   Responsabilità, Ciclo vita, Tecnico, Compliance, Servizi, Licenze, Storico, Economico, Supporto.

In fondo alla pagina c'è **Salva modifiche**: scrive tutto quello che hai cambiato, in tutte le schede. Finché non lo
premi non si salva niente; se cambi pagina prima, le modifiche si perdono. Salva, Sync e Force cambiano l'asset:
riescono solo a un amministratore.

## La Scheda NIS2 {#nis2}

Raccoglie in una pagina sola i campi che servono al registro NIS2, divisi in riquadri:

- **Identificazione**: Asset tag, Serial number, Hostname, Nome / descrizione, Categoria, Marca, Modello.
- **Ubicazione**: Sede, Reparto, Ubicazione (scelta fra le [Ubicazioni](pagine/inventory-locations.md)), Posizione
  fisica, IP, VLAN.
- **Responsabilità**: vedi sotto.
- **Assegnatario proposto dagli accessi**: vedi sotto.
- **Ciclo di vita**: Stato operativo, Fine supporto (EOL), Data acquisto, Data installazione, Data dismissione.
- **Software e rete**: Sistema operativo, Versione OS, Firmware, MAC.
- **Compliance NIS2**: In scope NIS2, Categoria NIS2, Criticità, Dati trattati, Classificazione dati, Ultimo audit,
  Ultima review NIS2.
- **Misure di protezione**: Antivirus / EDR, Crittografia disco, Gestito da MDR, Supporto rimovibile (USB / SD / disco
  esterno).
- **Checklist protezione (NIS2 art. 21)**: vedi sotto.
- **Note e remediation**: testo libero su cosa resta da fare.

Se l'asset viene da un apparato o da un Proxmox, sotto compare **Dati archiviati (dispositivo)** o **Dati archiviati
(Proxmox)**: quello che DA-IPAM ha letto dall'apparato (sysName, modello, firmware, seriale) o dal Proxmox (CPU, RAM,
versione, licenza). Si legge e basta.

### Responsabilità

![Il riquadro Responsabilità](/manuale/inventory-id/responsabilita.png)

**Business owner** (chi decide sull'asset) e **Technical owner** (chi lo gestisce tecnicamente) si scelgono fra gli
[Assegnatari](pagine/inventory-assignees.md). Sotto resta il **Proprietario business (legacy / pre-NIS2)** dei dati
vecchi. `tasto:plus` (①) accanto a ogni tendina apre la finestra **Nuovo/a assegnatario**: nome, email e telefono; la
persona creata compare subito nella tendina. Lo stesso `tasto:plus` c'è accanto a **Ubicazione** per crearne una al
volo.

### Assegnatario proposto dagli accessi

DA-IPAM guarda chi si collega più spesso al PC (dagli accessi letti da Wazuh, WinRM o dall'agente) e propone la
persona, con quanti accessi su quanti negli ultimi giorni.

- **Accetta**: la assegna.
- **Scegli un altro**: apre la scelta a mano.
- **PC condiviso, non proporre**: smette di proporre; **Riprendi le proposte** torna indietro.
- **Assegna a …**: compare quando l'asset è già assegnato ma si collega soprattutto un'altra persona.

Se nessuno supera la soglia degli accessi il riquadro dice **PC condiviso**; con pochi accessi dice **Pochi dati**;
senza nessuna fonte propone **Configura WinRM sull'host**. Server e apparati di rete non ricevono proposte. Sotto, la
tabella degli accessi: Utente, Assegnatario, Accessi, Tipo, Ultima volta, Fonti, Nel calcolo.

### Checklist protezione

![La checklist di protezione](/manuale/inventory-id/checklist.png)

Le misure che l'articolo 21 della NIS2 chiede, da spuntare quando valgono: Backup configurato (con la data
dell'**Ultimo test restore**), Patching automatico, MFA su accessi admin, Log centralizzati (SIEM), Hardening baseline
applicato, Disaster recovery plan documentato, Incident response procedurato.

## Servizi {#servizi}

I [servizi NIS2](pagine/services.md) che dipendono da questo asset, con `icona:shield` NIS2 se il servizio è in
perimetro. Il nome, con `icona:external-link`, apre il servizio. Il collegamento si fa dalla
[scheda del servizio](pagine/services-id.md), non da qui.

## Licenze {#licenze}

![La scheda Licenze](/manuale/inventory-id/licenze.png)

Le licenze software assegnate a questo asset, con la data di assegnazione. La tendina **Assegna licenza…** elenca le
licenze con posti liberi («(3 posti liberi)»): sceglierne una la assegna subito. `icona:trash` sulla riga (**Rimuovi
assegnazione**) libera il posto. Le licenze si creano in [Licenze](pagine/inventory-licenses.md).

## Storico {#storico}

![La scheda Storico](/manuale/inventory-id/storico.png)

Il registro di ogni modifica: Data, Azione, Campo, Valore precedente, Nuovo valore. Passa il mouse su un valore
tagliato per leggerlo intero.

## Le schede della vista ITAM {#itam}

| Scheda | Campi |
|---|---|
| **Identificazione** | Identificazione asset: asset tag, numero di serie, nome, categoria, marca, modello. |
| **Ubicazione** | Sede, reparto, ubicazione, posizione fisica. |
| **Responsabilità** | Assegnatario. |
| **Ciclo vita** | Stato, fine garanzia, fine supporto, date. |
| **Tecnico** | Specifiche tecniche: CPU, RAM, storage, sistema operativo, firmware, IP, MAC. |
| **Compliance** | Compliance GDPR / NIS2: in scope GDPR, in scope NIS2, classificazione dati, ultimo audit. |
| **Servizi**, **Licenze**, **Storico** | Come sopra. |
| **Economico** | Dati economici: prezzo d'acquisto, fornitore. |
| **Supporto** | Manutenzione & supporto: contratto, contatto, note tecniche. |

## Come si fa

- **Riempire i campi tecnici di un server appena sincronizzato**: `tasto:refresh` **Sync da discovery**, controlla,
  **Salva modifiche**.
- **Rimettere i dati letti al posto di quelli scritti a mano**: **Force**, poi **Salva modifiche**.
- **Dare un responsabile a un asset**: Scheda NIS2 › Responsabilità › Business owner; se la persona non c'è,
  `tasto:plus` e la crei.
- **Assegnare una licenza Office a un PC**: scheda **Licenze**, tendina **Assegna licenza…**, scegli la licenza.
- **Vedere chi ha cambiato lo stato di un asset**: scheda **Storico**.

## Da dove arrivano i dati

I campi tecnici vengono dall'host o dall'apparato collegato (scansioni, SNMP, WinRM, Proxmox); le persone dagli
[Assegnatari](pagine/inventory-assignees.md); la proposta di assegnatario dagli accessi ai PC. Tutto il resto lo scrive
una persona.

## Se la pagina è vuota

«Asset non trovato» vuol dire che l'asset è stato eliminato o che l'indirizzo è sbagliato: torna ad
[Asset](pagine/inventory.md). Se **Sync da discovery** è grigio, l'asset non è collegato a nessun host o apparato.
