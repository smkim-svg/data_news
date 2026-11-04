// 제품·페이지·배포일 설정 (저장소의 "config" 한 개 문서)
import crypto from "node:crypto";
import { getJSON, setJSON } from "./store.js";
import { SEED } from "./seed.js";
import { normalizePath } from "./ga4.js";
import { isIsoDate } from "./metrics.js";

const KEY = "config:v1";

export function withPaths(page) {
  const paths = [...new Set((page.urls || []).map(normalizePath).filter(Boolean))];
  return { ...page, paths };
}

export async function loadConfig() {
  let cfg = await getJSON(KEY);
  if (!cfg) {
    cfg = { products: SEED.products, pages: SEED.pages, updatedAt: new Date().toISOString(), updatedBy: "초기 설정" };
    await setJSON(KEY, cfg);
  }
  // 나중에 기본 제품 목록에 추가된 제품은 자동으로 합침
  for (const p of SEED.products) {
    const cur = cfg.products.find((x) => x.id === p.id);
    if (!cur) cfg.products.push(p);
    else for (const [k, v] of Object.entries(p)) if (cur[k] === undefined) cur[k] = v;   // 나중에 추가된 설정값 채우기
  }
  return cfg;
}

export async function saveConfig(cfg, who) {
  cfg.updatedAt = new Date().toISOString();
  cfg.updatedBy = who || "";
  await setJSON(KEY, cfg);
  return cfg;
}

const clean = (s, max) => String(s ?? "").trim().slice(0, max);

/** 화면에서 보낸 페이지 입력을 검사해서 정리. 문제가 있으면 throw */
export function validatePage(input, cfg) {
  const product = cfg.products.find((p) => p.id === input.product);
  if (!product) throw new Error("제품을 선택해 주세요.");
  const name = clean(input.name, 80);
  if (!name) throw new Error("페이지 이름을 입력해 주세요.");
  const urls = (Array.isArray(input.urls) ? input.urls : String(input.urls || "").split(/\n|,/))
    .map((u) => clean(u, 500)).filter(Boolean).slice(0, 20);
  if (!urls.length) throw new Error("페이지 주소를 하나 이상 입력해 주세요.");
  const bad = urls.filter((u) => !normalizePath(u));
  if (bad.length) throw new Error(`주소 형식을 확인해 주세요: ${bad.join(", ")}`);
  const match = input.match === "prefix" ? "prefix" : "exact";
  const seen = new Set();
  const releases = (input.releases || [])
    .map((r) => ({ date: clean(r.date, 10), note: clean(r.note, 100) }))
    .filter((r) => r.date && !seen.has(r.date) && seen.add(r.date))
    .slice(0, 50);
  if (!releases.length) throw new Error("배포일을 하나 이상 입력해 주세요.");
  const badDate = releases.find((r) => !isIsoDate(r.date));
  if (badDate) throw new Error(`배포일 형식이 올바르지 않습니다: ${badDate.date}`);
  releases.sort((a, b) => a.date.localeCompare(b.date));
  return { product: product.id, name, urls, match, releases, note: clean(input.note, 200) };
}

export const newId = () => crypto.randomBytes(6).toString("base64url");

// 제품 "사이트 전체" 가상 페이지: id = "__site:제품ID", 경로 필터 없음, 배포일 = 그 제품 모든 페이지의 배포일
export const SITE_PREFIX = "__site:";
export function sitePage(cfg, productId) {
  const dates = [...new Set(cfg.pages.filter((p) => p.product === productId).flatMap((p) => p.releases.map((r) => r.date)))].sort();
  return { id: SITE_PREFIX + productId, product: productId, name: "사이트 전체", urls: [], paths: [], match: "exact",
    releases: dates.map((date) => ({ date })), site: true };
}
/** id 로 페이지 찾기 (사이트 전체 포함) → { page(경로 포함), product } 또는 null */
export function resolvePage(cfg, id) {
  if (String(id).startsWith(SITE_PREFIX)) {
    const product = cfg.products.find((p) => p.id === id.slice(SITE_PREFIX.length));
    return product ? { page: sitePage(cfg, product.id), product } : null;
  }
  const raw = cfg.pages.find((p) => p.id === id);
  if (!raw) return null;
  return { page: withPaths(raw), product: cfg.products.find((p) => p.id === raw.product) };
}
