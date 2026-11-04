// GA4 Data API 를 서비스 계정으로 직접 호출 (외부 라이브러리 없이 Node 기본 기능만 사용)
//   필요한 Vercel 환경 변수: GA4_SA_KEY = 서비스 계정 JSON 전체 내용
import crypto from "node:crypto";
import { RAW, RATES, LOOKBACK_DAYS, addDays, dataThrough } from "./metrics.js";
import { getJSON, setJSON } from "./store.js";

const API = "https://analyticsdata.googleapis.com/v1beta";
const DEFAULT_CHANNEL_DIM = "sessionDefaultChannelGroup";

export const hasGA4 = () => !!process.env.GA4_SA_KEY;

// ---------- 인증 (서비스 계정 JWT → 액세스 토큰, 50분 재사용)
let tokenCache = { token: "", exp: 0 };
async function accessToken() {
  if (tokenCache.token && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  let sa;
  try { sa = JSON.parse(process.env.GA4_SA_KEY); } catch { throw new Error("GA4_SA_KEY 형식이 올바르지 않습니다 (서비스 계정 JSON 전체를 넣어야 해요)."); }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google 인증 실패: ${j.error_description || j.error || r.status}`);
  tokenCache = { token: j.access_token, exp: Date.now() + 50 * 60_000 };
  return j.access_token;
}

async function ga(path, body) {
  const r = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || r.status;
    if (r.status === 403) throw new Error(`권한 없음 — 서비스 계정을 이 GA4 속성에 뷰어로 추가해 주세요. (${msg})`);
    throw new Error(`GA4 오류: ${msg}`);
  }
  return j;
}

// ---------- 페이지 경로 필터
export function normalizePath(p) {
  p = String(p || "").trim();
  if (!p) return "";
  if (p.includes("://")) { try { p = new URL(p).pathname || "/"; } catch { return ""; } }
  p = p.split("?")[0].split("#")[0];
  return p.startsWith("/") ? p : "/" + p;
}
function pageFilter(paths, match) {
  if (!paths.length) return undefined;
  const exprs = paths.map((p) => match === "prefix"
    ? { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: p } } }
    : { filter: { fieldName: "pagePath", inListFilter: { values: [...new Set([p, p.replace(/\/+$/, "") || "/", p === "/" ? "/" : p.replace(/\/+$/, "") + "/"])] } } });
  return exprs.length === 1 ? exprs[0] : { orGroup: { expressions: exprs } };
}

// ---------- 맞춤 채널 그룹 찾기 (속성별 하루 캐시)
async function channelDimension(propertyId, wanted = "") {
  const key = `chdim:${propertyId}`;
  const hit = await getJSON(key);
  if (hit) return hit;
  let found = { api: DEFAULT_CHANNEL_DIM, name: "기본 채널 그룹" };
  try {
    const md = await ga(`properties/${propertyId}/metadata`);
    let groups = (md.dimensions || []).filter((d) => d.apiName.startsWith("sessionCustomChannelGroup:"));
    if (wanted) groups = groups.filter((g) => g.uiName.toLowerCase().includes(wanted.toLowerCase())).concat(groups);
    if (groups.length) found = { api: groups[0].apiName, name: groups[0].uiName };
  } catch (e) {
    if (String(e.message).startsWith("권한 없음")) throw e;
  }
  await setJSON(key, found, 86400);
  return found;
}

async function report(propertyId, start, end, paths, match, dims) {
  const out = [];
  for (let offset = 0; ; offset += 100000) {
    const j = await ga(`properties/${propertyId}:runReport`, {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: dims.map((name) => ({ name })),
      metrics: RAW.map((name) => ({ name })),
      dimensionFilter: pageFilter(paths, match),
      limit: 100000, offset,
    });
    for (const row of j.rows || []) {
      const d = row.dimensionValues[0].value;
      out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, dims: row.dimensionValues.slice(1).map((x) => x.value),
        vals: row.metricValues.map((m) => Number(m.value) || 0) });
    }
    if (!j.rowCount || offset + 100000 >= j.rowCount) break;
  }
  return out;
}

// ---------- 페이지 데이터 (전체 + 채널별 일별 원본 값)
function dateList(start, end) { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; }
const round = (v) => Math.round(v * 10000) / 10000;

export async function fetchPageData(product, page) {
  const end = dataThrough();
  const firstRelease = page.releases.map((r) => r.date).sort()[0] || end;
  const start = [addDays(firstRelease, -30), addDays(end, -LOOKBACK_DAYS)].sort()[0];
  const dates = dateList(start, end);
  const zero = RAW.map(() => 0);
  let total, byCh, groupName;
  if (hasGA4()) {
    const dim = await channelDimension(product.propertyId, product.channelGroup);
    groupName = dim.name;
    const [t, c] = await Promise.all([
      report(product.propertyId, start, end, page.paths, page.match, ["date"]),
      report(product.propertyId, start, end, page.paths, page.match, ["date", dim.api]),
    ]);
    total = Object.fromEntries(t.map((r) => [r.date, r.vals]));
    byCh = {};
    for (const r of c) (byCh[r.dims[0] || "(not set)"] ||= {})[r.date] = r.vals;
  } else {
    ({ total, byCh } = demoData(dates, page));
    groupName = "맞춤 채널 그룹 (데모)";
  }
  const daily = dates.map((d) => [d, ...(total[d] || zero).map(round)]);
  const channels = {};
  for (const [ch, days] of Object.entries(byCh)) {
    const rows = dates.map((d) => (days[d] ? days[d].map(round) : 0));
    if (rows.some(Boolean)) channels[ch] = rows;
  }
  return { id: page.id, dataThrough: end, dataFrom: start, daily, channels, channelGroup: groupName,
    demo: !hasGA4(), fetchedAt: new Date().toISOString() };
}

// ---------- GA4 키가 없을 때(로컬 확인용) 가짜 데이터
function demoData(dates, page) {
  let seed = [...page.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const CH = { "검색(SEO)": 0.38, "직접 유입": 0.22, "검색광고": 0.14, "디스플레이 광고": 0.08, "파트너 사이트": 0.07, "블로그·커뮤니티": 0.05, "뉴스레터": 0.04, "기타": 0.02 };
  const base = 150 + rnd() * 700, launch = page.releases.map((r) => r.date).sort().at(-1) || dates.at(-1);
  const total = {}, byCh = Object.fromEntries(Object.keys(CH).map((c) => [c, {}]));
  for (const d of dates) {
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    const k = (d >= launch ? 1.1 : 1) * (dow === 0 || dow === 6 ? 0.75 : 1) * (0.9 + rnd() * 0.2);
    const day = RAW.map(() => 0);
    for (const [ch, share] of Object.entries(CH)) {
      const q = k * (0.8 + rnd() * 0.4), users = base * share * q, sessions = users * 1.2;
      const er = Math.min(0.95, (ch === "직접 유입" ? 0.65 : 0.5) * q ** 0.2);
      const v = [Math.round(users * 1.6), Math.round(users), Math.round(sessions), er, 1 - er, users * 70 * q ** 0.5,
        Math.round(sessions * 0.03 * q), Math.min(1, 0.025 * q)];
      byCh[ch][d] = v;
      RAW.forEach((n, i) => { day[i] += RATES.includes(n) ? v[i] * v[2] : v[i]; });
    }
    RAW.forEach((n, i) => { if (RATES.includes(n)) day[i] = day[2] ? day[i] / day[2] : 0; });
    total[d] = day;
  }
  return { total, byCh };
}
