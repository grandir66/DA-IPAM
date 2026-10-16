/**
 * Il proxy Zabbix di QUESTA macchina, come componente locale (passo 7.4).
 *
 * Il pannello lo mostra accanto ai dati del centro: se gira lo dice la macchina
 * (`saluteProxyZabbix`, la stessa voce `zbx` del segnale verso DA-Link), il nome lo
 * dice il suo file di configurazione (`Hostname=`). DA-IPAM lo legge e basta: non lo
 * avvia, non lo ferma e non lo riavvia, nemmeno quando si aggiorna (lo installa e lo
 * governa la procedura guidata di DA-Zabbix).
 */
import fs from "node:fs";
import { FILE_PROXY_ZABBIX, saluteProxyZabbix } from "@/lib/dalink/fatti";
import type { ProxyLocale } from "./pannello";

/** Il valore di `Hostname=` in un file di configurazione del proxy, o null. */
export function hostnameDaConf(testo: string): string | null {
  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.trim();
    if (!riga.startsWith("Hostname=")) continue;
    const v = riga.slice("Hostname=".length).trim();
    if (v) return v;
  }
  return null;
}

export function leggiProxyLocale(nomeConfigurato: string | null): ProxyLocale {
  let stato: ProxyLocale["stato"];
  try {
    const s = saluteProxyZabbix();
    stato = s === "ok" ? "gira" : s === "fail" ? "fermo" : "assente";
  } catch {
    stato = "non_so";
  }
  let nome = nomeConfigurato;
  if (!nome && stato !== "assente") {
    try {
      nome = hostnameDaConf(fs.readFileSync(FILE_PROXY_ZABBIX, "utf8"));
    } catch {
      nome = null; // file non leggibile dall'utente del servizio: nome non noto
    }
  }
  return { stato, nome };
}
