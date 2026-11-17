# DNS di Active Directory, passo 1: sola lettura e anomalie — piano di esecuzione

> Si esegue in linea (una sessione che esegue i task in ordine). Le caselle tengono il conto.

**Obiettivo:** DA-IPAM legge dai DC le zone DNS forward e reverse, le tiene in archivio accanto alle concessioni DHCP di AD e mostra, coi nomi, le voci doppie, incoerenti o in disaccordo con quello che DA-IPAM vede in rete.
**Architettura:** la lettura passa dallo stesso collegamento LDAP della sincronizzazione di AD (`connectLdap`), sulle partizioni `DomainDnsZones`, `ForestDnsZones` e `CN=MicrosoftDNS,CN=System`. I record finiscono in due tabelle del cliente, riscritte a ogni sincronizzazione riuscita. Le anomalie non si salvano: le calcola una funzione pura al momento della lettura, dai record in archivio e dagli host.
**Spec:** nessuna a parte. Richiesta e decisioni di Riccardo in `TASKS.md`, sezione «2026-11-17 — Idea: DNS di Active Directory»; misura di partenza con `scripts/misura-dns-ad.ts`.
**Livello di controllo:** leggero (proposto, da confermare): più tappe su un progetto in esercizio, ma solo letture verso il DC e tabelle nuove.
**Stato:** bozza · **Ultimo aggiornamento:** 2026-11-17

## Vincoli globali

- **Solo lettura verso il DC.** Nessuna scrittura LDAP, nessun comando WinRM. Le correzioni sono il passo 2, zona rossa, con un piano suo.
- **Solo i record degli host**: A, AAAA, CNAME, PTR (Riccardo, 17/11). Fuori SRV, NS, SOA, le zone `_msdcs*`, `RootDNSServers`, `..TrustAnchors`, l'apice `@`, i nomi che cominciano con `_`, `DomainDnsZones` e `ForestDnsZones`.
- **Una lettura fallita non svuota l'archivio**: partizione non letta o errore LDAP lasciano i record di prima e l'errore si vede in pagina con la data dell'ultima lettura riuscita. «Partizione inesistente» (codice LDAP 32) non è un errore.
- **Ogni colonna che fa da chiave esterna ha il suo indice** (incidente del 17/11 su `attribution_evidence`).
- Ogni rotta apre con la guardia del suo contratto dentro `withTenantFromSession` (`.claude/rules/api-routes.md`); letture del database solo dalle funzioni di `db-tenant.ts` (`.claude/rules/db-access.md`).
- Interfaccia in italiano, scala dei testi e componenti del progetto (`.claude/rules/interfaccia.md`). **Riccardo è daltonico**: i tipi di anomalia si distinguono per etichetta e forma, mai solo per colore.
- Niente nomi di host o IP nei log.
- Prove mirate sui file toccati, sotto i 2 minuti. Il cancello completo gira una volta, prima della promozione su `main`, che resta di Riccardo.

## Casi da non dimenticare

1. Nodo con più record sullo stesso nome (round robin, più A): sono più righe, non una. Task 1.
2. Zona reverse larga (`168.192.in-addr.arpa`) con nodo a due etichette (`25.4`): l'IP si ricompone lo stesso. Task 1.
3. Record statico: `TimeStamp` a zero, nessuna data di rinnovo. Task 1.
4. Due integrazioni AD nello stesso cliente: i record restano separati per integrazione. Task 2.
5. Sincronizzazione che fallisce a metà: archivio di prima intatto. Task 2.

## Decisioni proposte, da confermare con l'approvazione

- **Dove si vede**: scheda «DNS» nella pagina Active Directory, subito dopo «DHCP». La pagina `/dns` esistente resta com'è (è quella di PowerDNS).
- **Quando si legge**: insieme alla sincronizzazione di AD (job `ad_sync` e pulsante «Sincronizza»), dopo le concessioni DHCP.
- **«È voluto»**: su un'anomalia si può segnare che va bene così (un alias, un round robin), con una nota. Si scrive solo nel database di DA-IPAM e la voce esce dall'elenco.
- **Meno rumore di serie**: «IP che DA-IPAM non conosce» conta solo gli IP dentro una rete censita; «host senza nome in DNS» conta solo gli host che sono computer di AD o hanno già un nome in DA-IPAM.

