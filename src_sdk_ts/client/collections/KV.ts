import { ReactiveValue } from '../ReactiveValue';
import type { CollectionContent } from './Collection';

export class KVContent<V = unknown> implements CollectionContent<Map<string, V>> {
  readonly type = 'KV' as const;
  readonly data$ = new ReactiveValue<Map<string, V>>(new Map());
  #pending = new Map<string, { op: 'set' | 'delete'; value?: V }>();

  constructor(initial?: Record<string, V>) {
    if (initial) this.data$.set(new Map(Object.entries(initial)));
  }

  get(key: string): V | undefined {
    return this.data$.value.get(key);
  }

  set(key: string, value: V): void {
    this.data$.update(m => m.set(key, value));
    this.#pending.set(key, { op: 'set', value });
  }

  delete(key: string): boolean {
    const had = this.data$.value.has(key);
    if (had) {
      this.data$.update(m => m.delete(key));
      this.#pending.set(key, { op: 'delete' });
    }
    return had;
  }

  has(key: string): boolean {
    return this.data$.value.has(key);
  }

  keys(): string[] {
    return [...this.data$.value.keys()];
  }

  serialize(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(Object.fromEntries(this.data$.value)));
  }

  //   applyPatch(patch: Record<string, V>): void {
  //     this.data$.set(new Map(Object.entries(patch)));
  //   }

  getPendingChanges() {
    return this.#pending.size ? Object.fromEntries(this.#pending) : null;
  }

  clearPending(): void {
    this.#pending.clear();
  }
}
