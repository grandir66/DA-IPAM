/**
 * La casa componibile della vista cliente (Riccardo, 11/11/2026: i riquadri «in una griglia
 * prestabilita, con la possibilità di spostarli, di nasconderli, di aggiungerne dalla libreria»).
 *
 * Versione semplice, apposta: griglia a due colonne, ogni riquadro in due sole misure (mezza riga
 * o riga intera), un ordine e una visibilità. Niente trascinamento né ridimensionamento a mano.
 * La «libreria» è `RIQUADRI_CASA`: un riquadro nuovo si aggiunge qui e compare da solo fra quelli
 * disponibili. La disposizione è una per cliente (`tenant_settings`, chiave `cliente.casa`) e la
 * compone l'amministratore: il Cliente resta in sola lettura.
 */
import type Database from "better-sqlite3";

export type MisuraRiquadro = "mezza" | "intera";
export const MISURE: readonly MisuraRiquadro[] = ["mezza", "intera"];

export interface RiquadroCasa {
  id: string;
  titolo: string;
  cosa: string;
  misura: MisuraRiquadro;
}

/** La libreria, nell'ordine predefinito. */
export const RIQUADRI_CASA: readonly RiquadroCasa[] = [
  { id: "indirizzi", titolo: "Indirizzi in uso nel tempo", cosa: "La curva degli indirizzi accesi nelle ultime 48 ore", misura: "intera" },
  { id: "accessi", titolo: "Accessi falliti", cosa: "Ora per ora nelle ultime 24 ore, con chi e da dove", misura: "intera" },
  { id: "reti", titolo: "Le tue reti", cosa: "Accesi e spenti da poco per ogni rete", misura: "mezza" },
  { id: "rischio", titolo: "Rischio del dominio", cosa: "Il punteggio di rischio e i rilievi gravi", misura: "mezza" },
  { id: "per-rete", titolo: "Da sistemare per rete", cosa: "Gravi e alte per ogni rete", misura: "mezza" },
];

export interface VoceDisposizione {
  id: string;
  misura: MisuraRiquadro;
  visibile: boolean;
}

export const CHIAVE_CASA = "cliente.casa";

export function disposizionePredefinita(): VoceDisposizione[] {
  return RIQUADRI_CASA.map((r) => ({ id: r.id, misura: r.misura, visibile: true }));
}

function eMisura(v: unknown): v is MisuraRiquadro {
  return v === "mezza" || v === "intera";
}

/**
 * Pura. Da un valore qualsiasi a una disposizione valida: gli id che la libreria non conosce si
 * scartano, i doppi pure, una misura sbagliata torna quella predefinita, e i riquadri della
 * libreria che mancano si aggiungono in coda, visibili (così uno nuovo compare a tutti).
 */
export function normalizza(salvata: unknown): VoceDisposizione[] {
  const noti = new Map(RIQUADRI_CASA.map((r) => [r.id, r]));
  const visti = new Set<string>();
  const voci: VoceDisposizione[] = [];
  if (Array.isArray(salvata)) {
    for (const voce of salvata) {
      if (!voce || typeof voce !== "object") continue;
      const v = voce as { id?: unknown; misura?: unknown; visibile?: unknown };
      if (typeof v.id !== "string") continue;
      const noto = noti.get(v.id);
      if (!noto || visti.has(v.id)) continue;
      visti.add(v.id);
      voci.push({ id: v.id, misura: eMisura(v.misura) ? v.misura : noto.misura, visibile: v.visibile !== false });
    }
  }
  for (const r of RIQUADRI_CASA) {
    if (!visti.has(r.id)) voci.push({ id: r.id, misura: r.misura, visibile: true });
  }
  return voci;
}

/** La disposizione del cliente; senza niente di salvato, o con un valore illeggibile, quella predefinita. */
export function leggiDisposizione(db: Database.Database): VoceDisposizione[] {
  const riga = db.prepare("SELECT value FROM tenant_settings WHERE key = ?").get(CHIAVE_CASA) as { value: string } | undefined;
  if (!riga?.value) return disposizionePredefinita();
  try {
    return normalizza(JSON.parse(riga.value));
  } catch {
    return disposizionePredefinita();
  }
}

/** Salva la disposizione già normalizzata. Rende ciò che ha scritto. */
export function salvaDisposizione(db: Database.Database, voci: unknown): VoceDisposizione[] {
  const pulite = normalizza(voci);
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(CHIAVE_CASA, JSON.stringify(pulite));
  return pulite;
}

/** Pura. Sposta un riquadro di un posto; ai bordi non fa niente. */
export function sposta(voci: readonly VoceDisposizione[], id: string, verso: "su" | "giu"): VoceDisposizione[] {
  const i = voci.findIndex((v) => v.id === id);
  const j = verso === "su" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= voci.length) return [...voci];
  const copia = [...voci];
  const a = copia[i] as VoceDisposizione;
  copia[i] = copia[j] as VoceDisposizione;
  copia[j] = a;
  return copia;
}
