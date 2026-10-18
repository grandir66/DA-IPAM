/**
 * Chiave SSH nel trasporto principale (tappa 2 credenziali, T14, D6 = (a), 16/10).
 *
 * Prima `SshOptions.password` era obbligatoria e l'authHandler di
 * `ssh-transport.ts` provava solo `password` e `keyboard-interactive`: una voce
 * SSH a chiave (tipo `ssh`, metodo `chiave`, nata nella 2c) arrivava al
 * trasporto senza password e il server la rifiutava; un apparato che accetta
 * solo `publickey` non si poteva acquisire. Allo stesso modo l'SSH di Proxmox
 * (`ProxmoxSshConfig.password: string`, acquisizione di `hypervisor_sync`).
 *
 * D6 dice anche i formati: OpenSSH e PEM (RSA, ECDSA, ed25519), passphrase
 * facoltativa. ssh2 da solo non legge il PEM PKCS#8 («BEGIN PRIVATE KEY»),
 * l'unico PEM di una ed25519: il trasporto lo converte.
 *
 * Server ssh2 in memoria su 127.0.0.1 (support/server-ssh-chiave), niente rete.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/devices/__tests__/ssh-chiave.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { utils } from "ssh2";
import { sshExec, SshError } from "@/lib/devices/ssh-transport";
import { extractProxmoxViaSsh, readLiveInterfaces, testProxmoxSsh } from "@/lib/proxmox/proxmox-ssh";
import { ed25519Prova, rigaPubblicaDaPem, serverSshProva } from "./support/server-ssh-chiave";

const ed25519 = ed25519Prova();
const ed25519Cifrata = ed25519Prova({ passphrase: "frase segreta", cipher: "aes256-cbc", rounds: 16 });
const altra = ed25519Prova();

function pem(alg: "rsa" | "ec" | "ed25519", tipo: "pkcs1" | "sec1" | "pkcs8", passphrase?: string): string {
  const cifra = passphrase ? { cipher: "aes-256-cbc", passphrase } : {};
  const pubblica = { type: "spki", format: "pem" } as const;
  if (alg === "rsa") {
    if (tipo === "sec1") throw new Error("SEC1 è solo per ECDSA");
    return generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: pubblica, privateKeyEncoding: { type: tipo, format: "pem", ...cifra } }).privateKey;
  }
  if (alg === "ec") {
    if (tipo === "pkcs1") throw new Error("PKCS#1 è solo per RSA");
    return generateKeyPairSync("ec", { namedCurve: "prime256v1", publicKeyEncoding: pubblica, privateKeyEncoding: { type: tipo, format: "pem", ...cifra } }).privateKey;
  }
  return generateKeyPairSync("ed25519", { publicKeyEncoding: pubblica, privateKeyEncoding: { type: "pkcs8", format: "pem", ...cifra } }).privateKey;
}

const opz = (porta: number) => ({ host: "127.0.0.1", port: porta, username: "root", timeout: 5000 });

test("ed25519 OpenSSH su un server che accetta solo publickey: entra con la chiave, mai la password (oggi prova la password e fallisce)", async () => {
  const srv = await serverSshProva({ chiavi: [ed25519.public] });
  try {
    const r = await sshExec({ ...opz(srv.porta), privateKey: ed25519.private }, "echo ok");
    assert.equal(r.stdout, "ok\n");
    assert.ok(srv.metodi.includes("publickey"), `metodi tentati: ${srv.metodi.join(", ")}`);
    assert.ok(!srv.metodi.includes("password") && !srv.metodi.includes("keyboard-interactive"), `metodi tentati: ${srv.metodi.join(", ")}`);
  } finally {
    await srv.chiudi();
  }
});

test("i formati di D6: OpenSSH (RSA, ECDSA, ed25519, anche cifrata) e PEM PKCS#1, SEC1 e PKCS#8 (anche cifrato)", async () => {
  const rsaOpenssh = utils.generateKeyPairSync("rsa", { bits: 2048 });
  const ecdsaOpenssh = utils.generateKeyPairSync("ecdsa", { bits: 256 });
  const casi: Array<{ nome: string; privata: string; passphrase?: string; pubblica: string }> = [
    { nome: "OpenSSH RSA", privata: rsaOpenssh.private, pubblica: rsaOpenssh.public },
    { nome: "OpenSSH ECDSA", privata: ecdsaOpenssh.private, pubblica: ecdsaOpenssh.public },
    { nome: "OpenSSH ed25519 cifrata", privata: ed25519Cifrata.private, passphrase: "frase segreta", pubblica: ed25519Cifrata.public },
  ];
  for (const [nome, alg, tipo, pass] of [
    ["PEM PKCS#1 RSA", "rsa", "pkcs1", undefined],
    ["PEM PKCS#1 RSA cifrata", "rsa", "pkcs1", "pp-rsa"],
    ["PEM SEC1 ECDSA", "ec", "sec1", undefined],
    ["PEM PKCS#8 RSA", "rsa", "pkcs8", undefined],
    ["PEM PKCS#8 ECDSA", "ec", "pkcs8", undefined],
    ["PEM PKCS#8 ed25519", "ed25519", "pkcs8", undefined],
    ["PEM PKCS#8 ed25519 cifrata", "ed25519", "pkcs8", "pp-ed"],
  ] as const) {
    const privata = pem(alg, tipo, pass);
    casi.push({ nome, privata, passphrase: pass, pubblica: rigaPubblicaDaPem(privata, pass) });
  }
  const srv = await serverSshProva({ chiavi: casi.map((c) => c.pubblica) });
  try {
    for (const c of casi) {
      const r = await sshExec({ ...opz(srv.porta), privateKey: c.privata, ...(c.passphrase ? { passphrase: c.passphrase } : {}) }, "echo ok").catch(
        (e: unknown) => assert.fail(`${c.nome}: ${(e as Error).message}`),
      );
      assert.equal(r.stdout, "ok\n", c.nome);
      assert.equal(srv.chiaviViste.at(-1), c.pubblica.split(" ")[1], `${c.nome}: la chiave presentata è quella giusta`);
    }
  } finally {
    await srv.chiudi();
  }
});

test("chiave e password insieme: prima la chiave; se il server la rifiuta, la password", async () => {
  const conChiave = await serverSshProva({ chiavi: [ed25519.public], password: "pw" });
  const soloPassword = await serverSshProva({ chiavi: [], password: "pw" });
  try {
    await sshExec({ ...opz(conChiave.porta), privateKey: ed25519.private, password: "pw" }, "echo ok");
    assert.deepEqual(conChiave.metodi.filter((m) => m !== "none"), ["publickey", "publickey"], "domanda e firma, nessuna password");
    await sshExec({ ...opz(soloPassword.porta), privateKey: ed25519.private, password: "pw" }, "echo ok");
    const tentati = soloPassword.metodi.filter((m) => m !== "none");
    assert.equal(tentati[0], "publickey");
    assert.equal(tentati.at(-1), "password");
  } finally {
    await conChiave.chiudi();
    await soloPassword.chiudi();
  }
});

test("passphrase sbagliata o mancante, chiave pubblica al posto della privata, testo qualunque: «key_invalid» in italiano, nessuna connessione", async () => {
  const srv = await serverSshProva({ chiavi: [ed25519Cifrata.public] });
  try {
    const casi: Array<{ privateKey: string; passphrase?: string; atteso: RegExp }> = [
      { privateKey: ed25519Cifrata.private, passphrase: "sbagliata", atteso: /passphrase/ },
      { privateKey: ed25519Cifrata.private, atteso: /passphrase/ },
      { privateKey: pem("rsa", "pkcs8", "pp"), passphrase: "sbagliata", atteso: /passphrase/ },
      { privateKey: ed25519Cifrata.public, atteso: /pubblica/ },
      { privateKey: "non è una chiave", atteso: /formato/ },
    ];
    for (const c of casi) {
      await assert.rejects(sshExec({ ...opz(srv.porta), privateKey: c.privateKey, ...(c.passphrase ? { passphrase: c.passphrase } : {}) }, "echo ok"), (e: unknown) => {
        assert.ok(e instanceof SshError, String(e));
        assert.equal(e.kind, "key_invalid", e.message);
        assert.match(e.message, /chiave privata/);
        assert.match(e.message, c.atteso);
        assert.ok(!e.message.includes("BEGIN"), "il messaggio non contiene la chiave");
        return true;
      });
    }
    assert.equal(srv.connessioni, 0, "una chiave che non si legge non apre nessuna connessione");
  } finally {
    await srv.chiudi();
  }
});

test("una chiave che il server non conosce: «chiave rifiutata», non «verifica username/password»", async () => {
  const srv = await serverSshProva({ chiavi: [ed25519.public] });
  try {
    await assert.rejects(sshExec({ ...opz(srv.porta), privateKey: altra.private, credentialName: "Chiave root" }, "echo ok"), (e: unknown) => {
      assert.ok(e instanceof SshError, String(e));
      assert.equal(e.kind, "auth_failed");
      assert.match(e.message, /chiave privata.*rifiutata/);
      assert.match(e.message, /Chiave root/);
      assert.match(e.hint ?? "", /authorized_keys/);
      return true;
    });
  } finally {
    await srv.chiudi();
  }
});

test("password sbagliata: «credenziali rifiutate» subito, non un timeout (l'authHandler rispondeva `none` all'infinito)", async () => {
  const srv = await serverSshProva({ password: "giusta", offerti: ["password", "keyboard-interactive"] });
  try {
    const inizio = Date.now();
    await assert.rejects(sshExec({ ...opz(srv.porta), password: "sbagliata" }, "echo ok"), (e: unknown) => {
      assert.ok(e instanceof SshError, String(e));
      assert.equal(e.kind, "auth_failed", e.message);
      assert.match(e.message, /credenziali rifiutate/);
      return true;
    });
    assert.ok(Date.now() - inizio < 4000, "prima del timeout di 5 s");
    assert.equal(srv.metodi.filter((m) => m === "none").length <= 1, true, `metodi: ${srv.metodi.join(", ")}`);
  } finally {
    await srv.chiudi();
  }
});

test("né password né chiave: «no_credentials», nessuna connessione (oggi parte con la password vuota)", async () => {
  const srv = await serverSshProva({ chiavi: [ed25519.public], password: "pw" });
  try {
    await assert.rejects(sshExec(opz(srv.porta), "echo ok"), (e: unknown) => {
      assert.ok(e instanceof SshError, String(e));
      assert.equal(e.kind, "no_credentials");
      return true;
    });
    assert.equal(srv.connessioni, 0);
  } finally {
    await srv.chiudi();
  }
});

test("Proxmox: extractProxmoxViaSsh, le schede vive e la prova SSH passano la chiave al trasporto (oggi il tipo esige la password)", async () => {
  const risorse = JSON.stringify([
    { type: "node", node: "pve1", status: "online", maxmem: 1024, mem: 512, uptime: 60, maxcpu: 8 },
    { type: "qemu", node: "pve1", vmid: 100, name: "vm-prova", status: "running", maxcpu: 2, maxmem: 2048, maxdisk: 4096, mem: 1024 },
  ]);
  const srv = await serverSshProva({
    chiavi: [ed25519.public],
    risposta: (cmd) => (cmd.startsWith("pvesh get /cluster/resources") ? risorse : cmd.startsWith("pveversion") ? "pve-manager/8.2.4\n" : ""),
  });
  try {
    const config = { host: "127.0.0.1", port: srv.porta, username: "root", privateKey: ed25519.private };
    const r = await extractProxmoxViaSsh(config, { includeStopped: true });
    assert.deepEqual(r.hosts.map((h) => h.hostname), ["pve1"]);
    assert.deepEqual(r.vms.map((v) => v.vmid), [100]);
    assert.equal(await testProxmoxSsh(config), true);
    await assert.rejects(readLiveInterfaces(config), /Lettura delle schede vive non riuscita/, "il comando arriva (uscita vuota → errore dichiarato), non un rifiuto d'accesso");
    assert.ok(!srv.metodi.includes("password"));
  } finally {
    await srv.chiudi();
  }
});
