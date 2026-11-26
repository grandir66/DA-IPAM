---
percorso: /inventory/[id]
titolo: Scheda di un asset
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la scheda completa di **un asset dell'inventario**: identificazione, ubicazione, chi ne è responsabile, ciclo di
vita, dati tecnici, compliance NIS2, servizi che ne dipendono, licenze assegnate e storico delle modifiche. Qui si
compilano i campi che la NIS2 chiede e si correggono quelli letti in automatico. Si apre dalla matita in fondo a una
riga di [Asset](pagine/inventory.md); la freccia in alto a sinistra torna all'elenco.

In cima c'è l'asset tag (o il nome del prodotto) e, sotto, il codice univoco dell'asset.

![La scheda di un asset, vista NIS2](/manuale/inventory-id/pagina.png)

## Le voci della pagina

1. **Sync da discovery**: riempie i campi **vuoti** con i dati dell'host o dell'apparato collegato (modello, numero di
   serie, sistema operativo, firmware, IP, MAC). Accanto, **Force** fa lo stesso ma **sovrascrive** anche i valori già
   scritti a mano. Tutti e due sono spenti se l'asset non è collegato a niente. L'interruttore **Vista NIS2** cambia le
   schede mostrate, come nell'elenco.
2. **Le schede**: con la vista NIS2 accesa sono quattro, **Scheda NIS2**, **Servizi**, **Licenze**, **Storico**. Con la
   vista spenta (inventario ITAM completo) sono undici: Identificazione, Ubicazione, Responsabilità, Ciclo vita,
   Tecnico, Compliance, Servizi, Licenze, Storico, Economico, Supporto.
3. **Salva modifiche** (in fondo alla pagina): scrive tutto quello che hai cambiato, in tutte le schede. Finché non lo
   premi non si salva niente.

## La Scheda NIS2

Raccoglie in una pagina sola i campi che servono al registro NIS2, divisi in riquadri:

- **Identificazione**: Asset tag, Serial number, Hostname, Nome / descrizione, Categoria, Marca, Modello.
- **Ubicazione**: Sede, Reparto, Ubicazione (scelta fra le [Ubicazioni](pagine/inventory-locations.md); il **+**
  accanto ne crea una al volo), Posizione fisica, IP, VLAN.
- **Responsabilità**: **Business owner** (chi decide sull'asset) e **Technical owner** (chi lo gestisce
  tecnicamente), scelti fra gli [Assegnatari](pagine/inventory-assignees.md); il **+** aggiunge una persona. Sotto
  resta il «Proprietario business (legacy / pre-NIS2)» dei dati vecchi.
- **Assegnatario proposto dagli accessi**: DA-IPAM guarda chi si collega più spesso al PC e propone la persona.
  **Accetta** la assegna, **Scegli un altro** apre la scelta a mano. Se il PC è condiviso (nessuno sopra la soglia
  degli accessi) lo dice e mostra la tabella Utente, Assegnatario, Accessi, Tipo. Se mancano i dati degli accessi,
  propone di configurare WinRM sull'host.
- **Ciclo di vita**: Stato operativo, Fine supporto (EOL), Data acquisto, Data installazione, Data dismissione.
- **Software e rete**: Sistema operativo, Versione OS, Firmware, MAC.
- **Compliance NIS2**: In scope NIS2, Categoria NIS2, Criticità, Dati trattati, Classificazione dati, Ultimo audit,
  Ultima review NIS2.
- **Misure di protezione**: Antivirus / EDR, Crittografia disco, Gestito da MDR, Supporto rimovibile.
- **Checklist protezione (NIS2 art. 21)**: Backup configurato (con l'ultimo test di ripristino), Patching automatico,
  MFA su accessi admin, Log centralizzati (SIEM), Hardening baseline applicato, Disaster recovery plan documentato,
  Incident response procedurato.
- **Note e remediation**: testo libero su cosa resta da fare.

Se l'asset viene da un apparato o da un Proxmox, sotto compare **Dati archiviati**: quello che DA-IPAM ha letto
dall'apparato (sysName, modello, firmware, seriale) o dal Proxmox (CPU, RAM, versione, licenza). Si legge e basta.

## Le altre schede

- **Servizi**: i [servizi NIS2](pagine/services.md) che dipendono da questo asset, con il segno NIS2 se il servizio è in
  perimetro. Il collegamento si fa dalla scheda del servizio.
- **Licenze**: le licenze software assegnate. Il menu **Assegna licenza…** ne assegna una con posti liberi; il cestino
  sulla riga toglie l'assegnazione. Le licenze si creano in [Licenze](pagine/inventory-licenses.md).
- **Storico**: il registro di ogni modifica, con Data, Azione, Campo, Valore precedente, Nuovo valore.
- Vista ITAM: **Identificazione**, **Ubicazione**, **Responsabilità** (Assegnato a), **Ciclo vita** (Stato, Fine
  garanzia, Fine supporto), **Tecnico** (CPU, RAM, storage, sistema operativo, firmware, IP, MAC), **Compliance** (In
  scope GDPR, In scope NIS2, Classificazione dati, Ultimo audit), **Economico** (Prezzo acquisto, Fornitore),
  **Supporto** (Contratto supporto, Contatto supporto, Note tecniche).

## Come si usa

1. Apri l'asset dalla matita in [Asset](pagine/inventory.md).
2. Se è collegato a un host o a un apparato, premi **Sync da discovery** per riempire i campi tecnici.
3. Compila **Responsabilità** e **Compliance NIS2**, poi spunta le voci della **Checklist protezione** che valgono.
4. Premi **Salva modifiche**.
5. Per vedere chi ha cambiato cosa apri **Storico**.

## Da dove arrivano i dati

I campi tecnici vengono dall'host o dall'apparato collegato (scansioni, SNMP, WinRM, Proxmox); le persone dagli
[Assegnatari](pagine/inventory-assignees.md); la proposta di assegnatario dagli accessi ai PC letti da Active
Directory. Tutto il resto lo scrive una persona.

## Se la pagina è vuota

«Asset non trovato» vuol dire che l'asset è stato eliminato o che l'indirizzo è sbagliato: torna ad
[Asset](pagine/inventory.md). Se **Sync da discovery** è grigio, l'asset non è collegato a nessun host o apparato.
