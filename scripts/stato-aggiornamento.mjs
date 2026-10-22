#!/usr/bin/env node
// DA-INVENT — stato dell'aggiornamento automatico, su file.
//
// Lo scrivono auto-update.sh e update.sh; lo leggono l'app (Impostazioni →
// Aggiornamenti) e il segnale verso DA-Link. Perché esiste (16/10/2026):
// auto-update.sh confrontava origin con HEAD, e HEAD avanza col pull PRIMA del
// build. Un build fallito lasciava HEAD = origin e il giro dopo diceva «già
// aggiornato»: nessun ritentativo, app ferma sulla build vecchia o rotta.
// Il riferimento giusto è il commit COSTRUITO E AVVIATO con salute buona.
//
// Solo moduli di Node, nessuna dipendenza: deve funzionare anche quando
// node_modules è a metà di un `npm install`.
//
// File: $DA_INVENT_STATO_AGGIORNAMENTO, altrimenti
//       ${DA_INVENT_DATA_DIR:-<repo>/data}/aggiornamento.json
//
// Comandi:
//   leggi <campo>                 stampa il valore (vuoto se manca):
//                                 commit_avviato | esito | commit_tentato | tentativi | fase
//   inizio <commit> <da_commit>   nuovo tentativo; conta i tentativi sullo stesso commit
//   fase <nome>                   fase in corso (pull, install, build, scambio, riavvio, salute)
//   fine <esito> [messaggio]      riuscito | fallito | interrotto | pronto_non_avviato;
//                                 solo con «riuscito» il commit tentato diventa il commit
//                                 avviato. «pronto_non_avviato» (19/10, F03): build pronta,
//                                 servizio fermo, nessun avvio né salute provati
//   avviato <commit> [messaggio]  il commit gira già (solo documentazione, primo giro)
//   avviso <testo>                aggiunge un avviso al tentativo in corso
//   controllo <esito> [interfaccia]  com'è finito l'ultimo giro di auto-update.sh:
//                                 gia_aggiornato | commit_fallito_attendo |
//                                 solo_documentazione | aggiornamento_avviato |
//                                 fetch_fallito | servizio_fermo |
//                                 retrocessione_rifiutata; «interfaccia» se l'ha
//                                 chiesto «Aggiorna ora»
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESITI = new Set(["riuscito", "fallito", "interrotto", "pronto_non_avviato"]);
const ESITI_CONTROLLO = new Set([
  "gia_aggiornato",
  "commit_fallito_attendo",
  "solo_documentazione",
  "aggiornamento_avviato",
  "fetch_fallito",
  "servizio_fermo",
  "retrocessione_rifiutata",
]);

export function percorsoStato(env = process.env) {
  if (env.DA_INVENT_STATO_AGGIORNAMENTO) return env.DA_INVENT_STATO_AGGIORNAMENTO;
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = (env.DA_INVENT_DATA_DIR || "").trim() || path.join(repo, "data");
  return path.join(dataDir, "aggiornamento.json");
}

export function leggiStato(file) {
  try {
    const dati = JSON.parse(fs.readFileSync(file, "utf8"));
    return dati && typeof dati === "object" ? dati : {};
  } catch {
    // File assente o illeggibile: come al primo giro. Mai un errore che ferma l'aggiornamento.
    return {};
  }
}

function scriviStato(file, stato) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stato, null, 2) + "\n", { mode: 0o644 });
  fs.renameSync(tmp, file);
}

/** Applica un comando allo stato e restituisce lo stato nuovo (puro, per le prove). */
export function applica(stato, comando, args, ora = new Date().toISOString()) {
  const s = { ...stato };
  const t = s.ultimo_tentativo ? { ...s.ultimo_tentativo } : null;
  switch (comando) {
    case "inizio": {
      const [commit, da] = args;
      if (!commit) throw new Error("inizio: manca il commit");
      const stessoCommit = t && t.commit === commit && t.esito !== "riuscito";
      s.ultimo_tentativo = {
        commit,
        da_commit: da || null,
        iniziato_il: ora,
        finito_il: null,
        fase: "inizio",
        esito: "in_corso",
        messaggio: null,
        avvisi: [],
        tentativi: stessoCommit ? (Number(t.tentativi) || 1) + 1 : 1,
      };
      return s;
    }
    case "fase": {
      if (!t) return s;
      s.ultimo_tentativo = { ...t, fase: args[0] || t.fase };
      return s;
    }
    case "avviso": {
      if (!t) return s;
      s.ultimo_tentativo = { ...t, avvisi: [...(t.avvisi || []), args.join(" ")] };
      return s;
    }
    case "fine": {
      const [esito, ...msg] = args;
      if (!ESITI.has(esito)) throw new Error(`fine: esito non valido «${esito}»`);
      if (!t) return s;
      s.ultimo_tentativo = { ...t, esito, finito_il: ora, messaggio: msg.join(" ") || null };
      if (esito === "riuscito") {
        s.commit_avviato = t.commit;
        s.ultimo_successo = { commit: t.commit, il: ora };
      }
      return s;
    }
    case "avviato": {
      const [commit, ...msg] = args;
      if (!commit) throw new Error("avviato: manca il commit");
      s.commit_avviato = commit;
      s.ultimo_successo = { commit, il: ora, nota: msg.join(" ") || null };
      return s;
    }
    case "controllo": {
      const [esito, origine] = args;
      if (!ESITI_CONTROLLO.has(esito)) throw new Error(`controllo: esito non valido «${esito}»`);
      s.ultimo_controllo = { il: ora, esito, richiesto_da_interfaccia: origine === "interfaccia" };
      return s;
    }
    default:
      throw new Error(`comando sconosciuto «${comando}»`);
  }
}

export function leggiCampo(stato, campo) {
  const t = stato.ultimo_tentativo || {};
  switch (campo) {
    case "commit_avviato": return stato.commit_avviato || "";
    case "esito": return t.esito || "";
    case "commit_tentato": return t.commit || "";
    case "tentativi": return t.tentativi != null ? String(t.tentativi) : "";
    case "fase": return t.fase || "";
    default: throw new Error(`campo sconosciuto «${campo}»`);
  }
}

function main(argv) {
  const [comando, ...args] = argv;
  const file = percorsoStato();
  if (comando === "leggi") {
    process.stdout.write(leggiCampo(leggiStato(file), args[0]) + "\n");
    return;
  }
  scriviStato(file, applica(leggiStato(file), comando, args));
}

// Percorsi reali da tutti e due i lati: lanciato da una cartella con un collegamento
// simbolico (su macOS /var/folders → /private/var/folders) il confronto falliva e il
// file non faceva niente, in silenzio. Le 9 prove «cadute per flock» del 19/10 erano questo.
function stessoFile(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

if (process.argv[1] && stessoFile(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    // Lo stato è un resoconto: un suo errore non deve mai fermare l'aggiornamento.
    process.stderr.write(`[stato-aggiornamento] ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(0);
  }
}
