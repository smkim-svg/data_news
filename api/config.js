// GET  /api/config            → 제품·페이지·지표 정의
// POST /api/config {action}   → 페이지 추가 / 수정 / 삭제
//   action: "addPage"    page: {product, name, urls[], match, releases[{date, note}], note}
//   action: "updatePage" id, page: {...}
//   action: "deletePage" id
import { loadConfig, saveConfig, validatePage, withPaths, newId, metricSet, mainCtasFor } from "./_lib/config.js";
import { dataThrough, LOOKBACK_DAYS, addDays, DEFAULT_LOGIN_LABEL } from "./_lib/metrics.js";
import { storeKind, del } from "./_lib/store.js";
import { hasGA4 } from "./_lib/ga4.js";
import { userEmail, readBody, send } from "./_lib/http.js";

function view(cfg) {
  const end = dataThrough(), { metrics, raw } = metricSet(cfg);
  return {
    version: 7, metrics, raw, dataThrough: end, dataFrom: addDays(end, -LOOKBACK_DAYS),
    products: cfg.products.map(({ id, name, loginLabel }) => ({ id, name, loginLabel: loginLabel || DEFAULT_LOGIN_LABEL })),
    pages: cfg.pages.map(withPaths),
    updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy,
    storage: storeKind(), demo: !hasGA4(),
  };
}

export default async function handler(req, res) {
  try {
    const cfg = await loadConfig();
    if (req.method === "GET") return send(res, 200, view(cfg));
    if (req.method !== "POST") return send(res, 405, { error: "허용되지 않는 요청" });

    const who = userEmail(req);
    const body = await readBody(req);
    if (body.action === "addPage") {
      if (cfg.pages.length >= 300) throw new Error("페이지는 300개까지 등록할 수 있어요.");
      const page = { id: newId(), ...validatePage(body.page || {}, cfg), createdBy: who, createdAt: new Date().toISOString() };
      if (!page.ctas.length) page.ctas = mainCtasFor(cfg, page) || [];   // 새 메인 페이지엔 제품 메인 버튼 자동 추가
      cfg.pages.push(page);
      await saveConfig(cfg, who);
      return send(res, 200, { ...view(cfg), savedId: page.id });
    }
    const idx = cfg.pages.findIndex((p) => p.id === body.id);
    if (idx < 0) throw new Error("페이지를 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.");
    if (body.action === "updatePage") {
      cfg.pages[idx] = { ...cfg.pages[idx], ...validatePage(body.page || {}, cfg), updatedBy: who, updatedAt: new Date().toISOString() };
      await saveConfig(cfg, who);
      await del(`data:${body.id}`);
      return send(res, 200, { ...view(cfg), savedId: body.id });
    }
    if (body.action === "deletePage") {
      cfg.pages.splice(idx, 1);
      await saveConfig(cfg, who);
      await del(`data:${body.id}`);
      return send(res, 200, view(cfg));
    }
    throw new Error("알 수 없는 요청");
  } catch (e) {
    return send(res, 400, { error: e.message || String(e) });
  }
}
