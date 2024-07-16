import type { Atom, WritableAtom } from './atom.ts'

type AnyValue = unknown
type AnyError = unknown
type AnyAtom = Atom<AnyValue>
type AnyWritableAtom = WritableAtom<AnyValue, unknown[], unknown>
type OnUnmount = () => void
type Getter = Parameters<AnyAtom['read']>[0]
type Setter = Parameters<AnyWritableAtom['write']>[1]

const hasInitialValue = <T extends Atom<AnyValue>>(
  atom: T,
): atom is T & (T extends Atom<infer Value> ? { init: Value } : never) =>
  'init' in atom

const isActuallyWritableAtom = (atom: AnyAtom): atom is AnyWritableAtom =>
  !!(atom as AnyWritableAtom).write

//
// Continuable Promise
//

const CONTINUE_PROMISE = Symbol(
  import.meta.env?.MODE !== 'production' ? 'CONTINUE_PROMISE' : '',
)

const PENDING = 'pending'
const FULFILLED = 'fulfilled'
const REJECTED = 'rejected'

type ContinuePromise<T> = (
  nextPromise: PromiseLike<T> | undefined,
  nextAbort: () => void,
) => void

type ContinuablePromise<T> = Promise<T> &
  (
    | { status: typeof PENDING }
    | { status: typeof FULFILLED; value?: T }
    | { status: typeof REJECTED; reason?: AnyError }
  ) & {
    [CONTINUE_PROMISE]: ContinuePromise<T>
  }

const isContinuablePromise = (
  promise: unknown,
): promise is ContinuablePromise<AnyValue> =>
  typeof promise === 'object' && promise !== null && CONTINUE_PROMISE in promise

const continuablePromiseMap: WeakMap<
  PromiseLike<AnyValue>,
  ContinuablePromise<AnyValue>
> = new WeakMap()

/**
 * Create a continuable promise from a regular promise.
 */
const createContinuablePromise = <T>(
  promise: PromiseLike<T>,
  abort: () => void,
  complete: () => void,
): ContinuablePromise<T> => {
  if (!continuablePromiseMap.has(promise)) {
    let continuePromise: ContinuePromise<T>
    const p: any = new Promise((resolve, reject) => {
      let curr = promise
      const onFulfilled = (me: PromiseLike<T>) => (v: T) => {
        if (curr === me) {
          p.status = FULFILLED
          p.value = v
          resolve(v)
          complete()
        }
      }
      const onRejected = (me: PromiseLike<T>) => (e: AnyError) => {
        if (curr === me) {
          p.status = REJECTED
          p.reason = e
          reject(e)
          complete()
        }
      }
      promise.then(onFulfilled(promise), onRejected(promise))
      continuePromise = (nextPromise, nextAbort) => {
        if (nextPromise) {
          continuablePromiseMap.set(nextPromise, p)
          curr = nextPromise
          nextPromise.then(onFulfilled(nextPromise), onRejected(nextPromise))

          // Only abort promises that aren't user-facing. When nextPromise is set,
          // we can replace the current promise with the next one, so we don't
          // see any abort-related errors.
          abort()
          abort = nextAbort
        }
      }
    })
    p.status = PENDING
    p[CONTINUE_PROMISE] = continuePromise!
    continuablePromiseMap.set(promise, p)
  }
  return continuablePromiseMap.get(promise) as ContinuablePromise<T>
}

const isPromiseLike = (x: unknown): x is PromiseLike<unknown> =>
  typeof (x as any)?.then === 'function'

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
  u?: OnUnmount
}

/**
 * Mutable atom state,
 * tracked for both mounted and unmounted atoms in a store.
 */
