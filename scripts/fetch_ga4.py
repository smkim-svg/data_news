"""GA4 지표를 배포일(GitHub Releases) 기준 전/후로 집계해 site/data.json 을 생성한다.

환경 변수
  GA4_PROPERTY_ID   GA4 속성 ID (숫자)                         [필수]
  RELEASE_REPOS     릴리스를 읽을 저장소, 쉼표 구분 (owner/repo)  [필수]
  RELEASES_TOKEN    릴리스 조회용 GitHub 토큰 (없으면 GITHUB_TOKEN)
  WINDOW_DAYS       전/후 비교 일수 (기본 7)
  LOOKBACK_DAYS     차트에 표시할 최소 기간 (기본 120)
  TIMEZONE          배포 시각을 날짜로 바꿀 때 쓰는 시간대 (기본 Asia/Seoul)
  INCLUDE_PRERELEASE  1 이면 pre-release 포함 (기본 0)
  GOOGLE_APPLICATION_CREDENTIALS  서비스 계정 JSON 경로

로컬 미리보기:  python scripts/fetch_ga4.py --demo
"""
from __future__ import annotations

import datetime as dt
import json
import os
import random
import sys
import urllib.request
from zoneinfo import ZoneInfo

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "site", "data.json")

# GA4 Data API 지표 이름 → 집계 방식
#   avg      : 일별 값의 평균 (일평균)
#   weighted : 세션 수로 가중 평균 (비율·평균값 지표)
METRICS = {
    "activeUsers": {"label": "활성 사용자 (일평균)", "agg": "avg", "fmt": "int"},
    "newUsers": {"label": "신규 사용자 (일평균)", "agg": "avg", "fmt": "int"},
    "sessions": {"label": "세션 (일평균)", "agg": "avg", "fmt": "int"},
    "engagementRate": {"label": "참여율", "agg": "weighted", "fmt": "pct"},
    "averageSessionDuration": {"label": "평균 세션 시간", "agg": "weighted", "fmt": "sec"},
    "keyEvents": {"label": "키 이벤트 (일평균)", "agg": "avg", "fmt": "int"},
    "sessionKeyEventRate": {"label": "세션 전환율", "agg": "weighted", "fmt": "pct"},
}

WINDOW = int(os.environ.get("WINDOW_DAYS", "7"))
LOOKBACK = int(os.environ.get("LOOKBACK_DAYS", "120"))
TZ = ZoneInfo(os.environ.get("TIMEZONE", "Asia/Seoul"))
DATA_LAG_DAYS = 2  # GA4 데이터 확정 지연


# ---------------------------------------------------------------- releases
def fetch_releases() -> list[dict]:
    repos = [r.strip() for r in os.environ["RELEASE_REPOS"].split(",") if r.strip()]
    token = os.environ.get("RELEASES_TOKEN") or os.environ.get("GITHUB_TOKEN")
    include_pre = os.environ.get("INCLUDE_PRERELEASE") == "1"
    out = []
    for repo in repos:
        page = 1
        while True:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}",
                headers={"Accept": "application/vnd.github+json",
                         **({"Authorization": f"Bearer {token}"} if token else {})},
            )
            with urllib.request.urlopen(req) as r:
                items = json.load(r)
            if not items:
                break
            for it in items:
                if it.get("draft") or (it.get("prerelease") and not include_pre):
                    continue
                ts = it.get("published_at") or it.get("created_at")
                when = dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(TZ)
                out.append({
                    "repo": repo,
                    "version": it.get("tag_name") or it.get("name"),
                    "title": it.get("name") or it.get("tag_name"),
                    "date": when.date().isoformat(),
                    "url": it.get("html_url"),
                })
            page += 1
    out.sort(key=lambda r: r["date"], reverse=True)
    return out


# ---------------------------------------------------------------- GA4
def fetch_daily(start: dt.date, end: dt.date) -> dict[str, dict[str, float]]:
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.types import (DateRange, Dimension, Metric,
                                                    OrderBy, RunReportRequest)

    client = BetaAnalyticsDataClient()
    names = list(METRICS)
    resp = client.run_report(RunReportRequest(
        property=f"properties/{os.environ['GA4_PROPERTY_ID']}",
        date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
        dimensions=[Dimension(name="date")],
        metrics=[Metric(name=n) for n in names],
        order_bys=[OrderBy(dimension=OrderBy.DimensionOrderBy(dimension_name="date"))],
        limit=100000,
        keep_empty_rows=True,
    ))
    daily = {}
    for row in resp.rows:
        d = row.dimension_values[0].value  # YYYYMMDD
        key = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        daily[key] = {n: float(v.value or 0) for n, v in zip(names, row.metric_values)}
    return daily


