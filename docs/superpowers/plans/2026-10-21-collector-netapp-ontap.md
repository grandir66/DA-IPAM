# Collector NetApp ONTAP / MetroCluster — piano

Estensione richiesta da Riccardo il 21/10, contratto ADR 0024; controllo completo,
esecuzione in linea, solo locale senza push/deploy né persistenza.

- [x] Preflight HTTPS, pin nel vault e login REST riuscito: ONTAP 9.16.1P11.
- [x] REST GET con allowlist, TLS CA/pin, paginazione locale all'endpoint e limiti;
  nessuna lettura di configurazioni con password, niente SSH/fallback o mutazioni.
- [x] Collector/schema storage: cluster, nodi/HA, MetroCluster e DR, aggregati,
  volumi/LUN, SVM, dischi/shelf e rete IP/Ethernet/FC; relazioni con UUID preservate,
  byte esatti, parziali/negati distinti da elenchi vuoti.
- [x] Prove anonime e collaudo CLI, conteggi e segreti; regressioni precedenti,
  lint/typecheck/build; manuale, contesto/checklist e commit selettivi locali.

Casi limite: no switchover/check/repair; risposta partner non equivale ad acquisizione
dell'altro cluster; dati MetroCluster senza TTL non sono una diagnosi di failover;
root aggregati non necessariamente visibili nel REST; logical/physical/mirrored
space non si sommano; next link non può portare Basic auth verso altri host.

Esito: 87 prove, lint/typecheck/build verdi. CLI storage ok e globale partial per scope non raccolti. Analisi vCenter successivamente richiesta eseguita come prova locale separata; consegna all’agente in docs/handoff/, nessun profilo vCenter di prodotto o modello persistente attivato.
