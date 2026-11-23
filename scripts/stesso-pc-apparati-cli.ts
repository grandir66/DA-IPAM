// scripts/stesso-pc-apparati-cli.ts
// Un PC, un apparato, un asset (src/lib/devices/stesso-pc-apparati.ts, 23/11/2026).
//
// Uso:
//   npx tsx scripts/stesso-pc-apparati-cli.ts <tenantCode>             prova a vuoto: chi resta, chi si unisce, dove va
//   npx tsx scripts/stesso-pc-apparati-cli.ts <tenantCode> --applica   unisce e sposta (anche verso righe offline)
//
// Il giro dopo ogni scansione fa lo stesso, ma sposta solo verso una riga viva. Prima di --applica: copia del DB.
import { withTenant, getTenantDb, closeTenantDb } from "@/lib/db-tenant";
import { applicaApparatiPc, pianoApparatiPc } from "@/lib/devices/stesso-pc-apparati";

const [tenant, ...resto] = process.argv.slice(2);
if (!tenant) {
  console.error("Uso: npx tsx scripts/stesso-pc-apparati-cli.ts <tenantCode> [--applica]");
  process.exit(1);
}
const applica = resto.includes("--applica");

withTenant(tenant, () => {
  const db = getTenantDb(tenant);
  const nome = db.prepare("SELECT name || ' @ ' || host AS n FROM network_devices WHERE id = ?");
  const n = (id: number) => `#${id} ${(nome.get(id) as { n: string } | undefined)?.n ?? "?"}`;
  const piani = pianoApparatiPc(db);
  for (const p of piani) {
    console.log(`${p.pc.toUpperCase()}${p.salta ? `  — SALTATO: ${p.salta}` : ""}`);
    console.log(`  resta ${n(p.tieni)}${p.verso ? ` → va su ${p.verso.ip} (riga ${p.verso.hostId}, ${p.verso.online ? "online" : "offline"})` : ""}`);
    for (const id of p.daUnire) console.log(`  si unisce e va via ${n(id)}`);
    console.log(`  asset: resta ${p.asset.tieni ?? "nessuno"}${p.asset.daUnire.length ? `, si uniscono ${p.asset.daUnire.join(", ")}` : ""}${p.asset.assegnatario ? `, assegnatario ${p.asset.assegnatario}` : ""}`);
  }
  if (applica) {
    const e = applicaApparatiPc(db, piani, null);
    console.log(`APPLICATO: ${e.uniti} apparati uniti, ${e.spostati} spostati, ${e.assetUniti} asset uniti, ${e.saltati.length} PC saltati`);
  } else {
    console.log(`PROVA A VUOTO: ${piani.length} PC, ${piani.reduce((s, p) => s + p.daUnire.length, 0)} apparati da unire, ${piani.filter((p) => p.salta).length} saltati`);
  }
});
closeTenantDb(tenant);
