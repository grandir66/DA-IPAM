// Stop dei giri e sequenze sul server, sul vero `runDiscovery` col banco delle scansioni.
// Lanciare con una cartella di prova, come esecutore-finto.test.ts.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { tentativiBloccati, togliGuardiaRete } from "./support/guardia-rete";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { discoverNetwork, getScanProgress, elencaGiri, type AvvioDiscovery } from "@/lib/scanner/discovery";
import { conSegnaleGiro, fermaGiro } from "@/lib/scanner/ferma-giro";
import { giriDelCliente } from "@/lib/scanner/giri";
import { classifyPingError, pingHost } from "@/lib/scanner/ping";
import { isScanInCorso, prendiRete } from "@/lib/scanner/network-scan-lock";
import { avviaSequenza, type FaseSequenza } from "@/lib/scanner/sequenze";
import { runJob } from "@/lib/cron/jobs";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

const T = "TESTFERMAGIRI";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Banco stop",
  indirizzo: null,
  citta: null,
  provincia: null,
  cap: null,
  telefono: null,
  email: null,
  piva: null,
  cf: null,
  referente: null,
  note: null,
  active: 1,
});

beforeEach(() => {
  togliEsecutoreFinto();
  deleteTenantDatabase(T);
  tentativiBloccati.length = 0;
});

