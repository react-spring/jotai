import type { Atom, Getter, Setter } from 'jotai/vanilla'
import { atom } from 'jotai/vanilla'

const INTERNAL_flushStoreHook = Symbol.for('JOTAI.EXPERIMENTAL.FLUSHSTOREHOOK')
const INTERNAL_syncEffectChannel = Symbol.for(
  'JOTAI-EFFECT.EXPERIMENTAL.SYNCEFFECTCHANNEL',
)

type Store = Parameters<NonNullable<AnyAtom['unstable_onInit']>>[0]
type StoreWithHooks = Store & {
  [INTERNAL_flushStoreHook]: () => void
  [INTERNAL_syncEffectChannel]?: Set<() => void>
}

type GetAtomState = Parameters<Parameters<Store['unstable_derive']>[0]>[0]

type AtomState = NonNullable<ReturnType<GetAtomState>>

type AnyAtom = Atom<unknown>

type GetterWithPeek = Getter & { peek: Getter }

type SetterWithRecurse = Setter & { recurse: Setter }

type Cleanup = () => void

export type Effect = (
  get: GetterWithPeek,
  set: SetterWithRecurse,
) => void | Cleanup

type Ref = {
  /** epoch */
  epoch: number
  /** pending error */
  error?: unknown
  /** getter */
  get?: Getter
}

export function syncEffect(effect: Effect): Atom<void> & { effect: Effect } {
  const refreshAtom = atom(0)

  const refAtom = atom(() => ({ inProgress: 0, epoch: 0 }) as Ref)

  const internalAtom = atom(
    (get) => {
      get(refreshAtom)
      const ref = get(refAtom)
      throwPendingError(ref)
      ref.get = get
      return ++ref.epoch
    },
    () => {},
  )
  internalAtom.onMount = () => () => {}

  internalAtom.unstable_onInit = (store) => {
    const ref = store.get(refAtom)

    let inProgress = 0
    let isMounted = false
    let isRecursing = false
    let isRefreshing = false
    let fromCleanup = false
    let runCleanup: Cleanup | void

    function runEffect() {
      if (!isMounted || (inProgress && !isRefreshing) || isRecursing) {
        return
      }

      const deps = new Map<AnyAtom, unknown>()

      const getter: GetterWithPeek = ((a) => {
        const value = ref.get!(a)
        deps.set(a, value)
        return value
      }) as GetterWithPeek

      getter.peek = store.get

      const setter: SetterWithRecurse = ((a, ...args) => {
        try {
          ++inProgress
          return store.set(a, ...args)
        } finally {
          --inProgress
        }
      }) as SetterWithRecurse

      setter.recurse = (a, ...args) => {
        if (fromCleanup) {
          if (process.env.NODE_ENV !== 'production') {
            throw new Error('set.recurse is not allowed in cleanup')
          }
          return undefined as any
        }
        try {
          isRecursing = true
          return store.set(a, ...args)
        } finally {
          isRecursing = false
          const depsChanged = Array.from(deps).some(areDifferent)
          if (depsChanged) {
            refresh()
          }
        }
      }

      try {
        ++inProgress
        runCleanup?.()
        const cleanup = effectAtom.effect(getter, setter)
        if (typeof cleanup === 'function') {
          runCleanup = () => {
            try {
              fromCleanup = true
              return cleanup()
            } finally {
              fromCleanup = false
              runCleanup = undefined
            }
          }
        }
      } catch (error) {
        ref.error = error
        throw error
      } finally {
        Array.from(deps.keys(), ref.get!)
        --inProgress
      }

      function refresh() {
        try {
          isRefreshing = true
          store.set(refreshAtom, (v) => v + 1)
        } finally {
          isRefreshing = false
        }
      }

      function areDifferent([a, v]: [Atom<unknown>, unknown]) {
        return getter.peek(a) !== v
      }
    }

    const atomState = getAtomState(store, internalAtom)
    const syncEffectChannel = ensureSyncEffectChannel(store)

    hookInto(atomState, 'h', function atomOnMount() {
      if (inProgress) {
        return
      }
      if (atomState.m) {
        isMounted = true
        syncEffectChannel.add(runEffect)
      } else {
        isMounted = false
        if (runCleanup) {
          syncEffectChannel.add(runCleanup)
        }
      }
    })

    hookInto(atomState, 'u', function atomOnUpdate() {
      syncEffectChannel.add(runEffect)
    })
  }

  if (process.env.NODE_ENV !== 'production') {
    function setLabel(atom: Atom<unknown>, label: string) {
      Object.defineProperty(atom, 'debugLabel', {
        get: () => `${effectAtom.debugLabel ?? 'effect'}:${label}`,
      })
      atom.debugPrivate = true
    }
    setLabel(refreshAtom, 'refresh')
    setLabel(refAtom, 'ref')
    setLabel(internalAtom, 'internal')
  }

  const effectAtom = Object.assign(
    atom((get) => {
      get(internalAtom)
    }),
    { effect },
  )
  effectAtom.effect = effect
  return effectAtom

  function throwPendingError(ref: Ref) {
    if ('error' in ref) {
      const error = ref.error
      delete ref.error
      throw error
    }
  }
}

function ensureSyncEffectChannel(store: Store) {
  const storeWithHooks = store as StoreWithHooks
  let syncEffectChannel = storeWithHooks[INTERNAL_syncEffectChannel]
  if (!syncEffectChannel) {
    storeWithHooks[INTERNAL_syncEffectChannel] = syncEffectChannel = new Set<
      () => void
    >()
    hookInto(storeWithHooks, INTERNAL_flushStoreHook, () => {
      syncEffectChannel!.forEach((fn) => fn())
      syncEffectChannel!.clear()
    })
  }
  return syncEffectChannel
}

const getAtomStateMap = new WeakMap<Store, GetAtomState>()

/**
 * HACK: Steals atomState to synchronously determine if
 * the atom is mounted.
 * We return null to cause the buildStore(...args) to throw
 * to abort creating a derived store.
 */
function getAtomState(store: Store, atom: AnyAtom): AtomState {
  let getAtomStateFn = getAtomStateMap.get(store)
  if (!getAtomStateFn) {
    try {
      store.unstable_derive((...storeArgs) => {
        getAtomStateFn = storeArgs[0]
        return null as any
      })
    } catch {
      // expect error
    }
    getAtomStateMap.set(store, getAtomStateFn!)
  }
  return getAtomStateFn!(atom)!
}

function hookInto<
  M extends string | symbol,
  T extends { [K in M]?: (...args: any[]) => void },
>(obj: T, methodName: M, newMethod: NonNullable<T[typeof methodName]>) {
  const originalMethod = obj[methodName]
  obj[methodName] = ((...args: any[]) => {
    originalMethod?.(...args)
    newMethod(...args)
  }) as T[typeof methodName]
}
