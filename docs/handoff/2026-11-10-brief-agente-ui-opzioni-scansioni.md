# Brief per l’agente UI — Scansioni: opzioni per modalità

Il motore è in **v0.9.1079** su `origin/dev`. Tu aggiungi solo i controlli in pagina e li mandi
nel POST. Non copiare Nety (GPL-3.0): idee sì, codice no. Usa `console.tsx` e `docs/STILE-UI.md`.
Mai push su `main`. Dopo il codice: `npm run version:release -- --staged-only` e
`git push origin HEAD:dev`. Testo UI in italiano, ≥ 13 px. shadcn v4: niente `asChild`,
`render={<Link />}`.

## Cosa è già fatto (non toccare)

Pagina `src/app/(dashboard)/scans/scans-client.tsx` (v0.9.1076+):

- Tipo, profilo, fasi Su misura, conferma Completo, scelta reti, levetta «Prove invasive»
  (`prove_fabbrica`), avanzamento `ScanProgress`, «Giri in corso», Storico.
- `POST /api/scans/lancia` (admin) passa già tutto il JSON a `lanciaGiro`.
- Costanti client-safe in `src/lib/scanner/profili-giro-ui.ts`:
  `SCAN_MODE_GIRO`, `PRESET_PORTE_GIRO`, `SRC_PORT_GIRO`, `PROTOCOLLI_SEG` (+ etichette tipi/profili).
- **Non** importare `opzioni-giro.ts` né `lancia-giro.ts` nel client (Node/DB).

File da toccare: **`scans-client.tsx`**. Al massimo un pezzo locale nello stesso file. Niente pagine
Hosts/Assets nuove. `/inventory` resta cespite.

## Come mandare i campi (trappole)

- **Numeri in JSON come number, non stringa.** `<input type="number">` dà stringhe: fai
  `Number(...)` / `parseInt(..., 10)` prima del `JSON.stringify`. Se mandi `"5000"` l’API risponde
  400 (`timeout_ms deve essere un intero tra 500 e 60000`).
- **Campi assenti = default del profilo.** Non mandare `null`, `""` o `0` “per pulizia”.
  Ometti la chiave se l’utente non ha scelto nulla.
- Toast: `fetchJson` mostra già `error` del server. Non inventare messaggi paralleli.
- Giri automatici / scheduler: non ci passano da questa pagina. Non cambiare altro.

---

## Discovery (`tipo: "discovery"`)

Sezione **«Targets e parametri»** nel profilo **Su misura** (come da piano UI). Sui profili
Rapido/Standard/… non serve: restano i default.

| Campo | Tipo | Range / valori | Se assente |
|---|---|---|---|
| `timeout_ms` | number | 500–60000 | default motore |
| `concorrenza` | number | 1–256 | default motore |
| `targets` | string | IPv4 o CIDR IPv4 `/16`–`/32`, spazio o virgola | tutti gli host delle reti scelte |
| `exclusions` | string | stesso formato | nessuno |
| `auto_targets` | boolean | default **true** | true = unione prefisso rete ∪ targets |
| `tcp_ports` | string | `top100` \| `top1000` \| `all` \| `22,80,8000-8100` | porte del profilo |
| `udp_ports` | string | idem; `""` = niente UDP | **niente UDP** (anche su Standard) |
| `scan_mode` | string | `auto` \| `syn` \| `connect` | auto/connect del profilo |
| `rate_pps` | number | 10–10000 | default profilo (Lento = 300) |
| `retries` | number | 0–5 | default nmap |

Regole:

- `auto_targets: false` senza `targets` → 400 «Senza auto_targets indica almeno un bersaglio».
  Checkbox «Includi tutti gli host della rete» **accesa di serie**.
- Un IP/CIDR in `targets` deve cadere in una delle reti scelte (`network_ids`), senno 400
  «Un bersaglio è fuori dalle reti scelte».
- `tcp_ports: "all"` (o profilo Completo) → stesso checkbox `conferma_completo: true`.
- Elenco custom: max **4096** porte; intervalli `a-b`. Le porte di stampa (9100/515/…) le toglie
  il motore da solo: non promettere in UI che si sondano.
- `scan_mode: "syn"` senza root sulla macchina → 400
  «scan_mode syn richiede privilegi di root sulla macchina». Mostra il toast, niente fallback
  silenzioso a connect.
- CIDR più largo di `/16` o IPv6 → 400. Placeholder es. `10.0.1.0/24, 10.0.1.10`.
- **UDP parte solo se mandi `udp_ports` non vuoto.** Non mandare UDP “per allinearti al profilo
  Standard”: oggi `/scans` senza quel campo non fa UDP.

Esempio body (solo chiavi valorizzate):

```json
{
  "tipo": "discovery",
  "profilo": "su_misura",
  "network_ids": [3],
  "fasi": ["host", "porte", "sonde"],
  "targets": "10.0.1.10, 10.0.1.0/28",
  "exclusions": "10.0.1.1",
  "auto_targets": false,
  "tcp_ports": "22,80,443,8000-8100",
  "scan_mode": "connect",
  "rate_pps": 400,
  "retries": 1,
  "timeout_ms": 3000,
  "concorrenza": 32
}
```

---

## Segmentazione (`tipo: "segmentazione"`)

Oggi `serveRete` è false: non si sceglie nessuna rete. Serve un pannello **sempre visibile**
per questo tipo (non solo Su misura).

1. **Rete sorgente** (una): `source_network_id` (id numerico).
2. **Reti da raggiungere** (checkbox, zero o più): `reti_bersaglio: number[]`.
   Vuoto / omesso = tutte le altre, come oggi.

GET **`/api/scans/reti-bersaglio`** (utente loggato, non solo admin):

```json
{
  "reti": [
    { "id": 1, "name": "LAN", "cidr": "10.0.1.0/24", "vlan_id": 10, "servizi": 12, "host": 40 }
  ]
}
```

Etichetta per checkbox: nome + `font-mono` CIDR + «N servizi · M host noti».
Carica questo GET quando il tipo è Segmentazione. Vuoto/errore: `Vuoto` / `LoadError`.

**Tecniche da auditor** — l’API le accetta ma **rifiuta con 400** finché la sonda non le sa
(«Questa tecnica da auditor non è ancora disponibile sulla sonda»). In pagina:

- mostrale **spente e disabilitate**, raggruppate: protocollo / porta sorgente / routing / L2;
- una riga: «Non ancora disponibile sulla sonda»;
- **non mandarle** nel POST;
- L2: avviso «può disturbare lo switch» anche da spento.
- Valori (per quando si sbloccheranno, non oggi):
  - `protocollo`: `direct` (default) \| `icmp_echo` \| `ipv6` \| `fragmented_syn`
  - `src_port`: sottoinsieme di `[53, 88, 123, 20, 67, 500]`
  - `via_local_gateway`, `via_other_next_hop`, `l2_active` (bool)
  - `l2_active: true` senza `conferma_l2: true` → 400 sulla conferma, prima dell’auditor.

`network_ids` per questo tipo non serve. Non riusare il pannello «Reti» della Discovery
(una cosa si dice una volta: sorgente ≠ elenco reti da scansionare).

---

## Sonda L2 (`tipo: "sonda_l2"`)

Un campo **Durata (secondi)**: `durata_s`, intero **1–600**.
Assente = sync immediato (comportamento attuale).
Se valorizzato: il POST **torna subito** con messaggio tipo «Ascolto per N secondi»;
il sync parte dopo, in sottofondo. Non tenere il pulsante bloccato per N secondi.
Niente reti.

---

## Solo controlli

Già fatto (`fasi` + `prove_fabbrica`). Nessun knob nuovo. Non nascondere la levetta invasiva.

---

## Errori da mostrare così come arrivano (italiano, senza IP)

400/409, campo `error`. Esempi:

- `timeout_ms deve essere un intero tra 500 e 60000`
- `scan_mode syn richiede privilegi di root sulla macchina`
- `Tutte le porte non partono da sole: conferma che vuoi tutte le 65.535 porte TCP`
- `Senza auto_targets indica almeno un bersaglio`
- `Un bersaglio è fuori dalle reti scelte`
- `targets: solo indirizzi o reti IPv4`
- `targets: il prefisso deve essere tra /16 e /32`
- `Questa tecnica da auditor non è ancora disponibile sulla sonda`
- `L2 attivo può disturbare lo switch: serve una conferma esplicita`
- `Un giro di segmentazione è già in corso` (409)
- `Rete sorgente non trovata`

Blocca in pagina (come già Completo) prima del POST: conferma Completo/`all`, almeno una rete
per Discovery/controlli, durata nel range se compilata, timeout/concorrenza/rate interi nel range.

---

## Stile

`docs/STILE-UI.md` + mattoni `src/components/shared/console.tsx`.
Pannelli numerati, `VoceSelezionabile` per scelte, checkbox/input ≥ 13 px, CIDR/IP/porte in
`font-mono`. Levetta invasiva resta nel box giallo con `Etichetta tono="ruolo"` «▲ invasiva».
Niente `Tabs` di shadcn. Niente colori Tailwind “di significato” (`bg-green-500` & co.).
Riccardo è daltonico: stato = segno + fondo, non solo tinta.

## Verifica

Apri `/scans` da admin, un giro per tipo:

1. Discovery Su misura: targets + timeout; campo vuoto omesso; `syn` (attendi 400 se non root).
2. Segmentazione: GET conteggi, una sorgente, due bersagli; interruttori auditor visibili ma off.
3. Sonda L2: senza durata (sync subito) e con `durata_s: 5` (POST immediato).
4. Completo senza spunta resta bloccato. Prove invasive invariate.
5. Desktop e stretto: niente scroll orizzontale.

Non lanciare giri lunghi sulla rete del cliente per collaudare: i 400 si vedono senza nmap.
