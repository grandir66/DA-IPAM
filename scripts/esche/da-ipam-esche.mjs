#!/usr/bin/env node
/**
 * DA-IPAM — le esche: finti servizi che non servono a niente, così chi ci si collega non ha un motivo buono
 * per farlo (Protezione, tappa 5; ADR 0041).
 *
 * Processo a parte, senza dipendenze e senza privilegi (lo lancia `deploy/da-ipam-esche.service` con un'utenza
 * effimera): ascolta su porte ALTE, e la tabella nftables `inet daipam_esche` ci porta le porte finte (23 → 20023…).
 * Non legge niente di DA-IPAM e non esegue niente di ciò che riceve.
 *
 * Poca interazione: un banner, al più la richiesta di nome e password, poi chiude. Limiti per connessione
 * (byte, secondi) e in tutto (connessioni insieme).
 *
 * Cosa scrive, una riga JSON per contatto in `<stato>/eventi-AAAA-MM-GG.jsonl`: quando, da dove, quale esca,
 * il nome provato (tagliato). LA PASSWORD MAI: solo quanto è lunga e un'impronta con una chiave che resta su
 * questa macchina, per dire «la stessa di prima» senza poterla rileggere.
 *
 * Uso: da-ipam-esche.mjs            legge ESCHE_CONF (predefinito /etc/da-ipam/esche.conf) e ESCHE_STATO
 * Configurazione: `ESCHE=telnet,ftp,smb,rdp,mysql,ssh,web` (quelle accese), `ESCHE_LENTE=si|no` (risposte lente).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** Elenco CHIUSO delle esche: nome, porta finta presentata, porta alta su cui ascolta davvero. */
export const ESCHE = {
  ftp: { porta: 21, ascolta: 20021 },
  telnet: { porta: 23, ascolta: 20023 },
  smb: { porta: 445, ascolta: 20445 },
  ssh: { porta: 2222, ascolta: 22222 },
  mysql: { porta: 3306, ascolta: 23306 },
  rdp: { porta: 3389, ascolta: 23389 },
  web: { porta: 8081, ascolta: 28081 },
};

const MAX_BYTE = 4096;
const MAX_MS = 20_000;
const MAX_INSIEME = 64;
const MAX_NOME = 64;

export function leggiConf(testo) {
  const valori = new Map();
  for (const grezza of testo.split("\n")) {
    const riga = grezza.trim();
    if (!riga || riga.startsWith("#")) continue;
    const i = riga.indexOf("=");
    if (i > 0) valori.set(riga.slice(0, i), riga.slice(i + 1).trim());
  }
  const accese = (valori.get("ESCHE") ?? "").split(/[,\s]+/).filter((n) => Object.hasOwn(ESCHE, n));
  return { accese: [...new Set(accese)], lente: valori.get("ESCHE_LENTE") === "si" };
}

/** Solo caratteri stampabili, tagliato: ciò che arriva da fuori finisce in un registro che qualcuno leggerà. */
export function pulisci(testo) {
  return String(testo).replace(/[^\x20-\x7e]/g, "").trim().slice(0, MAX_NOME);
}

/** Della password restano la lunghezza e un'impronta con la chiave locale. Mai il testo. */
export function improntaPassword(chiave, password) {
  if (!password) return null;
  return { lunga: Buffer.byteLength(password), impronta: crypto.createHmac("sha256", chiave).update(password).digest("hex").slice(0, 16) };
}

/**
 * Il dialogo di un'esca: riceve le righe (o i blocchi) del visitatore e dice cosa rispondere e cosa si è capito.
 * Funzioni pure, una per esca: `apri()` dà il primo messaggio, `ricevi(stato, dati)` il seguito.
 */
