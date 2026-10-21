# ADR 0025 — Inventario ESXi via API diretta nel contratto modulare

Data: 2026-10-21. Stato: accettato nel perimetro locale dei collector (ADR 0024).

## Contesto

Un host gestito da vCenter deve poter essere acquisito direttamente, senza attivare
SSH, modificare l'host o enumerare il cluster. Il JSON nato per switch deve mantenere
un significato coerente quando rappresenta VM, datastore e reti virtuali.

## Decisione

`vmware-esxi` usa vSphere Web Services SOAP e proprietà selezionate del singolo
HostSystem, delle VM e dei datastore referenziati da quell'host. L'endpoint deve
essere HostAgent: un VirtualCenter è rifiutato prima del login. Sessione singola,
limiti/paginazione/logout; nessun metodo di configurazione o operazione sulle VM.
TLS richiede CA valida oppure pin SHA256 esplicito prima di inviare credenziali.
Il preflight locale con cui si rileva un pin è fiducia al primo contatto, non una CA.

Il contratto 1.0 aggiunge `virtualization` opzionale, conservando le sezioni comuni.
ARP e membership VLAN fisica non disponibili producono parziali espliciti, non
liste vuote da usare per cancellare. VLAN 4095 è trunk; teaming non equivale a
inventario LACP. Byte interi come stringhe decimali; guest IP dai Tools dichiarati
potenzialmente vecchi. I sensori conservano unità/esponente originali.

ManagedObjectReference e UUID restano distinti. Un MoRef è valido nel suo endpoint:
`ha-host` o `vm-17` non sono chiavi globali. Un futuro import deve usare scope
endpoint+tipo+MoRef e riconciliare gli UUID con regole esplicite; i datastore
condivisi non si sommano una volta per host. Non dedurre identità dal solo nome.

## Verifica

Collaudo ESXi 8.0.3 su DL380 Gen11, 18 VM e 8 datastore; riferimenti e conteggi
confrontati. Prove su type/xsi:type, capacità grandi, zero/false, pin TLS, fault,
timeout, paginazione/logout e redazione. Nessuna persistenza o UI attivata.

## Cosa diventa difficile in futuro

L'accesso diretto non sostituisce un inventario vCenter: policy cluster, vDS complete,
vMotion e riferimenti che cambiano endpoint richiederanno un collector separato e
riconciliazione. Un certificato sostituito richiede aggiornamento esplicito del pin.
Gli errori di proprietà non autorizzano eliminazioni nello stato persistente.
