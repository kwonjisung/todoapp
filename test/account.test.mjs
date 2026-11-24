// node --test : Google 로그인, 계정별 목록, 예전 열쇠 목록 옮기기, 추가 전용 열쇠
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { memStore } from "./memstore.mjs";
import { setTestStore } from "../netlify/lib/store.mjs";
import { checkIdToken, publicId } from "../netlify/lib/auth.mjs";
import account from "../netlify/functions/account.mjs";
import list from "../netlify/functions/list.mjs";
import add from "../netlify/functions/add.mjs";

const SITE = "https://jstodoshop.netlify.app";
const CLIENT = "test-client.apps.googleusercontent.com";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
let store;
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims = {}) => [b64({ alg: "RS256" }), b64({ iss: "https://accounts.google.com", aud: CLIENT, sub: "1001", email: "me@gmail.com", email_verified: true, name: "나", exp: Math.floor(Date.now() / 1000) + 3600, ...claims }), "sig"].join(".");
let nextClaims = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
    const p = new URLSearchParams(opts.body);
    if (p.get("code") !== "good-code" || p.get("client_secret") !== "secret" || !p.get("code_verifier")) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    return new Response(JSON.stringify({ id_token: idToken(nextClaims) }), { status: 200 });
  }
  return realFetch(url, opts);
};

