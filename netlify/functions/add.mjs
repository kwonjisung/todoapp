// 앱을 열지 않고 항목 하나 추가 (음성 비서, 단축어, 자동화 앱용)
// POST /api/add?k=<열쇠>  body: {"text":"다이소 우유 2개","list":"shopping"}  또는 text/plain 본문
// GET  /api/add?k=<열쇠>&text=다이소%20우유%202개&list=todo
// 열쇠: 로그인한 사용자는 앱 팝업의 "음성·단축어용 추가 주소" 열쇠 (추가만 가능, 목록을 읽을 수는 없음).
//       로그인 전에는 예전 연결 링크 열쇠.
// 서버는 원문을 inbox 에 넣기만 하고, 구입처·수량 해석은 앱이 열릴 때 앱의 규칙으로 처리합니다.
import { authEnabled } from "../lib/auth.mjs";
import { KEY_RE, dataStore, json as baseJson, pushInbox, userKey } from "../lib/store.mjs";

const LISTS = new Set(["shopping", "todo"]);
const json = (body, status = 200) => baseJson(body, status, { "access-control-allow-origin": "*" });

export default async (req) => {
  const url = new URL(req.url);
  const k = url.searchParams.get("k") || "";
  if (!KEY_RE.test(k)) return json({ error: "bad_key" }, 400);

  let text = url.searchParams.get("text") || "";
  let list = url.searchParams.get("list") || "";
  if (req.method === "POST") {
    const raw = await req.text();
    try { const b = JSON.parse(raw); text = b.text || text; list = b.list || list; }
    catch { text = raw || text; }
  } else if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  text = String(text).trim().slice(0, 200);
  if (!text) return json({ error: "empty_text" }, 400);
  if (!LISTS.has(list)) list = /할\s*일|todo/i.test(text.slice(0, 4)) ? "todo" : "shopping";

  const store = dataStore();
  const owner = await store.get(`addkeys/${k}`, { type: "json" });
  let blobKey;
  if (owner && owner.sub) blobKey = userKey(owner.sub);
  else {
    // 로그인 기능이 켜졌으면 예전 열쇠는 이미 있는 목록에만 추가 (새 목록을 만들지 않음)
    if (authEnabled() && (await store.get(`lists/${k}`, { type: "json" })) === null) return json({ error: "not_found" }, 404);
    blobKey = `lists/${k}`;
  }
  const entries = text.split(/\s*,\s*|\s+그리고\s+/).filter(Boolean).slice(0, 20); // "우유, 계란" 여러 개 한 번에
  const r = await pushInbox(store, blobKey, entries, list);
  if (r === "moved") return json({ error: "moved" }, 410);
  if (!r) return json({ error: "conflict" }, 409);
  return json({ ok: true, added: entries, list });
};

export const config = { path: "/api/add" };