---

### [ ] Task 1 — Lettura e interpretazione dei record

**File:** crea `src/lib/ad/dns/record.ts`, `src/lib/ad/dns/lettura.ts`, `src/lib/ad/dns/__tests__/record.test.ts`; modifica `scripts/misura-dns-ad.ts` perché usi queste funzioni invece delle sue copie.

**Interfacce prodotte:**

```ts
export type TipoRecordDns = "A" | "AAAA" | "CNAME" | "PTR";
export interface VoceDns {
  zona: string; nome: string; fqdn: string; tipo: TipoRecordDns;
  dato: string;            // A: IPv4; AAAA: IPv6; CNAME e PTR: nome senza punto finale, minuscolo
  ip: string | null;       // A: l'IP; PTR: l'IP ricavato da nome e zona; altrimenti null
  statica: boolean; rinnovataIl: string | null; ttl: number;
}
export interface ZonaDns { nome: string; inversa: boolean; partizione: "dominio" | "foresta" | "sistema" }
export function leggiRecord(b: Buffer, adesso: Date): Pick<VoceDns, "tipo" | "dato" | "statica" | "rinnovataIl" | "ttl"> | null;
export function ipDaPtr(nome: string, zona: string): string | null;
export interface LetturaDnsAd { zone: ZonaDns[]; voci: VoceDns[]; partizioniLette: number; errori: string[] }
export async function leggiDnsAd(client: Client, baseDn: string): Promise<LetturaDnsAd>;
```

**Cosa fare:** portare qui `leggiRecord`, `nomeDns`, `ipDaPtr` e il ciclo sulle tre partizioni dallo script. Struttura del record di AD: lunghezza dei dati (2 byte, little endian), tipo (2), versione, rango, flag (2), seriale (4), TTL (4, big endian), riservato (4), ora del rinnovo (4, ore dal 1601, zero = statico), poi i dati. Tipi letti: 1 A, 5 CNAME, 12 PTR, 28 AAAA. Le zone si leggono con `(objectClass=dnsZone)`, così una zona senza record degli host compare lo stesso. `errori` porta i messaggi delle partizioni non lette, senza il codice 32.

**Verifica:** `node --import tsx --test src/lib/ad/dns/__tests__/record.test.ts`, con buffer costruiti nella forma vera: un A dinamico, un A statico, un PTR in zona `/24` e uno in zona `/16`, un CNAME, un tipo non letto (SRV) che dà `null`, un buffer troppo corto che dà `null`.

**Commit:** «DNS di AD: lettura dei record degli host».

### [ ] Task 2 — Archivio e aggancio alla sincronizzazione

**File:** modifica `src/lib/db-tenant-schema.ts` e `src/lib/db-tenant.ts` (tabelle, migrazione idempotente, funzioni), `src/lib/db.ts` (deleghe), `src/lib/transfer/table-registry.ts` (le due tabelle, `scope: "tenant"`, `tier: "mirror"`, come `ad_dhcp_leases`), `src/lib/ad/ad-client.ts` (chiamata dopo `syncAdDhcpLeases`, riga 444); crea `src/lib/ad/dns/__tests__/archivio.test.ts`.

**Tabelle:**

```sql
CREATE TABLE IF NOT EXISTS ad_dns_zone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, inversa INTEGER NOT NULL DEFAULT 0, partizione TEXT NOT NULL,
  letta_il TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(integration_id, nome)
);
CREATE TABLE IF NOT EXISTS ad_dns_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  zona TEXT NOT NULL, nome TEXT NOT NULL, fqdn TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('A','AAAA','CNAME','PTR')),
  dato TEXT NOT NULL, ip TEXT, statica INTEGER NOT NULL DEFAULT 0,
  rinnovata_il TEXT, ttl INTEGER NOT NULL DEFAULT 0,
  letta_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_dns_record_integrazione ON ad_dns_record(integration_id, tipo);
CREATE INDEX IF NOT EXISTS idx_ad_dns_record_ip ON ad_dns_record(ip);
CREATE INDEX IF NOT EXISTS idx_ad_dns_record_fqdn ON ad_dns_record(fqdn);
CREATE TABLE IF NOT EXISTS ad_dns_voluti (
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  chiave TEXT NOT NULL, nota TEXT, da TEXT, il TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (integration_id, chiave)
);
```

