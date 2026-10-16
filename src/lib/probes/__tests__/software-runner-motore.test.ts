/**
 * L'inventario software sceglie la credenziale col motore unico (tappa 2
 * credenziali, T9, 16/10).
 *
 * Prima:
 * - per un host accettava solo voci `windows` o `linux`: una voce `ssh`, il
 *   tipo d'archivio per esteso, finiva in «Usa una credenziale 'windows' o
 *   'linux'»; e senza voce esplicita usava la porta fissa (5986/22), non
 *   quella della riga host scelta;
 * - per un apparato prendeva prima la colonna `credential_id` e solo dopo i
 *   binding (`getBestCredentialBindingForDevice`), al contrario del motore
 *   (D1: binding riusciti prima delle colonne).
 *
 * Si guarda cosa decide il runner, che non dipende dalla macchina: la voce che
 * lo scan registra e la porta scritta nel log «connect» prima della sonda. La
 * sonda vera passa da un ponte Python (paramiko) e verso un server locale che
 * chiude subito: fallisce, e va bene.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/probes/__tests__/software-runner-motore.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-software-motore";

import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { runSoftwareScan } from "../software-runner";

const T = "TESTSOFTWAREMOTORE";
const id: Record<string, number> = {};
let server: net.Server;
let porta = 0;

function scan(scanId: number): { credential_id: number | null; porta: number | null } {
  const d = getTenantDb(T);
  const r = d.prepare("SELECT credential_id FROM software_scans WHERE id = ?").get(scanId) as { credential_id: number | null };
  const log = d.prepare("SELECT details FROM software_scan_logs WHERE scan_id = ? AND step = 'connect'").get(scanId) as
    | { details: string | null }
    | undefined;
  const dettagli = log?.details ? (JSON.parse(log.details) as { port?: number }) : {};
  return { credential_id: r.credential_id, porta: dettagli.port ?? null };
}

describe("inventario software sul motore", () => {
  before(async () => {
    server = net.createServer((s) => s.destroy());
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    porta = (server.address() as net.AddressInfo).port;

    withTenant(T, () => {
      const d = getTenantDb(T);
      const voce = (nome: string, tipo: string, utente: string, pw: string): number =>
        Number(
          d
            .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
            .run(nome, tipo, encrypt(utente), encrypt(pw)).lastInsertRowid,
        );
      const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('127.0.0.0/24', 'Rete locale')").run().lastInsertRowid);

      id.sshEsplicita = voce("SSH scelta a mano", "ssh", "root", "pw");
      id.hostEsplicito = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '127.0.0.1')").run(rete).lastInsertRowid);

      id.sshRiga = voce("SSH della riga host", "ssh", "root", "pw");
      const rete2 = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('127.0.1.0/24', 'Seconda rete locale')").run().lastInsertRowid);
      id.hostMotore = Number(d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '127.0.0.1')").run(rete2).lastInsertRowid);
      d.prepare(
        "INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, sort_order) VALUES (?, ?, 'ssh', ?, 1, 0)",
      ).run(id.hostMotore, id.sshRiga, porta);

      id.colonna = voce("SSH nella colonna", "ssh", "colonna", "pw");
      id.binding = voce("SSH del binding riuscito", "ssh", "binding", "pw");
      id.apparato = Number(
        d
          .prepare(
            "INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id) VALUES ('Server Linux', '127.0.0.1', 'server', 'linux', 'ssh', ?, ?)",
          )
          .run(porta, id.colonna).lastInsertRowid,
      );
      d.prepare(
        "INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (?, ?, 'ssh', ?, 0, 'success')",
      ).run(id.apparato, id.binding, porta);
    });
  });

  after(async () => {
    deleteTenantDatabase(T);
    await new Promise<void>((ok) => server.close(() => ok()));
  });

  it("host con una voce ssh scelta a mano: inventario accettato (oggi «Usa una credenziale 'windows' o 'linux'»)", async () => {
    const r = await withTenant(T, () =>
      runSoftwareScan({ target: { kind: "host", hostId: id.hostEsplicito }, credentialId: id.sshEsplicita, port: porta, timeoutMs: 5000 }),
    );
    assert.deepEqual(scan(r.scanId), { credential_id: id.sshEsplicita, porta });
  });

  it("host senza voce esplicita: il motore sceglie la riga host, con la porta della riga", async () => {
    const r = await withTenant(T, () => runSoftwareScan({ target: { kind: "host", hostId: id.hostMotore }, timeoutMs: 5000 }));
    assert.deepEqual(scan(r.scanId), { credential_id: id.sshRiga, porta });
  });

  it("apparato: il binding riuscito prima della colonna (D1; oggi la colonna)", async () => {
    const r = await withTenant(T, () => runSoftwareScan({ target: { kind: "device", deviceId: id.apparato }, timeoutMs: 5000 }));
    assert.deepEqual(scan(r.scanId), { credential_id: id.binding, porta });
  });
});
