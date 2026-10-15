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
 *         [--salva <istantanea.json>] [--confronta <istantanea.json>]
 *         [--esporta-input <file.json>] [--input-json <file.json>] [--nomi] [--json]
 *         [--senza-regola <regola>]...   spegne una regola del passaggio universale (src/lib/topology/regole.ts): la misura C19 confronta «tutte le regole» con «tutte meno una»
 *         [--adesso "AAAA-MM-GG HH:MM:SS"]   l'ora (UTC) a cui il modello giudica «non visto»: quella del «prima», per misurare il
 *                                            «dopo» sulla stessa copia con lo stesso orologio (di base l'ora vera; vale anche con --input-json)
 *   I file di --salva, --confronta, --esporta-input e --input-json stanno dentro --cartella (dati del cliente).
 *   Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi, percorsoReale } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const CON_VALORE = ["--cartella", "--scenario", "--soglia", "--uscita-router", "--ripristino", "--fatti-prova", "--salva", "--confronta", "--esporta-input", "--input-json", "--senza-regola", "--adesso"];

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad> [--scenario …] [--uscita-router <id>=<file>] [--ripristino <ora UTC>] [--fatti-prova <id>] [--traccia] [--cavi] [--senza-regola <regola>] [--adesso <ora UTC>] [--salva|--confronta <file>] [--esporta-input|--input-json <file>] [--nomi] [--json]\n");
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
  for (const k of ["--salva", "--confronta", "--esporta-input", "--input-json"]) {
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
        monitorFasci: stp.parseMonitorFasci(F("mikrotik-mk8b-testa.txt")),
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
  const input = applicaScenario(base, scenario);
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
  const mappe = [
    { vista: "auto", base: { auto: true, members: [] as string[], roots: [] as string[], head: viste.auto?.head_node ?? null }, tweaks: viste.autoVista.tweaks, salvato: viste.autoVista.orientation },
    ...viste.mappe.map(({ m, v }) => ({ vista: `mappa:${m.id}`, base: { auto: false, members: v.nodes, roots: m.roots, head: null }, tweaks: v.tweaks, salvato: v.orientation })),
  ].flatMap((x) => ORIENTAMENTI.filter((o) => o === x.salvato || x.tweaks.some((t) => t.orientation === o)).map((o) => {
    const c = computeMapView(model, { ...x.base, tweaks: x.tweaks, expanded: new Set(), orientation: o });
    const delVerso = c.tweaks.filter((t) => t.orientation === o);
    const validi = delVerso.filter((t) => c.layout.nodes.get(t.nodeId)?.role === "box" && !c.layout.expired.includes(t.nodeId)).length;
    return { vista: x.vista, orientamento: o, ritocchi: delVerso.length, validi, scaduti: c.layout.expired, oggetti_persi: c.missing.length };
  }));
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
    // §13.14, §13.15 punto 4: i collegamenti che hanno SOLO la prova «dalle VM».
    const dalleVm = ombra.collegamenti.flatMap((c) => {
      if (c.prove.length === 0 || !c.prove.every((p) => p.classe === "vm")) return [];
      const h = ipv.has(c.a.nodo) ? c.a : ipv.has(c.b.nodo) ? c.b : null;
      if (!h) return [];
      const sw = h === c.a ? c.b : c.a;
      const sc = ombra.albero.scelto.get(sw.nodo);
      const uplink = sc === undefined ? "non noto"
        : ombra.collegamenti.some((x) => x.id === sc && ((x.a.nodo === sw.nodo && x.a.chiave === sw.chiave) || (x.b.nodo === sw.nodo && x.b.chiave === sw.chiave)))
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
  }
  return righeQuick().every((r) => r === "ok" || /^Page \d+: never used$/.test(r)) ? 0 : 1;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