type AtomState<Value = AnyValue> = {
  /**
   * Map of atoms that the atom depends on.
   * The map value is the epoch number of the dependency.
   */
  readonly d: Map<AnyAtom, number>
  /**
   * Set of atoms with pending promise that depend on the atom.
   *
   * This may cause memory leaks, but it's for the capability to continue promises
   */
  readonly p: Set<AnyAtom>
  /** The epoch number of the atom. */
  n: number
  /** Object to store mounted state of the atom. */
  m?: Mounted // only available if the atom is mounted
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

const getPendingContinuablePromise = (atomState: AtomState) => {
  const value: unknown = atomState.v
  if (isContinuablePromise(value) && value.status === PENDING) {
    return value
  }
  return null
}

const addPendingContinuablePromiseToDependency = (
  atom: AnyAtom,
  promise: ContinuablePromise<AnyValue> & { status: typeof PENDING },
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

//
// Pending
//

type Pending = readonly [
  dependents: Map<AnyAtom, Set<AnyAtom>>,
  atomStates: Map<AnyAtom, AtomState>,
  functions: Set<() => void>,
]

const createPending = (): Pending => [new Map(), new Map(), new Set()]

const addPendingAtom = (
  pending: Pending,
  atom: AnyAtom,
  atomState: AtomState,
) => {
  if (!pending[0].has(atom)) {
    pending[0].set(atom, new Set())
  }
  pending[1].set(atom, atomState)
}

const addPendingDependent = (
  pending: Pending,
  atom: AnyAtom,
  dependent: AnyAtom,
) => {
  const dependents = pending[0].get(atom)
  if (dependents) {
    dependents.add(dependent)
  }
}

const getPendingDependents = (pending: Pending, atom: AnyAtom) =>
  pending[0].get(atom)

const addPendingFunction = (pending: Pending, fn: () => void) => {
  pending[2].add(fn)
}

const flushPending = (pending: Pending) => {
  while (pending[1].size || pending[2].size) {
    pending[0].clear()
    const atomStates = new Set(pending[1].values())
    pending[1].clear()
    const functions = new Set(pending[2])
    pending[2].clear()
    atomStates.forEach((atomState) => atomState.m?.l.forEach((l) => l()))
    functions.forEach((fn) => fn())
  }
}

type AtomStateMap = {
  get<Value>(key: Atom<Value>): AtomState<Value> | undefined
  set<Value>(key: Atom<Value>, value: AtomState<Value>): void
}

type GetAtomState = <Value>(
  atomStateMap: AtomStateMap,
  atom: Atom<Value>,
  context: unknown,
) => [atomState: AtomState<Value>, context: unknown]

// internal & unstable type
type StoreArgs = readonly [
  atomStateMap: AtomStateMap,
  getAtomState: GetAtomState,
]

// for debugging purpose only
type DevStoreRev4 = {
  dev4_get_internal_weak_map: () => AtomStateMap
  dev4_get_mounted_atoms: () => Set<AnyAtom>
  dev4_restore_atoms: (values: Iterable<readonly [AnyAtom, AnyValue]>) => void
}

type PrdStore = {
  get: <Value>(atom: Atom<Value>) => Value
  set: <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ) => Result
  sub: (atom: AnyAtom, listener: () => void) => () => void
  unstable_derive: (fn: (...args: StoreArgs) => StoreArgs) => Store
}

type Store = PrdStore | (PrdStore & DevStoreRev4)

export type INTERNAL_DevStoreRev4 = DevStoreRev4
export type INTERNAL_PrdStore = PrdStore

const buildStore = (
  atomStateMap: StoreArgs[0],
  getAtomState: StoreArgs[1],
): Store => {
  // for debugging purpose only
  let debugMountedAtoms: Set<AnyAtom>

  if (import.meta.env?.MODE !== 'production') {
    debugMountedAtoms = new Set()
  }

  const setAtomStateValueOrPromise = (
    atom: AnyAtom,
    context: unknown,
    atomState: AtomState,
    valueOrPromise: unknown,
    abortPromise = () => {},
    completePromise = () => {},
  ) => {
    const hasPrevValue = 'v' in atomState
    const prevValue = atomState.v
    const pendingPromise = getPendingContinuablePromise(atomState)
    if (isPromiseLike(valueOrPromise)) {
      if (pendingPromise) {
        if (pendingPromise !== valueOrPromise) {
          pendingPromise[CONTINUE_PROMISE](valueOrPromise, abortPromise)
          ++atomState.n
        }
      } else {
        const continuablePromise = createContinuablePromise(
          valueOrPromise,
          abortPromise,
          completePromise,
        )
        if (continuablePromise.status === PENDING) {
          for (const a of atomState.d.keys()) {
            const [aState] = getAtomState(atomStateMap, a, context)
            addPendingContinuablePromiseToDependency(
              atom,
              continuablePromise,
              aState,
            )
          }
        }
        atomState.v = continuablePromise
        delete atomState.e
      }
    } else {
      if (pendingPromise) {
        pendingPromise[CONTINUE_PROMISE](
          Promise.resolve(valueOrPromise),
          abortPromise,
        )
      }
      atomState.v = valueOrPromise
      delete atomState.e
    }
    if (!hasPrevValue || !Object.is(prevValue, atomState.v)) {
      ++atomState.n
    }
  }
  const addDependency = <Value>(
    pending: Pending | undefined,
    atom: Atom<Value>,
    context: unknown,
    a: AnyAtom,
    aState: AtomState,
  ) => {
    if (import.meta.env?.MODE !== 'production' && a === atom) {
      throw new Error('[Bug] atom cannot depend on itself')
    }
    const [atomState] = getAtomState(atomStateMap, atom, context)
    atomState.d.set(a, aState.n)
    const continuablePromise = getPendingContinuablePromise(atomState)
    if (continuablePromise) {
      addPendingContinuablePromiseToDependency(atom, continuablePromise, aState)
    }
    aState.m?.t.add(atom)
    if (pending) {
      addPendingDependent(pending, a, atom)
    }
  }

  const readAtomState = <Value>(
    pending: Pending | undefined,
    atom: Atom<Value>,
    context: unknown,
    force?: (a: AnyAtom) => boolean,
  ): AtomState<Value> => {
    const [atomState, nextContext] = getAtomState(atomStateMap, atom, context)
    // See if we can skip recomputing this atom.
    if (!force?.(atom) && isAtomStateInitialized(atomState)) {
      // If the atom is mounted, we can use the cache.
      // because it should have been updated by dependencies.
      if (atomState.m) {
        return atomState
      }
      // Otherwise, check if the dependencies have changed.
      // If all dependencies haven't changed, we can use the cache.
      if (
        Array.from(atomState.d).every(
          ([a, n]) =>
            // Recursively, read the atom state of the dependency, and
            // check if the atom epoch number is unchanged
            readAtomState(pending, a, nextContext, force).n === n,
        )
      ) {
        return atomState
      }
    }
    // Compute a new state for this atom.
    atomState.d.clear()
    let isSync = true
    const getter: Getter = <V>(a: Atom<V>) => {
      if (a === (atom as AnyAtom)) {
        const [aState] = getAtomState(atomStateMap, a, nextContext)
        if (!isAtomStateInitialized(aState)) {
          if (hasInitialValue(a)) {
            setAtomStateValueOrPromise(a, nextContext, aState, a.init)
          } else {
            // NOTE invalid derived atoms can reach here
            throw new Error('no atom init')
          }
        }
        return returnAtomValue(aState)
      }
      // a !== atom
      const aState = readAtomState(pending, a, nextContext, force)
      if (isSync) {
        addDependency(pending, atom, nextContext, a, aState)
      } else {
        const pending = createPending()
        addDependency(pending, atom, nextContext, a, aState)
        mountDependencies(pending, atom, nextContext, atomState)
        flushPending(pending)
      }
      return returnAtomValue(aState)
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
      const valueOrPromise = atom.read(getter, options as never)
      setAtomStateValueOrPromise(
        atom,
        nextContext,
        atomState,
        valueOrPromise,
        () => controller?.abort(),
        () => {
          if (atomState.m) {
            const pending = createPending()
            mountDependencies(pending, atom, nextContext, atomState)
            flushPending(pending)
          }
        },
      )
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
    returnAtomValue(readAtomState(undefined, atom, undefined))

  const recomputeDependents = (
    pending: Pending,
    atom: AnyAtom,
    context: unknown,
  ) => {
    const getDependents = (a: AnyAtom) => {
      const [aState, nextContext] = getAtomState(atomStateMap, a, context)
      const dependents = new Set(aState.m?.t)
      for (const atomWithPendingContinuablePromise of aState.p) {
        dependents.add(atomWithPendingContinuablePromise)
      }
      getPendingDependents(pending, a)?.forEach((dependent) => {
        dependents.add(dependent)
      })
      return [dependents, nextContext] as const
    }

    // This is a topological sort via depth-first search, slightly modified from
    // what's described here for simplicity and performance reasons:
    // https://en.wikipedia.org/wiki/Topological_sorting#Depth-first_search

    // Step 1: traverse the dependency graph to build the topsorted atom list
    // We don't bother to check for cycles, which simplifies the algorithm.
    const topsortedAtoms: (readonly [atom: AnyAtom, context: unknown])[] = []
    const markedAtoms = new Set<AnyAtom>()
    const visit = (n: AnyAtom) => {
      if (markedAtoms.has(n)) {
        return
      }
      markedAtoms.add(n)
      const [dependents, nextContext] = getDependents(n)
      for (const m of dependents) {
        if (n !== m) {
          visit(m)
        }
      }
      // The algorithm calls for pushing onto the front of the list. For
      // performance, we will simply push onto the end, and then will iterate in
      // reverse order later.
      topsortedAtoms.push([n, nextContext])
    }
    // Visit the root atom. This is the only atom in the dependency graph
    // without incoming edges, which is one reason we can simplify the algorithm
    visit(atom)
    // Step 2: use the topsorted atom list to recompute all affected atoms
    // Track what's changed, so that we can short circuit when possible
    const changedAtoms = new Set<AnyAtom>([atom])
    const isMarked = (a: AnyAtom) => markedAtoms.has(a)
    for (let i = topsortedAtoms.length - 1; i >= 0; --i) {
      const [a, nextContext] = topsortedAtoms[i]!
      const [aState] = getAtomState(atomStateMap, a, nextContext)
      const prevEpochNumber = aState.n
      let hasChangedDeps = false
      for (const dep of aState.d.keys()) {
        if (dep !== a && changedAtoms.has(dep)) {
          hasChangedDeps = true
          break
        }
      }
      if (hasChangedDeps) {
        readAtomState(pending, a, nextContext, isMarked)
        mountDependencies(pending, a, nextContext, aState)
        if (prevEpochNumber !== aState.n) {
          addPendingAtom(pending, a, aState)
          changedAtoms.add(a)
        }
      }
      markedAtoms.delete(a)
    }
  }

  const writeAtomState = <Value, Args extends unknown[], Result>(
    pending: Pending,
    atom: WritableAtom<Value, Args, Result>,
    context: unknown,
    ...args: Args
  ): Result => {
    const getter: Getter = <V>(a: Atom<V>) =>
      returnAtomValue(readAtomState(pending, a, context))
    const setter: Setter = <V, As extends unknown[], R>(
      a: WritableAtom<V, As, R>,
      ...args: As
    ) => {
      let r: R | undefined
      if (a === (atom as AnyAtom)) {
        if (!hasInitialValue(a)) {
          // NOTE technically possible but restricted as it may cause bugs
          throw new Error('atom not writable')
        }
        const [aState, nextContext] = getAtomState(atomStateMap, a, context)
        const hasPrevValue = 'v' in aState
        const prevValue = aState.v
        const v = args[0] as V
        setAtomStateValueOrPromise(a, nextContext, aState, v)
        mountDependencies(pending, a, nextContext, aState)
        if (!hasPrevValue || !Object.is(prevValue, aState.v)) {
          addPendingAtom(pending, a, aState)
          recomputeDependents(pending, a, nextContext)
        }
      } else {
        r = writeAtomState(pending, a, context, ...args) as R
      }
      flushPending(pending)
      return r as R
    }
    const result = atom.write(getter, setter, ...args)
    return result
  }

  const writeAtom = <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ): Result => {
    const pending = createPending()
    const result = writeAtomState(
      pending,
      atom,
      getAtomState(atomStateMap, atom, undefined)[1],
      ...args,
    )
    flushPending(pending)
    return result
  }

  const mountDependencies = (
    pending: Pending,
    atom: AnyAtom,
    context: unknown,
    atomState: AtomState,
  ) => {
    if (atomState.m && !getPendingContinuablePromise(atomState)) {
      for (const a of atomState.d.keys()) {
        if (!atomState.m.d.has(a)) {
          const aMounted = mountAtom(pending, a, context)
          aMounted.t.add(atom)
          atomState.m.d.add(a)
        }
      }
      for (const a of atomState.m.d || []) {
        if (!atomState.d.has(a)) {
          const aMounted = unmountAtom(pending, a, context)
          aMounted?.t.delete(atom)
          atomState.m.d.delete(a)
        }
      }
    }
  }

  const mountAtom = (
    pending: Pending,
    atom: AnyAtom,
    context: unknown,
  ): Mounted => {
    const [atomState, nextContext] = getAtomState(atomStateMap, atom, context)
    if (!atomState.m) {
      // recompute atom state
      readAtomState(pending, atom, nextContext)
      // mount dependencies first
      for (const a of atomState.d.keys()) {
        const aMounted = mountAtom(pending, a, nextContext)
        aMounted.t.add(atom)
      }
      // mount self
      atomState.m = {
        l: new Set(),
        d: new Set(atomState.d.keys()),
        t: new Set(),
      }
      if (import.meta.env?.MODE !== 'production') {
        debugMountedAtoms.add(atom)
      }
      if (isActuallyWritableAtom(atom) && atom.onMount) {
        const mounted = atomState.m
        const { onMount } = atom
        addPendingFunction(pending, () => {
          const onUnmount = onMount((...args) =>
            writeAtomState(pending, atom, nextContext, ...args),
          )
          if (onUnmount) {
            mounted.u = onUnmount
          }
        })
      }
    }
    return atomState.m
  }

  const unmountAtom = (
    pending: Pending,
    atom: AnyAtom,
    context: unknown,
  ): Mounted | undefined => {
    const [atomState, nextContext] = getAtomState(atomStateMap, atom, context)
    if (
      atomState.m &&
      !atomState.m.l.size &&
      !Array.from(atomState.m.t).some(
        (a) => getAtomState(atomStateMap, a, nextContext)[0].m,
      )
    ) {
      // unmount self
      const onUnmount = atomState.m.u
      if (onUnmount) {
        addPendingFunction(pending, onUnmount)
      }
      delete atomState.m
      if (import.meta.env?.MODE !== 'production') {
        debugMountedAtoms.delete(atom)
      }
      // unmount dependencies
      for (const a of atomState.d.keys()) {
        const aMounted = unmountAtom(pending, a, nextContext)
        aMounted?.t.delete(atom)
      }
      // abort pending promise
      const pendingPromise = getPendingContinuablePromise(atomState)
      if (pendingPromise) {
        // FIXME using `undefined` is kind of a hack.
        pendingPromise[CONTINUE_PROMISE](undefined, () => {})
      }
      return undefined
    }
    return atomState.m
  }

  const subscribeAtom = (atom: AnyAtom, listener: () => void) => {
    const pending = createPending()
    const mounted = mountAtom(pending, atom, undefined)
    flushPending(pending)
    const listeners = mounted.l
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      const pending = createPending()
      unmountAtom(pending, atom, undefined)
      flushPending(pending)
    }
  }

  const unstable_derive = (fn: (...args: StoreArgs) => StoreArgs) =>
    buildStore(...fn(atomStateMap, getAtomState))

  const store: Store = {
    get: readAtom,
    set: writeAtom,
    sub: subscribeAtom,
    unstable_derive,
  }
  if (import.meta.env?.MODE !== 'production') {
    const devStore: DevStoreRev4 = {
      // store dev methods (these are tentative and subject to change without notice)
      dev4_get_internal_weak_map: () => atomStateMap,
      dev4_get_mounted_atoms: () => debugMountedAtoms,
      dev4_restore_atoms: (values) => {
        const pending = createPending()
        for (const [atom, value] of values) {
          if (hasInitialValue(atom)) {
            const [aState, context] = getAtomState(
              atomStateMap,
              atom,
              undefined,
            )
            const hasPrevValue = 'v' in aState
            const prevValue = aState.v
            setAtomStateValueOrPromise(atom, context, aState, value)
            mountDependencies(pending, atom, context, aState)
            if (!hasPrevValue || !Object.is(prevValue, aState.v)) {
              addPendingAtom(pending, atom, aState)
              recomputeDependents(pending, atom, context)
            }
          }
        }
        flushPending(pending)
      },
    }
    Object.assign(store, devStore)
  }
  return store
}

export const createStore = (): Store => {
  const atomStateMap = new WeakMap() as AtomStateMap
  const getAtomState: GetAtomState = (atomStateMap, atom, context) => {
    let atomState = atomStateMap.get(atom)
    if (!atomState) {
      atomState = { d: new Map(), p: new Set(), n: 0 }
      atomStateMap.set(atom, atomState)
    }
    return [atomState, context]
  }
  return buildStore(atomStateMap, getAtomState)
}

let defaultStore: Store | undefined

export const getDefaultStore = (): Store => {
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
