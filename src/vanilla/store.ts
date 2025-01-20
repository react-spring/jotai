import type { Atom, WritableAtom } from './atom.ts'

type AnyValue = unknown
type AnyError = unknown
type AnyAtom = Atom<AnyValue>
type AnyWritableAtom = WritableAtom<AnyValue, unknown[], unknown>
type OnUnmount = () => void
type Getter = Parameters<AnyAtom['read']>[0]
type Setter = Parameters<AnyWritableAtom['write']>[1]
type EpochNumber = number

const isSelfAtom = (atom: AnyAtom, a: AnyAtom): boolean =>
  atom.unstable_is ? atom.unstable_is(a) : a === atom

const hasInitialValue = <T extends Atom<AnyValue>>(
  atom: T,
): atom is T & (T extends Atom<infer Value> ? { init: Value } : never) =>
  'init' in atom

const isActuallyWritableAtom = (atom: AnyAtom): atom is AnyWritableAtom =>
  !!(atom as AnyWritableAtom).write

//
// Cancelable Promise
//

type CancelHandler = (nextValue: unknown) => void
type PromiseState = [cancelHandlers: Set<CancelHandler>, settled: boolean]

const cancelablePromiseMap = new WeakMap<PromiseLike<unknown>, PromiseState>()

const isPendingPromise = (value: unknown): value is PromiseLike<unknown> =>
  isPromiseLike(value) && !cancelablePromiseMap.get(value)?.[1]

const cancelPromise = <T>(promise: PromiseLike<T>, nextValue: unknown) => {
  const promiseState = cancelablePromiseMap.get(promise)
  if (promiseState) {
    promiseState[1] = true
    promiseState[0].forEach((fn) => fn(nextValue))
  } else if (import.meta.env?.MODE !== 'production') {
    throw new Error('[Bug] cancelable promise not found')
  }
}

const patchPromiseForCancelability = <T>(promise: PromiseLike<T>) => {
  if (cancelablePromiseMap.has(promise)) {
    // already patched
    return
  }
  const promiseState: PromiseState = [new Set(), false]
  cancelablePromiseMap.set(promise, promiseState)
  const settle = () => {
    promiseState[1] = true
  }
  promise.then(settle, settle)
  ;(promise as { onCancel?: (fn: CancelHandler) => void }).onCancel = (fn) => {
    promiseState[0].add(fn)
  }
}

const isPromiseLike = (
  p: unknown,
): p is PromiseLike<unknown> & { onCancel?: (fn: CancelHandler) => void } =>
  typeof (p as any)?.then === 'function'

/**
 * State tracked for mounted atoms. An atom is considered "mounted" if it has a
 * subscriber, or is a transitive dependency of another atom that has a
 * subscriber.
 *
 * The mounted state of an atom is freed once it is no longer mounted.
 */
type Mounted = {
  /** Set of listeners to notify when the atom value changes. */
  readonly l: Set<() => void>
  /** Set of mounted atoms that the atom depends on. */
  readonly d: Set<AnyAtom>
  /** Set of mounted atoms that depends on the atom. */
  readonly t: Set<AnyAtom>
  /** Function to run when the atom is unmounted. */
  u?: () => void
}

/**
 * Mutable atom state,
 * tracked for both mounted and unmounted atoms in a store.
 *
 * This should be garbage collectable.
 * We can mutate it during atom read. (except for fields with TODO)
 */
type AtomState<Value = AnyValue> = {
  /**
   * Map of atoms that the atom depends on.
   * The map value is the epoch number of the dependency.
   */
  readonly d: Map<AnyAtom, EpochNumber>
  /**
   * Set of atoms with pending promise that depend on the atom.
   *
   * This may cause memory leaks, but it's for the capability to continue promises
   * TODO(daishi): revisit how to handle this
   */
  readonly p: Set<AnyAtom>
  /** The epoch number of the atom. */
  n: EpochNumber
  /**
   * Object to store mounted state of the atom.
   * TODO(daishi): move this out of AtomState
   */
  m?: Mounted // only available if the atom is mounted
  /**
   * Listener to notify when the atom value is updated.
   * This is an experimental API and will be changed in the next minor.
   * TODO(daishi): move this store hooks
   */
  u?: () => void
  /**
   * Listener to notify when the atom is mounted or unmounted.
   * This is an experimental API and will be changed in the next minor.
   * TODO(daishi): move this store hooks
   */
  h?: () => void
  /** Atom value */
  v?: Value
  /** Atom error */
  e?: AnyError
}

