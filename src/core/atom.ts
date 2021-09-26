type ResolveType<T> = T extends Promise<infer V> ? V : T

type Getter = {
  <Value>(atom: Atom<Value | Promise<Value>>): Value
  <Value>(atom: Atom<Promise<Value>>): Value
  <Value>(atom: Atom<Value>): ResolveType<Value>
}

type WriteGetter = Getter & {
  <Value>(atom: Atom<Value | Promise<Value>>, unstable_promise: true):
    | Promise<Value>
    | Value
  <Value>(atom: Atom<Promise<Value>>, unstable_promise: true):
    | Promise<Value>
    | Value
}

type Setter = {
  <Value, Result extends void | Promise<void>>(
    atom: WritableAtom<Value, undefined, Result>
  ): Result
  <Value, Update, Result extends void | Promise<void>>(
    atom: WritableAtom<Value, Update, Result>,
    update: Update
  ): Result
}

type Read<Value> = (get: Getter) => Value

type Write<Update, Result extends void | Promise<void>> = (
  get: WriteGetter,
  set: Setter,
  update: Update
) => Result

type WithInitialValue<Value> = {
  init: Value
}

export type Scope = symbol | string | number

// Are there better typings?
export type SetAtom<
  Update,
  Result extends void | Promise<void>
> = undefined extends Update
  ? (update?: Update) => Result
  : (update: Update) => Result

type OnUnmount = () => void
type OnMount<Update, Result extends void | Promise<void>> = <
  S extends SetAtom<Update, Result>
>(
  setAtom: S
) => OnUnmount | void

export type Atom<Value> = {
  toString: () => string
  debugLabel?: string
  /**
   * @deprecated Instead use `useAtom(atom, scope)`
   */
  scope?: Scope
  read: Read<Value>
}

export type WritableAtom<
  Value,
  Update,
  Result extends void | Promise<void> = void
> = Atom<Value> & {
  write: Write<Update, Result>
  onMount?: OnMount<Update, Result>
}

type SetStateAction<Value> = Value | ((prev: Value) => Value)

export type PrimitiveAtom<Value> = WritableAtom<Value, SetStateAction<Value>>

let keyCount = 0 // global key count for all atoms

// writable derived atom
export function atom<Value, Update, Result extends void | Promise<void> = void>(
  read: Read<Value>,
  write: Write<Update, Result>
): WritableAtom<Value, Update, Result>

// read-only derived atom
export function atom<Value>(read: Read<Value>): Atom<Value>

// invalid function in the first argument
export function atom(invalidFunction: (...args: any) => any, write?: any): never

// write-only derived atom
export function atom<Value, Update, Result extends void | Promise<void> = void>(
  initialValue: Value,
  write: Write<Update, Result>
): WritableAtom<Value, Update, Result> & WithInitialValue<Value>

// primitive atom
export function atom<Value>(
  initialValue: Value
): PrimitiveAtom<Value> & WithInitialValue<Value>

export function atom<Value, Update, Result extends void | Promise<void>>(
  read: Value | Read<Value>,
  write?: Write<Update, Result>
) {
  const key = `atom${++keyCount}`
  const config = {
    toString: () => key,
  } as WritableAtom<Value, Update, Result> & { init?: Value }
  if (typeof read === 'function') {
    config.read = read as Read<Value>
  } else {
    config.init = read
    config.read = (get) => get(config)
    config.write = (get, set, update) =>
      set(config, typeof update === 'function' ? update(get(config)) : update)
  }
  if (write) {
    config.write = write
  }
  return config
}
