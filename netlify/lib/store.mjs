// 저장소(Netlify Blobs) 공통 도우미. 함수들이 같은 규칙으로 읽고·합치고·씀.
// 저장 위치(키):
//   lists/<열쇠>      예전 방식(연결 링크 열쇠) 목록. 계정으로 옮기면 { moved: true } 표시만 남음
//   users/<Google id>  Google 로그인 사용자의 목록 (본인 세션으로만 읽고 씀)
//   sessions/<해시>    로그인 세션 (쿠키 값의 SHA-256, 원래 값은 저장 안 함)
//   addkeys/<열쇠>     음성·단축어용 "추가 전용" 열쇠 → 사용자 (목록을 읽을 수는 없음)
//   usermeta/<Google id>  사용자의 추가 전용 열쇠 목록 등
//   archive/<열쇠>     계정으로 옮기기 직전 원본 백업 (API로는 읽을 수 없음)
import { getStore } from "@netlify/blobs";
import { mergeState } from "./merge.mjs";

export const KEY_RE = /^[A-Za-z0-9_-]{24,64}$/;

let testStore = null;
export function setTestStore(s) { testStore = s; } // 테스트에서만 사용
export function dataStore() {
  // 사이트 전체 저장소: 배포와 무관하게 유지됨. 지역을 고정해 읽기/쓰기가 같은 곳을 보게 함.
  return testStore || getStore({ name: "basket-lists", consistency: "strong", region: "us-east-2" });
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const emptyDoc = () => ({ version: 2, lists: {}, stores: [] });

/* 앱이 보낸 상태를 저장소의 기존 문서와 항목 단위로 합쳐 저장. 다른 기기가 그사이 저장했어도 덮어쓰지 않게
   읽고 → 합치고 → "읽은 그대로일 때만" 쓰기, 겹치면 다시. 성공하면 저장된 문서, 계속 겹치면 null */
export async function saveMerged(store, blobKey, data, { keepInboxOf } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prevEntry = await store.getWithMetadata(blobKey, { type: "json" });
    const prev = prevEntry ? prevEntry.data : null;
    if (prev && prev.moved) return { moved: true };
    // 형식 5번 이상(항목별 수정 시각·지운 기록이 있는 앱)만 합침. 예전 앱은 예전처럼 통째로 저장
    const next = prev && Number(data.version) >= 5 ? mergeState(prev, data) : { ...data };
    next.savedAt = new Date().toISOString();
    next.rev = ((prev && Number(prev.rev)) || 0) + 1; // 저장할 때마다 +1: 앱이 "바뀌었는지"를 시계와 상관없이 알 수 있게
    // 음성 등으로 서버에 바로 들어온 항목(inbox)은 앱이 처리했다고 알려 준 것(inboxDone)만 지움
    const done = new Set(Array.isArray(next.inboxDone) ? next.inboxDone : []);
    const inbox = [...((prev && Array.isArray(prev.inbox)) ? prev.inbox : []), ...(keepInboxOf || [])];
    const seen = new Set();
    next.inbox = inbox.filter(e => e && !done.has(e.id) && !seen.has(e.id) && seen.add(e.id));
    const res = await store.setJSON(blobKey, next, prevEntry ? { onlyIfMatch: prevEntry.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return next;
  }
  return null;
}

/* 음성·단축어로 들어온 원문을 inbox 에 추가 (해석은 앱이 함). 성공 true, 옮겨진 목록이면 "moved", 겹침 실패 false */
export async function pushInbox(store, blobKey, entries, list) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prev = await store.getWithMetadata(blobKey, { type: "json" });
    if (prev && prev.data && prev.data.moved) return "moved";
    const data = (prev && prev.data) || emptyDoc();
    data.inbox = Array.isArray(data.inbox) ? data.inbox : [];
    for (const t of entries) {
      data.inbox.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: t, list, at: Date.now() });
    }
    data.updatedAt = Date.now();
    data.rev = (Number(data.rev) || 0) + 1;
    const res = await store.setJSON(blobKey, data, prev ? { onlyIfMatch: prev.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return true;
  }
  return false;
}

export const userKey = sub => `users/${sub}`;
