/**
 * Quali porte prova il giro leggero (Riccardo, 09/11/2026: «le porte da verificare possono
 * essere molto più ampie dello standard, per rilevare anche apparati che lavorano su porte
 * fuori standard»).
 *
 * Come Nety di serie: le 1000 porte TCP più frequenti. La classifica è quella di nmap
 * (`nmap-services`, terza colonna = frequenza osservata), già installato su ogni appliance;
 * a queste si aggiungono le porte di gestione fuori standard che vediamo dai clienti.
 * Senza il file si ripiega sulle porte comuni. Le porte di campo e di stampa restano fuori.
 */
import fs from "node:fs";
import { PORTE_DA_NON_TOCCARE } from "@/lib/scanner/profili/sconosciuti";

/** Il minimo garantito: accesso remoto, web e pannelli, posta, file, database, directory. */
export const PORTE_COMUNI: readonly number[] = [
  21, 22, 23, 25, 53, 80, 81, 88, 110, 111, 135, 139, 143, 389, 443, 445, 465, 587, 636, 993, 995,
  1433, 1723, 2049, 3000, 3128, 3306, 3389, 4443, 5000, 5001, 5432, 5900, 5985, 6443, 7443, 8000,
  8006, 8080, 8081, 8443, 8888, 9000, 9090, 9443, 10000, 10443,
];

/**
 * Pannelli e API fuori dalle classifiche: x443 dei firewall, Proxmox, MikroTik (Winbox, API),
 * SSH spostato, Webmin, NAS, controller Wi-Fi, BMC, hypervisor.
 */
export const PORTE_GESTIONE: readonly number[] = [
  2222, 2443, 3443, 4433, 5443, 8007, 8291, 8728, 8729, 8880, 8843, 9080, 9091, 9200, 9389, 10001,
  10080, 11443, 12443, 16992, 16993, 17988, 18443, 20443, 50000, 55443,
];

const PERCORSI_NMAP_SERVICES = [
  "/usr/share/nmap/nmap-services",
  "/usr/local/share/nmap/nmap-services",
  "/opt/homebrew/share/nmap/nmap-services",
];

/** Le `n` porte più frequenti dal testo di `nmap-services` per un protocollo. */
export function portePiuFrequenti(testo: string, n: number, proto: "tcp" | "udp"): number[] {
  const suffisso = `/${proto}`;
  const righe: Array<[number, number]> = [];
  for (const riga of testo.split("\n")) {
    if (!riga || riga.startsWith("#")) continue;
    const [, portaProto, freq] = riga.split(/\s+/);
    if (!portaProto?.endsWith(suffisso)) continue;
    const porta = Number(portaProto.slice(0, -suffisso.length));
    const f = Number(freq);
    if (Number.isInteger(porta) && porta > 0 && Number.isFinite(f) && f > 0) righe.push([porta, f]);
  }
  return righe.sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p);
}

/** Le `n` porte TCP più frequenti dal testo di `nmap-services`. */
export function porteTcpPiuFrequenti(testo: string, n: number): number[] {
  return portePiuFrequenti(testo, n, "tcp");
}

/** Le `n` porte UDP più frequenti dal testo di `nmap-services`. */
export function porteUdpPiuFrequenti(testo: string, n: number): number[] {
  return portePiuFrequenti(testo, n, "udp");
}

/** Testo di nmap-services, o null se il file non c'è. */
export function testoNmapServices(leggi: (p: string) => string | null = leggiFile): string | null {
  for (const p of PERCORSI_NMAP_SERVICES) {
    const testo = leggi(p);
    if (testo) return testo;
  }
  return null;
}

let memo: { n: number; porte: number[] } | null = null;

/** Le porte del giro leggero, senza doppioni e senza le porte da non toccare. */
export function portePerGiro(n = 1000, leggi: (p: string) => string | null = leggiFile): number[] {
  if (memo && memo.n === n && leggi === leggiFile) return memo.porte;
  let frequenti: number[] = [];
  for (const p of PERCORSI_NMAP_SERVICES) {
    const testo = leggi(p);
    if (testo) {
      frequenti = porteTcpPiuFrequenti(testo, n);
      break;
    }
  }
  const porte = [...new Set([...PORTE_COMUNI, ...PORTE_GESTIONE, ...frequenti])]
    .filter((p) => !PORTE_DA_NON_TOCCARE.has(p))
    .sort((a, b) => a - b);
  if (leggi === leggiFile) memo = { n, porte };
  return porte;
}

function leggiFile(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
