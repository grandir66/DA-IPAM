/**
 * Le voci dell'archivio nei passi del wizard (tappa 4 credenziali, 15/10):
 * tipi offerti dal modulo, voci adatte a un protocollo, ordine predefinito
 * delle prove sulla prima subnet e scelta dell'utente su quell'ordine.
 *
 * Prima il wizard chiedeva SNMP, SSH, Windows e Linux in quattro blocchi
 * fissi (una voce per tipo). Ora tutto si legge dall'archivio e dalla regola
 * unica di `credentials/tipi.ts`: un tipo nuovo delle sotto-tappe 2c/2f
 * compare nel wizard quando l'archivio lo accetta, senza toccare il wizard.
 * Modulo puro.
 */
import { ETICHETTE_TIPO, TIPI_CREDENZIALE, etichettaTipo, normalizzaTipo, tipiPerProtocollo } from "@/lib/credentials/tipi";

export interface VoceMinima {
  id: number;
  name: string;
  credential_type: string;
}

export interface OpzioneTipoWizard {
  value: string;
  label: string;
}

/**
 * Fino alla sotto-tappa 2c l'archivio non accetta «snmp_v3»: le voci v3 sono
 * di tipo «snmp» col livello di sicurezza, e il modulo ha la sezione
 * «Sicurezza SNMPv3». Con l'etichetta «SNMP v1/v2c» la v3 sembrava mancare
 * (revisione del 15/10).
 */
const ETICHETTA_SNMP_ANCHE_V3 = "SNMP (v1/v2c o v3)";

/**
 * Tipi della tendina del modulo nel wizard: quelli di `tipi.ts` che l'archivio
 * accetta oggi (`CRED_TYPE_OPTIONS`), nell'ordine e con le etichette di
 * `tipi.ts`. «linux» non è un tipo d'archivio ma un alias di SSH: non si offre.
 * Finché «snmp_v3» non è accettato, «snmp» dice che copre anche la v3.
 */
export function tipiDelModulo(codiciAccettati: readonly string[]): OpzioneTipoWizard[] {
  const accettati = new Set(codiciAccettati);
  const snmpAncheV3 = !accettati.has("snmp_v3");
  return TIPI_CREDENZIALE.filter((t) => accettati.has(t)).map((t) => ({
    value: t,
    label: t === "snmp" && snmpAncheV3 ? ETICHETTA_SNMP_ANCHE_V3 : ETICHETTE_TIPO[t],
  }));
}

/**
 * Etichetta di una voce dell'archivio: quella del tipo, ma una voce «snmp» col
 * livello di sicurezza è una v3 (fino alla 2c non ha un tipo suo).
 */
export function etichettaVoce(v: { credential_type: string; security_level?: string | null }): string {
  if (normalizzaTipo(v.credential_type) === "snmp" && v.security_level) return ETICHETTE_TIPO.snmp_v3;
  return etichettaTipo(v.credential_type);
}

/** Le voci che valgono per un protocollo d'apparato (`ssh`, `snmp_v2`, `winrm`…), regola di `tipi.ts`. */
export function vociPerProtocollo<T extends VoceMinima>(voci: readonly T[], protocollo: string): T[] {
  const tipi = tipiPerProtocollo(protocollo);
  return voci.filter((v) => tipi.includes(v.credential_type));
}

export function vociSnmp<T extends VoceMinima>(voci: readonly T[]): T[] {
  return vociPerProtocollo(voci, "snmp");
}

/** Voci per la WinRM dell'integrazione AD: solo le Windows (l'account AD non entra, D7). */
export function vociWindows<T extends VoceMinima>(voci: readonly T[]): T[] {
  return vociPerProtocollo(voci, "winrm");
}

/**
 * WinRM proposta per l'integrazione AD: la voce Windows se è una sola (il
 * vecchio wizard collegava quella creata da lui); con più voci si sceglie.
 */
export function winrmPredefinita(voci: readonly VoceMinima[]): number | null {
  const w = vociWindows(voci);
  return w.length === 1 ? w[0].id : null;
}

/** Gruppo nell'ordine predefinito: SNMP, SSH, Windows, poi le altre. */
function gruppo(tipo: string): number {
  const t = normalizzaTipo(tipo);
  if (t === "snmp" || t === "snmp_v3") return 0;
  if (t === "ssh") return 1;
  if (t === "windows") return 2;
  return 3;
}

/** Ordine predefinito delle prove sulla subnet; a parità di gruppo resta l'ordine dell'archivio. */
export function ordinePredefinito<T extends VoceMinima>(voci: readonly T[]): T[] {
  return voci
    .map((v, i) => ({ v, i }))
    .sort((a, b) => gruppo(a.v.credential_type) - gruppo(b.v.credential_type) || a.i - b.i)
    .map((x) => x.v);
}

export interface SceltaRete {
  id: number;
  attiva: boolean;
}

/**
 * La scelta dell'utente sulle voci da provare, riallineata all'archivio:
 * `null` = non ancora toccata (tutte, spuntate, nell'ordine predefinito);
 * le voci eliminate spariscono, quelle aggiunte dopo si accodano spuntate.
 */
export function riconciliaSceltaRete(scelta: readonly SceltaRete[] | null, voci: readonly VoceMinima[]): SceltaRete[] {
  if (scelta === null) return ordinePredefinito(voci).map((v) => ({ id: v.id, attiva: true }));
  const esistenti = new Set(voci.map((v) => v.id));
  const tenute = scelta.filter((s) => esistenti.has(s.id));
  const viste = new Set(tenute.map((s) => s.id));
  const nuove = ordinePredefinito(voci.filter((v) => !viste.has(v.id))).map((v) => ({ id: v.id, attiva: true }));
  return [...tenute.map((s) => ({ ...s })), ...nuove];
}

/** Scambia la voce `indice` con quella sopra (-1) o sotto (+1); ai bordi niente. */
export function spostaScelta(scelta: readonly SceltaRete[], indice: number, direzione: -1 | 1): SceltaRete[] {
  const j = indice + direzione;
  if (indice < 0 || indice >= scelta.length || j < 0 || j >= scelta.length) return [...scelta];
  const out = [...scelta];
  [out[indice], out[j]] = [out[j], out[indice]];
  return out;
}

/** Id da mandare in `credential_ids`: le spuntate, nell'ordine scelto. */
export function idsDaProvare(scelta: readonly SceltaRete[]): number[] {
  return scelta.filter((s) => s.attiva).map((s) => s.id);
}

/** Colonna «Porta»: «std» se è quella standard del tipo. */
export function etichettaPorta(porta: number | null): string {
  return porta == null ? "std" : String(porta);
}
