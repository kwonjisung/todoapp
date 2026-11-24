// node --test : 기기 간 합치기 규칙 확인
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeState } from "../netlify/lib/merge.mjs";

const block = src => src.slice(src.indexOf("/* MERGE-START */"), src.indexOf("/* MERGE-END */"));

test("앱(index.html)과 서버의 합치기 코드가 똑같다", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../netlify/lib/merge.mjs", import.meta.url), "utf8");
  assert.ok(block(lib).length > 200);
  assert.equal(block(html), block(lib));
});

const T = Date.now();
const it = (id, text, mt, extra = {}) => ({ id, text, mt, createdAt: mt, done: false, ...extra });
const st = (items, extra = {}) => ({ version: 5, updatedAt: T, lists: { shopping: { items, recent: [] }, todo: { items: [], recent: [] } }, deleted: {}, ...extra });
const ids = s => s.lists.shopping.items.map(i => i.id);

test("서로 다른 기기에서 추가한 항목이 둘 다 남는다", () => {
  const base = st([it("a", "우유", T - 10), it("b", "계란", T - 5)]); // 서버: 다른 기기가 b 추가
  const inc = st([it("c", "두부", T - 3), it("a", "우유", T - 10)]);  // 이 기기: c 추가 (b는 아직 모름)
  assert.deepEqual(ids(mergeState(base, inc)).sort(), ["a", "b", "c"]);
});

test("더 나중에 고친 쪽이 이긴다", () => {
  const base = st([it("a", "우유", T - 10, { done: true })]);
  const inc = st([it("a", "우유 2", T - 20)]);
  const m = mergeState(base, inc);
  assert.equal(m.lists.shopping.items[0].done, true);
  assert.equal(m.lists.shopping.items[0].text, "우유");
});

test("지운 항목은 다른 기기 데이터에 남아 있어도 되살아나지 않는다", () => {
  const base = st([it("a", "우유", T - 10), it("b", "계란", T - 10)]);
  const inc = st([it("b", "계란", T - 10)], { deleted: { a: T - 1 } });
  const m = mergeState(base, inc);
  assert.deepEqual(ids(m), ["b"]);
  assert.ok(m.deleted.a);
  // 반대 방향(서버가 지운 기록을 갖고 있음)도 같다
  assert.deepEqual(ids(mergeState(inc, base)), ["b"]);
});

test("지운 뒤에 다시 고친 항목(되돌리기)은 남는다", () => {
  const base = st([], { deleted: { a: T - 5 } });
  const inc = st([it("a", "우유", T - 1)]);
  assert.deepEqual(ids(mergeState(base, inc)), ["a"]);
});

test("오래된 지운 기록은 정리된다", () => {
  const old = T - 100 * 86400000;
  const m = mergeState(st([], { deleted: { x: old, y: T } }), st([]));
  assert.deepEqual(Object.keys(m.deleted), ["y"]);
});

test("음성 처리 기록(inboxDone)은 합쳐지고 updatedAt 은 큰 쪽", () => {
  const m = mergeState(st([], { inboxDone: ["1"], updatedAt: 5 }), st([], { inboxDone: ["2"], updatedAt: 3 }));
  assert.deepEqual(m.inboxDone, ["1", "2"]);
  assert.equal(m.updatedAt, 5);
});

test("mt 없는 예전 항목은 doneAt/createdAt 으로 비교", () => {
  const base = st([{ id: "a", text: "우유", createdAt: 1, done: true, doneAt: 100 }]);
  const inc = st([{ id: "a", text: "우유", createdAt: 1, done: false }]);
  assert.equal(mergeState(base, inc).lists.shopping.items[0].done, true);
});

test("색상 팔레트(look)는 더 나중에 고른 쪽이 이긴다", () => {
  const older = { shopping: { c: "pink", p: "dots" }, todo: { c: "blue", p: "none" }, mt: T - 100 };
  const newer = { shopping: { c: "orange", p: "grid" }, todo: { c: "navy", p: "stripe" }, mt: T - 1 };
  assert.deepEqual(mergeState(st([], { look: newer }), st([], { look: older })).look, newer); // 서버가 더 최근
  assert.deepEqual(mergeState(st([], { look: older }), st([], { look: newer })).look, newer);
  assert.deepEqual(mergeState(st([], { look: older }), st([])).look, older); // 예전 앱이 look 없이 저장해도 유지
});