Le date in forma `datetime('now')`, mai `toISOString()`. Su `ad_integrations` due colonne nuove con `ALTER` guardato da `pragma_table_info`: `dns_letto_il TEXT`, `dns_errore TEXT`.

**Interfacce prodotte:**

```ts
export function sostituisciDnsAd(integrationId: number, zone: ZonaDns[], voci: VoceDns[]): void; // una transazione: cancella e riscrive
export function segnaEsitoDnsAd(integrationId: number, errore: string | null): void;
export function getZoneDnsAd(integrationId: number): RigaZonaDns[];
export function getRecordDnsAd(integrationId: number): RigaRecordDns[];
export function getRecordDnsAdPaginati(integrationId: number, pagina: number, perPagina: number, filtri: { cerca?: string; tipo?: TipoRecordDns; zona?: string }): { rows: RigaRecordDns[]; total: number };
export function getVolutiDnsAd(integrationId: number): { chiave: string; nota: string | null; da: string | null; il: string }[];
export function segnaVolutoDnsAd(integrationId: number, chiave: string, nota: string | null, da: string | null): void;
export function togliVolutoDnsAd(integrationId: number, chiave: string): void;
export async function syncAdDns(integration: AdIntegration, client: Client): Promise<number>; // in ad-client.ts
```

**Cosa fare:** `syncAdDns` chiama `leggiDnsAd`; se `partizioniLette === 0` o `errori.length > 0` chiama `segnaEsitoDnsAd(id, messaggio)` e **non** tocca i record; altrimenti `sostituisciDnsAd` e `segnaEsitoDnsAd(id, null)`. Dentro `syncActiveDirectory` sta in un suo `try`: un guasto del DNS non fa fallire la sincronizzazione di utenti e computer. `AdSyncResult` prende `dns_records: number`.

**Verifica:** `node --import tsx --test src/lib/ad/dns/__tests__/archivio.test.ts` su un database temporaneo: due integrazioni restano separate; una seconda scrittura sostituisce la prima; con una lettura che porta errori i record di prima restano e `dns_errore` è scritto. Poi `npx tsx scripts/audit-db-drift.ts` senza differenze fra schema e migrazione.

**Commit:** «DNS di AD: archivio e lettura a ogni sincronizzazione».

### [ ] Task 3 — Le anomalie

**File:** crea `src/lib/ad/dns/anomalie.ts`, `src/lib/ad/dns/__tests__/anomalie.test.ts`.

**Interfacce prodotte:**

```ts
export type TipoAnomaliaDns =
  | "ip_piu_nomi" | "nome_piu_ip" | "a_senza_ptr" | "a_senza_zona_inversa"
  | "ptr_altro_nome" | "ptr_senza_a" | "ip_piu_ptr" | "cname_rotto"
  | "nome_diverso" | "host_spento" | "ip_sconosciuto" | "host_senza_nome";
export interface AnomaliaDns {
  tipo: TipoAnomaliaDns; chiave: string;   // `${tipo}:${ip o fqdn}`, stabile fra una lettura e l'altra
  ip: string | null; nomi: string[]; hostId: number | null;
  dettaglio: string;                        // frase in italiano, es. «in DA-IPAM questo IP si chiama …»
  tuttoStatico: boolean;
}
export interface HostPerDns { id: number; ip: string; hostname: string | null; status: string; last_seen: string | null; inAd: boolean }
export function anomalieDns(dati: {
  zone: ZonaDns[]; voci: VoceDns[]; host: HostPerDns[]; reti: string[]; // CIDR censiti
  voluti: Set<string>; adesso: Date; giorniSpento?: number;            // 30 di serie
}): AnomaliaDns[];
```