const isAtomStateInitialized = <Value>(atomState: AtomState<Value>) =>
  'v' in atomState || 'e' in atomState

const returnAtomValue = <Value>(atomState: AtomState<Value>): Value => {
  if ('e' in atomState) {
    throw atomState.e
  }
  if (import.meta.env?.MODE !== 'production' && !('v' in atomState)) {
    throw new Error('[Bug] atom state is not initialized')
  }
  return atomState.v!
}

const addPendingPromiseToDependency = (
  atom: AnyAtom,
  promise: PromiseLike<AnyValue>,
  dependencyAtomState: AtomState,
) => {
  if (!dependencyAtomState.p.has(atom)) {
    dependencyAtomState.p.add(atom)
    promise.then(
      () => {
        dependencyAtomState.p.delete(atom)
      },
      () => {
        dependencyAtomState.p.delete(atom)
      },
    )
  }
}

const addDependency = <Value>(
  atom: Atom<Value>,
  atomState: AtomState<Value>,
  a: AnyAtom,
  aState: AtomState,
) => {
  if (import.meta.env?.MODE !== 'production' && a === atom) {
    throw new Error('[Bug] atom cannot depend on itself')
  }
  atomState.d.set(a, aState.n)
  if (isPendingPromise(atomState.v)) {
    addPendingPromiseToDependency(atom, atomState.v, aState)
  }
  aState.m?.t.add(atom)
}

// internal & unstable type
type StoreArgs = readonly [
  getAtomState: <Value>(atom: Atom<Value>) => AtomState<Value> | undefined,
  setAtomState: <Value>(atom: Atom<Value>, atomState: AtomState<Value>) => void,
  atomRead: <Value>(
    atom: Atom<Value>,
    ...params: Parameters<Atom<Value>['read']>
  ) => Value,
  atomWrite: <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...params: Parameters<WritableAtom<Value, Args, Result>['write']>
  ) => Result,
  atomOnInit: <Value>(atom: Atom<Value>, store: Store) => void,
  atomOnMount: <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    setAtom: (...args: Args) => Result,
  ) => OnUnmount | void,
]

// for debugging purpose only
type DevStoreRev4 = {
  dev4_get_internal_weak_map: () => {
    get: (atom: AnyAtom) => AtomState | undefined
  }
  dev4_get_mounted_atoms: () => Set<AnyAtom>
  dev4_restore_atoms: (values: Iterable<readonly [AnyAtom, AnyValue]>) => void
}

type Store = {
  get: <Value>(atom: Atom<Value>) => Value
  set: <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ) => Result
  sub: (atom: AnyAtom, listener: () => void) => () => void
  unstable_derive: (fn: (...args: StoreArgs) => StoreArgs) => Store
}

export type INTERNAL_DevStoreRev4 = DevStoreRev4
export type INTERNAL_PrdStore = Store

/**
 * This is an experimental API and will be changed in the next minor.
 */
const INTERNAL_flushStoreHook = Symbol.for('JOTAI.EXPERIMENTAL.FLUSHSTOREHOOK')

