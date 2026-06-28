/**
 * Smoke E2E del connettore Headwind contro un'istanza hmdm reale.
 *
 * Uso:
 *   HMDM_URL=http://localhost:18088 HMDM_USER=admin HMDM_PASS=... \
 *     node --import tsx scripts/test-mdm-connector.ts
 *
 * Verifica login JWT (MD5 uppercase + id_token), device search (pageNum 1-based) e
 * deviceinfo plugin. Se la shape della risposta differisce, allineare hmdm-client.ts.
 */
import { loginJwt, searchDevices, getDeviceInfo } from "../src/lib/integrations/hmdm-client";

async function main() {
  const baseUrl = process.env.HMDM_URL;
  const username = process.env.HMDM_USER;
  const password = process.env.HMDM_PASS;
  if (!baseUrl || !username || !password) {
    console.error("Set HMDM_URL, HMDM_USER, HMDM_PASS");
    process.exit(2);
  }

  const jwt = await loginJwt({ baseUrl, username, password });
  console.log("login OK, jwt len:", jwt.length);

  const devices = await searchDevices(baseUrl, jwt, 1, 50);
  console.log("devices:", devices.length, devices.map((d) => d.number));

  if (devices[0]) {
    const d0 = devices[0];
    console.log("device[0]:", JSON.stringify({ number: d0.number, serial: d0.serial, imei: d0.imei, os: d0.androidVersion }));
    const di = await getDeviceInfo(baseUrl, jwt, d0.number);
    console.log("deviceinfo[0]:", JSON.stringify({ model: di?.model, apps: di?.applications.length ?? 0 }));
  }
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
