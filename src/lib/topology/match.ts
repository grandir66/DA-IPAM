export function normalizeName(s: string): string {
  return s.trim().toLowerCase().split(".")[0];
}

export function resolveRemote(
  remote: { name: string; ip: string | null },
  index: { byName: Map<string, string>; byIp: Map<string, string> },
): string | null {
  if (remote.ip) {
    const byIp = index.byIp.get(remote.ip);
    if (byIp) return byIp;
  }
  if (remote.name) {
    const byName = index.byName.get(normalizeName(remote.name));
    if (byName) return byName;
  }
  return null;
}
