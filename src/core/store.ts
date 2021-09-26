import type { Atom, WritableAtom } from './atom'

type AnyAtom = Atom<unknown>
type AnyWritableAtom = WritableAtom<unknown, unknown>
type OnUnmount = () => void
type NonPromise<T> = T extends Promise<infer V> ? V : T
type WriteGetter = Parameters<WritableAtom<unknown, unknown>['write']>[0]
type Setter = Parameters<WritableAtom<unknown, unknown>['write']>[1]

const hasInitialValue = <T extends Atom<unknown>>(
  atom: T
): atom is T & (T extends Atom<infer Value> ? { init: Value } : never) =>
  'init' in atom

const IS_EQUAL_PROMISE = Symbol()
const INTERRUPT_PROMISE = Symbol()
type InterruptablePromise = Promise<void> & {
  [IS_EQUAL_PROMISE]: (p: Promise<void>) => boolean
  [INTERRUPT_PROMISE]: () => void
}

const isInterruptablePromise = (
  promise: Promise<void>
): promise is InterruptablePromise =>
  !!(promise as InterruptablePromise)[INTERRUPT_PROMISE]

const createInterruptablePromise = (
  promise: Promise<void>
): InterruptablePromise => {
  let interrupt: (() => void) | undefined
  const interruptablePromise = new Promise<void>((resolve, reject) => {
    interrupt = resolve
    promise.then(resolve, reject)
  }) as InterruptablePromise
  interruptablePromise[IS_EQUAL_PROMISE] = (p: Promise<void>): boolean =>
    interruptablePromise === p ||
    promise === p ||
    (isInterruptablePromise(promise) && promise[IS_EQUAL_PROMISE](p))
  interruptablePromise[INTERRUPT_PROMISE] = interrupt as () => void
  return interruptablePromise
}

type Revision = number
type InvalidatedRevision = number
type ReadDependencies = Map<AnyAtom, Revision>

// immutable atom state
export type AtomState<Value = unknown> = {
  e?: unknown // read error
  p?: InterruptablePromise // read promise
  c?: () => void // cancel read promise
  w?: Promise<void> // write promise
  v?: NonPromise<Value>
  r: Revision
  i?: InvalidatedRevision
  d: ReadDependencies
}

type Listeners = Set<() => void>
type Dependents = Set<AnyAtom>
type Mounted = {
  l: Listeners
  d: Dependents
  u: OnUnmount | void
}

// for debugging purpose only
type StateListener = (updatedAtom: AnyAtom, isNewAtom: boolean) => void
type MountedAtoms = Set<AnyAtom>

// store methods
export const READ_ATOM = 'r'
export const WRITE_ATOM = 'w'
export const COMMIT_ATOM = 'c'
export const SUBSCRIBE_ATOM = 's'
export const RESTORE_ATOMS = 'h'

// store dev methods (these are tentative and subject to change)
export const DEV_SUBSCRIBE_STATE = 'n'
export const DEV_GET_MOUNTED_ATOMS = 'l'
export const DEV_GET_ATOM_STATE = 'a'
export const DEV_GET_MOUNTED = 'm'

