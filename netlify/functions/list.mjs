// 장바구니 메모 데이터 저장소 (Netlify Blobs)
// 앱 코드(public/index.html)와 분리된 JSON 문서로 저장되므로 재배포해도 지워지지 않습니다.
// GET  /api/list?k=<열쇠>  → { data }   (없으면 404)
// PUT  /api/list?k=<열쇠>  body: 앱 상태 JSON → { ok, updatedAt }
import { getStore } from "@netlify/blobs";

const KEY_RE = /^[A-Za-z0-9_-]{24,64}$/;
const MAX_BYTES = 512 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default async (req) => {
  const k = new URL(req.url).searchParams.get("k") || "";
  if (!KEY_RE.test(k)) return json({ error: "bad_key" }, 400);

  // 사이트 전체 저장소: 배포와 무관하게 유지됨. 지역을 고정해 읽기/쓰기가 같은 곳을 보게 함.
  const store = getStore({ name: "basket-lists", consistency: "strong", region: "us-east-2" });
  const blobKey = `lists/${k}`;

  if (req.method === "GET") {
    const data = await store.get(blobKey, { type: "json" });
    if (data === null) return json({ error: "not_found" }, 404);
    return json({ data });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400); }
    if (!data || typeof data !== "object" || !data.lists || typeof data.lists !== "object") {
      return json({ error: "bad_shape" }, 400);
    }
    data.savedAt = new Date().toISOString();
    // 음성 등으로 서버에 바로 들어온 항목(inbox)은 앱이 처리했다고 알려 준 것(inboxDone)만 지움
    const prev = await store.get(blobKey, { type: "json" });
    const done = new Set(Array.isArray(data.inboxDone) ? data.inboxDone : []);
    data.inbox = ((prev && Array.isArray(prev.inbox)) ? prev.inbox : []).filter(e => e && !done.has(e.id));
    await store.setJSON(blobKey, data);
    return json({ ok: true, updatedAt: data.updatedAt || null });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/list" };
