const { createHmac } = require("node:crypto");
const { isIP } = require("node:net");

const SYNC_CODE = /^[A-Za-z0-9_-]{8,64}$/;
const DEVICE_ID = /^[a-f0-9]{64}$/;
const grantTtl = 400 * 24 * 3600;

function grantKey(scope, secret) {
  if (typeof scope?.id !== "string") return null;
  const pattern = scope.type === "sync" ? SYNC_CODE : scope.type === "device" ? DEVICE_ID : null;
  if (!pattern?.test(scope.id)) return null;
  const digest = createHmac("sha256", secret).update(scope.type + "|" + scope.id).digest("hex");
  return "tiku:tutor:grant:" + digest;
}

async function redis(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw Error("Missing grant store");
  const response = await fetch(url.replace(/\/+$/, ""), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw Error("Grant store unavailable");
  const data = await response.json();
  if (data.error) throw Error("Grant store command failed");
  return data.result;
}

async function grantAllowed(req, key, secret) {
  const ip = req.headers["x-vercel-forwarded-for"] || req.socket?.remoteAddress;
  if (typeof ip === "string" && isIP(ip)) {
    // Count lookups across sessions and instances before checking a guessable group code.
    const id = createHmac("sha256", secret).update(ip).digest("hex");
    const counter = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n";
    const attempts = await redis(["EVAL", counter, "1", "tiku:tutor:limit:" + id]);
    if (Number(attempts) > 40) return 429;
  }
  return await redis(["GETEX", key, "EX", grantTtl]) === "1" ? 200 : 401;
}

async function saveGrant(key) {
  if (await redis(["SET", key, "1", "EX", grantTtl]) !== "OK") throw Error("Grant not saved");
}

module.exports = { grantKey, grantAllowed, saveGrant };
