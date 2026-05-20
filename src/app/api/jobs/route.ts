import { NextResponse } from "next/server";
import { getScheduledJobs, createScheduledJob, toggleJob, deleteScheduledJob, updateScheduledJobInterval } from "@/lib/db";
import { ScheduledJobSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";

export async function GET() {
  return withTenantFromSession(async () => {
    try {
      const authCheck = await requireAdmin();
      if (isAuthError(authCheck)) return authCheck;
      return NextResponse.json(getScheduledJobs());
    } catch (error) {
      console.error("Error fetching jobs:", error);
      return NextResponse.json({ error: "Errore" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const body = await request.json();
      const parsed = ScheduledJobSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      const job = createScheduledJob(parsed.data);
      try { reloadTenantScheduler(await getServerTenantCode()); } catch (e) { console.error("[jobs] scheduler reload failed:", e); }
      return NextResponse.json(job, { status: 201 });
    } catch (error) {
      console.error("Error creating job:", error);
      return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
    }
  });
}

export async function PUT(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const body = await request.json();
      const { id, enabled, interval_minutes } = body;
      if (typeof id !== "number") {
        return NextResponse.json({ error: "ID job mancante o non valido" }, { status: 400 });
      }
      if (typeof enabled === "boolean") toggleJob(id, enabled);
      if (typeof interval_minutes === "number" && interval_minutes >= 1) updateScheduledJobInterval(id, interval_minutes);
      try { reloadTenantScheduler(await getServerTenantCode()); } catch (e) { console.error("[jobs] scheduler reload failed:", e); }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error updating job:", error);
      return NextResponse.json({ error: "Errore" }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");
      if (!id) return NextResponse.json({ error: "ID richiesto" }, { status: 400 });
      deleteScheduledJob(Number(id));
      try { reloadTenantScheduler(await getServerTenantCode()); } catch (e) { console.error("[jobs] scheduler reload failed:", e); }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting job:", error);
      return NextResponse.json({ error: "Errore" }, { status: 500 });
    }
  });
}
