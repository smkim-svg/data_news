"""배포한 페이지별 GA4 지표를 배포일 기준 전/후로 집계해 site/data.json 을 생성한다.

설정 파일 (저장소 루트)
  products.json   제품 목록과 각 제품의 GA4 속성 ID
                  [{"id": "remotemeeting", "name": "리모트미팅", "propertyId": "543595202"}]
  releases.json   배포한 페이지 목록 (페이지 하나당 한 줄)
                  [{"date": "2026-06-30", "product": "remotemeeting", "name": "메인", "path": "/"}]
                  - path   : GA4 의 페이지 경로(pagePath). 전체 URL 을 넣어도 경로만 사용. 여러 개면 배열
                  - match  : "exact"(기본, 끝 / 유무는 같게 취급) 또는 "prefix"(하위 경로 포함)
                  - path 를 비우면 그 제품 사이트 전체 지표

환경 변수
  LOOKBACK_DAYS   받아올 기간 (기본 570일: 최근 6개월 + 전년 같은 6개월까지)
  TIMEZONE        기본 Asia/Seoul
  GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 JSON 경로

로컬 미리보기:  python scripts/fetch_ga4.py --demo
"""
from __future__ import annotations

import datetime as dt
import json
import os
import random
import sys
import zlib
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT_PATH = os.path.join(ROOT, "site", "data.json")
PRODUCTS_FILE = os.environ.get("PRODUCTS_FILE", os.path.join(ROOT, "products.json"))
RELEASES_FILE = os.environ.get("RELEASES_FILE", os.path.join(ROOT, "releases.json"))

# 화면에 보여줄 지표 (기간별 집계는 site/index.html 에서 이 정의대로 계산)
#   avg      : 일별 값의 평균 (일평균)
#   weighted : 세션 수로 가중 평균 (비율 지표)
#   ratio    : 분자 합 / 분모 합
#   lowerIsBetter: 낮을수록 좋은 지표 (변화 색을 반대로)
METRICS = {
    "activeUsers": {"label": "활성 사용자 (일평균)", "agg": "avg", "fmt": "int"},
    "screenPageViews": {"label": "페이지 조회수 (일평균)", "agg": "avg", "fmt": "int"},
    "sessions": {"label": "세션 (일평균)", "agg": "avg", "fmt": "int"},
    "engagementRate": {"label": "참여율", "agg": "weighted", "fmt": "pct"},
    "bounceRate": {"label": "이탈률", "agg": "weighted", "fmt": "pct", "lowerIsBetter": True},
    "avgEngagementTime": {"label": "사용자당 참여 시간", "agg": "ratio", "num": "userEngagementDuration",
                          "den": "activeUsers", "fmt": "sec"},
    "keyEvents": {"label": "키 이벤트 (일평균)", "agg": "avg", "fmt": "int"},
    "sessionKeyEventRate": {"label": "세션 전환율", "agg": "weighted", "fmt": "pct"},
}
# GA4 에서 실제로 받아오는 지표 (최대 10개)
RAW = ["screenPageViews", "activeUsers", "sessions", "engagementRate", "bounceRate", "userEngagementDuration",
       "keyEvents", "sessionKeyEventRate"]
CHANNEL_DIM = "sessionDefaultChannelGroup"  # GA4 기본 채널 그룹 (Organic Search, Direct, Paid Search …)

LOOKBACK = int(os.environ.get("LOOKBACK_DAYS", "570"))  # 6개월 전년 비교까지 (약 19개월)
TZ = ZoneInfo(os.environ.get("TIMEZONE", "Asia/Seoul"))
DATA_LAG_DAYS = 2  # 2일 전까지 (GA4 데이터가 확정되는 데 24~48시간 걸림)