const buildStore = (...storeArgs: StoreArgs): Store => {
  const [
    getAtomState,
    setAtomState,
    atomRead,
    atomWrite,
    atomOnInit,
    atomOnMount,
  ] = storeArgs
  const ensureAtomState = <Value>(atom: Atom<Value>) => {
    if (import.meta.env?.MODE !== 'production' && !atom) {
      throw new Error('Atom is undefined or null')
    }
    let atomState = getAtomState(atom)
    if (!atomState) {
      atomState = { d: new Map(), p: new Set(), n: 0 }
      setAtomState(atom, atomState)
      atomOnInit?.(atom, store)
    }
    return atomState
  }

  // These are store state.
  // As they are not garbage collectable, they shouldn't be mutated during atom read.
  const invalidatedAtoms = new WeakMap<AnyAtom, EpochNumber>()
  const changedAtoms = new Map<AnyAtom, AtomState>()
  const unmountCallbacks = new Set<() => void>()
  const mountCallbacks = new Set<() => void>()

  const flushCallbacks = () => {
    const errors: unknown[] = []
    const call = (fn: () => void) => {
      try {
        fn()
      } catch (e) {
        errors.push(e)
      }
    }
    do {
      ;(store as any)[INTERNAL_flushStoreHook]?.()
      const callbacks = new Set<() => void>()
      const add = callbacks.add.bind(callbacks)
      changedAtoms.forEach((atomState) => atomState.m?.l.forEach(add))
      changedAtoms.clear()
      unmountCallbacks.forEach(add)
      unmountCallbacks.clear()
      mountCallbacks.forEach(add)
      mountCallbacks.clear()
      callbacks.forEach(call)
      if (changedAtoms.size) {
        recomputeInvalidatedAtoms()
      }
    } while (changedAtoms.size || unmountCallbacks.size || mountCallbacks.size)
    if (errors.length) {
      throw errors[0]
    }
  }

  const setAtomStateValueOrPromise = (
    atom: AnyAtom,
    atomState: AtomState,
    valueOrPromise: unknown,
  ) => {
    const hasPrevValue = 'v' in atomState
    const prevValue = atomState.v
    const pendingPromise = isPendingPromise(atomState.v) ? atomState.v : null
    if (isPromiseLike(valueOrPromise)) {
      patchPromiseForCancelability(valueOrPromise)
      for (const a of atomState.d.keys()) {
        addPendingPromiseToDependency(atom, valueOrPromise, ensureAtomState(a))
      }
      atomState.v = valueOrPromise
    } else {
      atomState.v = valueOrPromise
    }
    delete atomState.e
    if (!hasPrevValue || !Object.is(prevValue, atomState.v)) {
      ++atomState.n
      if (pendingPromise) {
        cancelPromise(pendingPromise, valueOrPromise)
      }
    }
  }

  const readAtomState = <Value>(atom: Atom<Value>): AtomState<Value> => {
    const atomState = ensureAtomState(atom)
    // See if we can skip recomputing this atom.
    if (isAtomStateInitialized(atomState)) {
      // If the atom is mounted, we can use cached atom state.
      // because it should have been updated by dependencies.
      // We can't use the cache if the atom is invalidated.
      if (atomState.m && invalidatedAtoms.get(atom) !== atomState.n) {
        return atomState
      }
      // Otherwise, check if the dependencies have changed.
      // If all dependencies haven't changed, we can use the cache.
      if (
        Array.from(atomState.d).every(
          ([a, n]) =>
            // Recursively, read the atom state of the dependency, and
            // check if the atom epoch number is unchanged
            readAtomState(a).n === n,
        )
      ) {
        return atomState
      }
    }
    // Compute a new state for this atom.
    atomState.d.clear()
    let isSync = true
    const mountDependenciesIfAsync = () => {
      if (atomState.m) {
        mountDependencies(atom, atomState)
        flushCallbacks()
      }
    }
    const getter: Getter = <V>(a: Atom<V>) => {
      if (isSelfAtom(atom, a)) {
        const aState = ensureAtomState(a)
        if (!isAtomStateInitialized(aState)) {
          if (hasInitialValue(a)) {
            setAtomStateValueOrPromise(a, aState, a.init)
          } else {
            // NOTE invalid derived atoms can reach here
            throw new Error('no atom init')
          }
        }
        return returnAtomValue(aState)
      }
      // a !== atom
      const aState = readAtomState(a)
      try {
        return returnAtomValue(aState)
      } finally {
        addDependency(atom, atomState, a, aState)
        if (!isSync) {
          mountDependenciesIfAsync()
        }
      }
    }
    let controller: AbortController | undefined
    let setSelf: ((...args: unknown[]) => unknown) | undefined
    const options = {
      get signal() {
        if (!controller) {
          controller = new AbortController()
        }
        return controller.signal
      },
      get setSelf() {
        if (
          import.meta.env?.MODE !== 'production' &&
          !isActuallyWritableAtom(atom)
        ) {
          console.warn('setSelf function cannot be used with read-only atom')
        }
        if (!setSelf && isActuallyWritableAtom(atom)) {
          setSelf = (...args) => {
            if (import.meta.env?.MODE !== 'production' && isSync) {
              console.warn('setSelf function cannot be called in sync')
            }
            if (!isSync) {
              return writeAtom(atom, ...args)
            }
          }
        }
        return setSelf
      },
    }
    try {
      const valueOrPromise = atomRead(atom, getter, options as never)
      setAtomStateValueOrPromise(atom, atomState, valueOrPromise)
      if (isPromiseLike(valueOrPromise)) {
        valueOrPromise.onCancel?.(() => controller?.abort())
        valueOrPromise.then(mountDependenciesIfAsync, mountDependenciesIfAsync)
      }
      return atomState
    } catch (error) {
      delete atomState.v
      atomState.e = error
      ++atomState.n
      return atomState
    } finally {
      isSync = false
    }
  }

  const readAtom = <Value>(atom: Atom<Value>): Value =>
    returnAtomValue(readAtomState(atom))

  const getMountedOrPendingDependents = <Value>(
    atomState: AtomState<Value>,
  ): Map<AnyAtom, AtomState> => {
    const dependents = new Map<AnyAtom, AtomState>()
    for (const a of atomState.m?.t || []) {
      const aState = ensureAtomState(a)
      if (aState.m) {
        dependents.set(a, aState)
      }
    }
    for (const atomWithPendingPromise of atomState.p) {
      dependents.set(
        atomWithPendingPromise,
        ensureAtomState(atomWithPendingPromise),
      )
    }
    return dependents
  }

  const invalidateDependents = (atomState: AtomState) => {
    const stack: AtomState[] = [atomState]
    while (stack.length) {
      const aState = stack.pop()!
      for (const [d, s] of getMountedOrPendingDependents(aState)) {
        if (!invalidatedAtoms.has(d)) {
          invalidatedAtoms.set(d, s.n)
          stack.push(s)
        }
      }
    }
  }

  const recomputeInvalidatedAtoms = () => {
    // Step 1: traverse the dependency graph to build the topsorted atom list
    // We don't bother to check for cycles, which simplifies the algorithm.
    // This is a topological sort via depth-first search, slightly modified from
    // what's described here for simplicity and performance reasons:
    // https://en.wikipedia.org/wiki/Topological_sorting#Depth-first_search
    const topSortedReversed: [
      atom: AnyAtom,
      atomState: AtomState,
      epochNumber: EpochNumber,
    ][] = []
    const visiting = new WeakSet<AnyAtom>()
    const visited = new WeakSet<AnyAtom>()
    // Visit the root atom. This is the only atom in the dependency graph
    // without incoming edges, which is one reason we can simplify the algorithm
    const stack: [a: AnyAtom, aState: AtomState][] = Array.from(changedAtoms)
    while (stack.length) {
      const [a, aState] = stack[stack.length - 1]!
      if (visited.has(a)) {
        // All dependents have been processed, now process this atom
        stack.pop()
        continue
      }
      if (visiting.has(a)) {
        // The algorithm calls for pushing onto the front of the list. For
        // performance, we will simply push onto the end, and then will iterate in
        // reverse order later.
        if (invalidatedAtoms.get(a) === aState.n) {
          topSortedReversed.push([a, aState, aState.n])
        } else {
          invalidatedAtoms.delete(a)
          changedAtoms.set(a, aState)
        }
        // Atom has been visited but not yet processed
        visited.add(a)
        stack.pop()
        continue
      }
      visiting.add(a)
      // Push unvisited dependents onto the stack
      for (const [d, s] of getMountedOrPendingDependents(aState)) {
        if (!visiting.has(d)) {
          stack.push([d, s])
        }
      }
    }

    // Step 2: use the topSortedReversed atom list to recompute all affected atoms
    // Track what's changed, so that we can short circuit when possible
    for (let i = topSortedReversed.length - 1; i >= 0; --i) {
      const [a, aState, prevEpochNumber] = topSortedReversed[i]!
      let hasChangedDeps = false
      for (const dep of aState.d.keys()) {
        if (dep !== a && changedAtoms.has(dep)) {
          hasChangedDeps = true
          break
        }
      }
      if (hasChangedDeps) {
        readAtomState(a)
        mountDependencies(a, aState)
        if (prevEpochNumber !== aState.n) {
          changedAtoms.set(a, aState)
          aState.u?.()
        }
      }
      invalidatedAtoms.delete(a)
    }
  }

  const writeAtomState = <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ): Result => {
    let isSync = true
    const getter: Getter = <V>(a: Atom<V>) => returnAtomValue(readAtomState(a))
    const setter: Setter = <V, As extends unknown[], R>(
      a: WritableAtom<V, As, R>,
      ...args: As
    ) => {
      const aState = ensureAtomState(a)
      try {
        if (isSelfAtom(atom, a)) {
          if (!hasInitialValue(a)) {
            // NOTE technically possible but restricted as it may cause bugs
            throw new Error('atom not writable')
          }
          const prevEpochNumber = aState.n
          const v = args[0] as V
          setAtomStateValueOrPromise(a, aState, v)
          mountDependencies(a, aState)
          if (prevEpochNumber !== aState.n) {
            changedAtoms.set(a, aState)
            aState.u?.()
            invalidateDependents(aState)
          }
          return undefined as R
        } else {
          return writeAtomState(a, ...args)
        }
      } finally {
        if (!isSync) {
          recomputeInvalidatedAtoms()
          flushCallbacks()
        }
      }
    }
    try {
      return atomWrite(atom, getter, setter, ...args)
    } finally {
      isSync = false
    }
  }

  const writeAtom = <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ): Result => {
    try {
      return writeAtomState(atom, ...args)
    } finally {
      recomputeInvalidatedAtoms()
      flushCallbacks()
    }
  }

  const mountDependencies = (atom: AnyAtom, atomState: AtomState) => {
    if (atomState.m && !isPendingPromise(atomState.v)) {
      for (const [a, n] of atomState.d) {
        if (!atomState.m.d.has(a)) {
          const aState = ensureAtomState(a)
          const aMounted = mountAtom(a, aState)
          aMounted.t.add(atom)
          atomState.m.d.add(a)
          if (n !== aState.n) {
            changedAtoms.set(a, aState)
            aState.u?.()
            invalidateDependents(aState)
          }
        }
      }
      for (const a of atomState.m.d || []) {
        if (!atomState.d.has(a)) {
          atomState.m.d.delete(a)
          const aMounted = unmountAtom(a, ensureAtomState(a))
          aMounted?.t.delete(atom)
        }
      }
    }
  }

  const mountAtom = <Value>(
    atom: Atom<Value>,
    atomState: AtomState<Value>,
  ): Mounted => {
    if (!atomState.m) {
      // recompute atom state
      readAtomState(atom)
      // mount dependencies first
      for (const a of atomState.d.keys()) {
        const aMounted = mountAtom(a, ensureAtomState(a))
        aMounted.t.add(atom)
      }
      // mount self
      atomState.m = {
        l: new Set(),
        d: new Set(atomState.d.keys()),
        t: new Set(),
      }
      atomState.h?.()
      if (isActuallyWritableAtom(atom)) {
        const mounted = atomState.m
        const processOnMount = () => {
          let isSync = true
          const setAtom = (...args: unknown[]) => {
            try {
              return writeAtomState(atom, ...args)
            } finally {
              if (!isSync) {
                recomputeInvalidatedAtoms()
                flushCallbacks()
              }
            }
          }
          try {
            const onUnmount = atomOnMount(atom, setAtom)
            if (onUnmount) {
              mounted.u = () => {
                isSync = true
                try {
                  onUnmount()
                } finally {
                  isSync = false
                }
              }
            }
          } finally {
            isSync = false
          }
        }
        mountCallbacks.add(processOnMount)
      }
    }
    return atomState.m
  }

  const unmountAtom = <Value>(
    atom: Atom<Value>,
    atomState: AtomState<Value>,
  ): Mounted | undefined => {
    if (
      atomState.m &&
      !atomState.m.l.size &&
      !Array.from(atomState.m.t).some((a) => ensureAtomState(a).m?.d.has(atom))
    ) {
      // unmount self
      const onUnmount = atomState.m.u
      if (onUnmount) {
        unmountCallbacks.add(onUnmount)
      }
      delete atomState.m
      atomState.h?.()
      // unmount dependencies
      for (const a of atomState.d.keys()) {
        const aMounted = unmountAtom(a, ensureAtomState(a))
        aMounted?.t.delete(atom)
      }
      return undefined
    }
    return atomState.m
  }

  const subscribeAtom = (atom: AnyAtom, listener: () => void) => {
    const atomState = ensureAtomState(atom)
    const mounted = mountAtom(atom, atomState)
    const listeners = mounted.l
    listeners.add(listener)
    flushCallbacks()
    return () => {
      listeners.delete(listener)
      unmountAtom(atom, atomState)
      flushCallbacks()
    }
  }

  const unstable_derive: Store['unstable_derive'] = (fn) =>
    buildStore(...fn(...storeArgs))

  const store: Store = {
    get: readAtom,
    set: writeAtom,
    sub: subscribeAtom,
    unstable_derive,
  }
  return store
}

