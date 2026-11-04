// GET /api/data?id=페이지ID[&refresh=1]
//   GA4 에서 그 페이지의 일별 지표(전체 + 채널별)를 가져옴.
//   같은 날 같은 설정이면 저장해 둔 결과를 바로 돌려줌 (refresh=1 이면 다시 조회)
import crypto from "node:crypto";
import { loadConfig, resolvePage } from "./_lib/config.js";
import { fetchPageData } from "./_lib/ga4.js";
import { getJSON, setJSON } from "./_lib/store.js";
import { dataThrough, RAW } from "./_lib/metrics.js";
import { send } from "./_lib/http.js";

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");
  try {
    const cfg = await loadConfig();
    const found = resolvePage(cfg, id);
    if (!found) return send(res, 404, { error: "페이지를 찾을 수 없어요." });
    const { page, product } = found;
    // 설정(경로·배포일)이나 기준일이 바뀌면 캐시 키가 달라져서 자동으로 다시 조회
    const sig = crypto.createHash("sha1").update(JSON.stringify([RAW, product.propertyId, page.paths, page.match, page.releases.map((r) => r.date).sort()[0]])).digest("hex").slice(0, 10);
    const key = `data:${id}`;
    const cached = await getJSON(key);
    if (cached && cached.sig === sig && cached.dataThrough === dataThrough() && url.searchParams.get("refresh") !== "1") {
      return send(res, 200, { ...cached.data, cached: true });
    }
    const data = await fetchPageData(product, page);
    try { await setJSON(key, { sig, dataThrough: data.dataThrough, data }, 36 * 3600); } catch { /* 너무 크면 캐시 생략 */ }
    return send(res, 200, { ...data, cached: false });
  } catch (e) {
    return send(res, 200, { id, error: e.message || String(e) });
  }
}
