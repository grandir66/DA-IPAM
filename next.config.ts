import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "ssh2", "net-snmp", "bcrypt", "oui", "oui-data", "ldapts"],
};

export default nextConfig;
