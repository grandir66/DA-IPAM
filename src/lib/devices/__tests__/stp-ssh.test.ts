import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getMikrotikStpInfo } from "@/lib/devices/stp-ssh";

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const exec = (m: Record<string, string>) => async (cmd: string): Promise<string> => {
  if (!(cmd in m)) throw new Error(`comando inatteso: ${cmd}`);
  return m[cmd];
};
const MK3 = "/interface bridge print terse without-paging", MK5 = "/interface bridge monitor [find] once";

test("router di testa: radice, priorità 0 dalla forma «0.MAC»", async () => {
  const s = await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-mk3-testa.txt"), [MK5]: F("mikrotik-mk5-testa.txt") }));
  assert.deepEqual([s?.bridge_id, s?.priority, s?.is_root_bridge, s?.root_port, s?.protocol, s?.max_age_s, s?.forward_delay_s],
    ["0.02:00:a0:10:0e:02", 0, true, "none", "rstp", 20, 15]);
});

test("router di frontiera: il primo bridge, con la sua porta radice e la radice nell'altra forma", async () => {
  const s = await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-mk3-frontiera.txt"), [MK5]: F("mikrotik-mk5-frontiera.txt") }));
  assert.deepEqual([s?.bridge_id, s?.root_bridge_id, s?.root_port, s?.root_cost, s?.priority], ["32768.02:00:a0:10:93:15", "0.02:00:a0:10:0e:02", "sfp-sfpplus12", 2400, 32768]);
});

test("senza bridge o con un errore: null", async () => {
  assert.equal(await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-vuoto.txt") })), null);
  assert.equal(await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-mk3-testa.txt"), [MK5]: F("mikrotik-errore.txt") })), null);
});
