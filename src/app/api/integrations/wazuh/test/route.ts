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
import { createWazuhIndexerClient } from "@/lib/integrations/wazuh-indexer-api";
import { getWazuhConfig } from "@/lib/integrations/wazuh-config";

const BodySchema = z.object({
  url:             z.string().min(1).optional(),
  username:        z.string().min(1).optional(),
  password:        z.string().min(1).optional(),
  verifyTls:       z.boolean().optional(),
  indexerUrl:      z.string().optional(),
  indexerUsername: z.string().optional(),
  indexerPassword: z.string().optional(),
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
    url:             parsed.data.url             ?? saved.url,
    username:        parsed.data.username        ?? saved.username,
    password:        parsed.data.password        ?? saved.password,
    verifyTls:       parsed.data.verifyTls       ?? saved.verifyTls,
    indexerUrl:      parsed.data.indexerUrl      ?? saved.indexerUrl,
    indexerUsername: parsed.data.indexerUsername ?? saved.indexerUsername,
    indexerPassword: parsed.data.indexerPassword ?? saved.indexerPassword,
  };
  if (!cfg.url || !cfg.username || !cfg.password) {
    return NextResponse.json(
      { ok: false, error: "URL, username e password Manager API sono richiesti" },
      { status: 400 },
    );
  }

  const result: Record<string, unknown> = {
    ok: false,
    manager: null,
    indexer: null,
  };

  const client = createWazuhClient(cfg);
  if (client) {
    try {
      const info = await client.ping();
      const agents = await client.listAgents(true);
      result.manager = {
        ok: true,
        apiVersion: info.apiVersion ?? null,
        nodeName: info.nodeName ?? null,
        totalAgents: agents.length,
        activeAgents: agents.filter((a) => a.status === "active").length,
      };
    } catch (e) {
      result.manager = { ok: false, error: (e as Error).message };
    }
  }

  if (cfg.indexerUrl && cfg.indexerUsername && cfg.indexerPassword) {
    const idx = createWazuhIndexerClient({
      url: cfg.indexerUrl,
      username: cfg.indexerUsername,
      password: cfg.indexerPassword,
      verifyTls: cfg.verifyTls,
    });
    if (idx) {
      try {
        const info = await idx.ping();
        const total = await idx.totalVulnDocs();
        result.indexer = {
          ok: true,
          clusterName: info.clusterName ?? null,
          status: info.status ?? null,
          nodes: info.numberOfNodes ?? null,
          totalCveDocs: total,
        };
      } catch (e) {
        result.indexer = { ok: false, error: (e as Error).message };
      }
    }
  }

  result.ok = (result.manager as { ok?: boolean })?.ok === true;
  return NextResponse.json(result);
}
