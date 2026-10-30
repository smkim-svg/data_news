# 배포 임팩트 대시보드 (GA4 × GitHub Releases)

GitHub Releases의 배포일을 기준으로 GA4 주요 지표의 **배포 전 N일 vs 배포 후 N일** 변화를 매일 자동 집계해 Cloudflare Pages(+ Access)로 보여줍니다.

```
GitHub Actions (매일 09:00 KST · 수동 · 릴리스 발행 시)
  ├─ GitHub Releases API  → 배포일 목록
  ├─ GA4 Data API (1회 호출, 일별) → 배포별 전/후 집계
  └─ site/data.json 생성 → Cloudflare Pages 배포 (Access로 사내만 접근)
```

## 집계 방식

- 비교 구간: 배포 전 N일(배포일 제외) vs 배포일 포함 후 N일. 기본 N=7.
- 합계 지표(활성 사용자·세션·키 이벤트)는 **일평균**으로 비교해서, 집계 중인 배포도 공정하게 비교합니다.
- 비율 지표(참여율·전환율·평균 세션 시간)는 **세션 가중 평균**을 씁니다.
- GA4 데이터 확정 지연을 감안해 **2일 전까지만** 사용합니다. 후 구간이 N일 미만이면 "집계 중"으로 표시됩니다.
- 실제 데이터(`site/data.json`)는 저장소에 커밋하지 않습니다.

## 설정 (최초 1회)

### 1. GA4 서비스 계정
1. GCP 콘솔에서 **Google Analytics Data API**를 사용 설정합니다.
2. 서비스 계정을 만들고 JSON 키를 발급합니다.
3. GA4 **관리 → 속성 액세스 관리**에 서비스 계정 이메일을 **뷰어**로 추가합니다.
4. GA4 **관리 → 속성 세부정보**에서 속성 ID(숫자)를 확인합니다.

### 2. Cloudflare Pages + Access
1. Cloudflare 대시보드 **Workers & Pages → Create → Pages → Direct Upload**로 프로젝트를 만듭니다. 이름은 예: `ga4-release-dashboard`.
2. **My Profile → API Tokens**에서 `Cloudflare Pages: Edit` 권한 토큰을 발급합니다.
3. 계정 ID는 대시보드 우측 사이드바에서 확인합니다.
4. **Zero Trust → Access → Applications → Add (Self-hosted)**
   - Domain: `ga4-release-dashboard.pages.dev`. `*.ga4-release-dashboard.pages.dev`도 추가해서 미리보기 URL까지 보호합니다.
   - Policy: Allow · Include · Emails ending in `@rsupport.com`
   - 또는 Pages 프로젝트 **Settings → General → Access policy → Enable**을 켜면 미리보기 URL이 자동으로 보호됩니다. 프로덕션 도메인은 위 Application 설정이 따로 필요합니다.

### 3. 이 저장소 설정 (Settings → Secrets and variables → Actions)

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `GA4_SA_KEY` | 서비스 계정 JSON **전체 내용** |
| Secret | `GA4_PROPERTY_ID` | GA4 속성 ID (숫자) |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API 토큰 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 ID |
| Secret | `RELEASES_TOKEN` | (릴리스 저장소가 private이고 이 저장소와 다를 때) Fine-grained PAT, 대상 저장소 **Contents: Read** |
| Variable | `RELEASE_REPOS` | 릴리스를 읽을 저장소. 예: `rsupport/service-web,rsupport/service-app` |
| Variable | `CF_PAGES_PROJECT` | (선택) Pages 프로젝트 이름. 기본 `ga4-release-dashboard` |
| Variable | `WINDOW_DAYS` | (선택) 비교 일수. 기본 `7` |

### 4. 첫 실행
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
pip install -r requirements.txt
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/ga4-sa.json GA4_PROPERTY_ID=123456789 RELEASE_REPOS=owner/repo
python scripts/fetch_ga4.py
```

## 지표 변경

`scripts/fetch_ga4.py`의 `METRICS`에 [GA4 Data API 지표 이름](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#metrics)을 추가하거나 뺍니다.
- `agg`: `avg`(일평균) 또는 `weighted`(세션 가중)
- `fmt`: `int` · `pct` · `sec`

화면은 자동으로 따라 바뀝니다.