# ---------------------------------------------------------------- 설정 파일
def _load(path: str, name: str) -> list:
    if not os.path.exists(path):
        raise SystemExit(f"{name} 파일이 없습니다: {path}")
    with open(path, encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as e:
            raise SystemExit(f"{name} 형식 오류 ({e.lineno}번째 줄 근처): 쉼표·따옴표를 확인하세요.")


def load_products() -> list[dict]:
    out = []
    for i, it in enumerate(_load(PRODUCTS_FILE, "products.json"), 1):
        pid = str(it.get("propertyId") or "").strip()
        if not it.get("id") or not pid.isdigit():
            raise SystemExit(f"products.json {i}번째 항목에 id 또는 숫자 propertyId 가 없습니다: {it}")
        out.append({"id": str(it["id"]), "name": str(it.get("name") or it["id"]), "propertyId": pid})
    return out


def normalize_path(p: str) -> str:
    p = str(p).strip()
    if "://" in p:
        p = urlparse(p).path or "/"
    p = p.split("?")[0].split("#")[0]
    if not p.startswith("/"):
        p = "/" + p
    return p


def load_pages(products: list[dict]) -> list[dict]:
    ids = {p["id"] for p in products}
    out = []
    for i, it in enumerate(_load(RELEASES_FILE, "releases.json"), 1):
        try:
            d = dt.date.fromisoformat(str(it["date"]).strip())
        except (KeyError, ValueError, TypeError):
            raise SystemExit(f"releases.json {i}번째 항목의 date 가 YYYY-MM-DD 형식이 아닙니다: {it}")
        product = str(it.get("product") or "").strip()
        if product not in ids:
            raise SystemExit(f"releases.json {i}번째 항목의 product '{product}' 가 products.json 에 없습니다. "
                             f"사용 가능: {', '.join(sorted(ids))}")
        raw_paths = it.get("path") or []
        paths = [normalize_path(p) for p in (raw_paths if isinstance(raw_paths, list) else [raw_paths]) if str(p).strip()]
        match = str(it.get("match") or "exact").lower()
        if match not in ("exact", "prefix"):
            raise SystemExit(f"releases.json {i}번째 항목의 match 는 exact 또는 prefix 여야 합니다.")
        name = str(it.get("name") or it.get("title") or (paths[0] if paths else "사이트 전체"))
        out.append({"date": d.isoformat(), "product": product, "name": name, "paths": paths, "match": match,
                    "note": str(it.get("note") or ""), "url": str(it.get("url") or "")})
    return out


# ---------------------------------------------------------------- GA4
def page_filter(paths: list[str], match: str):
    from google.analytics.data_v1beta.types import Filter, FilterExpression, FilterExpressionList
    if not paths:
        return None
    exprs = []
    for p in paths:
        if match == "prefix":
            f = Filter(field_name="pagePath",
                       string_filter=Filter.StringFilter(match_type=Filter.StringFilter.MatchType.BEGINS_WITH, value=p))
        else:
            variants = sorted({p, p.rstrip("/") or "/", (p.rstrip("/") + "/") if p != "/" else "/"})
            f = Filter(field_name="pagePath", in_list_filter=Filter.InListFilter(values=variants))
        exprs.append(FilterExpression(filter=f))
    return exprs[0] if len(exprs) == 1 else FilterExpression(or_group=FilterExpressionList(expressions=exprs))


def _report(property_id: str, start: dt.date, end: dt.date, paths: list[str], match: str, dims: list[str]):
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
    req = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
        dimensions=[Dimension(name=d) for d in dims],
        metrics=[Metric(name=n) for n in RAW],
        limit=250000,
    )
    flt = page_filter(paths, match)
    if flt is not None:
        req.dimension_filter = flt
    for row in BetaAnalyticsDataClient().run_report(req).rows:
        d = row.dimension_values[0].value  # YYYYMMDD
        iso = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        yield iso, [x.value for x in row.dimension_values[1:]], {n: float(v.value or 0) for n, v in zip(RAW, row.metric_values)}


def fetch_daily(property_id: str, start: dt.date, end: dt.date, paths: list[str], match: str) -> tuple[dict, dict]:
    """(전체 일별, 채널별 일별) — {날짜: {지표: 값}}, {채널: {날짜: {지표: 값}}}"""
    total = {iso: vals for iso, _, vals in _report(property_id, start, end, paths, match, ["date"])}
    channels: dict[str, dict] = {}
    for iso, (ch,), vals in _report(property_id, start, end, paths, match, ["date", CHANNEL_DIM]):
        channels.setdefault(ch or "(not set)", {})[iso] = vals
    return total, channels


DEMO_CHANNELS = {"Organic Search": 0.44, "Direct": 0.24, "Paid Search": 0.13, "Referral": 0.08,
                 "Organic Social": 0.05, "Email": 0.03, "Unassigned": 0.03}


def demo_daily(start: dt.date, end: dt.date, launch: dt.date, seed: int, new_page: bool) -> tuple[dict, dict]:
    rnd = random.Random(seed)
    base = rnd.uniform(150, 900)
    lift = rnd.choice([1.12, 0.95, 1.25, 1.04])
    total, channels, d = {}, {c: {} for c in DEMO_CHANNELS}, start
    while d <= end:
        iso = d.isoformat()
        if new_page and d < launch:
            total[iso] = {n: 0.0 for n in RAW}
        else:
            season = 1 + 0.12 * ((d.timetuple().tm_yday % 91) / 91 - 0.5)  # 계절 흔들림
            k = (lift if d >= launch else 1.0) * season * (0.75 if d.weekday() >= 5 else 1.0) * rnd.uniform(0.9, 1.1)
            day = {n: 0.0 for n in RAW}
            for ch, share in DEMO_CHANNELS.items():
                q = k * rnd.uniform(0.8, 1.2) * (1.1 if ch == "Paid Search" and d >= launch else 1.0)
                users = base * share * q
                sessions = users * 1.2
                er = min(0.95, (0.65 if ch in ("Direct", "Email") else 0.5) * q ** 0.2)
                v = {"screenPageViews": round(users * 1.6), "activeUsers": round(users), "sessions": round(sessions),
                     "engagementRate": er, "bounceRate": 1 - er, "userEngagementDuration": users * 70 * q ** 0.5,
                     "keyEvents": round(sessions * 0.03 * q), "sessionKeyEventRate": min(1, 0.025 * q)}
                channels[ch][iso] = v
                for n in ("screenPageViews", "activeUsers", "sessions", "userEngagementDuration", "keyEvents"):
                    day[n] += v[n]
                for n in ("engagementRate", "bounceRate", "sessionKeyEventRate"):
                    day[n] += v[n] * v["sessions"]
            for n in ("engagementRate", "bounceRate", "sessionKeyEventRate"):
                day[n] = day[n] / day["sessions"] if day["sessions"] else 0
            total[iso] = day
        d += dt.timedelta(days=1)
    return total, channels


