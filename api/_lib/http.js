// 공통: 로그인한 사용자 이메일 (middleware.js 가 이미 서명을 검증한 세션 쿠키에서 읽음)
export function userEmail(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.match(/(?:^|;\s*)dash_session=([^;]+)/);
  if (!m) return "";
  try {
    const body = decodeURIComponent(m[1]).split(".")[0];
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")).email || "";
  } catch { return ""; }
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(JSON.stringify(data));
}
