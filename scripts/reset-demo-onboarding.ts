#!/usr/bin/env npx tsx
/**
 * CLI wrapper — stessa logica di POST /api/lab-config/reset
 *
 *   npx tsx scripts/reset-demo-onboarding.ts
 *   DA_IPAM_DATA=/opt/da-ipam/data TENANT_CODE=DEFAULT npx tsx scripts/reset-demo-onboarding.ts
 */
import { resetLabNetworkConfig } from "../src/lib/lab-config-reset";

const tenantCode = process.env.TENANT_CODE?.trim() || "DEFAULT";

const result = resetLabNetworkConfig(tenantCode);
console.log("[reset-demo-onboarding] OK", JSON.stringify(result, null, 2));
