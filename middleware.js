// Vercel Routing Middleware — 회사 Google Workspace 계정만 접근 허용
//
// 필요한 Vercel 환경 변수 (Production)
//   GOOGLE_CLIENT_ID      GCP OAuth 클라이언트 ID
//   GOOGLE_CLIENT_SECRET  GCP OAuth 클라이언트 보안 비밀번호
//   AUTH_SECRET           세션 서명용 임의 문자열 (32자 이상)
//   ALLOWED_DOMAIN        허용 도메인 (기본 rsupport.com)

export const config = { matcher: ["/((?!favicon\\.ico).*)"] };

const SESSION = "dash_session";
const STATE = "dash_oauth_state";
const SESSION_DAYS = 7;
const enc = new TextEncoder();

const env = (k, d) => (typeof process !== "undefined" && process.env[k]) || d;
const domain = () => env("ALLOWED_DOMAIN", "rsupport.com").toLowerCase();

// ---------------------------------------------------------------- crypto helpers
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
}
async function hmac(data) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(env("AUTH_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function signSession(payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}
async function readSession(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(await hmac(body), sig)) return null;
  try {
    const p = JSON.parse(fromB64url(body));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
function randomToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

// ---------------------------------------------------------------- http helpers
function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  cookies.forEach((c) => h.append("Set-Cookie", c));
  return new Response(null, { status: 302, headers: h });
}
function page(status, title, msg, cookies = []) {
  const h = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  cookies.forEach((c) => h.append("Set-Cookie", c));
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;color:#1f1f1d;background:#f7f7f5">
<div style="max-width:420px;text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#6b6b66">${msg}</p>
<p><a href="/auth/login" style="color:#2f6fde">회사 Google 계정으로 로그인</a></p></div></body>`;
  return new Response(html, { status, headers: h });
}
const safeNext = (n) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

// ---------------------------------------------------------------- routes
async function login(url) {
  const state = randomToken();
  const next = safeNext(url.searchParams.get("next"));
  const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  g.search = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: `${url.origin}/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    hd: domain(),
    prompt: "select_account",
    state,
  }).toString();
  return redirect(g.toString(), [cookie(STATE, `${state}|${next}`, 600)]);
}

async function callback(req, url) {
  const [savedState, next] = (getCookie(req, STATE) || "").split("|");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const clearState = cookie(STATE, "", 0);
  if (!code || !state || !savedState || !safeEqual(state, savedState)) {
    return page(400, "로그인 요청이 만료되었습니다", "다시 시도해 주세요.", [clearState]);
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: `${url.origin}/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return page(502, "Google 로그인에 실패했습니다", "잠시 후 다시 시도해 주세요.", [clearState]);
  const { id_token } = await res.json();
  // id_token 은 TLS 로 Google 토큰 엔드포인트에서 직접 받은 값이므로 서명 검증 없이 클레임만 확인해도 안전
  const claims = JSON.parse(fromB64url(id_token.split(".")[1]));
  const email = String(claims.email || "").toLowerCase();
  const ok =
    claims.aud === env("GOOGLE_CLIENT_ID") &&
    ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) &&
    claims.email_verified === true &&
    String(claims.hd || "").toLowerCase() === domain() &&
    email.endsWith(`@${domain()}`);
  if (!ok) {
    return page(403, "접근 권한이 없습니다", `@${domain()} 회사 계정으로만 볼 수 있습니다. (${email || "알 수 없는 계정"})`, [clearState]);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await signSession({ email, name: claims.name || email, exp });
  return redirect(safeNext(next), [clearState, cookie(SESSION, token, SESSION_DAYS * 86400)]);
}

// ---------------------------------------------------------------- entry
export default async function middleware(req) {
  const url = new URL(req.url);
  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET") || !env("AUTH_SECRET")) {
    return page(500, "로그인 설정이 필요합니다", "Vercel 환경 변수(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET)를 확인해 주세요.");
  }
  if (url.pathname === "/auth/login") return login(url);
  if (url.pathname === "/auth/callback") return callback(req, url);
  if (url.pathname === "/auth/logout") {
    return page(200, "로그아웃되었습니다", "다시 보려면 로그인해 주세요.", [cookie(SESSION, "", 0)]);
  }

  const session = await readSession(getCookie(req, SESSION));
  if (url.pathname === "/auth/me") {
    return new Response(JSON.stringify(session ? { email: session.email, name: session.name } : null), {
      status: session ? 200 : 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (session) return; // 통과 → 정적 파일 제공

  if (url.pathname.endsWith(".json")) return new Response("Unauthorized", { status: 401 });
  return redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}
