/**
 * Politica di invio delle notifiche e composizione dei messaggi.
 *
 * Modulo puro: nessun I/O, così la regola "cosa merita di svegliare qualcuno"
 * è testabile e resta una decisione esplicita invece che sparsa nel codice.
 */

import { categoryById } from "../integrations/wazuh-alerts";

export interface NotifiableEvent {
  id: number;
  category: string;
  diagnostic: number;
  rule_level: number;
  rule_description: string | null;
  agent_name: string | null;
  event_id: string | null;
  target_user: string | null;
  source_ip: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface NotifyPolicy {
  /** Categorie che notificano subito, a prescindere dal livello. */
  immediateCategories: string[];
  /** Livello Wazuh da cui si notifica subito comunque. */
  immediateMinLevel: number;
  /** Ogni quanto spedire il riepilogo di tutto il resto. */
  digestIntervalMinutes: number;
}

export const DEFAULT_POLICY: NotifyPolicy = {
  immediateCategories: ["ransomware", "log_tampering"],
  immediateMinLevel: 12,
  digestIntervalMinutes: 60,
};

/**
 * Gli eventi diagnostici non notificano mai subito: sul campo `agent_flooding`
 * è il segnale più rumoroso in assoluto, e usarlo per avvisi immediati
 * insegnerebbe a ignorare il canale. Finisce nel digest.
 */
export function shouldNotifyImmediately(
  e: NotifiableEvent,
  p: NotifyPolicy,
): boolean {
  if (e.diagnostic) return false;
  if (p.immediateCategories.includes(e.category)) return true;
  return e.rule_level >= p.immediateMinLevel;
}

function categoryLabel(id: string): string {
  return categoryById(id)?.labelIt ?? id;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("it-IT");
}

function describe(e: NotifiableEvent): string {
  const bits: string[] = [];
  bits.push(`  • ${e.rule_description ?? "(senza descrizione)"}`);
  bits.push(`    agent: ${e.agent_name ?? "sconosciuto"} · livello ${e.rule_level}`);
  const detail: string[] = [];
  if (e.event_id) detail.push(`Event ID ${e.event_id}`);
  if (e.target_user) detail.push(`utente ${e.target_user}`);
  if (e.source_ip) detail.push(`IP ${e.source_ip}`);
  if (detail.length) bits.push(`    ${detail.join(" · ")}`);
  bits.push(
    `    ${e.occurrence_count} ${e.occurrence_count === 1 ? "occorrenza" : "occorrenze"}, ultima ${formatDate(e.last_seen_at)}`,
  );
  return bits.join("\n");
}

export interface NotificationMessage {
  subject: string;
  text: string;
}

export function buildImmediateMessage(
  e: NotifiableEvent,
  tenant: string,
): NotificationMessage {
  const label = categoryLabel(e.category);
  return {
    subject: `[${tenant}] Alert sicurezza: ${label} su ${e.agent_name ?? "agent sconosciuto"}`,
    text:
      `Rilevato un alert di sicurezza che richiede attenzione immediata.\n\n` +
      `Categoria: ${label}\n\n` +
      `${describe(e)}\n\n` +
      `Apri DA-IPAM → Alert sicurezza per prendere in carico l'evento.`,
  };
}

export function buildDigestMessage(
  events: NotifiableEvent[],
  tenant: string,
): NotificationMessage | null {
  if (events.length === 0) return null;

  const byCategory = new Map<string, NotifiableEvent[]>();
  for (const e of events) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  const plural = (n: number) => (n === 1 ? "evento" : "eventi");

  const sections: string[] = [];
  for (const [cat, list] of byCategory) {
    sections.push(`${categoryLabel(cat)} — ${list.length} ${plural(list.length)}`);
    sections.push(list.map(describe).join("\n"));
    sections.push("");
  }

  const n = events.length;
  return {
    subject: `[${tenant}] Riepilogo alert sicurezza: ${n} ${n === 1 ? "nuovo evento" : "nuovi eventi"}`,
    text:
      `Nuovi eventi di sicurezza aperti dall'ultimo riepilogo.\n\n` +
      sections.join("\n") +
      `\nApri DA-IPAM → Alert sicurezza per il dettaglio.`,
  };
}

export interface WebhookPayload {
  source: "da-ipam";
  kind: "immediate" | "digest";
  tenant: string;
  generatedAt: string;
  text: string;
  events: Array<{
    id: number;
    category: string;
    diagnostic: boolean;
    level: number;
    description: string | null;
    agent: string | null;
    eventId: string | null;
    targetUser: string | null;
    sourceIp: string | null;
    occurrences: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
}

/**
 * @param message Testo già composto dal chiamante (es. una notifica di
 *   salute Wazuh, non legata a un `NotifiableEvent`): se presente ha SEMPRE
 *   precedenza sulla ricostruzione da `events`. Senza, con `events` vuoto
 *   (`kind: "immediate"` e nessun evento, o digest senza eventi) il testo
 *   ricostruito sarebbe vuoto — è esattamente il bug per cui è stato
 *   aggiunto questo parametro: un chiamante che notifica qualcosa che non è
 *   un `NotifiableEvent` non deve finire con un payload silenziosamente vuoto.
 */
export function buildWebhookPayload(
  kind: "immediate" | "digest",
  events: NotifiableEvent[],
  tenant: string,
  message?: NotificationMessage,
  generatedAt: string = new Date().toISOString(),
): WebhookPayload {
  const msg =
    message ??
    (kind === "immediate" && events[0]
      ? buildImmediateMessage(events[0], tenant)
      : buildDigestMessage(events, tenant));
  return {
    source: "da-ipam",
    kind,
    tenant,
    generatedAt,
    text: msg?.text ?? "",
    events: events.map((e) => ({
      id: e.id,
      category: e.category,
      diagnostic: e.diagnostic === 1,
      level: e.rule_level,
      description: e.rule_description,
      agent: e.agent_name,
      eventId: e.event_id,
      targetUser: e.target_user,
      sourceIp: e.source_ip,
      occurrences: e.occurrence_count,
      firstSeenAt: e.first_seen_at,
      lastSeenAt: e.last_seen_at,
    })),
  };
}
