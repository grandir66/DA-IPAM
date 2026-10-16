// scripts/misura-router.ts
/**
 * misura-vm.ts — effetto di hypervisor e VM nel modello (spec topologia §11.5, tappa E)
 * su una COPIA del DB di un tenant: stesso ingresso con e senza le VM delle scansioni Proxmox.
 * Copia della copia in una cartella temporanea; stampa solo conteggi, mai nomi, IP o MAC.
 *
 * Uso:  npx tsx scripts/misura-vm.ts <copia.db> --cartella <scratchpad>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const cartella = val("--cartella");
  const liberi = a.filter((x, i) => !x.startsWith("--") && !["--cartella"].includes(a[i - 1] ?? ""));
  if (!cartella || liberi.length !== 1) {
    process.stderr.write("Uso: npx tsx scripts/misura-vm.ts <copia.db> --cartella <scratchpad>\n");
    return 2;
  }
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return 2;
  const lavoro = path.join(path.resolve(cartella), `misura-vm-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) {
    process.stderr.write(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}\n`);
    return 2;
  }
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);
  }

  // Import dinamico voluto: l'ambiente va impostato prima di caricare db-tenant (processo solo, fuori dall'app; ADR 0002 non si applica).
  const tenantDb = await import("../src/lib/db-tenant");
  tenantDb.getTenantDb(tenant);
  const { buildTopologyModel } = await import("../src/lib/topology/model");
  const { buildTree, autoVisible, proposeHead } = await import("../src/lib/topology/tree");
  const { resolveScanHosts } = await import("../src/lib/topology/vms");
  const { indiceDeiNodi } = await import("../src/lib/topology/node-index");

  const input = tenantDb.withTenant(tenant, () => tenantDb.getTopologyModelInput(2));
  const senza = buildTopologyModel({ ...input, vms: [], scanHosts: [] });
  const con = buildTopologyModel(input);
  const radici = (m: typeof con) => buildTree(m, autoVisible(m), proposeHead(m) ? [proposeHead(m)!] : []);
  const alberoSenza = radici(senza);
  const alberoCon = radici(con);

  const macVm = new Set(input.vms.flatMap((v) => v.macs));
  const clientDi = (m: typeof con) => m.portClients.flatMap((p) => p.clients.map((c) => c.mac));
  const dopo = new Set(con.isolated);
  const out = {
    scansioni_con_vm: new Set(input.vms.map((v) => v.scannedDeviceId)).size,
    vm_trovate: con.vms.length,
    vm_lette_prima_dei_doppioni: input.vms.length,
    host_di_cluster_letti: input.scanHosts.length,
    host_di_cluster_abbinati_a_un_hypervisor: resolveScanHosts(input.scanHosts, indiceDeiNodi(input)).filter((r) => r.nodeId !== null).length,
    hypervisor_riconosciuti: con.counts.hypervisors,
    hypervisor_con_vm: new Set(con.vms.map((v) => v.hypervisorNodeId).filter((x) => x !== null)).size,
    vm_senza_host_abbinato: con.vms.filter((v) => v.hypervisorNodeId === null).length,
    vm_che_coincidono_con_un_nodo: con.counts.vmsOnNodes,
    nodi_usciti_da_da_sistemare: senza.isolated.filter((id) => !dopo.has(id)).length,
    da_sistemare_prima_dopo: [senza.isolated.length, con.isolated.length],
    mac_di_vm_tolti_dai_client_delle_porte: clientDi(senza).filter((m) => macVm.has(m)).length,
    client_delle_porte_prima_dopo: [clientDi(senza).length, clientDi(con).length],
    collegamenti_prima_dopo: [senza.links.length, con.links.length],
    collegamenti_ridondanti: alberoCon.links.filter((l) => l.redundant).length,
    collegamenti_ridondanti_senza_vm: alberoSenza.links.filter((l) => l.redundant).length,
    collegamenti_scelti_a_mano: alberoCon.links.filter((l) => l.primary === "user").length,
    collegamenti_a_mano_confermati_non: con.links.filter((l) => l.manual && !l.manual.confirmed).length,
    radici_albero_automatico_prima_dopo: [alberoSenza.roots.length, alberoCon.roots.length],
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