**Cosa fare:** le stesse regole dello script, una voce per caso invece di un conteggio. In più: `ip_sconosciuto` solo per IP dentro una delle `reti`; `host_senza_nome` solo per host accesi con `inAd` o con `hostname`; il confronto dei nomi è sul nome corto, minuscolo; le chiavi in `voluti` si saltano.

**Verifica:** `node --import tsx --test src/lib/ad/dns/__tests__/anomalie.test.ts`, un caso per tipo più: round robin segnato voluto che sparisce; IP fuori dalle reti che non conta; apparato acceso senza nome e fuori da AD che non conta.

**Commit:** «DNS di AD: calcolo delle anomalie».

### [ ] Task 4 — Rotte e scheda «DNS» in Active Directory

**File:** crea `src/app/api/ad/[id]/dns/route.ts` (GET), `src/app/api/ad/[id]/dns/voluti/route.ts` (POST, DELETE), `src/app/(dashboard)/active-directory/scheda-dns.tsx`; modifica `src/app/(dashboard)/active-directory/page.tsx` (scheda dopo «DHCP», righe 936-939).

**Rotte:** `GET /api/ad/[id]/dns?vista=anomalie|record&tipo=&zona=&cerca=&page=&pageSize=` con `requireAuth`: risponde `{ letto_il, errore, zone, conteggi: Record<TipoAnomaliaDns, number>, anomalie }` oppure `{ rows, total }`. `POST` e `DELETE /api/ad/[id]/dns/voluti` con `requireAdmin`, corpo `{ chiave, nota? }` validato con Zod.

**Oggetti della scheda, dall'alto:**
1. Riga di stato: «Letto il …» e numero di zone e record; se `errore`, un avviso con il testo e la data dell'ultima lettura riuscita.
2. Riquadri dei conteggi, uno per tipo di anomalia con più di zero casi, con etichetta per esteso («Stesso IP, più nomi»). Premendo un riquadro si filtra l'elenco.
3. Elenco delle anomalie: tipo (etichetta con icona, non solo colore), IP, nomi nel DNS, cosa dice DA-IPAM, «statico» o data del rinnovo; collegamento alla scheda dell'host quando c'è; comando «È voluto» con nota, solo per l'amministratore.
4. Sotto, a comparsa, «Tutti i record»: tabella con ricerca, filtro per tipo e per zona, 25 per pagina.
5. Nessun comando di correzione: una riga dice che arriveranno con il passo 2.

**Verifica:** `npx eslint` e `npx tsc --noEmit` sui file toccati; pagina aperta in locale e **una** schermata a 1920.

**Commit:** «DNS di AD: scheda in Active Directory».

### [ ] Task 5 — Rilascio su dev e riscontro sul 70791

**Cosa fare:** `CHANGELOG.md` col perché; `CONTEXT.md` (cosa legge, la regola «lettura fallita non svuota», dove sta la scheda); `docs/scheda-mappa.md` se cambia la riga «prossimo»; `npm run version:release -- --staged-only`, `git push origin dev`. Su 192.168.4.8, dopo l'aggiornamento, «Sincronizza» sull'integrazione del 70791.

**Verifica:** sul database del 70791 i record per tipo coincidono con lo script lanciato nello stesso momento (il 17/11 erano A 203, PTR 149, CNAME 7); `journalctl -u da-ipam.service` senza errori della sincronizzazione; la scheda si apre e mostra i nomi. `main` non si tocca.

**Commit:** quello del rilascio.

---

## Fuori da questo piano

- **Passo 2, correzioni**: scrittura sul DC via WinRM, una voce alla volta, con conferma a schermo (Riccardo, 17/11). Zona rossa, livello completo, piano a parte. Ancora da decidere: con quale utenza e cosa fare delle voci statiche del cliente.
- DNS non integrato in AD (zone su file) e DNS di altri prodotti.

## Registro

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo
