/**
 * misura-cavi.ts — i numeri del capitolo 13 della spec della topologia su una COPIA del DB di un tenant (pezzo T1.0,
 * spec §13.12.1). Copia della copia in una cartella di lavoro dentro --cartella (stesse guardie di misura-topologia);
 * migrazioni applicate lì; stampa solo conteggi. Con --nomi stampa anche i nomi, a terminale: mai su un file del repo.
 *
 * Uso:  npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad>
 *         [--scenario S0|S1|S3:<id>|S4|S9:<id>:<porta>:<fonte>|S12:<id>:<vmid>] [--soglia <giorni>]
 *         [--uscita-router <id>=<file>]...   righe nuove del router dall'uscita incollata (lettore di T1), insieme alle vecchie
 *         [--ripristino <ora UTC>]   dopo le righe nuove del router, lo stesso testo SQL di «Tornare indietro» (Task 10b)
 *         [--fatti-prova <id>]   T2: fatti dei MikroTik (fixture anonime del repo) e vicini con le fonti nuove (ssh, snmp) sull'apparato <id>, nella copia della copia
 *         [--traccia]   T2: «Cosa cambierebbe con la mappa nuova» (numeri; con --nomi le righe a terminale)
 *         [--cavi]   T3, Task 0: i collegamenti del modello per cavo (numeri; con --nomi riga per riga a terminale)
 *         [--mappa-cavi]   T3, Task 6: la mappa nuova (una linea per collegamento) con l'interruttore acceso in memoria:
 *                          tempo, impronta, albero della mappa automatica contro quello di oggi, ritocchi per mappa (R2)
 *         [--salva-cavi <file.json>] [--confronta-cavi <file.json>]   i padri della mappa nuova, salvati o confrontati
 *         [--salva <istantanea.json>] [--confronta <istantanea.json>]
 *         [--esporta-input <file.json>] [--input-json <file.json>] [--nomi] [--json]
 *         [--senza-regola <regola>]...   spegne una regola del passaggio universale (src/lib/topology/regole.ts): la misura C19 confronta «tutte le regole» con «tutte meno una»
 *         [--unisci <id>,<id>[,…]]...   unioni a mano (ADR 0021) IN MEMORIA, un gruppo per volta (gruppi -1, -2, …; «host:N» o «dev:N»,
 *                                       come le scriverebbe la rotta): nessuna riga scritta, valgono per T1, --mappa-cavi e --traccia
 *         [--separa <host:N>=<dev:N|host:N>]...   una separazione a mano in memoria, come sopra
 *         [--unioni]   la sezione «unioni»: righe nel DB (copia della copia, dopo la migrazione), ciò che c'è già di «stesso oggetto»
 *                      (collegamenti a mano per le scansioni, apparati e host dello stesso apparato fisico), fusioni per motivo;
 *                      con --unisci/--separa il confronto in memoria. Solo conteggi e id; con --nomi i nomi a terminale
 *         [--adesso "AAAA-MM-GG HH:MM:SS"]   l'ora (UTC) a cui il modello giudica «non visto»: quella del «prima», per misurare il
 *                                            «dopo» sulla stessa copia con lo stesso orologio (di base l'ora vera; vale anche con --input-json)
 *   I file di --salva, --confronta, --salva-cavi, --confronta-cavi, --esporta-input e --input-json stanno dentro --cartella
 *   (dati del cliente).
 *   Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi, percorsoReale } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const CON_VALORE = ["--cartella", "--scenario", "--soglia", "--uscita-router", "--ripristino", "--fatti-prova", "--salva", "--confronta", "--salva-cavi", "--confronta-cavi", "--esporta-input", "--input-json", "--senza-regola", "--adesso", "--unisci", "--separa"];

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad> [--scenario …] [--uscita-router <id>=<file>] [--ripristino <ora UTC>] [--fatti-prova <id>] [--traccia] [--cavi] [--mappa-cavi] [--salva-cavi|--confronta-cavi <file>] [--senza-regola <regola>] [--adesso <ora UTC>] [--unisci <id>,<id>…] [--separa <host:N>=<id>] [--unioni] [--salva|--confronta <file>] [--esporta-input|--input-json <file>] [--nomi] [--json]\n");
  return 2;
}

function dentro(file: string, cartella: string): boolean {
  const rel = path.relative(percorsoReale(cartella), percorsoReale(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Le copie del DB fatte da questo giro (320 MB sul cliente A, 2 GB sull'hub): si tolgono a fine giro, comunque vada; resta il registro. */