const CRLF = "\r\n";
export const DIALOGHI = {
  telnet: {
    apri: () => ({ manda: `${CRLF}Ubuntu 22.04.3 LTS${CRLF}login: `, stato: { passo: "nome" } }),
    ricevi(stato, riga) {
      if (stato.passo === "nome") return { manda: "Password: ", stato: { passo: "password", nome: riga } };
      return { manda: `${CRLF}Login incorrect${CRLF}`, chiudi: true, nome: stato.nome, password: riga };
    },
  },
  ftp: {
    apri: () => ({ manda: `220 FTP server ready${CRLF}`, stato: {} }),
    ricevi(stato, riga) {
      const m = /^(\w+)\s*(.*)$/.exec(riga) ?? [];
      const comando = (m[1] ?? "").toUpperCase();
      if (comando === "USER") return { manda: `331 Password required${CRLF}`, stato: { nome: m[2] } };
      if (comando === "PASS") return { manda: `530 Login incorrect${CRLF}`, chiudi: true, nome: stato.nome, password: m[2] };
      return { manda: `530 Please login with USER and PASS${CRLF}`, stato, chiudi: comando === "QUIT" };
    },
  },
  ssh: {
    apri: () => ({ manda: `SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6${CRLF}`, stato: {} }),
    // Il visitatore manda la sua versione: si annota e si chiude. Nessuno scambio di chiavi.
    ricevi: (_stato, riga) => ({ chiudi: true, nota: riga }),
  },
  mysql: {
    // Saluto di un server MySQL 5.7 (protocollo 10) con un sale fisso: basta a far mandare il nome al client.
    apri: () => {
      const corpo = Buffer.concat([
        Buffer.from([10]), Buffer.from("5.7.42-log\0"), Buffer.from([1, 0, 0, 0]), Buffer.from("abcdefgh\0"),
        Buffer.from([0xff, 0xf7, 33, 2, 0, 0xff, 0x81, 21]), Buffer.alloc(10), Buffer.from("ijklmnopqrst\0"), Buffer.from("mysql_native_password\0"),
      ]);
      const testa = Buffer.from([corpo.length & 0xff, (corpo.length >> 8) & 0xff, 0, 0]);
      return { manda: Buffer.concat([testa, corpo]), stato: {}, binario: true };
    },
    ricevi(_stato, blocco) {
      // Risposta di accesso: 4 byte di testa, 32 di opzioni, poi il nome finito da uno zero. La password è già un
      // hash col sale: non si guarda nemmeno.
      const nome = blocco.length > 36 ? blocco.subarray(36, blocco.indexOf(0, 36) > 36 ? blocco.indexOf(0, 36) : 36).toString("latin1") : "";
      const testo = "Access denied for user";
      const corpo = Buffer.concat([Buffer.from([0xff, 0x15, 0x04]), Buffer.from("#28000"), Buffer.from(testo)]);
      return { manda: Buffer.concat([Buffer.from([corpo.length, 0, 0, 2]), corpo]), chiudi: true, nome };
    },
  },
  // SMB e RDP: si ascolta, si annota il contatto, non si risponde niente.
  smb: { apri: () => ({ stato: {}, binario: true }), ricevi: () => ({ chiudi: true }) },
  rdp: { apri: () => ({ stato: {}, binario: true }), ricevi: () => ({ chiudi: true }) },
  web: {
    apri: () => ({ stato: { dati: "" }, binario: true }),
    ricevi(stato, blocco) {
      const dati = stato.dati + blocco.toString("latin1");
      const fine = dati.indexOf("\r\n\r\n");
      if (fine < 0) return { stato: { dati } };
      const [prima] = dati.split("\r\n");
      const lungo = Number(/\r\ncontent-length:\s*(\d+)/i.exec(dati)?.[1] ?? 0);
      const corpo = dati.slice(fine + 4);
      if (prima.startsWith("POST") && corpo.length < Math.min(lungo, 1024)) return { stato: { dati } };
      const pagina = (testo) => `<!doctype html><html><head><title>Device Login</title></head><body><h3>Network Storage — Login</h3>${testo}<form method="post" action="/login"><input name="username" placeholder="Username"><input name="password" type="password" placeholder="Password"><button>Sign in</button></form></body></html>`;
      const rispondi = (codice, testo) => { const html = pagina(testo); return `HTTP/1.1 ${codice}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(html)}\r\nConnection: close\r\nServer: nginx\r\n\r\n${html}`; };
      if (prima.startsWith("POST")) {
        const campi = new URLSearchParams(corpo.slice(0, 1024));
        return { manda: rispondi("401 Unauthorized", "<p>Invalid username or password.</p>"), chiudi: true, nome: campi.get("username") ?? "", password: campi.get("password") ?? "", nota: prima };
      }
      return { manda: rispondi("200 OK", ""), chiudi: true, nota: prima };
    },
  },
};

