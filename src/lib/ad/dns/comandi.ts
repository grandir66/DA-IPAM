/**
 * Comandi DNS di Windows per le correzioni (passo 2, 17/11/2026): si compongono SOLO da valori
 * passati dalla convalida. Niente testo libero: un valore che non è un nome DNS o un IPv4 fa
 * rifiutare il passo, non lo si «pulisce». I valori entrano nel comando come letterali
 * PowerShell fra apici singoli.
 *
 * Tre comandi: leggi un nodo, aggiungi un record, togli UN record esatto. Il «togli» non usa
 * `-RecordData` (la sua forma cambia fra A, PTR e CNAME): rilegge il nodo, tiene il solo record
 * che coincide e lo passa a `Remove-DnsServerResourceRecord`; se non ne trova esattamente uno
 * si ferma con `NON_UNICO`, senza togliere niente.
 *
 * `ConvertTo-Json` di PowerShell serializza indirizzi e durate come oggetti annidati (trappola
 * già vista sul DHCP, v0.2.658): i campi si appiattiscono lato PowerShell con `Select-Object`.
 */
import type { PassoDns, TipoPassoDns } from "./correzioni";

export type EsitoConvalida = { ok: true } | { ok: false; motivo: string };

export interface AmmessiDns {
  /** Le zone in archivio per quell'integrazione: fuori da queste non si scrive. */
  zone: ReadonlySet<string>;
  /** Controller di dominio: nomi corti in minuscolo. */
  nomiDc: ReadonlySet<string>;
  ipDc: ReadonlySet<string>;
}

const ETICHETTA = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TIPI: readonly TipoPassoDns[] = ["A", "CNAME", "PTR"];

function nomeValido(nome: string): boolean {
  return nome.length > 0 && nome.length <= 253 && nome.split(".").every((e) => ETICHETTA.test(e));
}

function ipv4(ip: string): boolean {
  const o = ip.split(".");
  return o.length === 4 && o.every((x) => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 255);
}

const corto = (s: string) => s.split(".")[0] ?? "";

/**
 * Nomi che i client Windows cercano da soli (proxy, tunnel IPv6): chi li registra si mette in mezzo
 * al traffico. Il nome di «crea» e «rinomina» viene da quello che l'host dichiara in rete, quindi
 * non si creano da qui (revisione del 18/11). Toglierli resta ammesso.
 */
const NOMI_RISERVATI = new Set(["wpad", "isatap"]);

export function convalidaPasso(p: PassoDns, ammessi: AmmessiDns): EsitoConvalida {
  if (p.azione !== "aggiungi" && p.azione !== "togli") return { ok: false, motivo: "Azione non prevista" };
  if (!TIPI.includes(p.tipo)) return { ok: false, motivo: `Tipo di record non correggibile: ${String(p.tipo)}` };
  if (!ammessi.zone.has(p.zona)) return { ok: false, motivo: "La zona non è fra quelle lette da questo dominio" };
  if (!nomeValido(p.zona) || /^_msdcs/.test(p.zona)) return { ok: false, motivo: "Zona non ammessa" };
  if (!nomeValido(p.nome)) return { ok: false, motivo: "Il nome del record non è un nome DNS di host" };
  if (p.azione === "aggiungi" && p.tipo !== "PTR" && NOMI_RISERVATI.has(corto(p.nome))) return { ok: false, motivo: "È un nome riservato (wpad, isatap): non si crea da qui" };
  const inversa = p.zona.endsWith(".in-addr.arpa");
  if ((p.tipo === "PTR") !== inversa) return { ok: false, motivo: p.tipo === "PTR" ? "Un reverse sta solo in una zona reverse" : "In una zona reverse stanno solo i reverse" };
  if (p.tipo === "PTR" && !p.nome.split(".").every((e) => /^\d{1,3}$/.test(e))) return { ok: false, motivo: "Il nodo di un reverse è fatto di soli numeri" };
  if (p.tipo === "A" ? !ipv4(p.dato) : !nomeValido(p.dato)) return { ok: false, motivo: p.tipo === "A" ? "L'indirizzo non è un IPv4" : "La destinazione non è un nome DNS" };

  const ipDelPtr = p.tipo === "PTR" ? [...p.nome.split("."), ...p.zona.replace(/\.in-addr\.arpa$/, "").split(".")].reverse().join(".") : "";
  const toccaUnDc =
    (p.tipo !== "PTR" && ammessi.nomiDc.has(corto(p.nome)))
    || (p.tipo !== "A" && ammessi.nomiDc.has(corto(p.dato)))
    || (p.tipo === "A" && ammessi.ipDc.has(p.dato))
    || (p.tipo === "PTR" && ammessi.ipDc.has(ipDelPtr));
  if (toccaUnDc) return { ok: false, motivo: "È un record di un controller di dominio: non si corregge da qui" };
  return { ok: true };
}

/** Letterale PowerShell fra apici singoli. I valori sono già convalidati: il raddoppio dell'apice è la seconda cintura. */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const CAMPO_DATO: Record<TipoPassoDns, string> = {
  A: "$_.RecordData.IPv4Address.IPAddressToString",
  PTR: "$_.RecordData.PtrDomainName.TrimEnd('.')",
  CNAME: "$_.RecordData.HostNameAlias.TrimEnd('.')",
};

