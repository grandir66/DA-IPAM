/**
 * Tipi e profili del lanciatore di giri (idea da Nety, codice nostro).
 *
 * I motori restano quelli già fatti: Discovery, sonde, matrice, trunk.
 * Qui si decide solo quante porte, a che ritmo, e se c'è l'UDP.
 */
import { getNmapHostTimeoutSeconds, getNmapVersionIntensity } from "@/lib/scanner/ports";
import {
  porteTcpPiuFrequenti,
  porteUdpPiuFrequenti,
  testoNmapServices,
} from "@/lib/servizi-rete/porte";
import { fasiValide, type FaseGiro, type ProfiloGiro } from "./profili-giro-ui";

export {
  eProfiloGiro,
  eTipoGiro,
  fasiValide,
  FASI_GIRO,
  PROFILI_GIRO,
  PROFILI_GIRO_UI,
  TIPI_GIRO,
  TIPI_GIRO_UI,
  type FaseGiro,
  type ProfiloGiro,
  type TipoGiro,
} from "./profili-giro-ui";

const UDP_RIPIEGO = [53, 67, 69, 123, 137, 161, 162, 500, 514, 520, 623, 1900, 4500, 5353];

export interface ParametriProfilo {
  tcpPorts: string | null;
  udpPorts: string;
  nmapArgs: string;
  tutteLePorteTcp: boolean;
  maxRate: number | null;
}

function elencoTcp(n: number, testo: string | null): string {
  const porte = testo ? porteTcpPiuFrequenti(testo, n) : [];
  return (porte.length ? porte : fallbackTcp(n)).join(",");
}

function elencoUdp(n: number, testo: string | null): string {
  const porte = testo ? porteUdpPiuFrequenti(testo, n) : [];
  const lista = porte.length ? porte : UDP_RIPIEGO.slice(0, n);
  return lista.join(",");
}

function fallbackTcp(n: number): number[] {
  const base = [22, 80, 443, 445, 3389, 21, 23, 25, 53, 110, 139, 143, 389, 636, 993, 995, 3306, 5432, 5900, 8080];
  return base.slice(0, Math.max(1, n));
}

function argomentiTcp(opts: {
  porte: string | null;
  tutte: boolean;
  maxRate: number | null;
  versione: boolean;
}): string {
  const ht = getNmapHostTimeoutSeconds();
  const parti = ["-Pn", "-sT", opts.tutte ? "-p-" : `-p ${opts.porte ?? "80,443"}`];
  if (opts.versione) parti.push("-sV", `--version-intensity ${getNmapVersionIntensity()}`);
  parti.push("-T4", "--max-retries 1");
  if (opts.maxRate != null) parti.push(`--max-rate ${opts.maxRate}`);
  else parti.push("--min-rate 200");
  parti.push(`--host-timeout ${ht}s`);
  return parti.join(" ");
}

/** Parametri nmap (e UDP) di un profilo. `testoNmap` si passa nelle prove. */
export function parametriProfilo(
  profilo: ProfiloGiro,
  opts: { testoNmap?: string | null; fasi?: FaseGiro[] } = {},
): ParametriProfilo {
  const testo = opts.testoNmap !== undefined ? opts.testoNmap : testoNmapServices();
  const fasi = profilo === "su_misura" ? fasiValide(opts.fasi) : (["host", "porte", "udp", "sonde"] as FaseGiro[]);
  const vuoleUdp = fasi.includes("udp") && profilo !== "rapido";
  const lento = profilo === "lento";
  const completo = profilo === "completo";
  const nTcp = completo ? 65535 : profilo === "rapido" ? 100 : 1000;
  const nUdp = completo ? 100 : 20;
  const tcpPorts = completo ? null : elencoTcp(nTcp, testo);
  const udpPorts = vuoleUdp ? elencoUdp(nUdp, testo) : "";
  return {
    tcpPorts,
    udpPorts,
    tutteLePorteTcp: completo,
    maxRate: lento ? 300 : null,
    nmapArgs: argomentiTcp({
      porte: tcpPorts,
      tutte: completo,
      maxRate: lento ? 300 : null,
      versione: !completo,
    }),
  };
}
