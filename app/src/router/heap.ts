/**
 * Binary min-heap of (priority, id) on typed arrays. Ties break on the smaller id, so the pop
 * order (and therefore every route) is deterministic.
 */
export class MinHeap {
  private pri: Float64Array;
  private ids: Uint32Array;
  size = 0;

  constructor(capacity = 1024) {
    this.pri = new Float64Array(capacity);
    this.ids = new Uint32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(priority: number, id: number): void {
    if (this.size === this.pri.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(priority, id, this.pri[parent]!, this.ids[parent]!)) break;
      this.pri[i] = this.pri[parent]!;
      this.ids[i] = this.ids[parent]!;
      i = parent;
    }
    this.pri[i] = priority;
    this.ids[i] = id;
  }

  /** Remove the smallest entry; returns its id. Call peekPriority() first if you need it. */
  pop(): number {
    const top = this.ids[0]!;
    const lastP = this.pri[--this.size]!;
    const lastId = this.ids[this.size]!;
    let i = 0;
    while (true) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const c = r < this.size && this.less(this.pri[r]!, this.ids[r]!, this.pri[l]!, this.ids[l]!) ? r : l;
      if (!this.less(this.pri[c]!, this.ids[c]!, lastP, lastId)) break;
      this.pri[i] = this.pri[c]!;
      this.ids[i] = this.ids[c]!;
      i = c;
    }
    this.pri[i] = lastP;
    this.ids[i] = lastId;
    return top;
  }

  peekPriority(): number {
    return this.pri[0]!;
  }

  private less(pa: number, ia: number, pb: number, ib: number): boolean {
    return pa < pb || (pa === pb && ia < ib);
  }

  private grow(): void {
    const pri = new Float64Array(this.pri.length * 2);
    const ids = new Uint32Array(this.ids.length * 2);
    pri.set(this.pri);
    ids.set(this.ids);
    this.pri = pri;
    this.ids = ids;
  }
}