const req = (path, { method = "GET", cookie = "", body, headers = {} } = {}) =>
  new Request(SITE + path, { method, headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const route = r => { const p = new URL(r.url).pathname; return p === "/api/list" ? list(r) : p === "/api/add" ? add(r) : account(r); };
const call = async (path, o) => { const res = await route(req(path, o)); const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch {} return { res, status: res.status, body }; };
const setCookies = res => res.headers.getSetCookie();
const cookieVal = (res, name) => { const c = setCookies(res).find(x => x.startsWith(name + "=")); return c && c.split(";")[0]; };

async function signIn(claims = {}) {
  nextClaims = claims;
  const a = await route(req("/api/auth/login"));
  assert.equal(a.status, 302);
  const loc = new URL(a.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(loc.searchParams.get("redirect_uri"), SITE + "/api/auth/callback");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  const oauth = cookieVal(a, "__Host-oauth");
  const b = await route(req(`/api/auth/callback?code=good-code&state=${loc.searchParams.get("state")}`, { cookie: oauth }));
  return { res: b, location: b.headers.get("location"), sid: cookieVal(b, "__Host-sid") };
}
const doc = items => ({ version: 5, updatedAt: Date.now(), deleted: {}, stores: [], lists: { shopping: { items, recent: [] }, todo: { items: [], recent: [] } } });
const item = (id, text) => ({ id, text, mt: Date.now(), createdAt: Date.now(), done: false });

beforeEach(() => {
  store = memStore(); setTestStore(store);
  process.env.GOOGLE_CLIENT_ID = CLIENT; process.env.GOOGLE_CLIENT_SECRET = "secret"; delete process.env.ALLOWED_EMAILS;
});

test("로그인 기능이 꺼져 있으면(환경 변수 없음) 예전처럼 열쇠로 동작", async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  assert.deepEqual((await call("/api/me")).body, { enabled: false, user: null });
  assert.equal((await call(`/api/list?k=${KEY}`, { method: "PUT", body: doc([item("a", "우유")]) })).status, 200);
  assert.equal((await call(`/api/list?k=${KEY}`)).body.data.lists.shopping.items[0].text, "우유");
  assert.equal((await call(`/api/add?k=${KEY}&text=두부`)).status, 200);
});

test("Google 로그인 → 세션 쿠키 → 내 정보", async () => {
  const { location, sid, res } = await signIn();
  assert.equal(location, "/#login=ok");
  assert.match(setCookies(res).find(c => c.startsWith("__Host-sid=")), /HttpOnly; Secure; SameSite=Lax/);
  const me = await call("/api/me", { cookie: sid });
  assert.equal(me.body.enabled, true);
  assert.equal(me.body.user.email, "me@gmail.com");
  assert.equal(me.body.user.id, publicId("1001"));
  // 세션은 쿠키 원래 값이 아니라 해시로 저장
  assert.ok(![...store.m.keys()].some(k => k.includes(sid.split("=")[1])));
});

test("state 가 다르거나 Google 이 거절하면 로그인 실패", async () => {
  const a = await route(req("/api/auth/login"));
  const oauth = cookieVal(a, "__Host-oauth");
  const bad = await route(req("/api/auth/callback?code=good-code&state=other", { cookie: oauth }));
  assert.equal(bad.headers.get("location"), "/#login=fail");
  const st = new URL(a.headers.get("location")).searchParams.get("state");
  const bad2 = await route(req(`/api/auth/callback?code=wrong&state=${st}`, { cookie: oauth }));
  assert.equal(bad2.headers.get("location"), "/#login=fail");
  assert.equal(cookieVal(bad2, "__Host-sid"), undefined);
});

test("ALLOWED_EMAILS 에 없는 계정은 거절", async () => {
  process.env.ALLOWED_EMAILS = "other@gmail.com, friend@gmail.com";
  const { location, sid } = await signIn();
  assert.equal(location, "/#login=denied");
  assert.equal(sid, undefined);
  process.env.ALLOWED_EMAILS = "ME@gmail.com";
  assert.equal((await signIn()).location, "/#login=ok");
});

test("id_token 확인: 다른 앱용·만료·이메일 미인증 토큰 거절", () => {
  assert.throws(() => checkIdToken(idToken({ aud: "evil" }), CLIENT), /audience/);
  assert.throws(() => checkIdToken(idToken({ exp: 1 }), CLIENT), /expired/);
  assert.throws(() => checkIdToken(idToken({ email_verified: false }), CLIENT), /verified/);
  assert.throws(() => checkIdToken(idToken({ iss: "https://evil.example" }), CLIENT), /issuer/);
});

test("계정별로 목록이 따로: 다른 사람 목록은 안 보임, 로그인 안 하면 401", async () => {
  const a = (await signIn({ sub: "1001", email: "a@gmail.com" })).sid;
  const b = (await signIn({ sub: "2002", email: "b@gmail.com" })).sid;
  assert.equal((await call("/api/list", { method: "PUT", cookie: a, body: doc([item("x", "A의 우유")]) })).status, 200);
  assert.equal((await call("/api/list", { cookie: b })).status, 404);
  assert.equal((await call("/api/list", { method: "PUT", cookie: b, body: doc([item("y", "B의 두부")]) })).status, 200);
  assert.deepEqual((await call("/api/list", { cookie: a })).body.data.lists.shopping.items.map(i => i.text), ["A의 우유"]);
  assert.equal((await call("/api/list")).status, 401);
  // 로그인 기능이 켜진 뒤 열쇠로 새 목록은 못 만듦
  assert.equal((await call(`/api/list?k=${KEY}`, { method: "PUT", body: doc([]) })).status, 401);
});

test("다른 사이트에서 보낸 쓰기 요청은 거절 (CSRF)", async () => {
  const { sid } = await signIn();
  const r = await call("/api/list", { method: "PUT", cookie: sid, body: doc([]), headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
  assert.equal(r.status, 403);
  assert.equal((await call("/api/addkey", { method: "POST", cookie: sid, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
});

test("로그아웃하면 세션이 지워짐", async () => {
  const { sid } = await signIn();
  const out = await call("/api/auth/logout", { method: "POST", cookie: sid });
  assert.match(setCookies(out.res)[0], /__Host-sid=;.*Max-Age=0/);
  assert.equal((await call("/api/me", { cookie: sid })).body.user, null);
  assert.equal((await call("/api/list", { cookie: sid })).status, 401);
});

test("예전 열쇠 목록을 계정으로 옮기기: 합쳐지고, 백업되고, 열쇠로는 더 못 읽음", async () => {
  delete process.env.GOOGLE_CLIENT_ID; // 로그인 기능 켜기 전에 쓰던 목록
  await call(`/api/list?k=${KEY}`, { method: "PUT", body: doc([item("old", "예전 우유")]) });
  await call(`/api/add?k=${KEY}&text=음성 두부`); // 아직 앱이 처리 안 한 음성 항목
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  // 로그인 전에는 열쇠로 계속 씀
  assert.equal((await call(`/api/list?k=${KEY}`)).status, 200);
  const { sid } = await signIn();
  await call("/api/list", { method: "PUT", cookie: sid, body: doc([item("new", "계정 계란")]) });
  const c = await call("/api/claim", { method: "POST", cookie: sid, body: { k: KEY } });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.data.lists.shopping.items.map(i => i.id).sort(), ["new", "old"]);
  assert.deepEqual(c.body.data.inbox.map(e => e.text), ["음성 두부"]);
  assert.equal((await call(`/api/list?k=${KEY}`)).status, 410);
  assert.equal((await call(`/api/list?k=${KEY}`, { method: "PUT", body: doc([]) })).status, 410);
  assert.ok(store.m.has(`archive/${KEY}`));
  // 다시 해도 괜찮고, 다른 계정은 가져갈 수 없음
  assert.equal((await call("/api/claim", { method: "POST", cookie: sid, body: { k: KEY } })).body.already, true);
  const other = (await signIn({ sub: "2002", email: "b@gmail.com" })).sid;
  assert.equal((await call("/api/claim", { method: "POST", cookie: other, body: { k: KEY } })).status, 409);
  // 예전 열쇠를 넣어 둔 음성 설정은 계속 동작 → 내 계정 목록으로
  assert.equal((await call(`/api/add?k=${KEY}&text=대파`)).status, 200);
  assert.ok((await call("/api/list", { cookie: sid })).body.data.inbox.some(e => e.text === "대파"));
});

test("추가 전용 열쇠: 추가는 되고 읽기는 안 됨, 새로 만들면 예전 것은 못 씀", async () => {
  const { sid } = await signIn();
  const k1 = (await call("/api/addkey", { method: "POST", cookie: sid })).body.key;
  assert.match(k1, /^[A-Za-z0-9_-]{24,64}$/);
  assert.equal((await call("/api/addkey", { cookie: sid })).body.key, k1);
  assert.equal((await call(`/api/add?k=${k1}`, { method: "POST", body: { text: "우유, 계란", list: "shopping" } })).status, 200);
  assert.deepEqual((await call("/api/list", { cookie: sid })).body.data.inbox.map(e => e.text), ["우유", "계란"]);
  assert.equal((await call(`/api/list?k=${k1}`)).status, 404); // 추가 전용 열쇠로는 목록을 못 읽음
  const k2 = (await call("/api/addkey", { method: "POST", cookie: sid })).body.key;
  assert.notEqual(k1, k2);
  assert.equal((await call(`/api/add?k=${k1}&text=x`)).status, 404);
  assert.equal((await call(`/api/add?k=${k2}&text=y`)).status, 200);
});
