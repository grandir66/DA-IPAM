/**
 * misura-cavi.ts — i numeri del capitolo 13 della spec della topologia su una COPIA del DB di un tenant (pezzo T1.0,
 * spec §13.12.1). Copia della copia in una cartella di lavoro dentro --cartella (stesse guardie di misura-topologia);
 * migrazioni applicate lì; stampa solo conteggi. Con --nomi stampa anche i nomi, a terminale: mai su un file del repo.
 *
 * Uso:  npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad>
 *         [--scenario S0|S1|S3:<id>|S4|S9:<id>:<porta>:<fonte>|S12:<id>:<vmid>] [--soglia <giorni>]
 *         [--uscita-router <id>=<file>]...   righe nuove del router dall'uscita incollata (lettore di T1), insieme alle vecchie
 *         [--ripristino <ora UTC>]   dopo le righe nuove del router, lo stesso testo SQL di «Tornare indietro» (Task 10b)
 *         [--salva <istantanea.json>] [--confronta <istantanea.json>]
 *         [--esporta-input <file.json>] [--input-json <file.json>] [--nomi] [--json]
 *         [--senza-regola <regola>]...   spegne una regola del passaggio universale (src/lib/topology/regole.ts): la misura C19 confronta «tutte le regole» con «tutte meno una»
 *   I file di --salva, --confronta, --esporta-input e --input-json stanno dentro --cartella (dati del cliente).
 *   Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi, percorsoReale } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const CON_VALORE = ["--cartella", "--scenario", "--soglia", "--uscita-router", "--ripristino", "--salva", "--confronta", "--esporta-input", "--input-json", "--senza-regola"];

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad> [--scenario …] [--uscita-router <id>=<file>] [--ripristino <ora UTC>] [--senza-regola <regola>] [--salva|--confronta <file>] [--esporta-input|--input-json <file>] [--nomi] [--json]\n");
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
    applicaScenario, conteggi, leggiScenario, lettureVm, lineeCucite, lineeDaNomeScelto, padriCambiati, padriDi, sottoUnaSuaVm, teste, testeCambiate,
  } = await import("../src/lib/topology/misura");
  const scenario = leggiScenario(val("--scenario") ?? "S0");
  if (!scenario) return uso("Scenario non valido: S0, S1, S3:<id>, S4, S9:<id>:<porta>:<fonte>, S12:<id>:<vmid>.");
  const soglia = Number(val("--soglia") ?? "2");
  if (!Number.isInteger(soglia) || soglia < 1) return uso("--soglia: giorni interi, almeno 1.");
  const { NOMI_REGOLE, REGOLE_T1, leggiRegola } = await import("../src/lib/topology/regole");
  const senza = valori("--senza-regola");
  if (senza.some((r) => leggiRegola(r) === null)) return uso(`--senza-regola vuole una di: ${NOMI_REGOLE.join(", ")}.`);
  const regole = new Set([...REGOLE_T1].filter((r) => !senza.includes(r)));
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
  const base: Input = (letto as Input | null) ?? tenantDb.withTenant(tenant, () => tenantDb.getTopologyModelInput(soglia));
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
  if (salva) fs.writeFileSync(salva, JSON.stringify({ padri, radici: auto.tree.roots, conteggi: numeri, teste: leTeste, letture_vm: out.letture_vm }, null, 1));
  const confronta = val("--confronta");
  let cambi: ReturnType<typeof padriCambiati> = [];
  if (confronta) {
    let prima: { padri: Record<string, string | null>; conteggi: Record<string, number>; teste?: ReturnType<typeof teste>; letture_vm?: Record<string, string | null> };
    try { prima = JSON.parse(fs.readFileSync(confronta, "utf8")) as typeof prima; } catch { return uso("--confronta: istantanea non leggibile."); }
    cambi = padriCambiati(prima.padri, padri);
    out.padri_cambiati = cambi.length;
    out.teste_cambiate = prima.teste ? testeCambiate(prima.teste, leTeste) : "istantanea senza teste";
    // R1: «prima» e «dopo» sulla stessa lettura delle VM, o la differenza si dice.
    out.stessa_lettura_vm = JSON.stringify(prima.letture_vm ?? null) === JSON.stringify(out.letture_vm);
    out.conteggi_cambiati = Object.fromEntries(Object.keys({ ...prima.conteggi, ...numeri })
      .filter((k) => prima.conteggi[k] !== numeri[k]).map((k) => [k, `${prima.conteggi[k] ?? "—"} → ${numeri[k] ?? "—"}`]));
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
    w("\n— «Da sistemare»: senza collegamenti —");
    for (const id of model.isolated) w(nome(id));
    if (cambiati.length > 0) {
      w("\n— host che cambiano categoria (C18) —");
      for (const id of cambiati) w(nome(`host:${id}`));
    }
  }
  return righeQuick().every((r) => r === "ok" || /^Page \d+: never used$/.test(r)) ? 0 : 1;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
