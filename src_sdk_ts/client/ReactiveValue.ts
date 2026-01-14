type Listener<T> = (value: T) => void;

export class ReactiveValue<T> {
  #value: T;
  #listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get value(): T {
    return this.#value;
  }

  set(next: T): void {
    this.#value = next;
    this.#notify();
  }

  /** Mutate in place and notify */
  update(fn: (v: T) => void): void {
    fn(this.#value);
    this.#notify();
  }

  subscribe(fn: Listener<T>): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify(): void {
    const v = this.#value;
    for (const fn of this.#listeners) {
      try {
        fn(v);
      } catch (e) {
        console.error('ReactiveValue listener error:', e);
      }
    }
  }

  /** React 18 useSyncExternalStore */
  getSnapshot = (): T => this.#value;
}
