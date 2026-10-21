# ADR 0026 — ONTAP: cluster logico, controller e relazioni storage distinti

Data: 2026-10-21. Stato: accettato per il collector locale; persistenza da progettare.

## Contesto

Il MetroCluster espone cluster, nodi locali/DR, SVM, LIF, aggregati, volumi e LUN.
Trattarli come un apparato con un solo IP/seriale produce duplicati e somme errate.
Il vCenter conferma la necessità di distinguere datastore e mount su molti host.

## Decisione

Profilo `netapp-ontap`, REST GET con CA oppure pin esplicito prima di Basic auth,
allowlist di endpoint, paginazione limitata allo stesso endpoint e limiti di tempo,
righe e byte. Nessun passthrough CLI, check attivo o metodo di modifica.

`storage` è opzionale nel JSON 1.0. Ogni sottocollezione conserva stato/fonti/
avvisi/tempo: 403, 404, timeout e zero record validi hanno significati diversi.
Byte grandi preservati dal token JSON originale prima dell'arrotondamento Number.
Identity rappresenta il cluster; modello/seriale dei controller sono nella lista
nodi, non un chassis unico inventato. HA partner e DR partner sono relazioni diverse.

LIF: home node/port e corrente separati; indirizzo è un attributo osservato.
Dischi e shelf mantengono il flag local; i riferimenti remoti non dimostrano un
censimento diretto dell'altro sito. Le capacità di mount, datastore, volume,
aggregato, disco e mirror non si sommano senza una dimensione dichiarata.

La proposta del modello/integrazione sta in `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`.
Osservazioni, alias scoped, entità e relazioni con prove sono livelli separati.
Non è stata applicata alcuna migrazione o importazione persistente.

## Verifica

ONTAP 9.16.1P11 su AFF A70 / MetroCluster IP. Letture REST e CLI, TLS/next-link,
conteggi di pagina, parziali, 403/404, byte grandi, zero/false, UUID e LIF migrata.
Confronto vCenter/NFS solo su IP LIF + SVM + percorso univoco; non per nome/capacità.

## Cosa diventa difficile in futuro

Collector del partner e domini di rete/siti richiederanno scope e deduplica espliciti.
Il REST non garantisce tutti i root aggregati. Correlare VMFS con LUN richiede
NAA/WWID e seriali verificati. La compatibilità con altre release resta da collaudare.
Un nuovo certificato richiede aggiornamento consapevole del pin, non fallback TLS.
