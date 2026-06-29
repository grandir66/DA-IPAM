/**
 * POST /api/integrations/meshcentral/install-script
 *
 * Body: { platform: 'windows' | 'linux' | 'macos' }
 *
 * Ritorna lo script di install MeshAgent con serverUrl + meshId EMBEDDED.
 * Valida che il MeshID configurato esista DAVVERO sul server (control.ashx
 * `meshes`) PRIMA di emettere lo script: senza il device group il `.msh` non
 * esiste (chicken-and-egg §4) → 500.
 *
 * Auth: requireAdmin (lo script porta il binding al device group del cliente).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getMeshCreds, type MeshCreds } from "@/lib/integrations/meshcentral/config";
import { MeshControlClient } from "@/lib/integrations/meshcentral/control-client";
import {
  buildMeshInstallScript,
  isMeshInstallPlatform,
  meshInstallScriptFilename,
  meshInstallScriptContentType,
} from "@/lib/integrations/meshcentral/install-scripts";

const bodySchema = z.object({
  platform: z.enum(["windows", "linux", "macos"]),
});

export interface ResolveInstallDeps {
  getMeshCreds: () => MeshCreds | null;
  listMeshes: (creds: MeshCreds) => Promise<Array<{ meshId: string; name: string }>>;
}

export interface ResolveInstallResult {
  status: number;
  error?: string;
  script?: string;
  filename?: string;
  contentType?: string;
}

/**
 * Logica pura (testabile senza HTTP): valida platform, carica creds, verifica
 * che il MeshID configurato esista sul server, costruisce lo script.
 */
export async function resolveInstallScript(
  platform: string,
  deps: ResolveInstallDeps,
): Promise<ResolveInstallResult> {
  if (!isMeshInstallPlatform(platform)) {
    return { status: 400, error: "platform non valida" };
  }
  const creds = deps.getMeshCreds();
  if (!creds) {
    return { status: 500, error: "MeshCentral non configurato" };
  }
  let meshes: Array<{ meshId: string; name: string }>;
  try {
    meshes = await deps.listMeshes(creds);
  } catch (err) {
    return {
      status: 500,
      error: `Verifica MeshID fallita: ${(err as Error)?.message ?? err}`,
    };
  }
  if (!meshes.some((m) => m.meshId === creds.meshId)) {
    return {
      status: 500,
      error:
        "Device group (MeshID) non presente sul server MeshCentral: completa il provisioning prima di generare lo script.",
    };
  }
  return {
    status: 200,
    script: buildMeshInstallScript(platform, {
      serverUrl: creds.serverUrl,
      meshId: creds.meshId,
    }),
    filename: meshInstallScriptFilename(platform),
    contentType: meshInstallScriptContentType(platform),
  };
}

const defaultDeps: ResolveInstallDeps = {
  getMeshCreds,
  listMeshes: async (creds) => {
    const client = new MeshControlClient(creds);
    try {
      return await client.listMeshes();
    } finally {
      client.close();
    }
  },
};

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const result = await resolveInstallScript(parsed.data.platform, defaultDeps);
    if (result.status !== 200 || !result.script) {
      return NextResponse.json(
        { error: result.error ?? "Errore generazione script" },
        { status: result.status },
      );
    }
    return new NextResponse(result.script, {
      status: 200,
      headers: {
        "Content-Type": result.contentType!,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
