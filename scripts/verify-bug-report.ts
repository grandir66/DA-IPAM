/**
 * Verifica runtime bug segnalati nell'audit DA-IPAM (read-only).
 * Uso: npx tsx scripts/verify-bug-report.ts
 */
import fs from "fs";
import path from "path";

type Verdict = "CONFIRMED" | "REJECTED" | "INCONCLUSIVE";

interface Finding {
  id: string;
  bug: string;
  verdict: Verdict;
  evidence: Record<string, unknown>;
}

const results: Finding[] = [];
const ROOT = process.cwd();

function record(id: string, bug: string, verdict: Verdict, evidence: Record<string, unknown>) {
  results.push({ id, bug, verdict, evidence });
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// H1: getDb() silent DEFAULT fallback
function verifyH1() {
  const src = readSrc("src/lib/db.ts");
  const hasSilentFallback =
    src.includes('return getTenantDb("DEFAULT")') &&
    src.includes("nessun contesto");
  record("H1", "getDb() silent DEFAULT fallback without tenant context", hasSilentFallback ? "CONFIRMED" : "REJECTED", {
    hubExists: fs.existsSync("data/hub.db"),
    defaultTenantExists: fs.existsSync("data/tenants/DEFAULT.db"),
    silentFallbackCode: hasSilentFallback,
  });
}

// H2: __ALL__ remapped to DEFAULT in withTenantFromSession
function verifyH2() {
  const src = readSrc("src/lib/api-tenant.ts");
  const remapsAll =
    /tenantCode === "__ALL__"/.test(src) && /tenantCode = "DEFAULT"/.test(src);
  record("H2", "__ALL__ superadmin mutations hit DEFAULT tenant DB", remapsAll ? "CONFIRMED" : "REJECTED", {
    withTenantFromSessionRemapsAll: remapsAll,
    getServerTenantCodeSamePattern: src.includes("getServerTenantCode"),
  });
}

// H3: requireSuperAdmin never used in routes
function verifyH3() {
  const apiAuth = readSrc("src/lib/api-auth.ts");
  const hasHelper = apiAuth.includes("requireSuperAdmin");
  let routeUsage = 0;
  const apiDir = path.join(ROOT, "src/app/api");
  function walk(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === "route.ts") {
        const c = fs.readFileSync(p, "utf8");
        if (c.includes("requireSuperAdmin")) routeUsage++;
      }
    }
  }
  walk(apiDir);
  record("H3", "requireSuperAdmin defined but unused in API routes", hasHelper && routeUsage === 0 ? "CONFIRMED" : "REJECTED", {
    helperExists: hasHelper,
    routeFilesUsingIt: routeUsage,
  });
}

// H4: admin can select any tenant without access check
function verifyH4() {
  const src = readSrc("src/app/api/auth/select-tenant/route.ts");
  const adminBypass =
    /role === "superadmin" \|\| role === "admin"/.test(src) &&
    !src.includes("getUserTenantAccess") ||
    (src.includes('role === "superadmin" || role === "admin"') && !/getUserTenantAccess[\s\S]{0,200}role === "admin"/.test(src));
  const adminNoAccessCheck =
    src.includes('if (role === "superadmin" || role === "admin")') &&
    !src.slice(src.indexOf('if (role === "superadmin" || role === "admin")')).includes("getUserTenantAccess");
  record("H4", "Tenant admin can switch to any tenant without access check", adminNoAccessCheck ? "CONFIRMED" : "REJECTED", {
    adminBypassesTenantAccessCheck: adminNoAccessCheck,
  });
}

// H5: scans/trigger no requireAdmin
function verifyH5() {
  const src = readSrc("src/app/api/scans/trigger/route.ts");
  const viewerCanTrigger =
    src.includes("withTenantFromSession") && !src.includes("requireAdmin");
  record("H5", "Viewer can trigger scans (no requireAdmin)", viewerCanTrigger ? "CONFIRMED" : "REJECTED", {
    usesWithTenantOnly: viewerCanTrigger,
  });
}

// H6: networks refresh without withTenantFromSession
function verifyH6() {
  const src = readSrc("src/app/api/networks/[id]/refresh/route.ts");
  const noTenant =
    src.includes("requireAdmin") &&
    src.includes('from "@/lib/db"') &&
    !src.includes("withTenantFromSession");
  record("H6", "Network refresh uses getDb() without tenant context", noTenant ? "CONFIRMED" : "REJECTED", {
    requireAdminOnlyNoWithTenant: noTenant,
  });
}

