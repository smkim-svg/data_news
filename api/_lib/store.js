// 저장소: Upstash Redis (Vercel Marketplace 로 연결하면 환경 변수가 자동으로 들어옴)
//   KV_REST_API_URL / KV_REST_API_TOKEN  또는  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// 둘 다 없으면 메모리에 저장 (로컬 테스트용 — 서버가 재시작되면 사라짐)

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const mem = globalThis.__dashMem || (globalThis.__dashMem = new Map());

export const storeKind = () => (URL_ && TOKEN ? "redis" : "memory");

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`저장소 오류: ${j.error || r.status}`);
  return j.result;
}

export async function getJSON(key) {
  if (storeKind() === "memory") {
    const v = mem.get(key);
    if (!v || (v.exp && v.exp < Date.now())) return null;
    return JSON.parse(v.s);
  }
  const s = await redis(["GET", key]);
  return s ? JSON.parse(s) : null;
}

export async function setJSON(key, value, ttlSec) {
  const s = JSON.stringify(value);
  if (storeKind() === "memory") {
    mem.set(key, { s, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
    return;
  }
  await redis(ttlSec ? ["SET", key, s, "EX", String(ttlSec)] : ["SET", key, s]);
}

export async function del(key) {
  if (storeKind() === "memory") { mem.delete(key); return; }
  await redis(["DEL", key]);
}
