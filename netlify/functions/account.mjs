// Google 로그인·계정 관련 주소를 한 함수에서 처리
//   GET  /api/me              → { enabled, user }  로그인 기능이 켜져 있는지, 누가 로그인했는지
//   GET  /api/auth/login      → Google 로그인 화면으로 이동
//   GET  /api/auth/callback   → Google 이 돌려보내는 곳. 확인 후 세션 쿠키를 주고 앱으로 돌아감
//   POST /api/auth/logout     → 세션 지우기
//   POST /api/claim {k}       → 예전 연결 링크 열쇠의 목록을 내 계정으로 옮기기 (옮긴 뒤 열쇠로는 못 읽음)
//   GET  /api/addkey          → 음성·단축어용 "추가 전용" 열쇠 보기
//   POST /api/addkey          → 새 추가 전용 열쇠 만들기 (예전 것은 못 쓰게 됨)
import { createHash } from "node:crypto";
import {
  SESSION_COOKIE, OAUTH_COOKIE, SESSION_DAYS, env, authEnabled, randomToken, publicId,
  parseCookies, cookie, clearCookie, sameOrigin, allowedEmail, checkIdToken, createSession, getSession, deleteSession,
} from "../lib/auth.mjs";
import { KEY_RE, dataStore, json, saveMerged, userKey } from "../lib/store.mjs";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

const redirectUri = req => new URL("/api/auth/callback", new URL(req.url).origin).toString();
function redirect(location, cookies = []) {
  const h = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}
const publicUser = s => ({ id: publicId(s.sub), email: s.email, name: s.name, picture: s.picture });

async function login(req) {
  if (!authEnabled()) return json({ error: "auth_disabled" }, 404);
  const state = randomToken(18), verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(req), response_type: "code",
    scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  return redirect(`${GOOGLE_AUTH}?${q}`, [cookie(OAUTH_COOKIE, `${state}.${verifier}`, 600)]);
}

async function callback(req) {
  const url = new URL(req.url);
  const back = code => redirect(`/#login=${code}`, [clearCookie(OAUTH_COOKIE)]);
  if (!authEnabled()) return back("off");
  if (url.searchParams.get("error")) return back("cancel");
  const [state, verifier] = (parseCookies(req)[OAUTH_COOKIE] || "").split(".");
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return back("fail");
  let user;
  try {
    const r = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, code_verifier: verifier, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
        redirect_uri: redirectUri(req), grant_type: "authorization_code",
      }),
    });
    const body = await r.json();
    if (!r.ok || !body.id_token) throw new Error("token_" + (body.error || r.status));
    user = checkIdToken(body.id_token, env("GOOGLE_CLIENT_ID"));
  } catch (e) {
    console.error("google login failed:", e.message);
    return back("fail");
  }
  if (!allowedEmail(user.email)) return back("denied");
  const token = await createSession(user);
  return redirect("/#login=ok", [clearCookie(OAUTH_COOKIE), cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400)]);
}

/* 예전 형식(4번 이하) 데이터도 계정 목록과 합칠 수 있게 항목별 수정 시각을 채움 */
function upgrade(d) {
  if (Number(d.version) >= 5) return d;
  const lists = {};
  for (const [k, l] of Object.entries(d.lists || {})) {
    lists[k] = { ...l, items: (Array.isArray(l && l.items) ? l.items : []).map(i => ({ ...i, mt: i.mt || i.doneAt || i.createdAt || 0 })) };
  }
  return { ...d, lists, deleted: d.deleted && typeof d.deleted === "object" ? d.deleted : {}, version: 5 };
}

async function claim(req, s) {
  let k;
  try { k = String((await req.json()).k || ""); } catch { return json({ error: "bad_json" }, 400); }
  if (!KEY_RE.test(k)) return json({ error: "bad_key" }, 400);
  const store = dataStore(), mine = publicId(s.sub);
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await store.getWithMetadata(`lists/${k}`, { type: "json" });
    if (!entry) return json({ error: "not_found" }, 404);
    const old = entry.data || {};
    if (old.moved) return old.movedTo === mine ? json({ ok: true, already: true }) : json({ error: "moved_elsewhere" }, 409);
    // 1) 원본 백업 2) 계정 목록에 항목 단위로 합치기 3) 열쇠 자리에는 "옮겨짐" 표시만 남김 (열쇠로 더는 못 읽음)
    await store.setJSON(`archive/${k}`, { ...old, archivedAt: new Date().toISOString() }, { onlyIfNew: true });
    const data = upgrade({ ...old, lists: old.lists || {} });
    delete data.inbox; delete data.rev; delete data.savedAt;
    const merged = await saveMerged(store, userKey(s.sub), data, { keepInboxOf: Array.isArray(old.inbox) ? old.inbox : [] });
    if (!merged) return json({ error: "conflict" }, 409);
    const res = await store.setJSON(`lists/${k}`, { moved: true, movedTo: mine, movedAt: new Date().toISOString() }, { onlyIfMatch: entry.etag });
    if (res && res.modified === false) continue; // 그사이 다른 기기가 열쇠로 저장함 → 다시 합치기 (합치기는 여러 번 해도 같음)
    // 음성·단축어에 넣어 둔 예전 열쇠는 "추가 전용"으로 계속 쓸 수 있게
    await store.setJSON(`addkeys/${k}`, { sub: s.sub, createdAt: Date.now(), fromLegacy: true });
    const meta = (await store.get(`usermeta/${s.sub}`, { type: "json" })) || {};
    meta.addKeys = [...new Set([...(meta.addKeys || []), k])];
    await store.setJSON(`usermeta/${s.sub}`, meta);
    return json({ ok: true, data: merged });
  }
  return json({ error: "conflict" }, 409);
}

async function addkey(req, s) {
  const store = dataStore();
  const meta = (await store.get(`usermeta/${s.sub}`, { type: "json" })) || {};
  const keys = Array.isArray(meta.addKeys) ? meta.addKeys : [];
  if (req.method === "GET") return json({ key: keys[keys.length - 1] || null });
  for (const k of keys) await store.delete(`addkeys/${k}`);
  const key = randomToken(32);
  await store.setJSON(`addkeys/${key}`, { sub: s.sub, createdAt: Date.now() });
  meta.addKeys = [key];
  await store.setJSON(`usermeta/${s.sub}`, meta);
  return json({ key });
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const write = req.method !== "GET" && req.method !== "HEAD";
  if (write && !sameOrigin(req)) return json({ error: "forbidden" }, 403);

  if (path === "/api/auth/login" && req.method === "GET") return login(req);
  if (path === "/api/auth/callback" && req.method === "GET") return callback(req);

  const s = authEnabled() ? await getSession(req) : null;
  if (path === "/api/me" && req.method === "GET") return json({ enabled: authEnabled(), user: s ? publicUser(s) : null });
  if (path === "/api/auth/logout" && req.method === "POST") {
    await deleteSession(req);
    return json({ ok: true }, 200, { "set-cookie": clearCookie(SESSION_COOKIE) });
  }
  if (!s) return json({ error: "login_required" }, 401);
  if (path === "/api/claim" && req.method === "POST") return claim(req, s);
  if (path === "/api/addkey" && (req.method === "GET" || req.method === "POST")) return addkey(req, s);
  return json({ error: "not_found" }, 404);
};

export const config = { path: ["/api/me", "/api/auth/login", "/api/auth/callback", "/api/auth/logout", "/api/claim", "/api/addkey"] };
