# Golden set attribuzione (spec §8)

Questo direttorio contiene il golden set per i test di progressività e qualità dell'attribuzione.

## Procedura di generazione

1. Scaricare una copia del DB tenant:
   ```bash
   npm run pull:db
   # oppure copiare manualmente /var/tmp/70791.pre-attrv2.db
   ```

2. Esportare gli host come `AttributionSignals`:
   ```bash
   npx tsx scripts/attribution-golden-export.ts data/tenants/70791.db > src/lib/attribution/__tests__/golden/hosts.json
   ```

3. Creare `expected.json` verificando **a mano** l'attribuzione attesa di ogni host (~50 elementi):
   ```json
   [
     { "ip": "192.168.1.10", "category": "network.access_point", "vendor": "ubiquiti", "os": null },
     { "ip": "192.168.1.20", "category": "server", "vendor": "dell", "os": "Linux" },
     ...
   ]
   ```
   - `category`: livello 2 (es. `network.access_point`) dove il segnale è certo, livello 1 (es. `network`) dove incerto, `null` dove ignoto
   - `vendor`: brand/costruttore, o `null` se sconosciuto
   - `os`: SO rilevato, o `null` se sconosciuto

4. Il test `golden.test.ts` fallisce se una release peggiora un host già corretto.
   ```bash
   node --import tsx --test src/lib/attribution/__tests__/golden.test.ts
   ```

## Accettazione

Metrica spec §8: **livello 2 corretto ≥ 85%** sul golden set.
