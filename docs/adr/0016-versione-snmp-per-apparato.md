# ADR 0016 — Versione SNMP per apparato, scelta dalla discovery, un solo punto che apre le sessioni

- **Stato**: Accettato
- **Data**: 2026-10-15

## Contesto

In net-snmp `createSession` **senza** `version` parla **v1** (`Version1 = 0`) e
`version: 1` vuol dire **v2c**. Nel codice convivevano le due cose: la discovery
(`snmp-query.ts`, `snmp-debug.ts`) forzava v2c; lettura dati, client switch e
router, sonda interfacce, STP e test credenziali non passavano `version` e
quindi parlavano v1 senza saperlo. Perfino la stessa lettura dati di un
apparato parlava v2c nel passo del profilo vendor e v1 nel passo ENTITY-MIB.
Il campo `protocol = 'snmp_v2'` degli apparati non diceva la versione vera.

A DTS il 15/10 gli AP Ubiquiti 172.16.3.4-7 (airFiber, sysObjectID
`1.3.6.1.4.1.10002.1`) rispondono **solo in v1**: in v2c vanno in timeout. La
discovery non li vedeva; la lettura dati sì, per caso. «Sistemare» i
`createSession` mettendo v2c ovunque li avrebbe spenti.

## Decisione

**La versione SNMP a community è un dato dell'apparato** (`network_devices.snmp_version`,
`'1' | '2c'`, NULL = non rilevata), scritto dalla discovery — v2c, poi v1 sugli host
accesi — o fissato a mano (`snmp_version_fissata = 1`, che la discovery non tocca).
Le sessioni a community si aprono **solo** da `src/lib/protocols/snmp-sessione.ts`, con
la versione esplicita; ogni punto sceglie con `versioneApparato(device, <quella di prima>)`,
così **NULL si comporta esattamente come prima, punto per punto**. Senza apparato
(test di una credenziale) si prova v2c e poi v1, e si dice quale ha risposto.

## Alternative scartate

- **v2c esplicita ovunque**: semplice, ma spegne gli apparati solo v1 (gli AP di DTS).
- **v1 esplicita ovunque**: rallenta i walk (niente GETBULK) e perde gli agenti solo v2c,
  che la discovery oggi vede.
- **Dedurre la versione da `protocol`**: `snmp_v2` c'è già su apparati che rispondono solo
  in v1; il campo dice come si gestisce l'apparato, non come risponde l'agente.
- **Provare v2c e poi v1 a ogni lettura**: raddoppia i tempi d'attesa a ogni giro su ogni
  apparato che non risponde, per sempre, invece di una volta alla discovery.

## Conseguenze

- Dopo la prima discovery gli apparati che rispondono in v2c (switch, router) passano da v1
  a v2c anche nei client: walk con GETBULK, più veloci. Un agente che regge male il
  GETBULK si vede dal registro e si corregge fissando la v1 a mano.
- Sugli host accesi che non parlano SNMP la discovery aspetta un GET in più per community
  (~3,5 s); il ripiego su `snmpwalk` da riga di comando resta solo al primo giro (v2c).
- **Cosa diventa difficile in futuro**: un `createSession(` nuovo scritto fuori dal modulo fa
  fallire `snmp-sessione.test.ts`; chi aggiunge un punto deve decidere quale versione usava
  quel punto «prima», e per un punto nuovo non c'è un «prima»: va scelta (di solito quella
  dell'apparato con default v2c, come la discovery). La v3 resta fuori: ha la sua sessione
  (`createV3Session`) e il suo protocollo.
