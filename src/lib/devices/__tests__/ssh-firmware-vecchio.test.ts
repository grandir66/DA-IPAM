/**
 * Firmware SSH vecchi (70151, 22/10): HP5700-Storage, Comware 7.1.045 Release 2422P02, offre solo scambio di chiavi SHA-1,
 * chiave host `ssh-rsa` e cifrature CBC. Il client dell'app proponeva solo GCM/CTR/ChaCha: «no matching cipher» e l'SSH
 * non entrava, con la credenziale giusta. Le CBC (AES) stanno in fondo all'elenco: si usano solo se l'apparato non offre
 * altro; 3DES e DES restano fuori.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/devices/__tests__/ssh-firmware-vecchio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sshExec } from "@/lib/devices/ssh-transport";
import { serverSshProva } from "./support/server-ssh-chiave";

const COMWARE_2422 = {
  kex: ["diffie-hellman-group14-sha1"], cipher: ["aes128-cbc"], serverHostKey: ["ssh-rsa"], hmac: ["hmac-sha1"],
} as const;

test("un server che offre solo SHA-1, ssh-rsa e AES-CBC: l'SSH entra ed esegue il comando", async () => {
  const srv = await serverSshProva({ password: "giusta", algoritmi: COMWARE_2422 as never, chiaveHostRsa: true, risposta: () => "Comware 7.1.045\n" });
  try {
    const r = await sshExec({ host: "127.0.0.1", port: srv.porta, username: "lettore", password: "giusta", timeout: 8000 }, "display version");
    assert.match(r.stdout, /Comware/);
  } finally {
    await srv.chiudi();
  }
});

test("un server che offre solo 3DES: resta fuori (nessuna cifratura comune)", async () => {
  const srv = await serverSshProva({ password: "giusta", algoritmi: { ...COMWARE_2422, cipher: ["3des-cbc"] } as never, chiaveHostRsa: true });
  try {
    await assert.rejects(sshExec({ host: "127.0.0.1", port: srv.porta, username: "lettore", password: "giusta", timeout: 8000 }, "display version"));
  } finally {
    await srv.chiudi();
  }
});
