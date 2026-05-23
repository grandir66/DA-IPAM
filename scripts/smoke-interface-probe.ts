/**
 * Smoke test runtime per il probe interfacce + identity resolver.
 *
 * Itera tutti i `network_devices` di un tenant, lancia `probeDeviceInterfaces`
 * e (se ottiene risultati) `resolvePhysicalDevice`. Stampa per ogni device:
 *   - sorgente probe (snmp_ip_mib_v4v6 / snmp_ip_mib_v4_legacy / none)
 *   - n. interfacce + n. IP
 *   - physical_device match/created
 *   - host promossi
 *
 * Uso: npx tsx scripts/smoke-interface-probe.ts --tenant=70791 [--device-id=15]
 */

import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const args = process.argv.slice(2);
  const tenant = args.find((a) => a.startsWith("--tenant="))?.split("=")[1];
  const deviceIdFilter = args.find((a) => a.startsWith("--device-id="))?.split("=")[1];
  if (!tenant) {
    console.error("Uso: npx tsx scripts/smoke-interface-probe.ts --tenant=<code> [--device-id=<id>]");
    process.exit(1);
  }

  const { withTenant } = await import("../src/lib/db-tenant");

  await withTenant(tenant, async () => {
    const { getDb } = await import("../src/lib/db");
    const { probeDeviceInterfaces } = await import("../src/lib/devices/interface-probe");
    const { resolvePhysicalDevice } = await import("../src/lib/devices/identity-resolver");

    let devices = getDb()
      .prepare("SELECT * FROM network_devices ORDER BY id")
      .all() as Array<{ id: number; name: string; host: string; vendor: string; protocol: string; snmp_credential_id: number | null; community_string: string | null }>;
    if (deviceIdFilter) devices = devices.filter((d) => String(d.id) === deviceIdFilter);

    console.log(`\n=== Smoke probe interfacce — tenant ${tenant} — ${devices.length} device ===\n`);
    let withInterfaces = 0;
    let promotedTotal = 0;
    for (const d of devices) {
      try {
        // Cast minimo: il probe legge solo i campi SNMP del device
        const outcome = await probeDeviceInterfaces(d as never);
        const ifaceCount = outcome.interfaces.length;
        const addrCount = outcome.interfaces.reduce((n, i) => n + i.addresses.length, 0);
        const head = `#${String(d.id).padStart(3)} ${d.name.slice(0, 28).padEnd(28)} ${d.host.padEnd(18)} ${d.vendor.padEnd(12)}`;
        if (outcome.source === "none") {
          console.log(`${head}  · SNMP non configurato`);
          continue;
        }
        if (ifaceCount === 0) {
          console.log(`${head}  ⚠ 0 interfacce (${outcome.warnings.slice(0, 1).join("; ")})`);
          continue;
        }
        withInterfaces++;
        const resolved = resolvePhysicalDevice(d as never, outcome);
        const created = resolved.promoted_hosts.filter((h) => h.created).length;
        promotedTotal += created;
        const label = resolved.created
          ? `creato phys#${resolved.physical_device_id}`
          : `match phys#${resolved.physical_device_id} (${resolved.identity_anchor} ${resolved.identity_confidence})`;
        console.log(
          `${head}  ✓ ${outcome.source.padEnd(22)}  ${String(ifaceCount).padStart(2)} if / ${String(addrCount).padStart(2)} ip  ${label}  +${created} host`
        );
      } catch (e) {
        console.log(`#${d.id} ${d.name}: ✗ ${(e as Error).message.slice(0, 80)}`);
      }
    }
    console.log(
      `\n=== Riepilogo: ${withInterfaces}/${devices.length} device con interfacce, ${promotedTotal} nuovi host promossi ===\n`
    );
  });
}

main().catch((e) => {
  console.error("[smoke] fatale:", e);
  process.exit(2);
});
