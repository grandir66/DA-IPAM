/**
 * La casa componibile della vista cliente, sul modello della home di Entra (Riccardo, 11/11/2026:
 * «una modalità simile alla pagina di entra.domarc.it, dove potevo ridimensionare gli oggetti»).
 *
 * Una griglia a 12 colonne con righe di altezza fissa. Ogni riquadro ha una larghezza in colonne e
 * un'altezza in righe e riempie tutta la sua casella. L'ordine è quello dell'elenco: la griglia li
 * dispone da sola e riempie i buchi, quindi due riquadri non si sovrappongono mai. La «libreria» è
 * `RIQUADRI_CASA`: un riquadro nuovo si aggiunge qui e compare da solo fra quelli disponibili.
 * La disposizione è una per cliente (`tenant_settings`, chiave `cliente.casa`) e la compone
 * l'amministratore: il Cliente resta in sola lettura.
 */
import type Database from "better-sqlite3";

export const COLONNE = 12;
/** Le larghezze ammesse, in colonne: un quarto, un terzo, metà, due terzi, tre quarti, tutta. */
export const LARGHEZZE: readonly number[] = [3, 4, 6, 8, 9, 12];
export const ALTEZZA_MIN = 2;
export const ALTEZZA_MAX = 8;
/** Altezza di una riga della griglia, in pixel (lo spazio fra le righe è a parte). */
export const RIGA_PX = 84;

export interface RiquadroCasa {
  id: string;
  titolo: string;
  cosa: string;
  /** Misura predefinita: colonne e righe. */
  l: number;
  a: number;
}

/** La libreria, nell'ordine predefinito. */
export const RIQUADRI_CASA: readonly RiquadroCasa[] = [
  { id: "indirizzi", titolo: "Indirizzi in uso nel tempo", cosa: "La curva degli indirizzi accesi nelle ultime 48 ore", l: 12, a: 4 },
  { id: "accessi-andamento", titolo: "Accessi falliti nel tempo", cosa: "Una barra per ora nelle ultime 24 ore, con i blocchi di account", l: 6, a: 4 },
  { id: "accessi-utenti", titolo: "Accessi falliti per utente", cosa: "Gli account che sbagliano di più nelle ultime 24 ore", l: 3, a: 4 },
  { id: "rischio", titolo: "Rischio del dominio", cosa: "Il punteggio di rischio e i rilievi gravi", l: 3, a: 4 },
  { id: "reti", titolo: "Le tue reti", cosa: "Accesi e spenti da poco per ogni rete", l: 6, a: 4 },
  { id: "per-rete", titolo: "Da sistemare per rete", cosa: "Gravi e alte per ogni rete", l: 6, a: 4 },
  { id: "accessi-origini", titolo: "Accessi falliti: da dove", cosa: "Le postazioni da cui partono i tentativi nelle ultime 24 ore", l: 6, a: 3 },
];

export interface VoceDisposizione {
  id: string;
  /** Larghezza in colonne, una di `LARGHEZZE`. */
  l: number;
  /** Altezza in righe, fra `ALTEZZA_MIN` e `ALTEZZA_MAX`. */
  a: number;
  visibile: boolean;
}

export const CHIAVE_CASA = "cliente.casa";

export function disposizionePredefinita(): VoceDisposizione[] {
  return RIQUADRI_CASA.map((r) => ({ id: r.id, l: r.l, a: r.a, visibile: true }));
}

/** Gli identificativi di una disposizione salvata prima che gli accessi fossero divisi in tre riquadri. */
const VECCHI_ID: Record<string, string> = { accessi: "accessi-andamento" };

function larghezzaDa(v: { l?: unknown; misura?: unknown }, predefinita: number): number {
  if (typeof v.l === "number" && LARGHEZZE.includes(v.l)) return v.l;
  // La prima versione salvava «mezza» o «intera».
  if (v.misura === "mezza") return 6;
  if (v.misura === "intera") return 12;
  return predefinita;
}

function altezzaDa(v: { a?: unknown }, predefinita: number): number {
  if (typeof v.a === "number" && Number.isInteger(v.a) && v.a >= ALTEZZA_MIN && v.a <= ALTEZZA_MAX) return v.a;
  return predefinita;
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
      const v = voce as { id?: unknown; l?: unknown; a?: unknown; misura?: unknown; visibile?: unknown };
      if (typeof v.id !== "string") continue;
      const id = VECCHI_ID[v.id] ?? v.id;
      const noto = noti.get(id);
      if (!noto || visti.has(id)) continue;
      visti.add(id);
      voci.push({ id, l: larghezzaDa(v, noto.l), a: altezzaDa(v, noto.a), visibile: v.visibile !== false });
    }
  }
  for (const r of RIQUADRI_CASA) {
    if (!visti.has(r.id)) voci.push({ id: r.id, l: r.l, a: r.a, visibile: true });
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

/** Pura. Porta `id` subito prima di `primaDi` (trascinato e lasciato sopra un altro riquadro). */
export function spostaPrima(voci: readonly VoceDisposizione[], id: string, primaDi: string): VoceDisposizione[] {
  if (id === primaDi) return [...voci];
  const mosso = voci.find((v) => v.id === id);
  if (!mosso || !voci.some((v) => v.id === primaDi)) return [...voci];
  const senza = voci.filter((v) => v.id !== id);
  const dove = senza.findIndex((v) => v.id === primaDi);
  return [...senza.slice(0, dove), mosso, ...senza.slice(dove)];
}

/** Pura. Sposta un riquadro di un posto nell'ordine; ai bordi non fa niente. */
export function sposta(voci: readonly VoceDisposizione[], id: string, verso: "prima" | "dopo"): VoceDisposizione[] {
  const i = voci.findIndex((v) => v.id === id);
  const j = verso === "prima" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= voci.length) return [...voci];
  const copia = [...voci];
  const a = copia[i] as VoceDisposizione;
  copia[i] = copia[j] as VoceDisposizione;
  copia[j] = a;
  return copia;
}

/** Pura. Allarga o stringe di uno scatto fra le larghezze ammesse; agli estremi resta com'è. */
export function allarga(voci: readonly VoceDisposizione[], id: string, scatto: 1 | -1): VoceDisposizione[] {
  return voci.map((v) => {
    if (v.id !== id) return v;
    const i = LARGHEZZE.indexOf(v.l);
    const nuova = LARGHEZZE[(i < 0 ? LARGHEZZE.indexOf(6) : i) + scatto];
    return nuova == null ? v : { ...v, l: nuova };
  });
}

/** Pura. Alza o abbassa di una riga, entro i limiti. */
export function alza(voci: readonly VoceDisposizione[], id: string, scatto: 1 | -1): VoceDisposizione[] {
  return voci.map((v) => (v.id === id ? { ...v, a: Math.min(ALTEZZA_MAX, Math.max(ALTEZZA_MIN, v.a + scatto)) } : v));
}