const copie: string[] = [];

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const valori = (k: string): string[] => a.flatMap((x, i) => (x === k && a[i + 1] !== undefined ? [a[i + 1]] : []));
  const val = (k: string): string | undefined => valori(k)[0];
  const liberi = a.filter((x, i) => !x.startsWith("--") && !CON_VALORE.includes(a[i - 1] ?? ""));
  const cartella = val("--cartella");
  if (!cartella || liberi.length !== 1) return uso();
  for (const k of ["--salva", "--confronta", "--salva-cavi", "--confronta-cavi", "--esporta-input", "--input-json"]) {
    const f = val(k);
    if (f && !dentro(f, cartella)) return uso(`${k} deve stare dentro --cartella: i dati del cliente non escono dallo scratchpad.`);
  }
  const {
    applicaScenario, conteggi, leggiAdesso, leggiScenario, lettureVm, lineeCucite, lineeDaNomeScelto, padriCambiati, padriDi, soloProveAggiunte, sottoUnaSuaVm, teste, testeCambiate, vistiSoloViaLldp,
  } = await import("../src/lib/topology/misura");
  const scenario = leggiScenario(val("--scenario") ?? "S0");
  if (!scenario) return uso("Scenario non valido: S0, S1, S3:<id>, S4, S9:<id>:<porta>:<fonte>, S12:<id>:<vmid>.");
  const soglia = Number(val("--soglia") ?? "2");
  if (!Number.isInteger(soglia) || soglia < 1) return uso("--soglia: giorni interi, almeno 1.");
  const { NOMI_REGOLE, REGOLE_T1, leggiRegola } = await import("../src/lib/topology/regole");
  const senza = valori("--senza-regola");
  if (senza.some((r) => leggiRegola(r) === null)) return uso(`--senza-regola vuole una di: ${NOMI_REGOLE.join(", ")}.`);
  const regole = new Set([...REGOLE_T1].filter((r) => !senza.includes(r)));
  const adessoTesto = val("--adesso");
  const adesso = adessoTesto === undefined ? null : leggiAdesso(adessoTesto);
  if (adessoTesto !== undefined && adesso === null) return uso("--adesso vuole l'ora in UTC come la scrive il DB: «AAAA-MM-GG HH:MM:SS».");
  const uscite = valori("--uscita-router").map((v) => /^(\d+)=(.+)$/.exec(v));
  if (uscite.some((m) => m === null)) return uso("--uscita-router vuole <id dell'apparato>=<file>.");
  // Unioni e separazioni a mano (piano 2026-10-16, Task 3 Step 4): solo in memoria, mai nel DB del cliente («Solo a mano»).
  const OGGETTO = /^(host|dev):[1-9]\d{0,9}$/;
  const unisci = valori("--unisci").map((v) => v.split(",").map((x) => x.trim()));
  if (unisci.some((g) => g.length < 2 || new Set(g).size !== g.length || !g.every((x) => OGGETTO.test(x)))) {
    return uso("--unisci vuole almeno due oggetti diversi, «host:N» o «dev:N», separati da virgole.");
  }
  const separaLetti = valori("--separa").map((v) => /^(host:[1-9]\d{0,9})=((?:host|dev):[1-9]\d{0,9})$/.exec(v));
  if (separaLetti.some((m) => m === null)) return uso("--separa vuole <host:N>=<dev:N o host:N>.");
  const separa = separaLetti.map((m) => [m![1], m![2]] as [string, string]);
  const inMemoria = unisci.length > 0 || separa.length > 0;

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const lavoro = path.join(path.resolve(cartella), `misura-cavi-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  copie.push(dataDir, hubDb, `${hubDb}-wal`, `${hubDb}-shm`);
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${dest}-wal`);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  // I registri dell'app contengono nomi e indirizzi: vanno nel file di lavoro, non a schermo.
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);

  // Import dinamico voluto qui (come misura-topologia.ts): l'ambiente va impostato prima che db-tenant si carichi, e lo
  // script è un processo solo, fuori dall'app. ADR 0002 riguarda il runtime dell'app.
  const tenantDb = await import("../src/lib/db-tenant");
  const db = tenantDb.getTenantDb(tenant);
  // Come misura-topologia.ts: una riga di quick_check può portarne molte («*** in database main ***», poi una «Page N:
  // never used» per riga), e una pagina mai usata è spazio non referenziato, non un danno (l'hub ne ha 4, CONTEXT §6).
  // Si va a capo prima di giudicare: unite con «; », sulla copia dell'hub lo script usciva con 1 (verifica del 15/10).
  const righeQuick = (): string[] => (db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>)
    .flatMap((r) => r.quick_check.split("\n")).map((r) => r.trim()).filter((r) => r !== "" && r !== "*** in database main ***");
  const quick = (): string => righeQuick().join("; ");
  const out: Record<string, unknown> = { tenant, scenario: val("--scenario") ?? "S0", regole_spente: senza, quick_check_prima: quick() };

  // C18: le classificazioni degli host prima e dopo le righe nuove del router (l'upsert ricalcola l'attribuzione).
  const classi = () => new Map((db.prepare("SELECT id, COALESCE(classification, '') AS c FROM hosts").all() as Array<{ id: number; c: string }>).map((r) => [r.id, r.c]));
  let cambiati: number[] = [];
  if (uscite.length > 0) {
    const { parseMikrotikNeighbors } = await import("../src/lib/devices/mikrotik-vicini");
    const prima = classi();
    tenantDb.withTenant(tenant, () => {
      for (const m of uscite) tenantDb.upsertNeighbors(Number(m![1]), parseMikrotikNeighbors(fs.readFileSync(m![2], "utf8")));
    });
    const dopo = classi();
    cambiati = [...dopo].filter(([id, c]) => prima.get(id) !== c).map(([id]) => id);
    out.host_cambiati_di_categoria = cambiati.length;
  }

  // «Tornare indietro» (Task 10b, R6): sulla copia della copia, dopo le righe nuove del router, lo stesso testo SQL che si
  // manderebbe all'impianto. Solo conteggi.
  const ripristino = val("--ripristino");
  if (ripristino) {
    const { sqlApplica, sqlConta } = await import("../src/lib/topology/ripristino-vicini");
    out.righe_riportate_a_mndp = (db.prepare(sqlConta(ripristino)).all() as Array<{ righe: number }>).reduce((s, r) => s + r.righe, 0);
    db.exec(sqlApplica(ripristino));
  }

  // T2 (piano di T2, Task 12): «letture accese» con le fixture vere rese anonime, sulla copia della copia: i fatti dei
  // MikroTik sull'apparato dato e righe dei vicini con le fonti nuove. Il modello di oggi non le legge: `impronta_modello`
  // deve restare quella di «letture spente» (R7, I33). Nomi inventati: non toccano le righe vere (la chiave dei vicini non ha
  // la fonte, SN6).
  const fattiProva = val("--fatti-prova");
  if (fattiProva) {
    if (!/^\d+$/.test(fattiProva)) return uso("--fatti-prova vuole l'id di un apparato.");
    const stp = await import("../src/lib/devices/mikrotik-stp");
    const { parseMikrotikNeighbors } = await import("../src/lib/devices/mikrotik-vicini");
    const FX = path.join(process.cwd(), "src/lib/devices/__tests__/fixtures");
    const F = (n: string) => fs.readFileSync(path.join(FX, n), "utf8");
    const id = Number(fattiProva);
    const scritti = tenantDb.withTenant(tenant, () => {
      const r = tenantDb.scriviFattiTopologia(id, "device", stp.fattiMikrotik({
        interfacce: stp.parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: stp.parseBridge(F("mikrotik-mk3-testa.txt")),
        porteBridge: stp.parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: stp.parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
        monitorPorte: stp.parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: stp.parseFasci(F("mikrotik-mk8a-testa.txt")),
        monitorFasci: stp.parseMonitorFasci(F("mikrotik-mk8b-testa.txt")), istanze: null, monitorIstanze: null,
      }));
      tenantDb.upsertNeighbors(id, parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse-ssh.txt")), "ssh");
      tenantDb.upsertNeighbors(id, parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse.txt")).map((n) => ({ ...n, localPortIndex: 1, remoteCaps: "bridge" })), "snmp");
      return r;
    });
    out.fatti_prova = scritti ?? "schema assente";
  }

  const fileInput = val("--input-json");
  let letto: unknown = null;
  if (fileInput) {
    try { letto = JSON.parse(fs.readFileSync(fileInput, "utf8")); } catch { return uso("--input-json: file non leggibile."); }
  }
  const { buildTopologyModel } = await import("../src/lib/topology/model");
  const { computeMapView } = await import("../src/lib/topology/map-compute");
  const { centroLato } = await import("../src/lib/topology/map-screen");
  const { pathPoints } = await import("../src/lib/topology/edge-look");
  const { getSmoothStepPath, Position } = await import("@xyflow/react");
  type Input = ReturnType<typeof tenantDb.getTopologyModelInput>;
  const letta: Input = (letto as Input | null) ?? tenantDb.withTenant(tenant, () => tenantDb.getTopologyModelInput(soglia, adesso ?? Date.now()));
  // L'orologio della misura (revisione finale di T1): con --adesso quello del «prima», anche su un ingresso esportato.
  const base: Input = adesso === null ? letta : { ...letta, nowMs: adesso };
  out.adesso = new Date(base.nowMs).toISOString();
  const senzaScelte = applicaScenario(base, scenario);
  // Le righe in memoria si aggiungono prima di ogni calcolo: valgono per T1, --mappa-cavi e --traccia (piano 2026-10-16).
  const { aggiungiScelte, confrontoUnione, fusioniPerCome } = await import("../src/lib/topology/misura-unioni");
  const input = aggiungiScelte(senzaScelte, unisci, separa);
  const esporta = val("--esporta-input");
  if (esporta) fs.writeFileSync(esporta, JSON.stringify(input));

  let model = buildTopologyModel(input, regole);
  const tempi: number[] = [];
  // 30 giri, la mediana (C17): con 5 la misura appena dopo il primo giro ballava di qualche millisecondo, troppo per un margine
  // di 2-3 ms sui 20 (misura del 15/10 notte: 5 giri 15,4 / 18,5 / 21,2 ms, 30 giri 13,5 / 16,9 / 18,0 per oggi, T1 e T1b).
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    model = buildTopologyModel(input, regole);
    tempi.push(performance.now() - t0);
  }
  out.modello_ms = Math.round(mediana(tempi) * 10) / 10;
  // T2 (I33): l'impronta del modello di oggi. Con le letture spente e con quelle accese (--fatti-prova) deve essere la stessa.
  out.impronta_modello = crypto.createHash("sha256").update(JSON.stringify(model)).digest("hex").slice(0, 16);

  const viste = tenantDb.withTenant(tenant, () => ({
    auto: tenantDb.getAutoMap(), autoVista: tenantDb.getTopologyMapView("auto"),
    mappe: tenantDb.listTopologyMaps().map((m) => ({ m, v: tenantDb.getTopologyMapView(`mappa:${m.id}`) })),
  }));
  const auto = computeMapView(model, {
    auto: true, members: [], roots: [], head: viste.auto?.head_node ?? null, tweaks: viste.autoVista.tweaks, expanded: new Set(), orientation: viste.autoVista.orientation,
  });
  const POS = { su: Position.Top, giu: Position.Bottom, sx: Position.Left, dx: Position.Right } as const;
  const percorsoOggi = (s: { x: number; y: number; w: number; h: number }, la: keyof typeof POS, t: { x: number; y: number; w: number; h: number }, lb: keyof typeof POS) => {
    const ps = centroLato(s, la), pt = centroLato(t, lb);
    const [d] = getSmoothStepPath({ sourceX: ps.x, sourceY: ps.y, sourcePosition: POS[la], targetX: pt.x, targetY: pt.y, targetPosition: POS[lb], borderRadius: 0 });
    return pathPoints(d);
  };
  const numeri = conteggi(input, model, auto, percorsoOggi);
  out.conteggi = numeri;
  // R1: su quale lettura delle VM è fatta la misura (per apparato scansionato, la data della scansione più recente).
  out.letture_vm = lettureVm(input);
  // C19, H17: la testa proposta della mappa automatica e quella di ogni sede (id, non nomi).
  const leTeste = teste(model);
  out.teste = leTeste;
  // R2: ritocchi validi e scaduti, e oggetti persi, per mappa E per orientamento (gli id delle mappe, non i nomi). Una
  // mappa salvata in verticale può avere i ritocchi in orizzontale (la sede 1 del cliente A ne ha 7, R2), e
  // `layout.expired` conta solo l'orientamento in uso: si calcola in quello salvato e in ogni altro che ha ritocchi
  // (verifica del 15/10: calcolata solo nel suo, la mappa della sede 1 dava 0 ritocchi).
  const ORIENTAMENTI = ["lr", "tb"] as const;
  // Lo stesso conto per il modello di oggi e, con --mappa-cavi, per la mappa nuova (stesse mappe salvate, stessi ritocchi).
  const ritocchiPerMappa = (mod: typeof model) => [
    { vista: "auto", base: { auto: true, members: [] as string[], roots: [] as string[], head: viste.auto?.head_node ?? null }, tweaks: viste.autoVista.tweaks, salvato: viste.autoVista.orientation },
    ...viste.mappe.map(({ m, v }) => ({ vista: `mappa:${m.id}`, base: { auto: false, members: v.nodes, roots: m.roots, head: null }, tweaks: v.tweaks, salvato: v.orientation })),
  ].flatMap((x) => ORIENTAMENTI.filter((o) => o === x.salvato || x.tweaks.some((t) => t.orientation === o)).map((o) => {
    const c = computeMapView(mod, { ...x.base, tweaks: x.tweaks, expanded: new Set(), orientation: o });
    const delVerso = c.tweaks.filter((t) => t.orientation === o);
    const validi = delVerso.filter((t) => c.layout.nodes.get(t.nodeId)?.role === "box" && !c.layout.expired.includes(t.nodeId)).length;
    return { vista: x.vista, orientamento: o, ritocchi: delVerso.length, validi, scaduti: c.layout.expired, oggetti_persi: c.missing.length };
  }));
  const mappe = ritocchiPerMappa(model);
  out.mappe = mappe.map((x) => ({ ...x, scaduti: x.scaduti.length }));

  const padri = padriDi(auto.tree);
  const salva = val("--salva");
  if (salva) fs.writeFileSync(salva, JSON.stringify({ padri, radici: auto.tree.roots, conteggi: numeri, teste: leTeste, letture_vm: out.letture_vm, adesso: base.nowMs }, null, 1));
  const confronta = val("--confronta");
  let cambi: ReturnType<typeof padriCambiati> = [];
  if (confronta) {
    let prima: { padri: Record<string, string | null>; conteggi: Record<string, number>; teste?: ReturnType<typeof teste>; letture_vm?: Record<string, string | null>; adesso?: number };
    try { prima = JSON.parse(fs.readFileSync(confronta, "utf8")) as typeof prima; } catch { return uso("--confronta: istantanea non leggibile."); }
    cambi = padriCambiati(prima.padri, padri);
    out.padri_cambiati = cambi.length;
    out.teste_cambiate = prima.teste ? testeCambiate(prima.teste, leTeste) : "istantanea senza teste";
    // R1: «prima» e «dopo» sulla stessa lettura delle VM, o la differenza si dice.
    out.stessa_lettura_vm = JSON.stringify(prima.letture_vm ?? null) === JSON.stringify(out.letture_vm);
    // «Prima» e «dopo» con lo stesso orologio, o la differenza si dice (le istantanee di prima di --adesso non l'hanno).
    out.stesso_orologio = prima.adesso === undefined ? "istantanea senza orologio" : prima.adesso === base.nowMs;
    out.conteggi_cambiati = Object.fromEntries(Object.keys({ ...prima.conteggi, ...numeri })
      .filter((k) => prima.conteggi[k] !== numeri[k]).map((k) => [k, `${prima.conteggi[k] ?? "—"} → ${numeri[k] ?? "—"}`]));
  }
  let traccia: import("../src/lib/topology/cavi/traccia").Traccia | null = null;
  let nomiT: Record<string, string> = {};
  let caviDaStampare: { dalleVm: Array<{ id: string; ipervisore: string; switch: string; porta: string; vm: number; principale: boolean; uplink: string }> } | null = null;
  // T3, Task 0: il modello in ombra si calcola una volta sola, per --traccia e per --cavi.
  let ombra: ReturnType<typeof import("../src/lib/topology/cavi/modello").costruisciModelloCavi> | null = null;
  if (a.includes("--traccia") || a.includes("--cavi")) {
    const { costruisciModelloCavi } = await import("../src/lib/topology/cavi/modello");
    const ing = tenantDb.withTenant(tenant, () => tenantDb.getIngressoCavi(soglia, base.nowMs));
    const t0 = performance.now();
    ombra = costruisciModelloCavi({ ...ing, t1: input }, model, { testaScelta: auto.headChosen ? auto.head : null });
    out.cavi_ms = Math.round((performance.now() - t0) * 10) / 10;
  }
  if (ombra && a.includes("--traccia")) {
    const { calcolaTraccia, nomiTraccia } = await import("../src/lib/topology/cavi/traccia");
    traccia = calcolaTraccia(padri, ombra);
    nomiT = nomiTraccia(model, ombra, traccia);
    out.traccia = {
      schema: traccia.schema, padri_diversi: traccia.padriDiversi, entrano: traccia.entrano.length, escono: traccia.escono.length,
      per_genere: traccia.perGenere, nuovi: traccia.nuovi, segmenti: traccia.segmenti, anomalie: traccia.anomalie, avvisi: traccia.avvisi.length,
    };
  }
  // T3, Task 0: i collegamenti del modello per cavo in numeri (sempre) e, con --nomi, riga per riga a terminale.
  if (ombra && a.includes("--cavi")) {
    const conta = (xs: readonly string[]) => xs.reduce<Record<string, number>>((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
    const ipv = new Set(model.vms.flatMap((v) => (v.hypervisorNodeId ? [v.hypervisorNodeId] : [])));
    // §13.14, §13.15 punto 4: i collegamenti che hanno SOLO la prova «dalle VM» (anche quelli che, con la regola accesa, stanno
    // solo nei dettagli: la misura deve vederli tutti, comunque sia `DALLE_VM_SOLO_DETTAGLI`).
    const dalleVm = [...ombra.collegamenti, ...ombra.soloDettagli.map((d) => d.collegamento)].flatMap((c) => {
      if (c.prove.length === 0 || !c.prove.every((p) => p.classe === "vm")) return [];
      const h = ipv.has(c.a.nodo) ? c.a : ipv.has(c.b.nodo) ? c.b : null;
      if (!h) return [];
      const sw = h === c.a ? c.b : c.a;
      const sc = ombra.albero.scelto.get(sw.nodo);
      // Con la regola accesa il collegamento può stare solo nei dettagli: `scelto` lo nomina, ma `collegamenti` non lo ha.
      const uplink = sc === undefined ? "non noto"
        : sc === c.id || ombra.collegamenti.some((x) => x.id === sc && ((x.a.nodo === sw.nodo && x.a.chiave === sw.chiave) || (x.b.nodo === sw.nodo && x.b.chiave === sw.chiave)))
          ? "noto, è questa porta" : "noto, è un'altra porta";
      return [{ id: c.id, ipervisore: h.nodo, switch: sw.nodo, porta: sw.nome, vm: c.vm ?? 0, principale: ombra.albero.via.get(h.nodo)?.id === c.id, uplink }];
    });
    out.cavi = {
      per_genere: conta(ombra.collegamenti.map((c) => c.genere)),
      per_stato: conta(ombra.collegamenti.map((c) => c.stato ?? "nessuno")),
      per_fiducia: conta(ombra.collegamenti.map((c) => c.fiducia)),
      non_visti: ombra.collegamenti.filter((c) => c.nonVisto).length,
      porte_da_verificare: ombra.collegamenti.filter((c) => c.porteDaVerificare).length,
      segmenti: ombra.segmenti.length,
      radici: ombra.albero.radici.length,
      anomalie: ombra.albero.anomalie.length,
      avvisi: ombra.albero.avvisi.length,
      dalle_vm: { totale: dalleVm.length, non_principali: dalleVm.filter((x) => !x.principale).length,
        uplink: conta(dalleVm.filter((x) => !x.principale).map((x) => x.uplink)) },
    };
    caviDaStampare = { dalleVm };
  }
  // T3, Task 6: la mappa nuova con l'interruttore acceso in memoria (non si scrive niente), sulla stessa misura: lo stesso giro della
  // rotta del modello (`modelloMappaDaIngresso` con la testa della mappa automatica salvata), 30 volte per il tempo (C17); poi la
  // mappa automatica con la stessa testa, gli stessi ritocchi e lo stesso orientamento, contro quella di oggi.
  let nuova: { mappa: import("../src/lib/topology/cavi/mappa").MappaCavi; padri: Record<string, string | null>; diversi: ReturnType<typeof padriCambiati>; dalSalvato: ReturnType<typeof padriCambiati> | null } | null = null;
  if (a.includes("--mappa-cavi")) {
    const { modelloMappaDaIngresso } = await import("../src/lib/topology/cavi/mappa");
    const ingC = { ...tenantDb.withTenant(tenant, () => tenantDb.getIngressoCavi(soglia, base.nowMs)), t1: input };
    const testaSalvata = viste.auto?.head_node ?? null;
    let mm = modelloMappaDaIngresso(ingC, { testaScelta: testaSalvata }).mappa;
    const tempiC: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      mm = modelloMappaDaIngresso(ingC, { testaScelta: testaSalvata }).mappa;
      tempiC.push(performance.now() - t0);
    }
    out.mappa_cavi_ms = Math.round(mediana(tempiC) * 10) / 10;
    out.impronta_mappa_cavi = crypto.createHash("sha256").update(JSON.stringify(mm)).digest("hex").slice(0, 16);
    const vistaC = computeMapView(mm, {
      auto: true, members: [], roots: [], head: testaSalvata, tweaks: viste.autoVista.tweaks, expanded: new Set(), orientation: viste.autoVista.orientation,
    });
    const padriC = padriDi(vistaC.tree);
    const diversi = padriCambiati(padri, padriC);
    const contaC = (xs: readonly string[]) => xs.reduce<Record<string, number>>((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
    const mappeC = ritocchiPerMappa(mm);
    out.mappa_cavi = {
      radici: vistaC.tree.roots.length, padri_diversi_da_oggi: diversi.length, testa_cambiata: vistaC.head !== auto.head,
      isolati: mm.isolated.length, da_sistemare: (mm.daSistemare ?? []).length, segmenti: mm.cavi.segmenti.length, anomalie: mm.cavi.anomalie.length,
      per_genere: contaC(mm.links.map((l) => l.cavo?.genere ?? "nessuno")), per_stato: contaC(mm.links.map((l) => l.cavo?.stato ?? "nessuno")),
      stelle_di_prima: mm.cavi.stelleDiPrima.length, dalle_vm_nei_dettagli: Object.values(mm.cavi.dalleVm).reduce((n, xs) => n + xs.length, 0),
      mappe: mappeC.map((x) => ({ ...x, scaduti: x.scaduti.length })),
    };
    const salvaC = val("--salva-cavi");
    if (salvaC) fs.writeFileSync(salvaC, JSON.stringify({ padri: padriC, radici: vistaC.tree.roots, adesso: base.nowMs }, null, 1));
    let dalSalvato: ReturnType<typeof padriCambiati> | null = null;
    const confrontaC = val("--confronta-cavi");
    if (confrontaC) {
      let prima: { padri: Record<string, string | null>; adesso?: number };
      try { prima = JSON.parse(fs.readFileSync(confrontaC, "utf8")) as typeof prima; } catch { return uso("--confronta-cavi: istantanea non leggibile."); }
      dalSalvato = padriCambiati(prima.padri, padriC);
      out.mappa_cavi_dal_salvato = { padri_cambiati: dalSalvato.length, stesso_orologio: prima.adesso === undefined ? "istantanea senza orologio" : prima.adesso === base.nowMs };
    }
    nuova = { mappa: mm, padri: padriC, diversi, dalSalvato };
  }
  // Unioni a mano (piano 2026-10-16, Task 3 Step 4 e Task 7): solo conteggi e id; i nomi, con --nomi, a terminale.
  const righeNomiUnioni: string[] = [];
  if (a.includes("--unioni") || inMemoria) {
    const { indiceDeiNodi } = await import("../src/lib/topology/node-index");
    const { nodoDi } = await import("../src/lib/topology/unioni");
    const nelDb = tenantDb.withTenant(tenant, () => ({ presente: tenantDb.schemaUnioniPresente(), righe: tenantDb.getRigheScelte() }));
    const idxOggi = indiceDeiNodi(senzaScelte);
    const idxMisura = indiceDeiNodi(input);
    const nomeDi = (id: string): string => {
      const [tipo, n] = id.split(":");
      const h = tipo === "host" ? input.hosts.find((x) => x.id === Number(n)) : undefined;
      const d = tipo === "dev" ? input.devices.find((x) => x.id === Number(n)) : undefined;
      return h ? (h.custom_name || h.hostname || h.ip || id) : d ? d.name : id;
    };
    const perFisico = (sql: string): Map<number, string[]> => {
      const m = new Map<number, string[]>();
      for (const r of db.prepare(sql).all() as Array<{ pd: number; id: string }>) m.set(r.pd, [...(m.get(r.pd) ?? []), r.id]);
      return new Map([...m].filter(([, ids]) => ids.length >= 2));
    };
    // Task 0 (a): i collegamenti a mano per le scansioni (non si convertono: candidati da unire a mano) e quanti sono già un oggetto solo.
    const manuali = perFisico(`SELECT pd.id AS pd, 'host:' || h.id AS id FROM physical_devices pd JOIN hosts h ON h.physical_device_id = pd.id
      WHERE pd.identity_anchor = 'manual_link' ORDER BY pd.id, h.id`);
    const unNodo = (ids: readonly string[]): boolean => new Set(ids.map((x) => nodoDi(idxOggi, x))).size === 1;
    // (b) due apparati censiti dello stesso apparato fisico («apparato + apparato», fuori tappa); (c) host dello stesso apparato
    // fisico senza apparato censito (oggi oggetti separati).
    const dueApparati = perFisico(`SELECT physical_device_id AS pd, 'dev:' || id AS id FROM network_devices WHERE physical_device_id IS NOT NULL ORDER BY 1, id`);
    const senzaApparato = perFisico(`SELECT h.physical_device_id AS pd, 'host:' || h.id AS id FROM hosts h WHERE h.physical_device_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM network_devices nd WHERE nd.physical_device_id = h.physical_device_id) ORDER BY 1, h.id`);
    const quanti = (m: Map<number, string[]>) => [...m.values()].reduce((n, ids) => n + ids.length, 0);
    const sezione: Record<string, unknown> = {
      schema_presente: nelDb.presente,
      righe_db: { unioni: nelDb.righe.unioni.length, separazioni: nelDb.righe.separazioni.length },
      collegamenti_scansioni: { gruppi: manuali.size, host: quanti(manuali), gia_un_nodo: [...manuali.values()].filter(unNodo).length },
      apparati_stesso_fisico: { gruppi: dueApparati.size, apparati: quanti(dueApparati) },
      host_stesso_fisico_senza_apparato: { gruppi: senzaApparato.size, host: quanti(senzaApparato) },
      fusioni_automatiche: fusioniPerCome(idxMisura),
    };
    const elenco = (titolo: string, m: Map<number, string[]>, extra: (ids: string[]) => string = () => "") => {
      righeNomiUnioni.push(`\n— ${titolo} —`);
      for (const [pd, ids] of m) righeNomiUnioni.push(`apparato fisico ${pd}: ${ids.map(nomeDi).join(", ")}${extra(ids)}`);
    };
    elenco("unioni: collegamenti a mano per le scansioni (a)", manuali, (ids) => (unNodo(ids) ? " · già un oggetto solo" : ""));
    elenco("unioni: apparati censiti dello stesso apparato fisico (b)", dueApparati);
    elenco("unioni: host dello stesso apparato fisico senza apparato (c)", senzaApparato);
    if (inMemoria) {
      const prima = buildTopologyModel(senzaScelte, regole);
      const memoria = (input.unioni ?? []).filter((u) => u.gruppo < 0);
      const gruppi = [...new Set(memoria.map((u) => u.gruppo))].sort((x, y) => y - x);
      const nodiDel = (g: number) => memoria.filter((u) => u.gruppo === g).map((u) => nodoDi(idxMisura, u.membro)).filter((x): x is string => x !== null);
      const applicata = (g: number): boolean => nodiDel(g).length >= 2 && new Set(nodiDel(g)).size === 1;
      const confronto = confrontoUnione(prima, model);
      sezione.in_memoria = {
        ...confronto,
        gruppi: gruppi.length, applicate: gruppi.filter(applicata).length,
        non_applicate: (model.unioni?.nonApplicate ?? []).filter((n) => n.gruppo < 0).map((n) => ({ gruppo: n.gruppo, membri: n.membri })),
        mancanti: model.unioni?.mancanti ?? [],
        separazioni: separa.length,
        // La riga «capi fusi» della mappa per cavo: attesa assente (l'indice per cavo è quello di T1).
        ...(nuova ? { capi_fusi: nuova.mappa.cavi.nonCalcolato.find((r) => /ha fuso/.test(r)) ?? null } : {}),
      };
      righeNomiUnioni.push("\n— unioni in memoria —");
      for (const g of gruppi) {
        const membri = memoria.filter((u) => u.gruppo === g).map((u) => u.membro);
        const na = model.unioni?.nonApplicate.find((n) => n.gruppo === g);
        const nodo = nodiDel(g)[0];
        righeNomiUnioni.push(`gruppo ${g}: ${membri.map(nomeDi).join(", ")} → ${na ? `non applicata: ${na.motivo}` : applicata(g) && nodo ? model.nodes.find((n) => n.id === nodo)?.name ?? nodo : "non applicata"}`);
      }
      for (const [m, altro] of separa) righeNomiUnioni.push(`separa ${nomeDi(m)} da ${nomeDi(altro)}`);
      righeNomiUnioni.push("\n— unioni in memoria: coppie scomparse —");
      for (const k of confronto.coppieScomparse) righeNomiUnioni.push(k.split("–").map((x) => model.nodes.find((n) => n.id === x)?.name ?? nomeDi(x)).join(" ↔ "));
    }
    out.unioni = sezione;
  }
  out.quick_check_dopo = quick();
  process.stdout.write(a.includes("--json") ? `${JSON.stringify(out, null, 1)}\n` : `${Object.entries(out).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}\n`);

  if (a.includes("--nomi")) {
    // A terminale e basta: nomi del cliente. Mai su un file del repo.
    const nome = (id: string | null | undefined) => (id ? (model.nodes.find((n) => n.id === id)?.name ?? id) : "—");
    const w = (s: string) => process.stdout.write(`${s}\n`);
    w("\n— padri cambiati —");
    for (const c of cambi) w(`${nome(c.id)}: ${c.prima === undefined ? "fuori dall'albero" : nome(c.prima)} → ${c.dopo === undefined ? "fuori dall'albero" : nome(c.dopo)}`);
    w("\n— collegamenti fra apparati (mappa automatica) —");
    const vista = new Map(auto.tree.links.map((l) => [l.id, l]));
    for (const l of model.links.filter((x) => x.a.startsWith("dev:") && x.b.startsWith("dev:"))) {
      const v = vista.get(l.id) ?? l;
      w(`${nome(l.a)} ${l.aPort || "?"} ↔ ${nome(l.b)} ${l.bPort || "?"} · ${l.speedMbps ?? "velocità non nota"} · ${l.sources.join("+")} · ${v.primary ? "principale" : v.redundant ? "ridondanza" : "fuori vista"}${l.medium ? ` · ${l.medium}` : ""}`);
    }
    w("\n— teste (C19, H17) —");
    w(`mappa automatica: ${nome(leTeste.proposta)}`);
    for (const s of model.sites) w(`${s.name}: ${nome(s.headNodeId)}${s.headProposed ? " (proposta)" : ""}`);
    w("\n— linee di un router MikroTik da un nome scelto (H7) —");
    for (const l of lineeDaNomeScelto(input, model)) w(`${nome(l.a)} ${l.aPort} ↔ ${nome(l.b)} ${l.bPort} · ${l.sources.join("+")}`);
    w("\n— hypervisor sotto una loro VM (H15) —");
    for (const id of sottoUnaSuaVm(model, padri)) w(`${nome(id)} sotto ${nome(padri[id])}`);
    w("\n— porte di segmento: nessun cavo da lì (H5, H6, C8) —");
    for (const [k, membri] of Object.entries(model.segmenti ?? {})) {
      const [nodo, porta] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
      w(`${nome(nodo)} ${porta}: ${membri.map(nome).join(", ")}`);
    }
    w("\n— linee cucite —");
    for (const l of lineeCucite(input, model)) w(`${nome(l.a)} ${l.aPort} ↔ ${nome(l.b)} ${l.bPort}`);
    w("\n— ritocchi scaduti, per mappa e orientamento (R2) —");
    for (const x of mappe) for (const id of x.scaduti) w(`${x.vista} ${x.orientamento}: ${nome(id)}`);
    w("\n— «Da sistemare»: senza prove di ruolo —");
    for (const d of model.daSistemare ?? []) w(`${nome(d.id)} · ${d.motivo}`);
    w("\n— senza prove di ruolo, visti solo via LLDP (scelta 4 del §13.16) —");
    for (const id of vistiSoloViaLldp(input, model)) w(nome(id));
    w("\n— nell'albero solo per una prova aggiunta —");
    for (const id of soloProveAggiunte(input, model)) w(nome(id));
    w("\n— «Da sistemare»: senza collegamenti —");
    for (const id of model.isolated) w(nome(id));
    if (cambiati.length > 0) {
      w("\n— host che cambiano categoria (C18) —");
      for (const id of cambiati) w(nome(`host:${id}`));
    }
    if (traccia) {
      w("\n— cosa cambierebbe con la mappa nuova (in ombra) —");
      const nt = (id: string | null | undefined) => (id === undefined ? "fuori" : id === null ? "nessuno" : (nomiT[id] ?? nome(id)));
      for (const r of traccia.righe) w(`${nt(r.id)} · padre oggi ${nt(r.prima)} · con la mappa nuova ${nt(r.dopo)} · ${r.perche}`);
      if (traccia.altri > 0) w(`+ altri ${traccia.altri}`);
    }
    if (ombra && caviDaStampare) {
      const nc = (id: string) => (id.startsWith("seg:") ? `segmento ${id}` : nome(id));
      w("\n— collegamenti del modello per cavo (T3, Task 0) —");
      for (const c of ombra.collegamenti) {
        w(`${c.genere} · ${nc(c.a.nodo)} ${c.a.nome || "?"} ↔ ${nc(c.b.nodo)} ${c.b.nome || "?"} · ${c.stato ?? "—"} · ${c.fiducia}`
          + `${c.velocitaMbps ? ` · ${c.velocitaMbps} Mbps` : ""}${c.nonVisto ? " · non visto" : ""}${c.porteDaVerificare ? " · porte da verificare" : ""}`
          + `${c.wan ? " · WAN" : ""}${c.attraverso ? " · attraverso apparati non letti" : ""}${c.fascioDedotto ? " · fascio dedotto" : ""}`);
      }
      w("\n— segmenti —");
      for (const s of ombra.segmenti) w(`${s.id}: ${s.membri.map((p) => `${nome(p.nodo)} ${p.nome}`).join(", ")}${s.altriApparati ? ` · +${s.altriApparati} non gestiti` : ""}`);
      w("\n— padri del modello per cavo (mappa automatica) —");
      for (const [id, p] of Object.entries(ombra.albero.padri)) w(`${nc(id)} ← ${p === null ? "partenza" : nc(p)}${ombra.albero.scelto.has(id) ? " (porta radice o uplink)" : ""}`);
      w("\n— anomalie e avvisi —");
      for (const x of ombra.albero.anomalie) w(`${nome(x.nodo)} sotto ${nome(x.padre)}; allo stesso livello: ${x.altri.map(nome).join(", ")}`);
      for (const x of ombra.albero.avvisi) w(`${nc(x.nodo)}: ${x.testo}`);
      w("\n— collegamenti «dalle VM» (§13.14) —");
      for (const x of caviDaStampare.dalleVm) w(`${nome(x.ipervisore)} · ${nome(x.switch)} ${x.porta} · ${x.vm} VM · ${x.principale ? "principale" : "NON principale"} · uplink dello switch: ${x.uplink}`);
    }
    for (const r of righeNomiUnioni) w(r);
    if (nuova) {
      const { nomiDellaMappa } = await import("../src/lib/topology/cavi/mappa");
      const nm = nomiDellaMappa(nuova.mappa);
      const nn = (id: string | null | undefined) => (id === undefined ? "fuori dall'albero" : id === null ? "partenza" : nm(id));
      w("\n— mappa nuova: padri diversi da oggi (T3, Task 6) —");
      for (const c of nuova.diversi) w(`${nn(c.id)}: oggi ${nn(c.prima)} → con la mappa nuova ${nn(c.dopo)}`);
      if (nuova.dalSalvato) {
        w("\n— mappa nuova: padri cambiati dall'istantanea —");
        for (const c of nuova.dalSalvato) w(`${nn(c.id)}: ${nn(c.prima)} → ${nn(c.dopo)}`);
      }
      w("\n— mappa nuova: isolati —");
      for (const id of nuova.mappa.isolated) w(nm(id));
      w("\n— mappa nuova: «Da sistemare» —");
      for (const d of nuova.mappa.daSistemare ?? []) w(`${nm(d.id)} · ${d.motivo}`);
      w("\n— mappa nuova: anomalie —");
      for (const x of nuova.mappa.cavi.anomalie) w(`${nm(x.nodo)} sotto ${nm(x.padre)} (porta ${x.porta || "non nota"}); allo stesso livello: ${x.altri.map(nm).join(", ")}`);
    }
  }
  return righeQuick().every((r) => r === "ok" || /^Page \d+: never used$/.test(r)) ? 0 : 1;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
