/**
 * Configurazione del pannello Zabbix nel DB del cliente (passo 7.4): indirizzo del
 * centro, chiave di lettura cifrata a riposo, impronta TLS facoltativa, codice
 * cliente atteso, nome del proxy della macchina, interruttore; più lo stato dei
 * tentativi che regge l'attesa crescente.
 *
 * La chiave non esce mai da qui in chiaro verso la pagina: la vista pubblica dà solo
 * la parte pubblica (`zl1.<id>`). Per decifrarla `safeDecrypt` (regola 3): una chiave
 * illeggibile è un guasto da dire, non un'eccezione.
 *
 * Funzioni su un `Database` passato: le rotte gli danno quello del tenant della
 * sessione, le prove un DB in memoria.
 */
import type Database from "better-sqlite3";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { assicuraTabelleZabbixLettura } from "@/lib/db-tenant-schema";
import { normalizzaBase } from "./client";
import { normalizzaImprontaLettura } from "./trasporto";

/** `zl1.<id 8 esadecimali>.<segreto base64url di 43 caratteri>` (§2 del design). */
export const FORMA_CHIAVE = /^zl1\.([0-9a-f]{8})\.([A-Za-z0-9_-]{43})$/;
export const FORMA_CODCLI = /^[0-9]{3,8}$/;

const pronti = new WeakSet<Database.Database>();
function pronto(db: Database.Database): Database.Database {
  if (!pronti.has(db)) {
    assicuraTabelleZabbixLettura(db);
    pronti.add(db);
  }
  return db;
}

interface Riga {
  base_url: string;
  chiave_enc: string;
  chiave_id: string;
  impronta: string | null;
  codcli: string;
  proxy_locale: string | null;
  enabled: number;
  fallimenti: number;
  prossimo_tentativo: string | null;
  ultimo_errore: string | null;
  ultima_lettura_ok: string | null;
  aggiornato_il: string;
  aggiornato_da: string | null;
}

export interface ConfigLettura {
  baseUrl: string;
  chiaveId: string;
  impronta: string | null;
  codcli: string;
  proxyLocale: string | null;
  enabled: boolean;
  fallimenti: number;
  prossimoTentativo: string | null;
  ultimoErrore: string | null;
  ultimaLetturaOk: string | null;
  aggiornatoIl: string;
  aggiornatoDa: string | null;
}

function vista(r: Riga): ConfigLettura {
  return {
    baseUrl: r.base_url,
    chiaveId: r.chiave_id,
    impronta: r.impronta,
    codcli: r.codcli,
    proxyLocale: r.proxy_locale,
    enabled: r.enabled === 1,
    fallimenti: r.fallimenti,
    prossimoTentativo: r.prossimo_tentativo,
    ultimoErrore: r.ultimo_errore,
    ultimaLetturaOk: r.ultima_lettura_ok,
    aggiornatoIl: r.aggiornato_il,
    aggiornatoDa: r.aggiornato_da,
  };
}

function riga(db: Database.Database): Riga | undefined {
  return pronto(db).prepare("SELECT * FROM zabbix_lettura_config WHERE id = 1").get() as Riga | undefined;
}

/** Configurazione senza segreti, o null se mai configurato. */
export function leggiConfigLettura(db: Database.Database): ConfigLettura | null {
  const r = riga(db);
  return r ? vista(r) : null;
}

/** La chiave decifrata, o null se manca o non si decifra (chiave di cifratura cambiata). */
export function chiaveLettura(db: Database.Database): string | null {
  const r = riga(db);
  if (!r) return null;
  const k = safeDecrypt(r.chiave_enc);
  return k && FORMA_CHIAVE.test(k) ? k : null;
}

export interface IngressoConfig {
  baseUrl: string;
  /** Vuota o assente = non cambiare quella salvata. */
  chiave?: string | null;
  impronta?: string | null;
  codcli: string;
  proxyLocale?: string | null;
  enabled: boolean;
}

export type EsitoSalvataggio = { ok: true; config: ConfigLettura } | { ok: false; errore: string };

/**
 * Salva la configurazione. Indirizzo solo https; chiave nella forma `zl1.…`; impronta
 * nella forma SPKI o SHA-256 del certificato; codice cliente di 3-8 cifre.
 * Ogni salvataggio azzera l'attesa: la configurazione nuova si prova subito.
 */