# ---------------------------------------------------------------- 집계
def fill(daily: dict, start: dt.date, end: dt.date) -> dict:
    """데이터가 없는 날(조회 0)도 0 으로 채움."""
    out, d = {}, start
    while d <= end:
        out[d.isoformat()] = daily.get(d.isoformat(), {n: 0.0 for n in RAW})
        d += dt.timedelta(days=1)
    return out


def build_page(product: dict, page: dict, last_full: dt.date, demo: bool) -> dict:
    """페이지별 일별 원본 값(전체 + 채널별)만 내보내고, 기간별 집계는 화면에서 한다."""
    launch = dt.date.fromisoformat(page["date"])
    start = min(launch - dt.timedelta(days=30), last_full - dt.timedelta(days=LOOKBACK))
    key = f"{page['date']}|{page['name']}|{'+'.join(page['paths'])}"
    base = {**page, "key": key}
    try:
        total, channels = (demo_daily(start, last_full, launch, zlib.crc32(key.encode()), new_page="new" in page["note"])
                           if demo else fetch_daily(product["propertyId"], start, last_full, page["paths"], page["match"]))
    except Exception as e:  # 권한 누락이 가장 흔한 원인
        msg = str(e).splitlines()[0][:300]
        print(f"[경고] {product['name']} / {page['name']}: {msg}", file=sys.stderr)
        return {**base, "error": f"GA4 조회 실패: {msg}"}
    total = fill(total, start, last_full)
    dates = sorted(total)
    pack = lambda v: [round(v[n], 4) for n in RAW]
    daily = [[d] + pack(total[d]) for d in dates]
    # 채널별: 날짜 순서는 daily 와 같고, 그날 데이터가 없으면 0
    by_ch = {}
    for ch, days in channels.items():
        rows = [pack(days[d]) if d in days else 0 for d in dates]
        if any(rows):
            by_ch[ch] = rows
    return {**base, "daily": daily, "channels": by_ch}


def main() -> None:
    demo = "--demo" in sys.argv
    today = dt.datetime.now(TZ).date()
    last_full = today - dt.timedelta(days=DATA_LAG_DAYS)

    if demo:
        products = [{"id": "remoteview", "name": "리모트뷰", "propertyId": "0"},
                    {"id": "remotemeeting", "name": "리모트미팅", "propertyId": "0"},
                    {"id": "airepoto", "name": "AI레포토", "propertyId": "0"}]
        mk = lambda prod, n, name, path, note="": {"date": (today - dt.timedelta(days=n)).isoformat(), "product": prod,
                                                   "name": name, "paths": [path], "match": "exact", "note": note, "url": ""}
        pages = [mk("remotemeeting", 6, "요금제", "/ko-kr/pricing/"), mk("remotemeeting", 40, "메인", "/"),
                 mk("remotemeeting", 40, "특장점", "/ko-kr/features/"), mk("airepoto", 43, "SDK 페이지", "/sdk/", "new"),
                 mk("remoteview", 15, "다운로드", "/download/")]
    else:
        products = load_products()
        pages = load_pages(products)

    out_products = []
    for p in products:
        mine = sorted([x for x in pages if x["product"] == p["id"]], key=lambda x: (x["date"], x["name"]), reverse=True)
        out_products.append({"id": p["id"], "name": p["name"],
                             "pages": [build_page(p, x, last_full, demo) for x in mine]})

    payload = {
        "version": 4,
        "updatedAt": dt.datetime.now(TZ).isoformat(timespec="minutes"),
        "dataThrough": last_full.isoformat(),
        "raw": RAW,
        "demo": demo,
        "metrics": METRICS,
        "products": out_products,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    errors = sum(1 for p in out_products for x in p["pages"] if x.get("error"))
    print(f"wrote {OUT_PATH}: " + ", ".join(f"{p['name']} {len(p['pages'])}개 페이지" for p in out_products)
          + (f" (조회 실패 {errors}건)" if errors else ""))


if __name__ == "__main__":
    main()
