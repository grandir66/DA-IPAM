# Collector VMware ESXi via API — piano di esecuzione

**Obiettivo:** acquisizione diretta ESXi con API vSphere SOAP, JSON comune/CLI e adapter senza DB.
**Architettura:** collector `vmware-esxi`, sessione HTTPS esplicita, PropertyCollector con proprietà selezionate, paginazione e logout. Estensione opzionale `virtualization`; sezioni comuni conservate.
**Spec:** contratto ADR 0024 e `docs/modules/acquisition.md`, estensione VMware richiesta da Riccardo il 21/10.
**Controllo:** completo come le tappe approvate QNAP/HP/Comware; esecuzione in linea, senza push/deploy.

- [x] Preflight senza autenticazione: HostAgent ESXi 8.0.3; acquisita impronta TLS nel vault privato.
- [x] Trasporto SOAP limitato e autenticazione singola, TLS CA oppure fingerprint SHA256 esplicito, allowlist operazioni, cookie solo in memoria; logout anche su errore. Niente redirect, retry credenziali, SSH o metodi di modifica.
- [x] Contratto API/virtualizzazione, parser puri e collector: host hardware/runtime, NIC/vSwitch/portgroup/VMkernel, datastore, dischi/LUN, VM con guest network/dischi/vNIC/snapshot; errori di proprietà visibili e riferimenti VMware preservati. Proprietà selezionate, niente configurazione completa o credenziali iSCSI.
- [x] Test anonimi: XML escaping, SOAP fault, limiti/paginazione, proprietà mancanti, byte/booleani/zero, identità e rete vDS; regressioni famiglie precedenti. CLI reale e confronto conteggi delle proprietà ricevute.
- [x] Lint/typecheck/build, segreti fuori repo, manuale/CONTEXT/TASKS/CHANGELOG e commit locali.

Casi limite: host gestito da vCenter non è un vCenter; VM guest IP proviene dai Tools e non è uno scan attivo; VLAN 4095 trunk non è VLAN singola; distributed portgroup non configurabile completamente dall'host; datastore condiviso non va sommato per host; capacità in byte oltre safe integer restano stringhe; dati non disponibili non diventano zeri.

Esito: 76 test verdi, lint senza errori, typecheck/build verdi. CLI sul vero: virtualizzazione ok con 18 VM/8 datastore e riferimenti coerenti; globale parziale per ARP e membership VLAN fisica non raccolti. Snapshot nel vault, nessuna modifica all’host o pubblicazione. Limiti e aree rinviate in TASKS/manuale.
