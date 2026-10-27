// In-memory stand-in for a Netlify Blobs store, with the same etag rules.
export class MemoryStore {
  map = new Map();
  count = 0;
  async getWithMetadata(key) {
    const x = this.map.get(key);
    return x ? structuredClone(x) : null;
  }
  async setJSON(key, data, opts = {}) {
    const old = this.map.get(key);
    if ((opts.onlyIfNew && old) || (opts.onlyIfMatch && old?.etag !== opts.onlyIfMatch)) return { modified: false };
    const etag = '"e' + ++this.count + '"';
    this.map.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  }
}
