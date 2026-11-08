/**
 * Tipo d'installazione (ADR 0037). Si dichiara con la variabile del servizio `DA_PROFILO`,
 * scritta da Deploy-Appliance nell'unità systemd: un'impostazione nel DB la cambierebbe
 * dall'interfaccia un superadmin, anche l'utente di servizio su un'appliance di cliente.
 *
 * - assente o vuota → `installazione`: l'installazione dal cliente, com'è oggi;
 * - `tecnico` → il PC del tecnico con più profili cliente (eccezione voluta alla decisione
 *   del 12/10, solo per questo tipo);
 * - qualsiasi altro valore → l'app non parte (`server.ts`). `centrale` lo aggiungerà il
 *   Task 7 del piano 2026-11-07: finché non c'è, non deve diventare in silenzio altro.
 *
 * È l'unico file che legge `DA_PROFILO` (presidiato da `__tests__/profilo.test.ts`).
 */
export const PROFILI = ["installazione", "tecnico"] as const;
export type Profilo = (typeof PROFILI)[number];

export type LetturaProfilo = { ok: true; profilo: Profilo } | { ok: false; letto: string };

export function leggiProfilo(env: Readonly<Record<string, string | undefined>> = process.env): LetturaProfilo {
  const letto = (env.DA_PROFILO ?? "").trim();
  if (letto === "") return { ok: true, profilo: "installazione" };
  const trovato = PROFILI.find((p) => p === letto);
  return trovato ? { ok: true, profilo: trovato } : { ok: false, letto };
}

/** Il profilo di questo processo; lancia se il valore non è ammesso (all'avvio lo ferma `server.ts`). */
export function profilo(): Profilo {
  const l = leggiProfilo();
  if (!l.ok) throw new Error(messaggioProfiloNonValido(l.letto));
  return l.profilo;
}

export function isTecnico(): boolean {
  return profilo() === "tecnico";
}

export function messaggioProfiloNonValido(letto: string): string {
  return `Tipo d'installazione non valido: DA_PROFILO="${letto}". Valori ammessi: ${PROFILI.join(", ")} (assente = installazione).`;
}
