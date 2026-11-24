// 테스트용 메모리 저장소 (Netlify Blobs 의 get / getWithMetadata / setJSON / delete 흉내)
export function memStore() {
  const m = new Map(); let n = 0;
  const clone = v => JSON.parse(JSON.stringify(v));
  return {
    m,
    async get(k) { return m.has(k) ? clone(m.get(k).v) : null; },
    async getWithMetadata(k) { return m.has(k) ? { data: clone(m.get(k).v), etag: m.get(k).etag } : null; },
    async setJSON(k, v, o = {}) {
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || m.get(k).etag !== o.onlyIfMatch)) return { modified: false };
      const etag = "e" + ++n; m.set(k, { v: clone(v), etag }); return { modified: true, etag };
    },
    async delete(k) { m.delete(k); },
  };
}
