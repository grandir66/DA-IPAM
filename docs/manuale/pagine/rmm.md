---
percorso: /rmm
titolo: Controllo remoto (RMM)
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **computer su cui si può aprire una sessione remota** con MeshCentral: desktop, terminale, file e comandi, già
autenticati, senza aprire la console di MeshCentral. Mostra anche i computer che hanno l'agente MeshCentral ma non sono
ancora legati a un host di DA-IPAM, per associarli. Si arriva da **Applicativi › Controllo remoto** nel menu; la voce
c'è solo se il modulo MeshCentral è acceso.

![La pagina Controllo remoto](/manuale/rmm/pagina.png)

## Le voci della pagina

In alto a destra:

- **Le due frecce**: ricaricano l'elenco.
- **Sincronizza ora**: chiede subito a MeshCentral l'elenco dei computer con l'agente e li abbina agli host di DA-IPAM.
- **Console MeshCentral**: apre la console di MeshCentral in una scheda nuova, per i lavori che da qui non si fanno.

**Endpoint gestiti**: i computer con l'agente già legati a un host di DA-IPAM. Colonne:

- **Endpoint**: il nome del computer.
- **IP** e **OS** (il sistema operativo letto dall'agente).
- **Stato**: **online** se l'agente è collegato in questo momento, **offline** se no.
- **Azione**: **Controllo remoto** apre la [sessione remota](pagine/rmm-hostid.md) dentro DA-IPAM. È grigio quando il
  computer è offline.

**Nodi da associare**: i computer che hanno l'agente ma che DA-IPAM non ha saputo abbinare a un host. Colonne Nodo, IP,
OS e **Associa a oggetto**: si scrive il numero dell'host di DA-IPAM (lo si legge nell'indirizzo della sua scheda) e si
preme **Associa**. Le frecce in alto a destra del riquadro rileggono l'elenco.

## Come si usa

1. Per entrare su un computer, trovalo in **Endpoint gestiti** e premi **Controllo remoto**.
2. Se un computer appena installato non compare, premi **Sincronizza ora**.
3. Se compare fra i **Nodi da associare**, scrivi il numero dell'host e premi **Associa**.

## Cosa vogliono dire i segni

- **online** (verde): l'agente è collegato, la sessione si può aprire.
- **offline** (arancio): il computer è spento o l'agente non è collegato.

## Da dove arrivano i dati

Dal server MeshCentral dell'appliance: l'elenco dei computer con l'agente, il loro stato e il sistema operativo.
L'abbinamento agli host di DA-IPAM si fa per indirizzo e nome.

## Se la pagina è vuota

«Modulo MeshCentral non configurato per questo tenant» vuol dire che il modulo è spento: il pulsante **Vai a Impostazioni
→ Moduli** porta alla configurazione. «Nessun endpoint mappato» vuol dire che l'agente non è ancora installato su nessun
computer: lo script si scarica da Impostazioni › Moduli › MeshCentral, oppure si associano i nodi qui sotto.
