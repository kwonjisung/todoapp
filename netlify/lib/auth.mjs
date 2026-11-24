// Google 로그인과 세션.
// 흐름: /api/auth/login → Google 로그인 화면 → /api/auth/callback 에서 Google 서버와 직접 확인(코드 교환)
//       → 우리 세션을 만들어 HttpOnly 쿠키로 줌. 앱 코드(브라우저 JS)는 세션 값을 볼 수 없음.
// 필요한 Netlify 환경 변수: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (선택: ALLOWED_EMAILS=a@gmail.com,b@gmail.com)
import { createHash, randomBytes } from "node:crypto";
import { dataStore } from "./store.mjs";

export const SESSION_COOKIE = "__Host-sid";
export const OAUTH_COOKIE = "__Host-oauth";
export const SESSION_DAYS = 180;

export const env = name => (process.env[name] || "").trim();
export const authEnabled = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));

export const randomToken = (n = 32) => randomBytes(n).toString("base64url");
export const sha256 = s => createHash("sha256").update(s).digest("hex");
/* 앱에 보여 줄 짧은 사용자 구분값 (Google id 그대로 내보내지 않음) */
export const publicId = sub => sha256("uid:" + sub).slice(0, 16);

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export const clearCookie = name => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/* 다른 사이트에서 몰래 보낸 요청(CSRF) 막기: 브라우저가 붙이는 Sec-Fetch-Site / Origin 확인 */
export function sameOrigin(req) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return false;
  return true;
}

export function allowedEmail(email) {
  const list = env("ALLOWED_EMAILS").toLowerCase().split(/[\s,]+/).filter(Boolean);
  return !list.length || list.includes(String(email || "").toLowerCase());
}

/* Google 토큰 엔드포인트에서 (TLS로) 직접 받은 id_token 의 내용 확인.
   서버끼리 직접 받은 토큰이라 서명 확인 없이 내용만 확인해도 됨 (OpenID Connect Core 3.1.3.7) */
export function checkIdToken(idToken, clientId, now = Date.now()) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("bad_token");
  const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (p.iss !== "https://accounts.google.com" && p.iss !== "accounts.google.com") throw new Error("bad_issuer");
  if (p.aud !== clientId) throw new Error("bad_audience");
  if (!(Number(p.exp) * 1000 > now)) throw new Error("expired");
  if (!p.sub) throw new Error("no_subject");
  if (p.email_verified !== true && p.email_verified !== "true") throw new Error("email_not_verified");
  return { sub: String(p.sub), email: String(p.email || ""), name: String(p.name || ""), picture: String(p.picture || "") };
}

export async function createSession(user) {
  const token = randomToken();
  const exp = Date.now() + SESSION_DAYS * 86400000;
  await dataStore().setJSON(`sessions/${sha256(token)}`, { ...user, exp, createdAt: Date.now() });
  return token;
}
/* 요청의 쿠키로 로그인한 사용자 찾기. 없거나 만료면 null */
export async function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length < 20 || token.length > 100) return null;
  const s = await dataStore().get(`sessions/${sha256(token)}`, { type: "json" });
  if (!s || !s.sub || !(s.exp > Date.now())) return null;
  return s;
}
export async function deleteSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await dataStore().delete(`sessions/${sha256(token)}`);
}
