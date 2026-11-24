// 목록 데이터 저장소 (Netlify Blobs)
// 앱 코드(public/index.html)와 분리된 JSON 문서로 저장되므로 재배포해도 지워지지 않습니다.
// Google 로그인했으면(세션 쿠키) 내 계정 목록(users/<id>)만, 아니면 예전처럼 열쇠(?k=)로 찾음.
// GET  /api/list[?k=<열쇠>]  → { data }   (없으면 404, 계정으로 옮겨진 열쇠면 410)
// PUT  /api/list[?k=<열쇠>]  body: 앱 상태 JSON → { ok, updatedAt, data }  (서버에 있던 것과 항목 단위로 합친 결과)
import { authEnabled, getSession, sameOrigin } from "../lib/auth.mjs";
import { KEY_RE, dataStore, json, saveMerged, userKey } from "../lib/store.mjs";

const MAX_BYTES = 512 * 1024;

export default async (req) => {
  const session = authEnabled() ? await getSession(req) : null;
  let blobKey;
  if (session) blobKey = userKey(session.sub);
  else {
    const k = new URL(req.url).searchParams.get("k") || "";
    if (!KEY_RE.test(k)) return json({ error: authEnabled() ? "login_required" : "bad_key" }, authEnabled() ? 401 : 400);
    blobKey = `lists/${k}`;
  }
  const store = dataStore();

  if (req.method === "GET") {
    const data = await store.get(blobKey, { type: "json" });
    if (data === null) return json({ error: "not_found" }, 404);
    if (data.moved) return json({ error: "moved" }, 410);
    return json({ data });
  }

  if (req.method === "PUT") {
    if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400); }
    if (!data || typeof data !== "object" || !data.lists || typeof data.lists !== "object") {
      return json({ error: "bad_shape" }, 400);
    }
    // 로그인 기능이 켜진 뒤에는 열쇠로 새 목록을 만들지 않음 (있던 목록만 계속 쓰다가 로그인하면 계정으로 옮김)
    if (!session && authEnabled() && (await store.get(blobKey, { type: "json" })) === null) return json({ error: "login_required" }, 401);
    const next = await saveMerged(store, blobKey, data);
    if (!next) return json({ error: "conflict" }, 409);
    if (next.moved) return json({ error: "moved" }, 410);
    return json({ ok: true, updatedAt: next.updatedAt || null, data: next });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/list" };
