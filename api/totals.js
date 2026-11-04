// GET /api/totals?id=페이지ID&from=&to=&pFrom=&pTo=
//   선택 기간·비교 기간의 "순 사용자 수"(중복 제거)를 GA4 에서 바로 조회 — 전체 + 채널별
//   (조회수·세션 같은 합계 지표는 일별 값을 더하면 정확해서 화면에서 계산)
import crypto from "node:crypto";
import { loadConfig, withPaths } from "./_lib/config.js";
import { fetchRangeUsers } from "./_lib/ga4.js";
import { getJSON, setJSON } from "./_lib/store.js";
import { isIsoDate, dataThrough } from "./_lib/metrics.js";
import { send } from "./_lib/http.js";

export default async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const id = q.get("id"), ranges = { cur: [q.get("from"), q.get("to")], cmp: [q.get("pFrom"), q.get("pTo")] };
  try {
    if (![...ranges.cur, ...ranges.cmp].every(isIsoDate)) return send(res, 400, { error: "날짜 형식 오류" });
    const cfg = await loadConfig();
    const raw = cfg.pages.find((p) => p.id === id);
    if (!raw) return send(res, 404, { error: "페이지를 찾을 수 없어요." });
    const page = withPaths(raw), product = cfg.products.find((p) => p.id === page.product);
    const sig = crypto.createHash("sha1").update(JSON.stringify([product.propertyId, page.paths, page.match, ranges, dataThrough()])).digest("hex").slice(0, 12);
    const key = `tot:${id}:${sig}`;
    const hit = await getJSON(key);
    if (hit) return send(res, 200, { ...hit, cached: true });
    const data = await fetchRangeUsers(product, page, ranges);
    await setJSON(key, data, 36 * 3600);
    return send(res, 200, data);
  } catch (e) {
    return send(res, 200, { error: e.message || String(e) });
  }
}
