import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMdmConfig, type MdmConfig } from "@/lib/integrations/mdm-config";
import { MdmSettingsClient } from "./MdmSettingsClient";

export const metadata = {
  title: "MDM (Headwind) — DA-IPAM",
};

export default async function MdmSettingsPage() {
  const result = await withTenantFromSession(() => getMdmConfig());
  if (result instanceof NextResponse) {
    redirect("/login");
  }
  const config = result as MdmConfig;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">MDM (Headwind)</h1>
        <p className="text-muted-foreground mt-1">
          Configura la connessione al server Headwind MDM per importare i
          dispositivi mobili (Android/iOS) come host e arricchirne l&apos;inventario.
        </p>
      </div>
      <MdmSettingsClient config={config} />
    </div>
  );
}