/** Una connessione a un'esca. `scrivi(evento)` riceve la riga da registrare, una sola per connessione. */
export function servi(nome, socket, { chiave, lente, scrivi, adesso = () => new Date() }) {
  const dialogo = DIALOGHI[nome];
  const evento = { il: adesso().toISOString(), esca: nome, porta: ESCHE[nome].porta, indirizzo: String(socket.remoteAddress ?? "").replace(/^::ffff:/, ""), tentativi: 0 };
  let ricevuti = 0;
  let chiusa = false;
  let coda = Buffer.alloc(0);
  const inizio = dialogo.apri();
  let stato = inizio.stato;
  const binario = inizio.binario === true;

  const chiudi = () => {
    if (chiusa) return;
    chiusa = true;
    clearTimeout(scadenza);
    socket.destroy();
    scrivi(evento);
  };
  const scadenza = setTimeout(chiudi, MAX_MS);
  const manda = (dati, poi) => {
    if (chiusa || dati === undefined) return poi?.();
    // «Lenta»: la risposta parte dopo un po'. Chi scansiona resta appeso su ogni porta finta.
    setTimeout(() => { if (!chiusa) socket.write(dati, () => poi?.()); else poi?.(); }, lente ? 2500 : 0);
  };
  const passo = (dati) => {
    let esito;
    try {
      esito = dialogo.ricevi(stato, dati);
    } catch {
      return chiudi();
    }
    if (esito.stato) stato = esito.stato;
    if (esito.nome !== undefined) { evento.utente = pulisci(esito.nome); evento.tentativi += 1; }
    if (esito.password !== undefined) { const p = improntaPassword(chiave, esito.password); if (p) evento.password = p; }
    if (esito.nota !== undefined) evento.nota = pulisci(esito.nota);
    if (esito.chiudi) manda(esito.manda, chiudi);
    else manda(esito.manda);
  };

  socket.on("error", chiudi);
  socket.on("close", chiudi);
  socket.on("data", (blocco) => {
    ricevuti += blocco.length;
    if (ricevuti > MAX_BYTE) return chiudi();
    if (binario) return passo(blocco);
    // Telnet: i byte di negoziazione (0xFF e i due che seguono) non sono testo.
    coda = Buffer.concat([coda, blocco]);
    let a;
    while ((a = coda.indexOf(10)) >= 0) {
      const riga = coda.subarray(0, a).filter((b) => b !== 13).toString("latin1").replace(/\xff[\s\S]{2}/g, "");
      coda = coda.subarray(a + 1);
      passo(riga.trim());
      if (chiusa) return;
    }
  });
  manda(inizio.manda);
}

function avvia() {
  const fileConf = process.env.ESCHE_CONF ?? "/etc/da-ipam/esche.conf";
  const dirStato = process.env.ESCHE_STATO ?? process.env.STATE_DIRECTORY ?? "/var/lib/da-ipam-esche";
  let conf = { accese: [], lente: false };
  try {
    conf = leggiConf(fs.readFileSync(fileConf, "utf8"));
  } catch {
    console.error(`da-ipam-esche: configurazione ${fileConf} non letta: nessuna esca accesa`);
  }
  fs.mkdirSync(dirStato, { recursive: true });
  const fileChiave = path.join(dirStato, "chiave");
  if (!fs.existsSync(fileChiave)) fs.writeFileSync(fileChiave, crypto.randomBytes(32), { mode: 0o600 });
  const chiave = fs.readFileSync(fileChiave);
  const scrivi = (evento) => {
    try {
      fs.appendFileSync(path.join(dirStato, `eventi-${evento.il.slice(0, 10)}.jsonl`), `${JSON.stringify(evento)}\n`, { mode: 0o640 });
    } catch (e) {
      console.error("da-ipam-esche: evento non scritto:", e.message);
    }
  };
  let insieme = 0;
  for (const nome of conf.accese) {
    const server = net.createServer((socket) => {
      if (insieme >= MAX_INSIEME) return socket.destroy();
      insieme += 1;
      socket.once("close", () => { insieme -= 1; });
      servi(nome, socket, { chiave, lente: conf.lente, scrivi });
    });
    server.on("error", (e) => console.error(`da-ipam-esche: ${nome} non ascolta su ${ESCHE[nome].ascolta}: ${e.message}`));
    server.listen(ESCHE[nome].ascolta, "0.0.0.0", () => console.log(`da-ipam-esche: ${nome} (porta finta ${ESCHE[nome].porta}) in ascolto su ${ESCHE[nome].ascolta}`));
  }
  if (conf.accese.length === 0) console.log("da-ipam-esche: nessuna esca accesa");
  // Resta vivo anche senza esche: il servizio non deve ripartire in continuazione.
  setInterval(() => {}, 3_600_000);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) avvia();
