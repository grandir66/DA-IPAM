---
percorso: /rmm
titolo: Controllo remoto (RMM)
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Elenca i **computer su cui si può aprire una sessione remota** con MeshCentral: desktop, terminale, file e comandi, già
autenticati, senza aprire la console di MeshCentral. Mostra anche i computer che hanno l'agente MeshCentral ma non sono
ancora legati a un host di DA-IPAM, per associarli. Si arriva da **Applicativi › Controllo remoto** nel menu; la voce
c'è solo se il modulo MeshCentral è acceso. La pagina non ha schede in cima.

Le parti che si ripetono in tutte le pagine sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md). Le immagini
del manuale nascondono i nomi dei computer.

## La testata

![La testata del Controllo remoto](/manuale/rmm/testata.png)

1. `tasto:refresh`: ricarica l'elenco.
2. `tasto:monitor-smartphone` **Sincronizza ora**: chiede subito a MeshCentral l'elenco dei computer con l'agente e li
   abbina agli host di DA-IPAM.
3. `tasto:external-link` **Console MeshCentral**: apre la console di MeshCentral in una scheda nuova, per i lavori che
   da qui non si fanno.

## Endpoint gestiti

![Gli endpoint gestiti](/manuale/rmm/endpoint.png)

I computer con l'agente già legati a un host di DA-IPAM; il titolo dice quanti sono.

| Colonna | Che cosa dice |
|---|---|
| **Endpoint** | Il nome del computer. |
| **IP** | L'indirizzo principale. |
| **OS** | Il sistema operativo letto dall'agente. |
| **Stato** (①) | **online** se l'agente è collegato in questo momento, **offline** se no. |
| **Azione** (②) | `tasto:monitor-smartphone` **Controllo remoto** apre la [sessione remota](pagine/rmm-hostid.md) dentro DA-IPAM. È grigio quando il computer è offline. |

## Nodi da associare

![I nodi da associare](/manuale/rmm/nodi.png)

I computer che hanno l'agente ma che DA-IPAM non ha saputo abbinare a un host. Il riquadro dice quanti sono e ha il suo
`tasto:refresh` per rileggerli. Colonne **Nodo**, **IP**, **OS** e **Associa a oggetto**: si scrive nella casella
**host id** il numero dell'host di DA-IPAM (lo si legge nell'indirizzo della sua [scheda](pagine/objects-id.md)) e si
preme `tasto:link` **Associa**. Associare cambia i dati: lo fa un amministratore.

## Come si fa

- **Entrare su un server per un controllo**: trovalo in **Endpoint gestiti**, `tasto:monitor-smartphone` **Controllo
  remoto**.
- **Un PC appena installato non compare**: `tasto:monitor-smartphone` **Sincronizza ora**.
- **Un PC compare fra i Nodi da associare**: apri la sua scheda in DA-IPAM, copia il numero dall'indirizzo, scrivilo in
  **host id**, **Associa**.
- **Il pulsante Controllo remoto è grigio**: il PC è offline; accendilo o controlla l'agente, poi `tasto:refresh`.
- **Un lavoro che da qui non si fa** (gruppi, criteri, aggiornamento degli agenti): `tasto:external-link` **Console
  MeshCentral**.

## Cosa vogliono dire i segni

- **online** (verde): l'agente è collegato, la sessione si può aprire.
- **offline** (arancio): il computer è spento o l'agente non è collegato.

## Da dove arrivano i dati

Dal server MeshCentral dell'appliance: l'elenco dei computer con l'agente, il loro stato e il sistema operativo.
L'abbinamento agli host di DA-IPAM si fa per indirizzo e nome.

## Se la pagina è vuota

«Modulo MeshCentral non configurato per questo tenant» vuol dire che il modulo è spento: `tasto:settings` **Vai a
Impostazioni → Moduli** porta alla configurazione. «Nessun endpoint mappato» vuol dire che l'agente non è ancora
installato su nessun computer: lo script si scarica da Impostazioni › Moduli › MeshCentral, oppure si associano i nodi
qui sotto.