export function salvaConfigLettura(db: Database.Database, i: IngressoConfig, chi: string): EsitoSalvataggio {
  const base = normalizzaBase(i.baseUrl);
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { ok: false, errore: "Indirizzo del centro non valido" };
  }
  if (url.protocol !== "https:") return { ok: false, errore: "L'indirizzo del centro deve essere https" };
  if (url.username || url.password) return { ok: false, errore: "L'indirizzo non deve contenere credenziali" };
  if (url.search || url.hash) return { ok: false, errore: "L'indirizzo non deve contenere parametri" };

  const codcli = i.codcli.trim();
  if (!FORMA_CODCLI.test(codcli)) return { ok: false, errore: "Codice cliente non valido (da 3 a 8 cifre)" };

  let impronta: string | null = null;
  if (i.impronta && i.impronta.trim()) {
    impronta = normalizzaImprontaLettura(i.impronta);
    if (!impronta) {
      return {
        ok: false,
        errore: "Impronta non valida: «sha256//…» (chiave pubblica) oppure SHA-256 del certificato in esadecimale",
      };
    }
  }

  const proxy = i.proxyLocale?.trim() || null;
  if (proxy && !/^[A-Za-z0-9._ -]{1,128}$/.test(proxy)) return { ok: false, errore: "Nome del proxy non valido" };

  const attuale = riga(db);
  const nuova = i.chiave?.trim() || null;
  let chiaveEnc: string;
  let chiaveId: string;
  if (nuova) {
    const m = FORMA_CHIAVE.exec(nuova);
    if (!m) return { ok: false, errore: "Chiave di lettura non valida: è attesa la forma zl1.<id>.<segreto>" };
    chiaveEnc = encrypt(nuova);
    chiaveId = m[1]!;
  } else if (attuale) {
    // Un indirizzo nuovo non riceve la chiave di prima senza che la si riscriva: un
    // errore di battitura la manderebbe a un host qualunque.
    if (new URL(attuale.base_url).origin !== url.origin) {
      return { ok: false, errore: "Indirizzo cambiato: inserisci di nuovo la chiave di lettura" };
    }
    chiaveEnc = attuale.chiave_enc;
    chiaveId = attuale.chiave_id;
  } else {
    return { ok: false, errore: "Chiave di lettura mancante" };
  }

  pronto(db)
    .prepare(
      `INSERT INTO zabbix_lettura_config
         (id, base_url, chiave_enc, chiave_id, impronta, codcli, proxy_locale, enabled,
          fallimenti, prossimo_tentativo, ultimo_errore, aggiornato_il, aggiornato_da)
       VALUES (1, @base, @enc, @cid, @impronta, @codcli, @proxy, @enabled, 0, NULL, NULL, datetime('now'), @chi)
       ON CONFLICT(id) DO UPDATE SET
         base_url = @base, chiave_enc = @enc, chiave_id = @cid, impronta = @impronta, codcli = @codcli,
         proxy_locale = @proxy, enabled = @enabled, fallimenti = 0, prossimo_tentativo = NULL,
         ultimo_errore = NULL, aggiornato_il = datetime('now'), aggiornato_da = @chi`,
    )
    .run({
      base: url.toString().replace(/\/+$/, ""),
      enc: chiaveEnc,
      cid: chiaveId,
      impronta,
      codcli,
      proxy,
      enabled: i.enabled ? 1 : 0,
      chi,
    });
  return { ok: true, config: leggiConfigLettura(db)! };
}

/** Toglie la configurazione (gli abbinamenti verificati restano: sono di DA-IPAM). */
export function togliConfigLettura(db: Database.Database): boolean {
  return pronto(db).prepare("DELETE FROM zabbix_lettura_config WHERE id = 1").run().changes > 0;
}

export function registraSuccesso(db: Database.Database, adesso: Date): void {
  pronto(db)
    .prepare(
      `UPDATE zabbix_lettura_config
          SET fallimenti = 0, prossimo_tentativo = NULL, ultimo_errore = NULL, ultima_lettura_ok = ?
        WHERE id = 1`,
    )
    .run(adesso.toISOString());
}

/** Conta un fallimento e fissa il prossimo tentativo. Restituisce i fallimenti consecutivi. */
export function registraFallimento(
  db: Database.Database,
  adesso: Date,
  errore: string,
  attesaS: (fallimenti: number) => number,
): { fallimenti: number; prossimo: string } {
  const r = riga(db);
  const fallimenti = (r?.fallimenti ?? 0) + 1;
  const prossimo = new Date(adesso.getTime() + attesaS(fallimenti) * 1000).toISOString();
  pronto(db)
    .prepare(
      `UPDATE zabbix_lettura_config
          SET fallimenti = ?, prossimo_tentativo = ?, ultimo_errore = ?
        WHERE id = 1`,
    )
    .run(fallimenti, prossimo, errore.slice(0, 500));
  return { fallimenti, prossimo };
}
