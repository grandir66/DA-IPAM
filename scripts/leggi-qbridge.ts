/**
 * Una lettura una tantum, in SOLA LETTURA, delle tabelle Q-BRIDGE-MIB e di `dot1dBasePortIfIndex` di uno switch
 * (gli switch dell'hub, di Domarc, non di un cliente) per ricavarne le fixture anonime del lettore delle VLAN
 * (`src/lib/devices/snmp-vlan.ts`). Sette walk con `creaWalkSnmp` dell'apparato (una sessione e 20 s ciascuna),
 * nessun SET. Nel file (permessi 600) le voci grezze: OID e valore (i Buffer in esadecimale). A schermo SOLO
 * conteggi ed esiti: mai nomi delle VLAN né valori. Rifiuta (uscita 2) un apparato senza credenziale SNMP.
 *
 * Gira sull'hub, meglio su una COPIA dei DB (DA_INVENT_DATA_DIR e DA_IPAM_HUB_DB_PATH sulla copia):
 *   node --env-file=.env.local --import tsx scripts/leggi-qbridge.ts --tenant 70791 --device 7 --uscita /root/qbridge-7.json
 */
import fs from "node:fs";
import { withTenant } from "../src/lib/db-tenant";
import { getNetworkDeviceById, haSnmpApparato } from "../src/lib/db";
import { creaWalkSnmp } from "../src/lib/devices/switch-client";
import { OID_QBRIDGE } from "../src/lib/devices/snmp-vlan";

type VoceGrezza = { oid: string; hex?: string; num?: number; str?: string };
type WalkGrezza = { oid: string; voci: VoceGrezza[] | null; codice: string | null };

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: leggi-qbridge.ts --tenant <codice> --device <id> --uscita <file>\n");
  return 2;
}

function grezza(v: { oid: string; value: unknown }): VoceGrezza {
  if (Buffer.isBuffer(v.value)) return { oid: v.oid, hex: v.value.toString("hex") };
  if (typeof v.value === "number") return { oid: v.oid, num: v.value };
  return { oid: v.oid, str: String(v.value) };
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const tenant = val("--tenant");
  const id = Number(val("--device"));
  const uscita = val("--uscita");
  if (!tenant || !uscita || !Number.isInteger(id)) return uso();

  const esito = await withTenant(tenant, async () => {
    const device = getNetworkDeviceById(id);
    if (!device) return { errore: "Apparato non trovato." };
    if (!haSnmpApparato(device)) return { errore: "L'apparato non ha una credenziale SNMP: non leggo." };
    const walk = await creaWalkSnmp(device, 20_000);
    const walks: Record<string, WalkGrezza> = {};
    for (const [nome, oid] of Object.entries(OID_QBRIDGE)) {
      try {
        const voci = (await walk(oid)).map(grezza);
        walks[nome] = { oid, voci, codice: null };
        process.stdout.write(`${nome}: ${voci.length} voci\n`);
      } catch (e) {
        const codice = (e as { code?: string }).code ?? "errore";
        walks[nome] = { oid, voci: null, codice };
        process.stdout.write(`${nome}: non letta (${codice})\n`);
      }
    }
    return { walks };
  });
  if ("errore" in esito) return uso(esito.errore);
  fs.writeFileSync(uscita, JSON.stringify({ device: id, walks: esito.walks }), { mode: 0o600 });
  fs.chmodSync(uscita, 0o600);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    process.stderr.write(`Lettura non riuscita: ${(e as { code?: string }).code ?? "errore"}\n`);
    process.exit(1);
  },
);
