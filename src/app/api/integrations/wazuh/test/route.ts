/**
 * Test connessione Wazuh.
 *
 *   POST  con body { url, username, password, verifyTls } → testa al volo
 *         (utile prima del Salva, senza persistere). Se body vuoto, usa
 *         la config salvata.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { createWazuhClient } from "@/lib/integrations/wazuh-api";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";

const BodySchema = z.object({
  url:       z.string().min(1).optional(),
  username:  z.string().min(1).optional(),
  password:  z.string().min(1).optional(),
  verifyTls: z.boolean().optional(),
});

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown = {};
  try { body = await req.json(); } catch { /* body vuoto = usa config salvata */ }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  const saved = getWazuhConfig();
  const cfg = {
    url:       parsed.data.url       ?? saved.url,
    username:  parsed.data.username  ?? saved.username,
    password:  parsed.data.password  ?? saved.password,
    verifyTls: parsed.data.verifyTls ?? saved.verifyTls,
  };
  if (!cfg.url || !cfg.username || !cfg.password) {
    return NextResponse.json(
      { ok: false, error: "URL, username e password sono richiesti" },
      { status: 400 },
    );
  }

  const client = createWazuhClient(cfg);
  if (!client) {
    return NextResponse.json({ ok: false, error: "Config non valida" }, { status: 400 });
  }

  try {
    const info = await client.ping();
    const agents = await client.listAgents(true);
    return NextResponse.json({
      ok: true,
      apiVersion: info.apiVersion ?? null,
      nodeName: info.nodeName ?? null,
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.status === "active").length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 200 }, // 200 con ok:false per non confondere errori di rete vs config
    );
  }
}
