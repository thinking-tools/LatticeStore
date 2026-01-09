import { ReactiveValue } from '../ReactiveValue';
import type { CollectionContent } from './Collection';
import type { CollectionType } from '../../shared/Consts';
import { KV_KEY_SIZE_LIMIT_BYTES } from '../../shared/Consts.js';
import { encoder, decoder } from '../../shared/Helpers.js';

export class KVContent<V = unknown> implements CollectionContent<Map<string, V>> {
  readonly type = 'KV' as CollectionType;
  readonly data$ = new ReactiveValue<Map<string, V>>(new Map());
  #pending = new Map<string, { op: 'set' | 'delete'; value?: V }>();

  constructor(initial?: Record<string, V>) {
    if (initial) this.data$.set(new Map(Object.entries(initial)));
  }
  static deserialize<V>(bytes: Uint8Array): KVContent<V> {
    if (bytes.length === 0) return new KVContent<V>();
    const obj = JSON.parse(decoder.decode(bytes));
    return new KVContent<V>(obj);
  }

  serialize(): Uint8Array {
    return encoder.encode(JSON.stringify(Object.fromEntries(this.data$.value)));
  }

  #validateKey(key: string | number): void {
    if (encoder.encode(String(key)).length > KV_KEY_SIZE_LIMIT_BYTES) {
      throw new Error(`Key exceeds ${KV_KEY_SIZE_LIMIT_BYTES} bytes`);
    }
  }

  get(key: string): V | undefined {
    return this.data$.value.get(key);
  }

  set(key: string, value: V): void {
    this.#validateKey(key);
    this.data$.update(m => m.set(key, value));
    this.#pending.set(key, { op: 'set', value });
  }

  delete(key: string): boolean {
    const had = this.data$.value.has(key);
    if (had) {
      this.data$.update(m => {
        m.delete(key);
        return m;
      });
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

  merge(remote: KVContent<V> | Record<string, V> | Map<string, V>): void {
    const remoteMap =
      remote instanceof KVContent
        ? remote.data$.value
        : remote instanceof Map
        ? remote
        : new Map(Object.entries(remote));

    this.data$.update(local => {
      const merged = new Map([...local, ...remoteMap]);

      // Reapply pending changes over merged state
      for (const [key, change] of this.#pending) {
        if (change.op === 'delete') {
          merged.delete(key);
        } else {
          merged.set(key, change.value!);
        }
      }

      return merged;
    });
  }

  /** Replace all data, clearing pending changes */
  replace(data: KVContent<V> | Record<string, V> | Map<string, V>): void {
    const newMap =
      data instanceof KVContent
        ? new Map(data.data$.value)
        : data instanceof Map
        ? new Map(data)
        : new Map(Object.entries(data));

    this.data$.set(newMap);
    this.#pending.clear();
  }

  getPendingChanges() {
    return this.#pending.size ? Object.fromEntries(this.#pending) : null;
  }

  clearPending(): void {
    this.#pending.clear();
  }
}