// H7: Integration secrets plaintext to any auth user
function verifyH7() {
  const route = readSrc("src/app/api/integrations/[component]/route.ts");
  const config = readSrc("src/lib/integrations/config.ts");
  const getAuthOnly =
    route.includes("requireAuth()") &&
    route.includes("getIntegrationConfig") &&
    !route.includes("requireAdmin");
  const plaintextToken = config.includes("apiToken") && config.includes("getSetting");
  record("H7", "Integration API tokens/passwords exposed via GET (requireAuth only)", getAuthOnly && plaintextToken ? "CONFIRMED" : "REJECTED", {
    getUsesRequireAuthOnly: getAuthOnly,
    tokensStoredPlaintextInHubSettings: plaintextToken,
  });
}

// H8: client-config no tenant scoping
function verifyH8() {
  const src = readSrc("src/app/api/client-config/route.ts");
  const noTenant = src.includes("requireAuth") && !src.includes("withTenantFromSession") && !src.includes("requireAdmin");
  record("H8", "Client config (VPN/credentials docs) readable without tenant scope", noTenant ? "CONFIRMED" : "INCONCLUSIVE", {
    requireAuthOnly: noTenant,
  });
}

// H9: No rate limiting in API
function verifyH9() {
  let rateLimitHits = 0;
  const apiDir = path.join(ROOT, "src/app/api");
  function walk(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === "route.ts") {
        const c = fs.readFileSync(p, "utf8");
        if (/rateLimit|checkRateLimit|rate.limit/i.test(c)) rateLimitHits++;
      }
    }
  }
  walk(apiDir);
  record("H9", "No rate limiting on API routes", rateLimitHits === 0 ? "CONFIRMED" : "REJECTED", {
    routeFilesWithRateLimit: rateLimitHits,
  });
}

// H10: db-legacy unused
function verifyH10() {
  let imports = 0;
  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name !== "node_modules" && ent.name !== ".next") walkDir(p);
      else if (/\.(ts|tsx)$/.test(ent.name)) {
        const c = fs.readFileSync(p, "utf8");
        if (c.includes("db-legacy")) imports++;
      }
    }
  }
  walkDir(path.join(ROOT, "src"));
  record("H10", "db-legacy.ts dead code (zero imports)", imports === 0 ? "CONFIRMED" : "REJECTED", {
    filesImportingDbLegacy: imports,
    dbLegacyExists: fs.existsSync("src/lib/db-legacy.ts"),
  });
}

// H11: nmap target injection in agent
function verifyH11() {
  const p = "agent/da_invent_agent/exec/nmap.py";
  if (!fs.existsSync(p)) {
    record("H11", "Nmap flag injection via target arg", "INCONCLUSIVE", { reason: "nmap.py not found" });
    return;
  }
  const src = readSrc(p);
  const appendsTargetWithoutSeparator =
    src.includes('cmd.append(target)') || src.includes("cmd.extend") && src.includes("target");
  const usesDoubleDash = src.includes('"--"') || src.includes("'--'");
  record("H11", "Nmap flag injection via target (no -- separator)", appendsTargetWithoutSeparator && !usesDoubleDash ? "CONFIRMED" : "REJECTED", {
    appendsTargetDirectly: appendsTargetWithoutSeparator,
    usesDoubleDashSeparator: usesDoubleDash,
  });
}

// H12: Production service runs as root
function verifyH12() {
  const p = "deploy/da-invent.service";
  if (!fs.existsSync(p)) {
    record("H12", "Production systemd service runs as root", "INCONCLUSIVE", {});
    return;
  }
  const src = readSrc(p);
  record("H12", "Production systemd service runs as root", /User=root/.test(src) ? "CONFIRMED" : "REJECTED", {
    userRoot: /User=root/.test(src),
  });
}

verifyH1();
verifyH2();
verifyH3();
verifyH4();
verifyH5();
verifyH6();
verifyH7();
verifyH8();
verifyH9();
verifyH10();
verifyH11();
verifyH12();

const confirmed = results.filter((r) => r.verdict === "CONFIRMED").length;
console.log("\n=== DA-IPAM VERIFICA RUNTIME BUG REPORT ===\n");
for (const r of results) {
  const icon = r.verdict === "CONFIRMED" ? "🔴" : r.verdict === "REJECTED" ? "🟢" : "🟡";
  console.log(`${icon} [${r.id}] ${r.bug}: ${r.verdict}`);
  console.log(`   ${JSON.stringify(r.evidence)}\n`);
}
console.log(`Totale: ${confirmed} CONFIRMED, ${results.filter((r) => r.verdict === "REJECTED").length} REJECTED, ${results.filter((r) => r.verdict === "INCONCLUSIVE").length} INCONCLUSIVE`);
process.exit(0);