const deriveDevStoreRev4 = (store: Store): Store & DevStoreRev4 => {
  const debugMountedAtoms = new Set<AnyAtom>()
  let savedGetAtomState: StoreArgs[0]
  let inRestoreAtom = 0
  const derivedStore = store.unstable_derive((...storeArgs: [...StoreArgs]) => {
    const [getAtomState, setAtomState, , atomWrite] = storeArgs
    savedGetAtomState = getAtomState
    storeArgs[1] = function devSetAtomState(atom, atomState) {
      setAtomState(atom, atomState)
      const originalMounted = atomState.h
      atomState.h = () => {
        originalMounted?.()
        if (atomState.m) {
          debugMountedAtoms.add(atom)
        } else {
          debugMountedAtoms.delete(atom)
        }
      }
    }
    storeArgs[3] = function devAtomWrite(atom, getter, setter, ...args) {
      if (inRestoreAtom) {
        return setter(atom, ...args)
      }
      return atomWrite(atom, getter, setter, ...args)
    }
    return storeArgs
  })
  const savedStoreSet = derivedStore.set
  const devStore: DevStoreRev4 = {
    // store dev methods (these are tentative and subject to change without notice)
    dev4_get_internal_weak_map: () => ({
      get: (atom) => {
        const atomState = savedGetAtomState(atom)
        if (!atomState || atomState.n === 0) {
          // for backward compatibility
          return undefined
        }
        return atomState
      },
    }),
    dev4_get_mounted_atoms: () => debugMountedAtoms,
    dev4_restore_atoms: (values) => {
      const restoreAtom: WritableAtom<null, [], void> = {
        read: () => null,
        write: (_get, set) => {
          ++inRestoreAtom
          try {
            for (const [atom, value] of values) {
              if (hasInitialValue(atom)) {
                set(atom as never, value)
              }
            }
          } finally {
            --inRestoreAtom
          }
        },
      }
      savedStoreSet(restoreAtom)
    },
  }
  return Object.assign(derivedStore, devStore)
}

