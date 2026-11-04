// 화면에 보여줄 지표 정의 (기간별 집계는 site/index.html 에서 이 정의대로 계산)
//   avg      : 일별 값의 평균 (일평균)
//   weighted : 세션 수로 가중 평균 (비율 지표)
//   ratio    : 분자 합 / 분모 합
//   lowerIsBetter: 낮을수록 좋은 지표 (변화 색을 반대로)
export const METRICS = {
  activeUsers: { label: "활성 사용자 (일평균)", agg: "avg", fmt: "int" },
  screenPageViews: { label: "페이지 조회수 (일평균)", agg: "avg", fmt: "int" },
  sessions: { label: "세션 (일평균)", agg: "avg", fmt: "int" },
  engagementRate: { label: "참여율", agg: "weighted", fmt: "pct" },
  bounceRate: { label: "이탈률", agg: "weighted", fmt: "pct", lowerIsBetter: true },
  avgEngagementTime: { label: "사용자당 참여 시간", agg: "ratio", num: "userEngagementDuration", den: "activeUsers", fmt: "sec" },
  keyEvents: { label: "키 이벤트 (일평균)", agg: "avg", fmt: "int" },
  sessionKeyEventRate: { label: "세션 전환율", agg: "weighted", fmt: "pct" },
};

// GA4 에서 실제로 받아오는 지표 (최대 10개)
export const RAW = ["screenPageViews", "activeUsers", "sessions", "engagementRate", "bounceRate",
  "userEngagementDuration", "keyEvents", "sessionKeyEventRate"];
export const RATES = ["engagementRate", "bounceRate", "sessionKeyEventRate"];

export const LOOKBACK_DAYS = 570;   // 6개월 + 전년 같은 6개월까지
export const DATA_LAG_DAYS = 2;     // GA4 데이터 확정 지연 → 2일 전까지

// ---------- 날짜 (한국 시간 기준)
export function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dataThrough = () => addDays(todayKST(), -DATA_LAG_DAYS);
export const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