/** I record di quel tipo sul nodo esatto (non sui nodi figli), con i campi che servono al confronto. */
function leggiNodo(zona: string, nome: string, tipo: TipoPassoDns): string {
  return `@(Get-DnsServerResourceRecord -ZoneName ${q(zona)} -Name ${q(nome)} -RRType ${q(tipo)} -ErrorAction SilentlyContinue | Where-Object { $_.HostName -eq ${q(nome)} })`;
}

const PREAMBOLO = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; try { ";
const CODA = " } catch { 'ESITO_ERRORE: ' + $_.Exception.Message }";

export function comandoLeggi(zona: string, nome: string, tipo: TipoPassoDns): string {
  return `${PREAMBOLO}$r = ${leggiNodo(zona, nome, tipo)}; `
    + `'ESITO_LETTO: ' + (ConvertTo-Json -Compress -InputObject @($r | ForEach-Object { [pscustomobject]@{ `
    + `tipo = ${q(tipo)}; dato = ${CAMPO_DATO[tipo]}; ttl = [int]$_.TimeToLive.TotalSeconds; `
    + `rinnovo = $(if ($_.Timestamp) { $_.Timestamp.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') } else { $null }) } }))`
    + CODA;
}

export function comandoPasso(p: PassoDns): string {
  if (p.azione === "aggiungi") {
    const aggiungi = p.tipo === "A"
      ? `Add-DnsServerResourceRecordA -ZoneName ${q(p.zona)} -Name ${q(p.nome)} -IPv4Address ${q(p.dato)}`
      : p.tipo === "PTR"
        ? `Add-DnsServerResourceRecordPtr -ZoneName ${q(p.zona)} -Name ${q(p.nome)} -PtrDomainName ${q(p.dato)}`
        : `Add-DnsServerResourceRecordCName -ZoneName ${q(p.zona)} -Name ${q(p.nome)} -HostNameAlias ${q(p.dato)}`;
    return `${PREAMBOLO}${aggiungi}; 'ESITO_OK'${CODA}`;
  }
  return `${PREAMBOLO}$r = @(${leggiNodo(p.zona, p.nome, p.tipo)} | Where-Object { ${CAMPO_DATO[p.tipo]} -eq ${q(p.dato)} }); `
    + `if ($r.Count -ne 1) { throw ('NON_UNICO: ' + $r.Count) }; `
    + `$r[0] | Remove-DnsServerResourceRecord -ZoneName ${q(p.zona)} -Force; 'ESITO_OK'${CODA}`;
}

export interface RecordSulDc {
  tipo: TipoPassoDns;
  dato: string;
  ttl: number;
  statica: boolean;
  rinnovataIl: string | null;
}

export type RispostaLettura = { ok: true; record: RecordSulDc[] } | { ok: false; motivo: string };
export type RispostaPasso = { ok: true } | { ok: false; motivo: string };

function rigaEsito(uscita: string): string | null {
  const righe = uscita.split(/\r?\n/).map((r) => r.trim()).filter((r) => r.startsWith("ESITO_"));
  return righe.length > 0 ? righe[righe.length - 1]! : null;
}

/** L'uscita di `comandoLeggi`. Senza la riga `ESITO_LETTO` non è una risposta: non si sa niente. */
export function leggiRisposta(uscita: string): RispostaLettura {
  const riga = rigaEsito(uscita);
  if (!riga) return { ok: false, motivo: "Il DC non ha risposto nella forma attesa" };
  if (riga.startsWith("ESITO_ERRORE:")) return { ok: false, motivo: riga.slice("ESITO_ERRORE:".length).trim() };
  if (!riga.startsWith("ESITO_LETTO:")) return { ok: false, motivo: "Il DC non ha risposto nella forma attesa" };
  const testo = riga.slice("ESITO_LETTO:".length).trim();
  let dati: unknown;
  try { dati = testo ? JSON.parse(testo) : []; } catch { return { ok: false, motivo: "Risposta del DC non leggibile" }; }
  const lista = dati == null ? [] : Array.isArray(dati) ? dati : [dati];
  const record: RecordSulDc[] = [];
  for (const x of lista as Record<string, unknown>[]) {
    const tipo = TIPI.find((t) => t === x?.tipo);
    if (!tipo || typeof x.dato !== "string" || !x.dato) return { ok: false, motivo: "Risposta del DC non leggibile" };
    const rinnovo = typeof x.rinnovo === "string" && x.rinnovo ? x.rinnovo : null;
    record.push({ tipo, dato: x.dato.toLowerCase().replace(/\.$/, ""), ttl: Number(x.ttl) || 0, statica: rinnovo === null, rinnovataIl: rinnovo });
  }
  return { ok: true, record };
}

/** L'uscita di `comandoPasso`: riuscito solo con `ESITO_OK` scritto dal DC. */
export function leggiEsitoPasso(uscita: string): RispostaPasso {
  const riga = rigaEsito(uscita);
  if (riga === "ESITO_OK") return { ok: true };
  if (riga?.startsWith("ESITO_ERRORE:")) return { ok: false, motivo: riga.slice("ESITO_ERRORE:".length).trim() };
  return { ok: false, motivo: "Il DC non ha confermato l'operazione" };
}