def demo_daily(start: dt.date, end: dt.date, releases: list[dict]) -> dict:
    rnd = random.Random(42)
    bumps = sorted(dt.date.fromisoformat(r["date"]) for r in releases)
    daily, d = {}, start
    while d <= end:
        lift = 1 + sum(rnd.choice([0.06, -0.03, 0.1, 0.02]) for b in bumps if d >= b) * 0.5
        week = 0.8 if d.weekday() >= 5 else 1.0
        users = 4200 * lift * week * rnd.uniform(0.93, 1.07)
        sessions = users * 1.35
        daily[d.isoformat()] = {
            "activeUsers": round(users), "newUsers": round(users * 0.38),
            "sessions": round(sessions),
            "engagementRate": min(0.9, 0.58 * lift ** 0.3 * rnd.uniform(0.97, 1.03)),
            "averageSessionDuration": 165 * lift ** 0.5 * rnd.uniform(0.9, 1.1),
            "keyEvents": round(sessions * 0.031 * lift * rnd.uniform(0.9, 1.1)),
            "sessionKeyEventRate": 0.024 * lift * rnd.uniform(0.92, 1.08),
        }
        d += dt.timedelta(days=1)
    return daily


# ---------------------------------------------------------------- aggregation
def aggregate(daily: dict, start: dt.date, end: dt.date) -> tuple[dict, int]:
    rows = []
    d = start
    while d <= end:
        if d.isoformat() in daily:
            rows.append(daily[d.isoformat()])
        d += dt.timedelta(days=1)
    if not rows:
        return {}, 0
    total_sessions = sum(r["sessions"] for r in rows) or 1
    res = {}
    for name, meta in METRICS.items():
        if meta["agg"] == "avg":
            res[name] = sum(r[name] for r in rows) / len(rows)
        else:
            res[name] = sum(r[name] * r["sessions"] for r in rows) / total_sessions
    return res, len(rows)


def main() -> None:
    demo = "--demo" in sys.argv
    today = dt.datetime.now(TZ).date()
    last_full = today - dt.timedelta(days=DATA_LAG_DAYS)

    if demo:
        releases = [
            {"repo": "demo/app", "version": v, "title": t, "date": (today - dt.timedelta(days=n)).isoformat(), "url": "#"}
            for v, t, n in [("v2.6.0", "추천 영역 개편", 4), ("v2.5.0", "결제 화면 리뉴얼", 19),
                            ("v2.4.1", "로그인 버그 수정", 33), ("v2.4.0", "온보딩 단계 축소", 48),
                            ("v2.3.0", "검색 개선", 75)]
        ]
    else:
        releases = fetch_releases()

    earliest = min([dt.date.fromisoformat(r["date"]) for r in releases] + [last_full])
    start = min(earliest - dt.timedelta(days=WINDOW), last_full - dt.timedelta(days=LOOKBACK))
    daily = demo_daily(start, last_full, releases) if demo else fetch_daily(start, last_full)

    out_releases = []
    for r in releases:
        d = dt.date.fromisoformat(r["date"])
        before, nb = aggregate(daily, d - dt.timedelta(days=WINDOW), d - dt.timedelta(days=1))
        after_end = min(d + dt.timedelta(days=WINDOW - 1), last_full)
        after, na = aggregate(daily, d, after_end) if after_end >= d else ({}, 0)
        delta = {m: ((after[m] - before[m]) / before[m] * 100) if before.get(m) and m in after else None
                 for m in METRICS}
        out_releases.append({**r, "before": before, "after": after, "deltaPct": delta,
                             "beforeDays": nb, "afterDays": na, "complete": na >= WINDOW})

    chart_start = last_full - dt.timedelta(days=LOOKBACK)
    series = [{"date": k, **v} for k, v in sorted(daily.items()) if k >= chart_start.isoformat()]

    payload = {
        "updatedAt": dt.datetime.now(TZ).isoformat(timespec="minutes"),
        "dataThrough": last_full.isoformat(),
        "windowDays": WINDOW,
        "demo": demo,
        "metrics": METRICS,
        "releases": out_releases,
        "daily": series,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT_PATH}: {len(out_releases)} releases, {len(series)} days")


if __name__ == "__main__":
    main()
