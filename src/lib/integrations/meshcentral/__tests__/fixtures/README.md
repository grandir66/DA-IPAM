# Login-token golden vector (interop with real MeshCentral)

The login-token codec is internal MeshCentral source (`obj.encodeCookie`), not a
stable API. This fixture pins interop against a token emitted by the REAL server,
so a MeshCentral version bump that changes the codec fails this test loudly
(spec §9, rischio #1, D8).

## ⚠️ Current state — NOT YET a real interop guarantee (Phase 0)

At plan-execution time there is **no live MeshCentral server** (it is provisioned
by Deploy-Appliance in Phase 0). The committed `login-token.golden.json` therefore
ships with:

```json
"token": "__REGENERATE_AGAINST_LIVE_SERVER_PHASE0__"
```

While this placeholder is present the golden test **self-seeds** a token with our
own `encodeCookie` and only exercises the decrypt *mechanism* (iv/tag/ct split,
key.slice(0,32), `@/$` reversal). The test prints a `// TODO Phase0` console note
and does **not** present this as a server-interop guarantee — it would be a
tautology (we both encode and decode). The real interop assertion runs only once a
server-emitted token has been committed (placeholder replaced).

## How to (re)generate `login-token.golden.json`

On the appliance MeshCentral host, with the pinned `LoginCookieEncryptionKey`:

```bash
# 1. Read the pinned key (160 hex chars) from the deterministic config.json:
#    settings.LoginCookieEncryptionKey
#    -> this is the "key" field of the fixture (hex, 80 bytes).

# 2. Ask the server to mint a real login token for the service user:
cd /opt/meshcentral
node meshcentral.js --logintoken "user//svc-daipam" --loginkey <pinned-160-hex>
#    Older builds: node meshcentral.js --logintoken "user//svc-daipam"
#    (reads the key from config.json). Copy the printed token verbatim
#    (it already uses the @/$ url-safe alphabet) into "token", REPLACING the
#    __REGENERATE_AGAINST_LIVE_SERVER_PHASE0__ placeholder.

# 3. Record the payload fields you requested so the test can assert them.
```

Fixture shape:
```json
{
  "key": "<160-hex pinned LoginCookieEncryptionKey>",
  "token": "<url-safe token printed by node meshcentral.js --logintoken>",
  "expectedPayload": { "u": "user//svc-daipam", "a": 3 }
}
```

Notes:
- Do NOT byte-compare against a re-encoded token: the IV is random, so two
  encodings of the same payload differ. The invariant we pin is: OUR codec
  DECRYPTS the SERVER's token to the exact payload, using key.slice(0,32) on the
  hex-loaded key (bug #2932). That is the real interop guarantee.
- `time` is server-clock dependent; the test asserts only the stable fields
  present in `expectedPayload` (u, a) and that `time`/`expire` decode to numbers.
- This fixture contains NO production secret: the key here is a throwaway test
  key, NOT the real appliance LoginCookieEncryptionKey. Never commit a real key.
