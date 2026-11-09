# UX 성과 모니터링 대시보드 (GA4 × 배포일)

## 지금 구조 (화면에서 바로 추가)

- **대시보드에서 페이지·주소·배포일을 추가/편집**하면 저장 즉시 GA4에서 불러와요. 배포(푸시)할 필요가 없어요.
- 한 페이지에 **배포일을 여러 개** 넣을 수 있어요(개선할 때마다 추가). "배포 후~현재"에서 어느 배포 기준으로 볼지 고를 수 있어요.
- 구성
  - `api/config.js` — 제품·페이지·배포일 저장/수정 (Upstash Redis)
  - `api/data.js` — GA4 Data API 조회 (같은 날·같은 설정이면 저장해 둔 결과 재사용, `↻ 다시 불러오기`로 강제 조회)
  - `api/_lib/seed.js` — 저장소가 비어 있을 때 넣는 기본 제품·페이지 (제품 추가는 여기에)
  - `middleware.js` — 회사 Google 계정 로그인 (API 도 보호)

### Vercel 설정 (최초 1회)
1. **Storage → Marketplace → Upstash (Redis)** 를 `data-news` 프로젝트에 연결 (무료). `KV_REST_API_URL`, `KV_REST_API_TOKEN` 이 자동으로 들어옵니다.
2. **Settings → Environment Variables** 에 `GA4_SA_KEY` (서비스 계정 JSON 전체) 추가.
3. 서비스 계정을 모든 제품 속성(리모트뷰·리모트미팅·AI레포토·리모트콜)에 **뷰어**로 추가.

> 아래 내용(products.json / releases.json / GitHub Actions 로 data.json 생성)은 이전 방식이에요. 지금 화면은 data.json 을 쓰지 않습니다.

---


GitHub Releases의 배포일을 기준으로 GA4 주요 지표의 **배포 전 N일 vs 배포 후 N일** 변화를 매일 자동 집계해 Vercel에 올립니다. 회사 Google 계정(@rsupport.com)으로 로그인해야만 볼 수 있습니다.

```
GitHub Actions (매일 09:00 KST · 수동 · 릴리스 발행 시)
  ├─ GitHub Releases API  → 배포일 목록
  ├─ GA4 Data API (1회 호출, 일별) → 배포별 전/후 집계
  └─ site/data.json 생성 → Vercel 배포
Vercel middleware.js → Google 로그인 + @rsupport.com 계정만 통과
```

## 집계 방식

- 비교 구간: 배포 전 N일(배포일 제외) vs 배포일 포함 후 N일. 기본 N=7.
- 합계 지표(활성 사용자·세션·키 이벤트)는 **일평균**으로 비교해서, 집계 중인 배포도 공정하게 비교합니다.
- 비율 지표(참여율·전환율·평균 세션 시간)는 **세션 가중 평균**을 씁니다.
- GA4 데이터 확정 지연을 감안해 **2일 전까지만** 사용합니다. 후 구간이 N일 미만이면 "집계 중"으로 표시됩니다.
- 실제 데이터(`site/data.json`)는 저장소에 커밋하지 않습니다.

## 제품 · 배포 페이지 관리

### products.json — 제품과 GA4 속성
```json
[
  { "id": "remoteview", "name": "리모트뷰", "propertyId": "307717617" },
  { "id": "remotemeeting", "name": "리모트미팅", "propertyId": "543595202" },
  { "id": "airepoto", "name": "AI레포토", "propertyId": "477959686" }
]
```
서비스 계정(`ga4-reader@…`)이 **모든 속성에 뷰어**로 추가돼 있어야 합니다.

### releases.json — 배포한 페이지 (페이지 하나당 한 줄)
```json
[
  { "date": "2026-09-21", "product": "airepoto", "name": "SDK 페이지", "path": "/ko-kr/sdk/" },
  { "date": "2026-06-30", "product": "remotemeeting", "name": "메인", "path": "/" },
  { "date": "2026-06-30", "product": "remotemeeting", "name": "특장점", "path": "/ko-kr/features/", "match": "prefix" }
]
```
- `date`: 배포일 `YYYY-MM-DD` (한국 시간)
- `product`: products.json 의 `id`
- `name`: 왼쪽 목록에 보일 이름
- `path`: 페이지 주소. 전체 URL을 붙여넣어도 경로만 씁니다. 여러 개면 `["/a/", "/b/"]`. 비우면 사이트 전체 지표
- `match`(선택): `exact`(기본, 끝 `/` 유무는 같게 취급) / `prefix`(하위 경로까지 포함)
- 새로 만든 페이지는 배포 전 데이터가 없어서 "신규"로 표시되고 배포 후 값만 보여줍니다.

