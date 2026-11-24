// 두 기기에서 동시에 고쳐도 서로의 변경을 지우지 않도록 항목 단위로 합칩니다.
// 아래 MERGE-START ~ MERGE-END 부분은 public/index.html 안의 같은 표시 사이 코드와 똑같아야 합니다 (npm test 가 확인).
/* MERGE-START */
const TOMBSTONE_DAYS = 90;
const itemTime = it => Number(it && (it.mt || it.doneAt || it.createdAt)) || 0;
/* base 위에 inc 를 합침. 항목은 id 별로 더 최근에 고친 쪽(mt)이 이기고, 지운 항목(deleted 기록)은 그 뒤에 고친 게 없으면 빠짐.
   목록 순서·최근 항목·구입처 같은 나머지는 inc 쪽을 따름. */
function mergeState(base, inc) {
  if (!base || typeof base !== "object") return inc;
  if (!inc || typeof inc !== "object") return base;
  const out = { ...base, ...inc };
  const deleted = {};
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
  for (const src of [base.deleted, inc.deleted]) {
    if (!src || typeof src !== "object") continue;
    for (const [id, t] of Object.entries(src)) if (Number(t) > cutoff && !(deleted[id] >= Number(t))) deleted[id] = Number(t);
  }
  out.deleted = deleted;
  const lists = {};
  const keys = new Set([...Object.keys(base.lists || {}), ...Object.keys(inc.lists || {})]);
  for (const k of keys) {
    const bl = (base.lists || {})[k] || {}, il = (inc.lists || {})[k] || {};
    const bItems = Array.isArray(bl.items) ? bl.items : [], iItems = Array.isArray(il.items) ? il.items : [];
    const bById = new Map(bItems.filter(i => i && i.id).map(i => [i.id, i]));
    const iIds = new Set(iItems.filter(i => i && i.id).map(i => i.id));
    const pick = it => { const b = bById.get(it.id); return b && itemTime(b) > itemTime(it) ? b : it; };
    // 상대 기기에만 있는 항목(대개 새로 추가한 것)은 맨 앞에
    const items = [...bItems.filter(i => i && i.id && !iIds.has(i.id)), ...iItems.filter(i => i && i.id).map(pick)]
      .filter(i => !(deleted[i.id] >= itemTime(i)));
    lists[k] = { ...bl, ...il, items, recent: Array.isArray(il.recent) ? il.recent : (Array.isArray(bl.recent) ? bl.recent : []) };
  }
  out.lists = lists;
  const done = [...new Set([...(Array.isArray(base.inboxDone) ? base.inboxDone : []), ...(Array.isArray(inc.inboxDone) ? inc.inboxDone : [])])];
  if (done.length) out.inboxDone = done.slice(-200);
  // 색상 팔레트(look): 더 나중에 고른 쪽
  const lookT = l => Number(l && l.mt) || 0;
  if (base.look || inc.look) out.look = lookT(base.look) > lookT(inc.look) ? base.look : inc.look;
  out.updatedAt = Math.max(Number(base.updatedAt) || 0, Number(inc.updatedAt) || 0) || undefined;
  return out;
}
/* MERGE-END */
export { mergeState };
