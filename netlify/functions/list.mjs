// 장바구니 메모 데이터 저장소 (Netlify Blobs)
// 앱 코드(public/index.html)와 분리된 JSON 문서로 저장되므로 재배포해도 지워지지 않습니다.
// GET  /api/list?k=<열쇠>  → { data }   (없으면 404)
// PUT  /api/list?k=<열쇠>  body: 앱 상태 JSON → { ok, updatedAt, data }  (서버에 있던 것과 항목 단위로 합친 결과)
import { getStore } from "@netlify/blobs";
import { mergeState } from "../lib/merge.mjs";

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
    // 다른 기기가 그사이 저장했어도 덮어쓰지 않게: 읽고 → 합치고 → "읽은 그대로일 때만" 쓰기, 겹치면 다시
    for (let attempt = 0; attempt < 5; attempt++) {
      const prevEntry = await store.getWithMetadata(blobKey, { type: "json" });
      const prev = prevEntry ? prevEntry.data : null;
      // 형식 5번 이상(항목별 수정 시각·지운 기록이 있는 앱)만 합침. 예전 앱은 예전처럼 통째로 저장
      let next = prev && Number(data.version) >= 5 ? mergeState(prev, data) : { ...data };
      next.savedAt = new Date().toISOString();
      next.rev = ((prev && Number(prev.rev)) || 0) + 1; // 저장할 때마다 +1: 앱이 "바뀌었는지"를 시계와 상관없이 알 수 있게
      // 음성 등으로 서버에 바로 들어온 항목(inbox)은 앱이 처리했다고 알려 준 것(inboxDone)만 지움
      const done = new Set(Array.isArray(next.inboxDone) ? next.inboxDone : []);
      next.inbox = ((prev && Array.isArray(prev.inbox)) ? prev.inbox : []).filter(e => e && !done.has(e.id));
      const res = await store.setJSON(blobKey, next, prevEntry ? { onlyIfMatch: prevEntry.etag } : { onlyIfNew: true });
      if (!res || res.modified !== false) return json({ ok: true, updatedAt: next.updatedAt || null, data: next });
    }
    return json({ error: "conflict" }, 409);
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/list" };
