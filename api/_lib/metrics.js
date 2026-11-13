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
  // 주요 이벤트: 이 페이지가 "방문 페이지(Landing page)"인 세션에서 발생한 횟수
  nf_submit: { label: "nf_submit (일평균)", agg: "avg", fmt: "cnt", hint: "방문 페이지 기준" },
  trial_step3_activate_gtm: { label: "trial_step3_activate_gtm (일평균)", agg: "avg", fmt: "cnt", hint: "방문 페이지 기준" },
  // 로그인 버튼 클릭: 이 페이지에서 발생한 cta_id_click 중 Label = 제품별 로그인 라벨 (기본 gnb_login)
  login_click: { label: "로그인 버튼 클릭 (일평균)", agg: "avg", fmt: "cnt", hint: "페이지 기준 · cta_id_click" },
};

// 방문 페이지 기준으로 셀 이벤트 (이벤트 이름 = METRICS 키)
export const LANDING_EVENTS = ["nf_submit", "trial_step3_activate_gtm"];

// GA4 에서 실제로 받아오는 지표 (최대 10개)
//   PAGE_RAW: 페이지 경로(pagePath) 기준으로 받는 값, 뒤에 LANDING_EVENTS 가 붙음
export const PAGE_RAW = ["screenPageViews", "activeUsers", "sessions", "engagementRate", "bounceRate", "userEngagementDuration"];
export const RAW = [...PAGE_RAW, ...LANDING_EVENTS, "login_click"];

// 로그인 버튼 클릭 조건
export const CLICK_EVENT = "cta_id_click";
export const DEFAULT_LOGIN_LABEL = "gnb_login";
export const LABEL_DIM_NAME = "Label";   // GA4 맞춤 측정기준 이름 (속성마다 API 이름을 자동으로 찾음)
export const RATES = ["engagementRate", "bounceRate"];

// 페이지별 추가 버튼 클릭: 페이지 설정의 ctas [{label, name}] 마다 지표 하나 (키 = "cta:라벨")
export const CTA_PREFIX = "cta:";
export const CTA_LABEL_RE = /^[A-Za-z0-9_.\-]{1,100}$/;   // GA4 Label 값으로 쓸 수 있는 글자만
export const ctaKey = (label) => CTA_PREFIX + label;
export function ctaMetric(name, label) {
  return { label: `${name} 클릭 (일평균)`, agg: "avg", fmt: "cnt", hint: "페이지 기준 · cta_id_click", cta: label };
}
// 클릭률 = 버튼 클릭 수 ÷ 활성 사용자 (기간 동안 합계끼리 나눔, 원본 열은 따로 없음)
export const ctrKey = (label) => "ctr:" + label;
export function ctrMetric(name, label) {
  return { label: `${name} 클릭률`, agg: "ratio", num: ctaKey(label), den: "activeUsers", fmt: "pct", hint: "클릭 ÷ 활성 사용자", cta: label, rate: true };
}

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
