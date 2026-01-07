// ReactiveValue.ts
type Listener = () => void;

export class ReactiveValue<T> {
  #value: T;
  #listeners = new Set<Listener>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get value() {
    return this.#value;
  }

  set(next: T) {
    this.#value = next;
    this.#listeners.forEach(fn => fn());
  }

  /** Mutate in place and notify */
  update(fn: (v: T) => void) {
    fn(this.#value);
    this.#listeners.forEach(l => l());
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  /** React 18 useSyncExternalStore compatible */
  getSnapshot = () => this.#value;
}
