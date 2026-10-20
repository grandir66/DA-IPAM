# Agents Remoti / Bridge — DA-IPAM

## Scopo nel progetto

Gestisce gli **agenti remoti** (scanner-edge / bridge di esecuzione) che
permettono a un hub DA-IPAM di scansionare e operare su reti cliente
**raggiungibili solo dietro l'agente**, via NetBird. Un tenant può
essere in modalità `agent_mode='remote'`: in quel caso l'esecuzione degli scan
e delle probe non avviene in-process sull'hub ma viene delegata all'agente sul
campo. La pagina di overview è `/agents`. Multi-agent per tenant supportato.

## Funzioni principali

- **Anagrafica agenti** (hub `tenant_agents`): label, hostname (nome NetBird o
  IP, niente schemi), porta (default 8443), `subnet_match`, versione, last seen.
  Un tenant con almeno un agente passa automaticamente a `agent_mode='remote'`.
- **CRUD agenti**: creazione/aggiornamento/cancellazione via `/api/tenant-agents`
  e `/api/tenant-agents/[id]`.
- **Token lifecycle**: generazione/import del token agente
  (`/api/tenant-agents/[id]/token`, `.../token/import`). Token cifrato AES-GCM
  (`token_encrypted`), mai esposto in lista (`has_token` boolean).
- **Test connessione**: `/api/tenant-agents/[id]/test` decifra il token e chiama
  `/whoami` sul remoto via NetBird (timeout 5s), ritornando latency, label,
  scopes, tenant_code o un `error_code` strutturato.
- **Overview cross-tenant**: `/api/agents` lista tutti gli agenti di tutti i
  tenant (admin), una riga per agente, per la pagina `/agents`.
- **Executor astratto**: `getExecutor()` ritorna `LocalExecutor` (in-process) o
  `RemoteExecutor` per i tenant remoti; se `agent_mode='remote'` ma nessun agente
  configurato → errore esplicito. Disaccoppia l'orchestrazione (hub) dall'I/O di
  rete verso il cliente (agente).

## Come si usa

1. **Creazione agente**: dalla pagina `/agents` (dialog "Nuovo agente") si
   associa un agente a un tenant con label + hostname (nome NetBird) + porta +
   `subnet_match`.
2. **Token**: si genera o si importa il token; viene cifrato e salvato.
3. **Test**: "Test connessione" chiama `/whoami` sul remoto e mostra
   latency/scopes/esito.
4. **Operatività**: per i tenant remoti scan e probe del core IPAM vengono
   eseguiti dal `RemoteExecutor` attraverso l'agente.

## Architettura e integrazioni

- DA-IPAM (hub) gira in **systemd**. Gli agenti sono nodi separati raggiunti via
  **NetBird** (nome `*.netbird.selfhosted`), porta default 8443; l'agente parte
  solo con l'interfaccia `wt0` e accetta solo la rete NetBird dell'account.
- Anagrafica e token degli agenti vivono sull'**hub** (`tenant_agents`,
  `db-hub-schema.ts`), non sul DB tenant.
- L'astrazione `Executor` (`src/lib/executor/`) è il punto di innesto: stessa
  interfaccia per locale e remoto, così discovery/DNS/nmap/health funzionano in
  entrambe le modalità.
- Si integra direttamente con il Core IPAM (esecuzione scan) ed è correlato allo
  Scanner-Edge (l'edge può fare da agente/scanner sul campo).

## File chiave

- `src/app/(dashboard)/agents/page.tsx` — overview agenti (client).
- `src/app/api/agents/route.ts` — lista cross-tenant.
- `src/app/api/tenant-agents/route.ts` + `[id]/route.ts` — CRUD agenti.
- `src/app/api/tenant-agents/[id]/token/route.ts` + `token/import/route.ts` — token.
- `src/app/api/tenant-agents/[id]/test/route.ts` — `/whoami` via NetBird.
- `src/lib/executor/{index,local,remote}.ts` — astrazione esecuzione locale/remota.
- `src/lib/db-hub-schema.ts` — tabella `tenant_agents`.
- `src/lib/db-hub.ts` — `getTenantAgents`, `getAllTenantAgentsWithInfo`,
  `getFirstTenantAgent`, `createTenantAgent`, `updateTenantAgentConfig`.
