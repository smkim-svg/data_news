// /api/analyze — Claude 에서 받은 AI 분석 결과를 페이지별로 저장 (팀원이 함께 봄)
//   GET  ?page=페이지ID                         → { items: [...] } (최신순)
//   POST { action: "add", page, period, question, text }
//   POST { action: "delete", page, id }
//   (분석 자체는 화면의 "Claude용 복사" → Claude 대화창에서 돌리고, 결과만 붙여넣어 저장 — API 비용 없음)
import crypto from "node:crypto";
import { loadConfig, resolvePage } from "./_lib/config.js";
import { getJSON, setJSON } from "./_lib/store.js";
import { readBody, send, userEmail } from "./_lib/http.js";
import { isIsoDate } from "./_lib/metrics.js";

const MAX_ITEMS = 60;        // 페이지당 보관 개수 (넘으면 오래된 것부터 지움)
const MAX_TEXT = 20_000;     // 결과 한 건 글자 수
const key = (page) => `analysis:${page}`;
const str = (v, n) => String(v ?? "").trim().slice(0, n);

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const page = new URL(req.url, "http://x").searchParams.get("page") || "";
      return send(res, 200, { items: (await getJSON(key(page))) || [] });
    }
    if (req.method !== "POST") return send(res, 405, { error: "지원하지 않는 요청이에요." });

    const body = await readBody(req);
    const page = str(body.page, 120);
    const cfg = await loadConfig();
    if (!resolvePage(cfg, page)) return send(res, 404, { error: "페이지를 찾을 수 없어요." });
    const items = (await getJSON(key(page))) || [];
    const me = userEmail(req) || "";

    if (body.action === "add") {
      const text = str(body.text, MAX_TEXT + 1);
      if (!text) return send(res, 400, { error: "붙여넣은 분석 결과가 비어 있어요." });
      if (text.length > MAX_TEXT) return send(res, 400, { error: `결과가 너무 길어요 (최대 ${MAX_TEXT.toLocaleString()}자).` });
      const p = body.period || {};
      const dates = ["from", "to", "pFrom", "pTo"].map((k) => p[k]);
      if (!dates.every(isIsoDate)) return send(res, 400, { error: "기간 정보가 올바르지 않아요." });
      const item = {
        id: crypto.randomBytes(6).toString("hex"),
        at: new Date().toISOString(),
        by: me,
        period: { label: str(p.label, 80), from: p.from, to: p.to, pFrom: p.pFrom, pTo: p.pTo,
          cmpName: str(p.cmpName, 40), mode: p.mode === "yoy" ? "yoy" : "prev", agg: p.agg === "sum" ? "sum" : "avg",
          unit: /^(w[123]|m[1236]|since)$/.test(p.unit || "") ? p.unit : null, start: isIsoDate(p.start) ? p.start : null },
        question: str(body.question, 500),
        text,
      };
      const next = [item, ...items].slice(0, MAX_ITEMS);
      await setJSON(key(page), next);
      return send(res, 200, { items: next, savedId: item.id });
    }

    if (body.action === "delete") {
      const target = items.find((x) => x.id === body.id);
      if (!target) return send(res, 404, { error: "이미 지워졌어요." });
      if (target.by && me && target.by !== me) return send(res, 403, { error: "직접 저장한 분석만 지울 수 있어요." });
      const next = items.filter((x) => x.id !== body.id);
      await setJSON(key(page), next);
      return send(res, 200, { items: next });
    }
    return send(res, 400, { error: "알 수 없는 요청이에요." });
  } catch (e) {
    return send(res, 200, { error: e.message || String(e) });
  }
}
