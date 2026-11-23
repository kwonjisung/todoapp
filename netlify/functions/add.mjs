// 앱을 열지 않고 항목 하나 추가 (음성 비서, 단축어, 자동화 앱용)
// POST /api/add?k=<열쇠>  body: {"text":"다이소 우유 2개","list":"shopping"}  또는 text/plain 본문
// GET  /api/add?k=<열쇠>&text=다이소%20우유%202개&list=todo
// 서버는 원문을 inbox 에 넣기만 하고, 구입처·수량 해석은 앱이 열릴 때 앱의 규칙으로 처리합니다.
import { getStore } from "@netlify/blobs";

const KEY_RE = /^[A-Za-z0-9_-]{24,64}$/;
const LISTS = new Set(["shopping", "todo"]);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });

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

  const store = getStore({ name: "basket-lists", consistency: "strong", region: "us-east-2" });
  const blobKey = `lists/${k}`;
  const entries = text.split(/\s*,\s*|\s+그리고\s+/).filter(Boolean).slice(0, 20); // "우유, 계란" 여러 개 한 번에
  // 앱이 동시에 저장해도 서로 덮어쓰지 않게 "읽은 그대로일 때만" 쓰기, 겹치면 다시
  for (let attempt = 0; attempt < 5; attempt++) {
    const prev = await store.getWithMetadata(blobKey, { type: "json" });
    const data = (prev && prev.data) || { version: 2, lists: {}, stores: [] };
    data.inbox = Array.isArray(data.inbox) ? data.inbox : [];
    for (const t of entries) {
      data.inbox.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: t, list, at: Date.now() });
    }
    data.updatedAt = Date.now();
    data.rev = (Number(data.rev) || 0) + 1;
    const res = await store.setJSON(blobKey, data, prev ? { onlyIfMatch: prev.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return json({ ok: true, added: entries, list });
  }
  return json({ error: "conflict" }, 409);
};

export const config = { path: "/api/add" };