export const createStore = (
  initialValues?: Iterable<readonly [AnyAtom, unknown]>
) => {
  const atomStateMap = new WeakMap<AnyAtom, AtomState>()
  const mountedMap = new WeakMap<AnyAtom, Mounted>()
  const pendingMap = new Map<
    AnyAtom,
    [dependencies: ReadDependencies | undefined, isNewAtom: boolean]
  >()
  let stateListeners: Set<StateListener>
  let mountedAtoms: MountedAtoms
  if (typeof process === 'object' && process.env.NODE_ENV !== 'production') {
    stateListeners = new Set()
    mountedAtoms = new Set()
  }

  if (initialValues) {
    for (const [atom, value] of initialValues) {
      const atomState: AtomState = { v: value, r: 0, d: new Map() }
      if (
        typeof process === 'object' &&
        process.env.NODE_ENV !== 'production'
      ) {
        Object.freeze(atomState)
        if (!hasInitialValue(atom)) {
          console.warn(
            'Found initial value for derived atom which can cause unexpected behavior',
            atom
          )
        }
      }
      atomStateMap.set(atom, atomState)
    }
  }

  const getAtomState = <Value>(atom: Atom<Value>) =>
    atomStateMap.get(atom) as AtomState<Value> | undefined

  const setAtomState = <Value>(
    atom: Atom<Value>,
    atomState: AtomState<Value>,
    prevDependencies?: ReadDependencies
  ): void => {
    if (typeof process === 'object' && process.env.NODE_ENV !== 'production') {
      Object.freeze(atomState)
    }
    const isNewAtom = !atomStateMap.has(atom)
    atomStateMap.set(atom, atomState)
    if (!pendingMap.has(atom)) {
      pendingMap.set(atom, [prevDependencies, isNewAtom])
    }
  }

  const prepareNextAtomState = <Value>(
    atom: Atom<Value>,
    dependencies?: Set<AnyAtom>
  ): [AtomState<Value>, ReadDependencies] => {
    const atomState = getAtomState(atom)
    const nextAtomState = {
      r: 0,
      ...atomState,
      d: dependencies
        ? new Map(
            Array.from(dependencies).map((a) => [a, getAtomState(a)?.r ?? 0])
          )
        : atomState?.d || new Map(),
    }
    return [nextAtomState, atomState?.d || new Map()]
  }

  const setAtomValue = <Value>(
    atom: Atom<Value>,
    value: NonPromise<Value>,
    dependencies?: Set<AnyAtom>,
    promise?: Promise<void>
  ): void => {
    const [atomState, prevDependencies] = prepareNextAtomState(
      atom,
      dependencies
    )
    if (promise && !atomState.p?.[IS_EQUAL_PROMISE](promise)) {
      // newer async read is running, not updating
      return
    }
    atomState.c?.() // cancel read promise
    delete atomState.e // read error
    delete atomState.p // read promise
    delete atomState.c // cancel read promise
    delete atomState.i // invalidated revision
    if (!('v' in atomState) || !Object.is(atomState.v, value)) {
      atomState.v = value
      ++atomState.r // increment revision
      if (atomState.d.has(atom)) {
        atomState.d.set(atom, atomState.r)
      }
    }
    setAtomState(atom, atomState, dependencies && prevDependencies)
  }

  const setAtomReadError = <Value>(
    atom: Atom<Value>,
    error: unknown,
    dependencies?: Set<AnyAtom>,
    promise?: Promise<void>
  ): void => {
    const [atomState, prevDependencies] = prepareNextAtomState(
      atom,
      dependencies
    )
    if (promise && !atomState.p?.[IS_EQUAL_PROMISE](promise)) {
      // newer async read is running, not updating
      return
    }
    atomState.c?.() // cancel read promise
    delete atomState.p // read promise
    delete atomState.c // cancel read promise
    delete atomState.i // invalidated revision
    atomState.e = error // read error
    setAtomState(atom, atomState, prevDependencies)
  }

  const setAtomReadPromise = <Value>(
    atom: Atom<Value>,
    promise: Promise<void>,
    dependencies?: Set<AnyAtom>
  ): void => {
    const [atomState, prevDependencies] = prepareNextAtomState(
      atom,
      dependencies
    )
    if (atomState.p?.[IS_EQUAL_PROMISE](promise)) {
      // the same promise, not updating
      return
    }
    atomState.c?.() // cancel read promise
    delete atomState.e // read error
    const interruptablePromise = createInterruptablePromise(promise)
    atomState.p = interruptablePromise // read promise
    atomState.c = interruptablePromise[INTERRUPT_PROMISE]
    setAtomState(atom, atomState, prevDependencies)
  }

  const setAtomInvalidated = <Value>(atom: Atom<Value>): void => {
    const [atomState] = prepareNextAtomState(atom)
    atomState.i = atomState.r // invalidated revision
    setAtomState(atom, atomState)
  }

  const setAtomWritePromise = <Value>(
    atom: Atom<Value>,
    promise: Promise<void> | null,
    prevPromise?: Promise<void>
  ): void => {
    const [atomState] = prepareNextAtomState(atom)
    if (promise) {
      atomState.w = promise
    } else if (atomState.w === prevPromise) {
      // delete it only if it's not overwritten
      delete atomState.w // write promise
    }
    setAtomState(atom, atomState)
  }

  const scheduleReadAtomState = <Value>(
    atom: Atom<Value>,
    promise: Promise<unknown>
  ): void => {
    promise.finally(() => {
      readAtomState(atom, true)
    })
  }

  const readAtomState = <Value>(
    atom: Atom<Value>,
    force?: boolean
  ): AtomState<Value> => {
    if (!force) {
      const atomState = getAtomState(atom)
      if (atomState) {
        atomState.d.forEach((_, a) => {
          if (a !== atom) {
            const aState = getAtomState(a)
            if (
              aState &&
              !('e' in aState) && // no read error
              !aState.p && // no read promise
              aState.r === aState.i // revision is invalidated
            ) {
              readAtomState(a, true)
            }
          }
        })
        if (
          Array.from(atomState.d.entries()).every(([a, r]) => {
            const aState = getAtomState(a)
            return (
              aState &&
              !('e' in aState) && // no read error
              !aState.p && // no read promise
              aState.r !== aState.i && // revision is not invalidated
              aState.r === r // revision is equal to the last one
            )
          })
        ) {
          return atomState
        }
      }
    }
    let error: unknown | undefined
    let promise: Promise<void> | undefined
    let value: NonPromise<Value> | undefined
    const dependencies = new Set<AnyAtom>()
    try {
      const promiseOrValue = atom.read((a: AnyAtom) => {
        dependencies.add(a)
        const aState = a === atom ? getAtomState(a) : readAtomState(a)
        if (aState) {
          if ('e' in aState) {
            throw aState.e // read error
          }
          if (aState.p) {
            throw aState.p // read promise
          }
          return aState.v // value
        }
        if (hasInitialValue(a)) {
          return a.init
        }
        // NOTE invalid derived atoms can reach here
        throw new Error('no atom init')
      })
      if (promiseOrValue instanceof Promise) {
        promise = promiseOrValue
          .then((value) => {
            setAtomValue(
              atom,
              value as NonPromise<Value>,
              dependencies,
              promise as Promise<void>
            )
            flushPending()
          })
          .catch((e) => {
            if (e instanceof Promise) {
              scheduleReadAtomState(atom, e)
              return e
            }
            setAtomReadError(atom, e, dependencies, promise as Promise<void>)
            flushPending()
          })
      } else {
        value = promiseOrValue as NonPromise<Value>
      }
    } catch (errorOrPromise) {
      if (errorOrPromise instanceof Promise) {
        promise = errorOrPromise
      } else {
        error = errorOrPromise
      }
    }
    if (error) {
      setAtomReadError(atom, error, dependencies)
    } else if (promise) {
      setAtomReadPromise(atom, promise, dependencies)
    } else {
      setAtomValue(atom, value as NonPromise<Value>, dependencies)
    }
    return getAtomState(atom) as AtomState<Value>
  }

  const readAtom = <Value>(readingAtom: Atom<Value>): AtomState<Value> => {
    const atomState = readAtomState(readingAtom)
    return atomState
  }

  const addAtom = (addingAtom: AnyAtom): Mounted => {
    let mounted = mountedMap.get(addingAtom)
    if (!mounted) {
      mounted = mountAtom(addingAtom)
    }
    return mounted
  }

  // FIXME doesn't work with mutally dependent atoms
  const canUnmountAtom = (atom: AnyAtom, mounted: Mounted) =>
    !mounted.l.size &&
    (!mounted.d.size || (mounted.d.size === 1 && mounted.d.has(atom)))

  const delAtom = (deletingAtom: AnyAtom): void => {
    const mounted = mountedMap.get(deletingAtom)
    if (mounted && canUnmountAtom(deletingAtom, mounted)) {
      unmountAtom(deletingAtom)
    }
  }

  const invalidateDependents = <Value>(atom: Atom<Value>): void => {
    const mounted = mountedMap.get(atom)
    mounted?.d.forEach((dependent) => {
      if (dependent === atom) {
        return
      }
      setAtomInvalidated(dependent)
      invalidateDependents(dependent)
    })
  }

  const writeAtomState = <Value, Update>(
    atom: WritableAtom<Value, Update>,
    update: Update
  ): void | Promise<void> => {
    const writeGetter: WriteGetter = (
      a: AnyAtom,
      unstable_promise: boolean = false
    ) => {
      const aState = readAtomState(a)
      if ('e' in aState) {
        throw aState.e // read error
      }
      if (aState.p) {
        if (
          typeof process === 'object' &&
          process.env.NODE_ENV !== 'production'
        ) {
          if (unstable_promise) {
            console.info(
              'promise option in getter is an experimental feature.',
              a
            )
          } else {
            console.warn(
              'Reading pending atom state in write operation. We throw a promise for now.',
              a
            )
          }
        }
        if (unstable_promise) {
          return aState.p.then(() => writeGetter(a, unstable_promise))
        }
        throw aState.p // read promise
      }
      if ('v' in aState) {
        return aState.v // value
      }
      if (
        typeof process === 'object' &&
        process.env.NODE_ENV !== 'production'
      ) {
        console.warn(
          '[Bug] no value found while reading atom in write operation. This is probably a bug.',
          a
        )
      }
      throw new Error('no value found')
    }
    const setter: Setter = <V, U>(a: WritableAtom<V, U>, v?: V) => {
      let promiseOrVoid: void | Promise<void>
      if ((a as AnyWritableAtom) === atom) {
        if (!hasInitialValue(a)) {
          // NOTE technically possible but restricted as it may cause bugs
          throw new Error('no atom init')
        }
        if (v instanceof Promise) {
          promiseOrVoid = v
            .then((resolvedValue) => {
              setAtomValue(a, resolvedValue)
              invalidateDependents(a)
              flushPending()
            })
            .catch((e) => {
              setAtomReadError(atom, e)
              flushPending()
            })
          setAtomReadPromise(atom, promiseOrVoid)
        } else {
          setAtomValue(a, v as NonPromise<V>)
        }
        invalidateDependents(a)
        flushPending()
      } else {
        promiseOrVoid = writeAtomState(a as AnyWritableAtom, v)
      }
      return promiseOrVoid
    }
    const promiseOrVoid = atom.write(writeGetter, setter, update)
    if (promiseOrVoid instanceof Promise) {
      const promise = promiseOrVoid.finally(() => {
        setAtomWritePromise(atom, null, promise)
        flushPending()
      })
      setAtomWritePromise(atom, promise)
    }
    flushPending()
    return promiseOrVoid
  }

  const writeAtom = <Value, Update>(
    writingAtom: WritableAtom<Value, Update>,
    update: Update
  ): void | Promise<void> => {
    const promiseOrVoid = writeAtomState(writingAtom, update)
    return promiseOrVoid
  }

  const isActuallyWritableAtom = (atom: AnyAtom): atom is AnyWritableAtom =>
    !!(atom as AnyWritableAtom).write

  const mountAtom = <Value>(
    atom: Atom<Value>,
    initialDependent?: AnyAtom
  ): Mounted => {
    const atomState = readAtomState(atom)
    // mount read dependencies beforehand
    atomState.d.forEach((_, a) => {
      if (a !== atom) {
        const aMounted = mountedMap.get(a)
        if (aMounted) {
          aMounted.d.add(atom) // add dependent
        } else {
          mountAtom(a, atom)
        }
      }
    })
    // mount self
    const mounted: Mounted = {
      d: new Set(initialDependent && [initialDependent]),
      l: new Set(),
      u: undefined,
    }
    mountedMap.set(atom, mounted)
    if (typeof process === 'object' && process.env.NODE_ENV !== 'production') {
      mountedAtoms.add(atom)
    }
    if (isActuallyWritableAtom(atom) && atom.onMount) {
      const setAtom = (update: unknown) => writeAtom(atom, update)
      mounted.u = atom.onMount(setAtom)
    }
    return mounted
  }

  const unmountAtom = <Value>(atom: Atom<Value>): void => {
    // unmount self
    const onUnmount = mountedMap.get(atom)?.u
    if (onUnmount) {
      onUnmount()
    }
    mountedMap.delete(atom)
    if (typeof process === 'object' && process.env.NODE_ENV !== 'production') {
      mountedAtoms.delete(atom)
    }
    // unmount read dependencies afterward
    const atomState = getAtomState(atom)
    if (atomState) {
      atomState.d.forEach((_, a) => {
        if (a !== atom) {
          const mounted = mountedMap.get(a)
          if (mounted) {
            mounted.d.delete(atom)
            if (canUnmountAtom(a, mounted)) {
              unmountAtom(a)
            }
          }
        }
      })
    } else if (
      typeof process === 'object' &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.warn('[Bug] could not find atom state to unmount', atom)
    }
  }

  const mountDependencies = <Value>(
    atom: Atom<Value>,
    atomState: AtomState<Value>,
    prevDependencies: ReadDependencies
  ): void => {
    const dependencies = new Set(atomState.d.keys())
    prevDependencies.forEach((_, a) => {
      if (dependencies.has(a)) {
        // not changed
        dependencies.delete(a)
        return
      }
      const mounted = mountedMap.get(a)
      if (mounted) {
        mounted.d.delete(atom)
        if (canUnmountAtom(a, mounted)) {
          unmountAtom(a)
        }
      }
    })
    dependencies.forEach((a) => {
      const mounted = mountedMap.get(a)
      if (mounted) {
        const dependents = mounted.d
        dependents.add(atom)
      } else {
        mountAtom(a, atom)
      }
    })
  }

  const flushPending = (): void => {
    const pending = Array.from(pendingMap)
    pendingMap.clear()
    pending.forEach(([atom, [prevDependencies, isNewAtom]]) => {
      if (prevDependencies) {
        const atomState = getAtomState(atom)
        if (atomState) {
          mountDependencies(atom, atomState, prevDependencies)
        }
      }
      const mounted = mountedMap.get(atom)
      mounted?.l.forEach((listener) => listener())
      if (
        typeof process === 'object' &&
        process.env.NODE_ENV !== 'production'
      ) {
        stateListeners.forEach((l) => l(atom, isNewAtom))
      }
    })
  }

  const commitAtom = (_atom: AnyAtom) => {
    flushPending()
  }

  const subscribeAtom = (atom: AnyAtom, callback: () => void) => {
    const mounted = addAtom(atom)
    const listeners = mounted.l
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
      delAtom(atom)
    }
  }

  const restoreAtoms = (
    values: Iterable<readonly [AnyAtom, unknown]>
  ): void => {
    for (const [atom, value] of values) {
      if (hasInitialValue(atom)) {
        setAtomValue(atom, value)
        invalidateDependents(atom)
      }
    }
    flushPending()
  }

  if (typeof process === 'object' && process.env.NODE_ENV !== 'production') {
    return {
      [READ_ATOM]: readAtom,
      [WRITE_ATOM]: writeAtom,
      [COMMIT_ATOM]: commitAtom,
      [SUBSCRIBE_ATOM]: subscribeAtom,
      [RESTORE_ATOMS]: restoreAtoms,
      [DEV_SUBSCRIBE_STATE]: (l: StateListener) => {
        stateListeners.add(l)
        return () => {
          stateListeners.delete(l)
        }
      },
      [DEV_GET_MOUNTED_ATOMS]: () => mountedAtoms.values(),
      [DEV_GET_ATOM_STATE]: (a: AnyAtom) => atomStateMap.get(a),
      [DEV_GET_MOUNTED]: (a: AnyAtom) => mountedMap.get(a),
    }
  }
  return {
    [READ_ATOM]: readAtom,
    [WRITE_ATOM]: writeAtom,
    [COMMIT_ATOM]: commitAtom,
    [SUBSCRIBE_ATOM]: subscribeAtom,
    [RESTORE_ATOMS]: restoreAtoms,
  }
}

export type Store = ReturnType<typeof createStore>