type PrdOrDevStore = Store | (Store & DevStoreRev4)

export const createStore = (): PrdOrDevStore => {
  const atomStateMap = new WeakMap()
  const store = buildStore(
    (atom) => atomStateMap.get(atom),
    (atom, atomState) => atomStateMap.set(atom, atomState).get(atom),
    (atom, ...params) => atom.read(...params),
    (atom, ...params) => atom.write(...params),
    (atom, ...params) => atom.unstable_onInit?.(...params),
    (atom, ...params) => atom.onMount?.(...params),
  )
  if (import.meta.env?.MODE !== 'production') {
    return deriveDevStoreRev4(store)
  }
  return store
}

let defaultStore: PrdOrDevStore | undefined

export const getDefaultStore = (): PrdOrDevStore => {
  if (!defaultStore) {
    defaultStore = createStore()
    if (import.meta.env?.MODE !== 'production') {
      ;(globalThis as any).__JOTAI_DEFAULT_STORE__ ||= defaultStore
      if ((globalThis as any).__JOTAI_DEFAULT_STORE__ !== defaultStore) {
        console.warn(
          'Detected multiple Jotai instances. It may cause unexpected behavior with the default store. https://github.com/pmndrs/jotai/discussions/2044',
        )
      }
    }
  }
  return defaultStore
}