after(() => {
  togliEsecutoreFinto();
  togliGuardiaRete();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function db() {
  return getTenantDb(T);
}

/** Rete /29 con un host noto e acceso: un giro «ping» completo lo spegnerebbe. */
function preparaRete(): number {
  const d = db();
  const id = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.251.0.0/29', 'banco')").run().lastInsertRowid);
  d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.251.0.5', 'online')").run(id);
  return id;
}

function statoHost(reteId: number): string {
  return (db().prepare("SELECT status FROM hosts WHERE network_id = ? AND ip = '10.251.0.5'").get(reteId) as { status: string }).status;
}

async function attendi(condizione: () => boolean, cosa: string): Promise<void> {
  const limite = Date.now() + 10_000;
  while (!condizione()) {
    if (Date.now() > limite) throw new Error(`in attesa: ${cosa}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const finito = (id: string) => () => getScanProgress(id)?.status !== "running";

function cancello() {
  let apri: () => void = () => undefined;
  const promessa = new Promise<void>((r) => (apri = r));
  return { promessa, apri };
}

const ogniGiro = (reteId: number, tipo: "ping" = "ping"): FaseSequenza["avvia"] =>
  (sequenzaId) => discoverNetwork(reteId, tipo, undefined, undefined, { sequenzaId });

test("un giro fermato non manda offline nessuno, chiude come fermato e libera la rete", async () => {
  const reteId = withTenant(T, preparaRete);
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], cancello: c.promessa }).override);

  const { id, done } = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  assert.equal(fermaGiro(id), true);
  c.apri();
  const esito = await done;

  assert.deepEqual(esito, { status: "failed", error: "Fermata dall'utente", fermato: true });
  const p = getScanProgress(id)!;
  assert.equal(p.status, "failed");
  assert.equal(p.fermato, true);
  assert.equal(withTenant(T, () => statoHost(reteId)), "online", "il giro fermato ha spento un host che non ha finito di guardare");
  const storia = db().prepare("SELECT COUNT(*) AS n FROM scan_history WHERE network_id = ?").get(reteId) as { n: number };
  assert.equal(storia.n, 0, "un giro fermato risulterebbe eseguito nello stato delle fasi");

  const dopo = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  await dopo.done;
  assert.equal(fermaGiro(dopo.id), false, "un giro chiuso non si ferma più");
});

test("lo stop arrivato dopo il sweep ferma il giro prima della fase offline", async () => {
  const reteId = withTenant(T, preparaRete);
  let fermato = false;
  const { override } = creaEsecutoreFinto({ vivi: [] });
  const sweep = override.executor.pingSweep.bind(override.executor);
  let idGiro = "";
  override.executor.pingSweep = async (ips, conc, cb) => {
    const out = await sweep(ips, conc, cb);
    fermato = fermaGiro(idGiro);
    return out;
  };
  installaEsecutoreFinto(override);
  const avvio = withTenant(T, () => discoverNetwork(reteId, "ping"));
  const a = await avvio;
  idGiro = a.id;
  await a.done;
  assert.equal(fermato, true, "la prova non ha fermato il giro in tempo");
  assert.equal(withTenant(T, () => statoHost(reteId)), "online");
});

test("lo stop arrivato a sweep finito, durante la lettura ARP, ferma il giro prima della fase offline", async () => {
  const reteId = withTenant(T, preparaRete);
  const { override, chiamate } = creaEsecutoreFinto({ vivi: ["10.251.0.1"] });
  let idGiro = "";
  let fermato = false;
  const leggiArp = override.readArpCache!;
  override.readArpCache = async () => {
    fermato = fermaGiro(idGiro);
    return leggiArp();
  };
  installaEsecutoreFinto(override);
  const a = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  idGiro = a.id;
  await a.done;
  assert.ok(chiamate.pingSweep > 0);
  assert.equal(fermato, true, "la prova non ha fermato il giro in tempo");
  assert.equal(getScanProgress(a.id)!.fermato, true);
  assert.equal(withTenant(T, () => statoHost(reteId)), "online");
});

test("un errore di processo dopo lo stop è uno stop, non un guasto", async () => {
  const reteId = withTenant(T, preparaRete);
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], cancello: c.promessa, lancia: new Error("nmap killed") }).override);
  const { id, done } = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  fermaGiro(id);
  c.apri();
  const esito = await done;
  assert.equal(esito.fermato, true);
  assert.equal(getScanProgress(id)!.error, "Fermata dall'utente");
});

test("«fast»: un nmap ucciso dallo stop non fa partire il ripiego col ping su tutta la rete", async () => {
  const reteId = withTenant(T, preparaRete);
  const c = cancello();
  const { override, chiamate } = creaEsecutoreFinto({ vivi: [], cancello: c.promessa, lancia: new Error("nmap killed") });
  installaEsecutoreFinto(override);
  const { id, done } = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  fermaGiro(id);
  c.apri();
  const esito = await done;
  assert.equal(esito.fermato, true);
  assert.equal(chiamate.nmapDiscoverHosts, 1);
  assert.equal(chiamate.pingSweep, 0, "il ripiego è partito dopo lo stop");
});

test("un ping chiesto a giro fermato non lancia nessun processo", async () => {
  const ferma = new AbortController();
  ferma.abort();
  const r = await conSegnaleGiro(ferma.signal, () => pingHost("10.251.0.1"));
  assert.equal(r.alive, false);
  assert.ok(r.error, "deve restare un esito sconosciuto, non «spento»");
  assert.deepEqual(tentativiBloccati, []);
});

test("un ping ucciso dallo stop è sconosciuto, non «nessuna risposta»", () => {
  const ucciso = { code: "ABORT_ERR", killed: true, name: "AbortError" };
  assert.equal(classifyPingError(ucciso, "linux").esito, "sconosciuto");
  assert.equal(classifyPingError(ucciso, "darwin").esito, "sconosciuto");
  assert.equal(classifyPingError({ killed: true }, "linux").esito, "nessuna_risposta", "il timeout resta nessuna risposta");
});

test("sequenza: due fasi in ordine, in bacheca una riga sola, esito sulla sequenza", async () => {
  const reteId = withTenant(T, preparaRete);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.5"] }).override);
  const avviate: string[] = [];
  const idFasi: string[] = [];
  const fase = (nome: string): FaseSequenza => ({
    nome,
    avvia: async (s) => {
      avviate.push(nome);
      const a = await ogniGiro(reteId)(s);
      idFasi.push(a.id);
      return a;
    },
  });
  const { id } = await withTenant(T, () =>
    avviaSequenza({ tenantCode: T, networkId: reteId, etichetta: "banco", tipo: "sequenza_scoperta", fasi: [fase("Uno"), fase("Due")] }),
  );
  await attendi(finito(id), "fine sequenza");
  const p = getScanProgress(id)!;
  assert.equal(p.status, "completed", p.error);
  assert.equal(p.phase, "Completata: Uno + Due");
  assert.deepEqual(avviate, ["Uno", "Due"]);
  const inBacheca = giriDelCliente(elencaGiri(), T).map((g) => g.id);
  assert.ok(inBacheca.includes(id));
  assert.deepEqual(inBacheca.filter((i) => idFasi.includes(i)), [], "le fasi non vanno in bacheca");
});

test("sequenza: una fase fallita ferma le successive e lo dice", async () => {
  const reteId = withTenant(T, preparaRete);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], lancia: new Error("esecutore guasto") }).override);
  let seconda = false;
  const { id } = await withTenant(T, () =>
    avviaSequenza({
      tenantCode: T,
      networkId: reteId,
      etichetta: "banco",
      tipo: "sequenza_scoperta",
      fasi: [
        { nome: "Uno", avvia: ogniGiro(reteId) },
        { nome: "Due", avvia: (s) => { seconda = true; return ogniGiro(reteId)(s); } },
      ],
    }),
  );
  await attendi(finito(id), "fine sequenza");
  const p = getScanProgress(id)!;
  assert.equal(p.status, "failed");
  assert.equal(p.fermato, undefined);
  assert.match(p.error ?? "", /^Uno: .*le successive non sono partite$/);
  assert.equal(seconda, false);
});

test("sequenza: lo stop ferma la fase in corso e quella dopo non parte", async () => {
  const reteId = withTenant(T, preparaRete);
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], cancello: c.promessa }).override);
  let seconda = false;
  const { id } = await withTenant(T, () =>
    avviaSequenza({
      tenantCode: T,
      networkId: reteId,
      etichetta: "banco",
      tipo: "sequenza_scoperta",
      fasi: [
        { nome: "Uno", avvia: ogniGiro(reteId) },
        { nome: "Due", avvia: (s) => { seconda = true; return ogniGiro(reteId)(s); } },
      ],
    }),
  );
  assert.equal(fermaGiro(id), true);
  c.apri();
  await attendi(finito(id), "fine sequenza");
  const p = getScanProgress(id)!;
  assert.equal(p.fermato, true);
  assert.equal(seconda, false);
  assert.equal(withTenant(T, () => statoHost(reteId)), "online");
});

test("sequenza: i log delle fasi finite restano accanto a quelli della fase dopo", async () => {
  const reteId = withTenant(T, preparaRete);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.5"] }).override);
  const fase = (riga: string): FaseSequenza => ({
    nome: riga,
    avvia: async (s) => {
      const a = await ogniGiro(reteId)(s);
      a.progress.logs?.push(riga);
      return a;
    },
  });
  const { id } = await withTenant(T, () =>
    avviaSequenza({ tenantCode: T, networkId: reteId, etichetta: "banco", tipo: "sequenza_scoperta", fasi: [fase("riga-uno"), fase("riga-due")] }),
  );
  await attendi(finito(id), "fine sequenza");
  const righe = getScanProgress(id)!.logs ?? [];
  assert.ok(righe.includes("riga-uno"), "persi i log della fase 1");
  assert.ok(righe.includes("riga-due"));
});

test("sequenza: rete occupata alla partenza, torna l'errore e non nasce niente", async () => {
  const reteId = withTenant(T, preparaRete);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [] }).override);
  const prima = elencaGiri().length;
  const rilascia = prendiRete(T, reteId, { scanId: "altro", scanType: "fast" });
  try {
    await assert.rejects(
      withTenant(T, () =>
        avviaSequenza({ tenantCode: T, networkId: reteId, etichetta: "banco", tipo: "sequenza_scoperta", fasi: [{ nome: "Uno", avvia: ogniGiro(reteId) }] }),
      ),
      (e) => isScanInCorso(e),
    );
  } finally {
    rilascia();
  }
  assert.equal(elencaGiri().length, prima);
});

/** Prima fase finta, finita a comando: fra le due fasi la prova occupa la rete. */
function faseFinta(fine: Promise<void>): FaseSequenza {
  return {
    nome: "Uno",
    avvia: async () => {
      const a = { id: "finto", done: fine.then(() => ({ status: "completed" as const })), progress: { total: 1 } };
      return a as unknown as AvvioDiscovery;
    },
  };
}

test("sequenza: un giro infilato fra due fasi si aspetta, poi la fase parte", async () => {
  const reteId = withTenant(T, preparaRete);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.5"] }).override);
  const c = cancello();
  let seconda = false;
  const { id } = await withTenant(T, () =>
    avviaSequenza({
      tenantCode: T,
      networkId: reteId,
      etichetta: "banco",
      tipo: "sequenza_scoperta",
      fasi: [faseFinta(c.promessa), { nome: "Due", avvia: (s) => ogniGiro(reteId)(s).then((a) => { seconda = true; return a; }) }],
    }),
  );
  const rilascia = prendiRete(T, reteId, { scanId: "altro", scanType: "fast" });
  c.apri();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(getScanProgress(id)!.status, "running", "la sequenza deve aspettare, non fallire");
  assert.equal(seconda, false);
  rilascia();
  await attendi(finito(id), "fine sequenza");
  assert.equal(getScanProgress(id)!.status, "completed", getScanProgress(id)!.error);
  assert.equal(seconda, true);
});

test("sequenza: lo stop interrompe anche l'attesa della rete", async () => {
  const reteId = withTenant(T, preparaRete);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [] }).override);
  const c = cancello();
  const { id } = await withTenant(T, () =>
    avviaSequenza({
      tenantCode: T,
      networkId: reteId,
      etichetta: "banco",
      tipo: "sequenza_scoperta",
      fasi: [faseFinta(c.promessa), { nome: "Due", avvia: ogniGiro(reteId) }],
    }),
  );
  const rilascia = prendiRete(T, reteId, { scanId: "altro", scanType: "fast" });
  c.apri();
  await new Promise((r) => setTimeout(r, 50));
  try {
    assert.equal(fermaGiro(id), true);
    await attendi(finito(id), "fine sequenza a rete ancora occupata");
    assert.equal(getScanProgress(id)!.fermato, true);
  } finally {
    rilascia();
  }
});

test("job programmato fermato a mano: non è un guasto del job", async () => {
  const reteId = withTenant(T, preparaRete);
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], cancello: c.promessa }).override);
  const jobId = Number(
    db().prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled) VALUES (?, 'ping_sweep', 60, 1)").run(reteId).lastInsertRowid,
  );
  const esito = await withTenant(T, () =>
    runJob(jobId, {
      onGiroAvviato: (id) => {
        fermaGiro(id);
        c.apri();
      },
    }),
  );
  assert.equal(esito.esito, "eseguito");
  assert.match(esito.motivo ?? "", /fermata dall'utente/);
  assert.equal(withTenant(T, () => statoHost(reteId)), "online");
});
