/**
 * Una lettura una tantum, in SOLA LETTURA, delle uscite vere di un MikroTik
 * (il router dell'hub, di Domarc, non di un cliente) per ricavarne fixture
 * anonime della scheda MikroTik. Una connessione SSH, dieci comandi di stampa,
 * uscite nel file (permessi 600) separate da «### <comando>». A schermo SOLO
 * comando, righe e byte: mai il contenuto (IP, nomi e utenti del router).
 * Rifiuta (uscita 2) se l'apparato non è vendor mikrotik con protocollo ssh.
 *
 * Gira sull'hub:
 *   node --env-file=.env.local --import tsx scripts/leggi-uscite-mikrotik.ts --tenant 70791 --device 1 --uscita /root/uscite-mk-<data>.txt
 */
import fs from "node:fs";
import { withTenant } from "../src/lib/db-tenant";
import { getNetworkDeviceById } from "../src/lib/db";
import { apriEsecutoreSsh } from "../src/lib/devices/mikrotik-letture";

/** Solo comandi di stampa: nessuno scrive sul router. */
const COMANDI = [
  "/system resource print",
  "/system routerboard print",
  "/ip arp print terse",
  "/ip dhcp-server print terse",
  "/ip pool print terse",
  "/interface bridge print terse without-paging",
  "/interface bridge vlan print terse without-paging",
  "/interface vlan print terse without-paging",
  "/ip dns print",
  "/user print terse without-paging",
];

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: leggi-uscite-mikrotik.ts --tenant <codice> --device <id> --uscita <file>\n");
  return 2;
}

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const val = (k: string) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : undefined);
  const tenant = val("--tenant");
  const id = Number(val("--device"));
  const uscita = val("--uscita");
  if (!tenant || !uscita || !Number.isInteger(id)) return uso();

  const device = withTenant(tenant, () => getNetworkDeviceById(id));
  if (!device) return uso("Apparato non trovato.");
  if (device.vendor !== "mikrotik" || device.protocol !== "ssh") {
    return uso("L'apparato non è un MikroTik raggiunto in ssh: non leggo.");
  }

  const pezzi: string[] = [];
  await withTenant(tenant, () =>
    apriEsecutoreSsh(device, async (esegui) => {
      for (const c of COMANDI) {
        const out = await esegui(c, 20_000);
        pezzi.push(`### ${c}\n${out}\n`);
        const righe = out.split("\n").filter((r) => r.trim() !== "").length;
        process.stdout.write(`${c}: ${righe} righe, ${Buffer.byteLength(out)} byte\n`);
      }
    }),
  );
  fs.writeFileSync(uscita, pezzi.join(""), { mode: 0o600 });
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
