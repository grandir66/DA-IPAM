// scripts/credenziali/prova-a-vuoto.ts
/**
 * Prova a vuoto delle migrazioni della tappa 2 credenziali, sulla COPIA dei
 * dati (T11 del piano 2026-10-15-tappa2-archivio-credenziali, procedura R
 * passo 2; si estende nei T16, T19, T22 e T27).
 *
 * Questo script SCRIVE: apre ogni tenant della copia con getTenantDb, cioè con
 * tutte le migrazioni, come al riavvio vero. Per ogni tenant:
 *   1. conta in sola lettura PRIMA: righe di credentials, figli per colonna,
 *      violazioni delle chiavi esterne, contatore, segni credenziali_t2_*;
 *   2. apre con getTenantDb (migrazioni);
 *   3. conta DOPO e stampa le differenze, coi nomi delle voci a terminale;
 *   4. chiude e riapre: la seconda apertura non deve cambiare niente.
 * Dalla 2d (T16) anche le catene: righe della lista delle reti, delle righe
 * host, delle catene vecchie e dei pin prima → dopo; le voci entrate nella
 * lista e le righe host nuove, per nome; per ogni rete la sequenza del motore
 * per ssh, winrm e snmp, che deve restare uguale (proprietà della 2d).
 * Dalla 2e (T19) anche gli apparati: righe dei binding, inline e apparati con
 * colonne piene prima → dopo; per nome i binding nati dalle colonne (protocollo
 * e porta), le voci nuove, le community diventate voce, le colonne svuotate,
 * gli inline rimasti e gli apparati lasciati col motivo. Le scelte (porta e
 * segreto) le confronta la fotografia, sullo stesso istante.
 *
 * Ordine obbligato (vincolo «Script sulle copie»): db-tenant e db-hub fissano i
 * percorsi quando si caricano, e l'ambiente del servizio punta ai dati veri.
 *   1. qui si importano staticamente solo moduli di node e la guardia pura;
 *   2. si sposta l'ambiente su --dati;
 *   3. solo dopo si carica `appoggio-prova` (che importa db-tenant);
 *   4. prima di aprire un DB, la guardia ricontrolla i percorsi che i moduli
 *      useranno davvero. Ogni errore: uscita 2, niente aperto.
 *
 * Uso:  npx tsx scripts/credenziali/prova-a-vuoto.ts --dati <copia> [--dati-servizio <cartella>]
 *   Serve ENCRYPTION_KEY (ambiente del servizio, caricato senza stamparlo).
 *   Senza DA_INVENT_DATA_DIR nell'ambiente (l'hub non ce l'ha) serve
 *   --dati-servizio con la cartella dati del servizio.
 *   Uscita: 0 tutto in regola, 1 da guardare (seconda apertura che cambia,
 *   segno errore: o parziale:, tenant che non si apre, catene del motore
 *   diverse o non misurabili), 2 non partito.
 */
import path from "node:path";
import { cartelleServizio, controllaCopia } from "../../src/lib/credentials/guardia-copia";

type Misura = import("./appoggio-prova").Misura;
type Lasciati = Array<{ device_id: number; motivo: string }>;

const NOME_PROTOCOLLO: Record<string, string> = { ssh: "SSH", snmp: "SNMP", winrm: "WinRM", api: "API", redfish: "Redfish", onvif: "ONVIF" };

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/credenziali/prova-a-vuoto.ts --dati <copia dei dati> [--dati-servizio <cartella>]\n");
  return 2;
}

function figli(prima: Misura, dopo: Misura): string[] {
  const chiavi = [...new Set([...Object.keys(prima.stato.figli), ...Object.keys(dopo.stato.figli)])].sort();
  return chiavi.map((k) => {
    const a = prima.stato.figli[k];
    const b = dopo.stato.figli[k];
    return `  ${k}: ${a ?? "-"} → ${b ?? "-"}${a === b ? "" : "  (DIVERSO)"}`;
  });
}

function voci(prima: Misura, dopo: Misura): string[] {
  const out: string[] = [];
  const primaPerId = new Map(prima.voci.map((v) => [v.id, v]));
  const dopoPerId = new Map(dopo.voci.map((v) => [v.id, v]));
  for (const v of dopo.voci) {
    const p = primaPerId.get(v.id);
    if (!p) out.push(`  #${v.id} «${v.name}»: nuova, ${v.credential_type}`);
    else if (p.credential_type !== v.credential_type || p.name !== v.name) {
      out.push(`  #${v.id} «${v.name}»: ${p.credential_type} → ${v.credential_type}${p.name !== v.name ? ` (era «${p.name}»)` : ""}`);
    }
  }
  for (const p of prima.voci) if (!dopoPerId.has(p.id)) out.push(`  #${p.id} «${p.name}»: SPARITA`);
  return out;
}