푸시하면 대시보드가 바로 다시 계산됩니다.

## 설정 (최초 1회)

### 1. GA4 서비스 계정
1. GCP 콘솔에서 **Google Analytics Data API**를 사용 설정합니다.
2. 서비스 계정을 만들고 JSON 키를 발급합니다.
3. GA4 **관리 → 속성 액세스 관리**에 서비스 계정 이메일을 **뷰어**로 추가합니다.
4. GA4 **관리 → 속성 세부정보**에서 속성 ID(숫자)를 확인합니다.

### 2. Vercel 프로젝트 연결
터미널에서 이 저장소 폴더로 이동해 실행합니다.

```bash
npx vercel link        # 로그인 → 팀(Scope) 선택 → 새 프로젝트 이름 입력 (예: ga4-release-dashboard)
cat .vercel/project.json   # orgId, projectId 확인
```

- `vercel.json`에서 Git 자동 배포를 꺼 두었습니다. 배포는 GitHub Actions만 합니다.
- Vercel **Account Settings → Tokens**에서 토큰을 발급합니다. Scope는 위에서 고른 팀으로 합니다.
- `.vercel/` 폴더는 커밋하지 않습니다.

### 3. 회사 Google 로그인 (GCP OAuth 클라이언트)
1. GCP 콘솔 **API 및 서비스 → OAuth 동의 화면**에서 사용자 유형 **내부(Internal)**를 고르고 앱 이름을 입력합니다.
2. **사용자 인증 정보 → 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션**을 선택합니다.
   - 승인된 리디렉션 URI: `https://<프로젝트명>.vercel.app/auth/callback`
   - 커스텀 도메인을 붙이면 그 주소의 `/auth/callback`도 추가합니다.
3. Vercel 프로젝트 **Settings → Environment Variables**(Production)에 아래를 등록합니다.

| 이름 | 값 |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 클라이언트 보안 비밀번호 |
| `AUTH_SECRET` | 임의 문자열 32자 이상 (`openssl rand -base64 32`) |
| `ALLOWED_DOMAIN` | (선택) 기본 `rsupport.com` |

로그인 동작:
- 비로그인 상태로 접속하면 Google 로그인 화면으로 이동합니다.
- `@rsupport.com` 계정만 통과하고, 세션은 7일간 유지됩니다.
- 개인 Gmail이나 다른 도메인은 403으로 막힙니다.
- 로그아웃 주소: `/auth/logout`

### 4. 이 저장소 설정 (Settings → Secrets and variables → Actions)

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `GA4_SA_KEY` | 서비스 계정 JSON **전체 내용** |
| Secret | `VERCEL_TOKEN` | Vercel 토큰 |
| Secret | `VERCEL_ORG_ID` | `.vercel/project.json`의 `orgId` |
| Secret | `VERCEL_PROJECT_ID` | `.vercel/project.json`의 `projectId` |
| Secret | `RELEASES_TOKEN` | (릴리스 저장소가 private이고 이 저장소와 다를 때) Fine-grained PAT, 대상 저장소 **Contents: Read** |
| Variable | `WINDOW_DAYS` | (선택) 비교 일수. 기본 `7` |

### 5. 첫 실행
**Actions → Update GA4 release dashboard → Run workflow**를 실행합니다.

## (선택) 릴리스 발행 즉시 갱신

서비스 저장소에 아래 워크플로를 추가합니다. `DASHBOARD_DISPATCH_TOKEN`은 이 저장소에 대한 **Contents: Read and write** 권한을 가진 Fine-grained PAT입니다.

```yaml
# 서비스 저장소/.github/workflows/notify-dashboard.yml
on:
  release:
    types: [published]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -X POST \
            -H "Authorization: Bearer ${{ secrets.DASHBOARD_DISPATCH_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/smkim-svg/data_news/dispatches \
            -d '{"event_type":"release-published"}'
```

## 로컬 미리보기

```bash
python scripts/fetch_ga4.py --demo     # 가짜 데이터로 site/data.json 생성
python -m http.server -d site 8000     # http://localhost:8000
```

실제 데이터로 확인하려면 다음을 실행합니다.

```bash
pip install -r scripts/requirements.txt
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/ga4-sa.json
python scripts/fetch_ga4.py
```

## 지표 변경

`scripts/fetch_ga4.py`의 `METRICS`에 [GA4 Data API 지표 이름](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#metrics)을 추가하거나 뺍니다.
- `agg`: `avg`(일평균) 또는 `weighted`(세션 가중)
- `fmt`: `int` · `pct` · `sec`

화면은 자동으로 따라 바뀝니다.
