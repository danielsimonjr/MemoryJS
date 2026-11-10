/** Stable bounded selection. A negative comparator result means the left item ranks first. */
export class BoundedTopK<T> {
  private readonly heap: Array<{ value: T; order: number }> = [];
  private sequence = 0;
  private readonly capacity: number;

  /** Create a selector retaining at most `limit` values in comparator order. */
  constructor(limit: number, private readonly compare: (left: T, right: T) => number) {
    this.capacity = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));
  }

  private compareEntries(left: { value: T; order: number }, right: { value: T; order: number }): number {
    return this.compare(left.value, right.value) || left.order - right.order;
  }

  /** Whether a value could enter the retained set, before doing expensive resolution. */
  wouldAccept(value: T): boolean {
    return this.capacity > 0 && (this.heap.length < this.capacity
      || this.compare(value, this.heap[0].value) < 0);
  }

  /** Consider one value, preserving insertion order when comparisons tie. */
  add(value: T): void {
    if (this.capacity === 0) return;
    const entry = { value, order: this.sequence++ };
    if (this.heap.length < this.capacity) {
      this.heap.push(entry);
      let index = this.heap.length - 1;
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (this.compareEntries(this.heap[index], this.heap[parent]) <= 0) break;
        [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
        index = parent;
      }
      return;
    }
    if (this.compareEntries(entry, this.heap[0]) >= 0) return;
    this.heap[0] = entry;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worst = index;
      if (left < this.heap.length && this.compareEntries(this.heap[left], this.heap[worst]) > 0) worst = left;
      if (right < this.heap.length && this.compareEntries(this.heap[right], this.heap[worst]) > 0) worst = right;
      if (worst === index) break;
      [this.heap[index], this.heap[worst]] = [this.heap[worst], this.heap[index]];
      index = worst;
    }
  }

  /** Return the retained values in best-first order without changing the selector. */
  sorted(): T[] {
    return [...this.heap].sort((a, b) => this.compareEntries(a, b)).map(entry => entry.value);
  }
}
