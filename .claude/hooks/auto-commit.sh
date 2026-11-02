#!/usr/bin/env bash
# 이 폴더 전용 자동 커밋 훅 (.claude/settings.json 에서 호출)
#   edit : Claude 가 파일을 수정한 직후 → 그 변경을 커밋
#   stop : Claude 응답이 끝날 때 → 직접 수정한 파일까지 남은 변경을 커밋
# 푸시는 하지 않습니다. 실패해도 Claude 작업을 막지 않도록 항상 exit 0.

MODE="${1:-edit}"
AUTHOR_NAME="김세민"
AUTHOR_EMAIL="smkim@rsupport.com"

# 민감 파일 이중 차단 (.gitignore 를 빠져나가거나 예전에 추적된 경우 대비)
SENSITIVE_RE='(^|/)(\.env($|\.)|.*\.env$|sa\.json$|.*service-account.*\.json$|.*credentials.*\.json$|client_secret.*\.json$|.*\.(key|pem|p12|pfx|jks|keystore|ppk)$|id_(rsa|ed25519)|\.npmrc$|\.netrc$|\.vercel/|.*token.*\.txt$|.*\.(csv|xlsx|xls|sqlite3?|db)$)'

INPUT="$(cat 2>/dev/null || true)"

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

GIT_DIR="$(git rev-parse --git-dir)"
# rebase / merge / am 진행 중에는 건드리지 않음
for f in rebase-apply rebase-merge MERGE_HEAD CHERRY_PICK_HEAD; do
  [ -e "$GIT_DIR/$f" ] && exit 0
done

git add -A >/dev/null 2>&1 || exit 0

# 스테이징된 파일 중 민감 패턴은 제외
BLOCKED="$(git diff --cached --name-only | grep -E "$SENSITIVE_RE" || true)"
if [ -n "$BLOCKED" ]; then
  echo "$BLOCKED" | while IFS= read -r p; do git reset -q -- "$p" 2>/dev/null; done
  echo "[auto-commit] 민감 파일로 보여 커밋에서 제외: $(echo "$BLOCKED" | tr '\n' ' ')" >&2
fi

git diff --cached --quiet && exit 0   # 커밋할 변경 없음

FILES="$(git diff --cached --name-only)"
COUNT="$(printf '%s\n' "$FILES" | grep -c .)"

if [ "$MODE" = "edit" ]; then
  # 훅 입력(JSON)에서 수정된 파일 경로 추출
  TARGET="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  TARGET="${TARGET#"$PWD/"}"
  [ -z "$TARGET" ] && TARGET="$(printf '%s\n' "$FILES" | head -1)"
  MSG="auto: ${TARGET} 수정 (Claude)"
else
  FIRST="$(printf '%s\n' "$FILES" | head -1)"
  if [ "$COUNT" -gt 1 ]; then MSG="auto: ${FIRST} 외 $((COUNT - 1))개 파일 변경"; else MSG="auto: ${FIRST} 변경"; fi
fi

git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
  commit -q --no-verify -m "$MSG" -m "$(printf '%s\n' "$FILES")" >/dev/null 2>&1 || true
exit 0
