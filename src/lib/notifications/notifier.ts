/**
 * Fan-out delle notifiche sui canali abilitati.
 *
 * Nessun canale può far fallire gli altri: un SMTP irraggiungibile non deve
 * impedire al webhook di partire, né far fallire il job di sync che l'ha
 * invocato. Gli esiti tornano al chiamante per il log.
 */

import { getNotificationConfig, parseRecipients } from "./config";
import { buildWebhookPayload, type NotifiableEvent, type NotificationMessage } from "./policy";

export interface ChannelResult {
  channel: "smtp" | "webhook";
  ok: boolean;
  error?: string;
}

async function sendSmtp(msg: NotificationMessage): Promise<ChannelResult> {
  const cfg = getNotificationConfig();
  const to = parseRecipients(cfg.smtpTo);
  if (!cfg.smtpHost || to.length === 0 || !cfg.smtpFrom) {
    return { channel: "smtp", ok: false, error: "SMTP non configurato (host, from o destinatari mancanti)" };
  }
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      ...(cfg.smtpUser
        ? { auth: { user: cfg.smtpUser, pass: cfg.smtpPassword } }
        : {}),
    });
    await transport.sendMail({
      from: cfg.smtpFrom,
      to,
      subject: msg.subject,
      text: msg.text,
    });
    return { channel: "smtp", ok: true };
  } catch (e) {
    return { channel: "smtp", ok: false, error: (e as Error).message };
  }
}

async function sendWebhook(
  kind: "immediate" | "digest",
  events: NotifiableEvent[],
  tenant: string,
  message?: NotificationMessage,
): Promise<ChannelResult> {
  const cfg = getNotificationConfig();
  if (!cfg.webhookUrl) {
    return { channel: "webhook", ok: false, error: "URL webhook non configurato" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.webhookAuthHeader ? { Authorization: cfg.webhookAuthHeader } : {}),
        },
        // `message` (se il chiamante lo passa) ha sempre precedenza sulla
        // ricostruzione da `events`: senza, un chiamante con `events: []`
        // (es. una notifica di salute, non un NotifiableEvent) riceverebbe
        // un payload con `text` vuoto pur avendo un canale che risponde 200.
        body: JSON.stringify(buildWebhookPayload(kind, events, tenant, message)),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { channel: "webhook", ok: false, error: `HTTP ${res.status}` };
      }
      return { channel: "webhook", ok: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { channel: "webhook", ok: false, error: (e as Error).message };
  }
}

/**
 * Spedisce su tutti i canali abilitati. Ritorna [] se le notifiche sono spente
 * o se nessun canale è attivo: il chiamante lo tratta come "niente da fare".
 */
export async function dispatchNotification(args: {
  kind: "immediate" | "digest";
  message: NotificationMessage;
  events: NotifiableEvent[];
  tenant: string;
}): Promise<ChannelResult[]> {
  const cfg = getNotificationConfig();
  if (!cfg.enabled) return [];

  const tasks: Promise<ChannelResult>[] = [];
  if (cfg.smtpEnabled) tasks.push(sendSmtp(args.message));
  if (cfg.webhookEnabled) tasks.push(sendWebhook(args.kind, args.events, args.tenant, args.message));
  if (tasks.length === 0) return [];

  return Promise.all(tasks);
}

/** Invio di prova dalla UI di configurazione. */
export async function sendTestNotification(tenant: string): Promise<ChannelResult[]> {
  const message: NotificationMessage = {
    subject: `[${tenant}] Test notifiche DA-IPAM`,
    text:
      "Questo è un messaggio di prova inviato da DA-IPAM.\n\n" +
      "Se lo stai leggendo, il canale è configurato correttamente.",
  };
  const cfg = getNotificationConfig();
  const tasks: Promise<ChannelResult>[] = [];
  // Il test ignora `enabled`: serve proprio a validare prima di attivare.
  if (cfg.smtpEnabled) tasks.push(sendSmtp(message));
  // Stesso motivo del fix in dispatchNotification: senza passare `message`,
  // events: [] produrrebbe un payload webhook con `text` vuoto.
  if (cfg.webhookEnabled) tasks.push(sendWebhook("digest", [], tenant, message));
  return Promise.all(tasks);
}