function nomeVoce(prima: Misura, dopo: Misura, id: number | string): string {
  const n = Number(id);
  const v = dopo.voci.find((x) => x.id === n) ?? prima.voci.find((x) => x.id === n);
  return `«${v?.name ?? "?"}» (#${id})`;
}

function nomeRete(prima: Misura, dopo: Misura, id: number | string): string {
  return `rete «${dopo.catene.reti[String(id)] ?? prima.catene.reti[String(id)] ?? "?"}» (#${id})`;
}

/** Catene (2d): righe, voci entrate e uscite dalla lista, righe host nuove, catene del motore. Vero se c'è da guardare. */
function stampaCatene(prima: Misura, dopo: Misura): boolean {
  const c1 = prima.catene;
  const c2 = dopo.catene;
  const r = (m: Misura["catene"], k: "lista" | "righeHost" | "catenaVecchia" | "pin") => (m.righe ? String(m.righe[k]) : "-");
  process.stdout.write(
    `catene (2d): lista delle reti ${r(c1, "lista")} → ${r(c2, "lista")}, righe host ${r(c1, "righeHost")} → ${r(c2, "righeHost")}, ` +
      `catene vecchie ${r(c1, "catenaVecchia")} → ${r(c2, "catenaVecchia")}, pin ${r(c1, "pin")} → ${r(c2, "pin")}\n`
  );
  const chiave = (x: { network_id: number; credential_id: number }) => `${x.network_id}:${x.credential_id}`;
  const k1 = new Set(c1.lista.map(chiave));
  const k2 = new Set(c2.lista.map(chiave));
  const riga = (x: { network_id: number; credential_id: number }) =>
    `  ${nomeRete(prima, dopo, x.network_id)}: ${nomeVoce(prima, dopo, x.credential_id)}`;
  const entrate = c2.lista.filter((x) => !k1.has(chiave(x))).map(riga);
  const uscite = c1.lista.filter((x) => !k2.has(chiave(x))).map(riga);
  process.stdout.write(`voci entrate nella lista:\n${entrate.join("\n") || "  (nessuna)"}\n`);
  if (uscite.length > 0) process.stdout.write(`voci USCITE dalla lista:\n${uscite.join("\n")}\n`);
  const idHost = new Set(c1.righeHost.map((h) => h.id));
  const nuove = c2.righeHost
    .filter((h) => !idHost.has(h.id))
    .map((h) => `  host ${h.ip} (#${h.host_id}): ${nomeVoce(prima, dopo, h.credential_id)} ${h.protocol_type}/${h.port}`);
  process.stdout.write(`righe host nuove:\n${nuove.join("\n") || "  (nessuna)"}\n`);

  if (c1.errore || c2.errore) {
    process.stdout.write(`catene del motore non misurabili: prima ${c1.errore ?? "ok"}; dopo ${c2.errore ?? "ok"}\n`);
    return true;
  }
  const chiaviCatene = [...new Set([...Object.keys(c1.catene), ...Object.keys(c2.catene)])].sort();
  const diverse: string[] = [];
  const leggibile = (xs: string[] | undefined) =>
    xs === undefined ? "(rete assente)" : xs.map((x) => `${nomeVoce(prima, dopo, x.split(":")[0])}:${x.split(":")[1]}`).join(", ") || "(vuota)";
  for (const k of chiaviCatene) {
    const a = c1.catene[k];
    const b = c2.catene[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const [rete, protocollo] = k.split(":");
    diverse.push(`  ${nomeRete(prima, dopo, rete)} ${protocollo}: prima ${leggibile(a)} → dopo ${leggibile(b)}`);
  }
  if (diverse.length === 0) {
    process.stdout.write("catene del motore (ssh, winrm, snmp): uguali prima e dopo\n");
    return false;
  }
  process.stdout.write(`catene del motore (ssh, winrm, snmp): DIVERSE\n${diverse.join("\n")}\n`);
  return true;
}

/**
 * Apparati (2e): binding nati dalle colonne, voci nuove, community diventate
 * voce, colonne svuotate, inline rimasti, lasciati col motivo. Vero se c'è da
 * guardare oltre al segno (che `parziale:` lo dice già): binding spariti,
 * inline o colonne rimasti fuori dai lasciati, lasciati non misurabili.
 */
function stampaApparati(prima: Misura, dopo: Misura, lasciati: Lasciati | { errore: string }): boolean {
  const a1 = prima.apparati;
  const a2 = dopo.apparati;
  const r = (m: Misura["apparati"], k: "binding" | "inline" | "conColonne") => (m.righe ? String(m.righe[k]) : "-");
  process.stdout.write(
    `apparati (2e): binding ${r(a1, "binding")} → ${r(a2, "binding")}, inline ${r(a1, "inline")} → ${r(a2, "inline")}, ` +
      `apparati con colonne piene ${r(a1, "conColonne")} → ${r(a2, "conColonne")}\n`
  );
  let daGuardare = false;
  const app = (id: number | string) => `apparato «${a2.apparati[String(id)]?.nome ?? a1.apparati[String(id)]?.nome ?? "?"}» (#${id})`;
  const proto = (p: string) => NOME_PROTOCOLLO[p] ?? p;
  const vociPrima = new Set(prima.voci.map((v) => v.id));
  const bindingPrima = new Map(a1.binding.map((b) => [b.id, b]));
  const bindingDopo = new Set(a2.binding.map((b) => b.id));

  const nati = a2.binding.filter((b) => !bindingPrima.has(b.id));
  const voceNuova = (id: number | null) => id != null && !vociPrima.has(id);
  const righeNati = nati.map(
    (b) => `  ${app(b.device_id)}: ${proto(b.protocol_type)}/${b.port} → ${nomeVoce(prima, dopo, b.credential_id ?? "-")}${voceNuova(b.credential_id) ? ", voce nuova" : ""}`
  );
  process.stdout.write(`binding nati dalle colonne:\n${righeNati.join("\n") || "  (nessuno)"}\n`);

  const nuove = dopo.voci.filter((v) => !vociPrima.has(v.id));
  const righeVoci = nuove.map((v) => {
    const b = a2.binding.find((x) => x.credential_id === v.id);
    if (!b) return `  «${v.name}» (#${v.id}): nessun binding la punta`;
    const daInline = bindingPrima.get(b.id)?.credential_id === null;
    return `  «${v.name}» (#${v.id}): ${app(b.device_id)}, ${daInline ? "da binding inline" : "da colonne"}`;
  });
  process.stdout.write(`voci nuove:\n${righeVoci.join("\n") || "  (nessuna)"}\n`);

  const community = nati
    .filter((b) => b.protocol_type === "snmp" && voceNuova(b.credential_id))
    .map((b) => `  ${app(b.device_id)}: ${nomeVoce(prima, dopo, b.credential_id ?? "-")}`);
  process.stdout.write(`community diventate voce:\n${community.join("\n") || "  (nessuna)"}\n`);

  const svuotate: string[] = [];
  for (const [id, x] of Object.entries(a1.apparati)) {
    const restano = new Set(a2.apparati[id]?.colonne ?? []);
    const via = x.colonne.filter((c) => !restano.has(c));
    if (via.length > 0) svuotate.push(`  ${app(id)}: ${via.join(", ")}`);
  }
  process.stdout.write(`colonne svuotate:\n${svuotate.join("\n") || "  (nessuna)"}\n`);

  const spariti = a1.binding.filter((b) => !bindingDopo.has(b.id));
  if (spariti.length > 0) {
    daGuardare = true;
    process.stdout.write(`binding SPARITI:\n${spariti.map((b) => `  ${app(b.device_id)}: #${b.id} ${proto(b.protocol_type)}/${b.port}`).join("\n")}\n`);
  }

  const idLasciati = new Set("errore" in lasciati ? [] : lasciati.map((l) => String(l.device_id)));
  const inline = a2.binding.filter((b) => b.credential_id == null);
  process.stdout.write(`inline rimasti: ${inline.length}\n`);
  for (const b of inline) {
    process.stdout.write(`  ${app(b.device_id)}: #${b.id} ${proto(b.protocol_type)}/${b.port}\n`);
    if (!idLasciati.has(String(b.device_id))) daGuardare = true;
  }
  for (const [id, x] of Object.entries(a2.apparati)) {
    if (x.colonne.length > 0 && !idLasciati.has(id)) {
      daGuardare = true;
      process.stdout.write(`colonne ancora piene fuori dai lasciati: ${app(id)}: ${x.colonne.join(", ")}\n`);
    }
  }

  if ("errore" in lasciati) {
    process.stdout.write(`lasciati: non misurabili (${lasciati.errore})\n`);
    return true;
  }
  process.stdout.write(`lasciati:\n${lasciati.map((l) => `  ${app(l.device_id)}: ${l.motivo}`).join("\n") || "  (nessuno)"}\n`);
  return daGuardare;
}

function stampaTenant(code: string, prima: Misura, dopo: Misura): boolean {
  const s1 = prima.stato;
  const s2 = dopo.stato;
  process.stdout.write(`== Tenant ${code}\n`);
  process.stdout.write(
    `credentials: righe ${s1.righe} → ${s2.righe}, violazioni ${s1.violazioni ?? "-"} → ${s2.violazioni ?? "-"}, seq ${s1.seq ?? "-"} → ${s2.seq ?? "-"}\n`
  );
  process.stdout.write(`figli per colonna:\n${figli(prima, dopo).join("\n") || "  (nessuna colonna figlia)"}\n`);
  const segni = [...new Set([...Object.keys(prima.segni), ...Object.keys(dopo.segni)])].sort();
  process.stdout.write(`segni:\n${segni.map((k) => `  ${k}: ${prima.segni[k] ?? "(assente)"} → ${dopo.segni[k] ?? "(assente)"}`).join("\n") || "  (nessuno)"}\n`);
  const v = voci(prima, dopo);
  process.stdout.write(`voci cambiate:\n${v.join("\n") || "  (nessuna)"}\n`);
  return stampaCatene(prima, dopo);
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  // Un'opzione scritta senza valore vale "" (errore), non «assente».
  const val = (k: string) => (a.indexOf(k) >= 0 ? (a[a.indexOf(k) + 1] ?? "") : undefined);
  const datiArg = val("--dati");
  if (!datiArg) return uso();
  if (!process.env.ENCRYPTION_KEY?.trim()) return uso("ENCRYPTION_KEY assente: carica l'ambiente del servizio prima di lanciare la prova a vuoto.");

  // Le cartelle dati del servizio, lette PRIMA di sovrascrivere l'ambiente.
  const servizio = cartelleServizio(process.env, val("--dati-servizio"), process.cwd());
  if (!servizio.ok) return uso(`Non parto: ${servizio.motivo}`);
  const dati = path.resolve(datiArg);
  const attesi = { dati, hubDb: path.join(dati, "hub.db"), cartellaTenant: path.join(dati, "tenants"), datiServizio: servizio.cartelle };
  const erroriPrima = controllaCopia(attesi);
  if (erroriPrima.length > 0) return uso(`Non parto:\n${erroriPrima.map((e) => `  - ${e}`).join("\n")}`);

  process.env.DA_INVENT_DATA_DIR = attesi.dati;
  process.env.DA_IPAM_HUB_DB_PATH = attesi.hubDb;
  const appoggio = await import("./appoggio-prova");
  const erroriDopo = controllaCopia({ ...attesi, hubDb: appoggio.getHubDbPath(), cartellaTenant: appoggio.cartellaTenant() });
  if (erroriDopo.length > 0) return uso(`Non parto (percorsi dei moduli):\n${erroriDopo.map((e) => `  - ${e}`).join("\n")}`);

  let esito = 0;
  for (const code of appoggio.elencaTenant()) {
    let prima: Misura;
    let dopo: Misura;
    let riapertura: Misura;
    try {
      prima = appoggio.misuraFile(code);
      dopo = appoggio.apriEMisura(code);
      riapertura = appoggio.apriEMisura(code);
    } catch (e) {
      process.stdout.write(`== Tenant ${code}\nERRORE: ${e instanceof Error ? e.message : String(e)}\n`);
      esito = 1;
      continue;
    }
    if (stampaTenant(code, prima, dopo)) {
      process.stdout.write("DA GUARDARE: catene del motore diverse o non misurabili\n");
      esito = 1;
    }
    let lasciati: Lasciati | { errore: string };
    try {
      lasciati = appoggio.lasciatiApparati(code);
    } catch (e) {
      lasciati = { errore: e instanceof Error ? e.message : String(e) };
    }
    if (stampaApparati(prima, dopo, lasciati)) {
      process.stdout.write("DA GUARDARE: apparati con binding spariti, inline o colonne rimasti fuori dai lasciati, o lasciati non misurabili\n");
      esito = 1;
    }
    if (JSON.stringify(riapertura) === JSON.stringify(dopo)) {
      process.stdout.write("seconda apertura: nessun cambiamento\n");
    } else {
      process.stdout.write("seconda apertura: CAMBIA QUALCOSA\n");
      stampaTenant(`${code} (seconda apertura)`, dopo, riapertura);
      esito = 1;
    }
    for (const [k, v] of Object.entries(dopo.segni)) {
      if (v.startsWith("errore:") || v.startsWith("parziale:")) {
        process.stdout.write(`DA GUARDARE: ${k} = ${v}\n`);
        esito = 1;
      }
    }
  }
  appoggio.chiudiTutto();
  return esito;
}

function esci(codice: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(codice)));
}

main().then(esci, (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  esci(2);
});
