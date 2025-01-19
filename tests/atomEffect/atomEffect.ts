import type { Atom, Getter, Setter } from 'jotai/vanilla'
import { atom } from 'jotai/vanilla'

type Cleanup = () => void
type GetterWithPeek = Getter & { peek: Getter }
type SetterWithRecurse = Setter & { recurse: Setter }
export type Effect = Parameters<typeof atomEffect>[0]
export type AtomWithEffect<T extends Atom<unknown> = Atom<void>> = T & {
  effect: Effect
}
type Ref = {
  /** inProgress */
  inProgress: number
  /** mounted */
  isMounted: boolean
  /** promise */
  promise: Promise<void> | undefined
  /** pending error */
  error?: unknown
  /** cleanup */
  cleanup: Cleanup | void
  /** from cleanup */
  fromCleanup: boolean
  /** is recursing */
  isRecursing: boolean
  /** is refreshing */
  isRefreshing: boolean
  peek: Getter
  set: Setter
}

export function atomEffect(
  effect: (get: GetterWithPeek, set: SetterWithRecurse) => void | Cleanup,
): AtomWithEffect {
  const refreshAtom = atom(0)
  const refAtom = atom(
    () => ({ inProgress: 0 }) as Ref,
    (get, set) => {
      const ref = get(refAtom)
      ref.isMounted = true
      ref.peek = get
      ref.set = set
      set(refreshAtom, (v) => v + 1)
      return () => {
        ref.isMounted = false
        cleanup(ref)
        throwPendingError(ref)
      }
    },
  )
  refAtom.onMount = (mount) => mount()
  const baseAtom = atom((get) => {
    get(refreshAtom)
    const ref = get(refAtom)
    if (
      !ref.isMounted ||
      ref.isRecursing ||
      (ref.inProgress && !ref.isRefreshing)
    ) {
      return ref.promise
    }
    throwPendingError(ref)
    const currDeps = new Map<Atom<unknown>, unknown>()
    const getter: GetterWithPeek = (a) => {
      const value = get(a)
      currDeps.set(a, value)
      return value
    }
    getter.peek = ref.peek
    const setter: SetterWithRecurse = (...args) => {
      try {
        ++ref.inProgress
        return ref.set(...args)
      } finally {
        Array.from(currDeps.keys(), get)
        --ref.inProgress
      }
    }
    setter.recurse = (anAtom, ...args) => {
      if (ref.fromCleanup) {
        if (process.env.NODE_ENV !== 'production') {
          throw new Error('set.recurse is not allowed in cleanup')
        }
        return undefined as any
      }
      try {
        ref.isRecursing = true
        return ref.set(anAtom, ...args)
      } finally {
        ref.isRecursing = false
        const depsChanged = Array.from(currDeps).some(areDifferent)
        if (depsChanged) {
          refresh(ref)
        }
      }
    }
    function areDifferent([a, v]: [Atom<unknown>, unknown]) {
      return get(a) !== v
    }
    ++ref.inProgress
    function runEffect() {
      try {
        ref.isRefreshing = false
        if (!ref.isMounted) return
        cleanup(ref)
        ref.cleanup = effectAtom.effect(getter, setter)
      } catch (error) {
        ref.error = error
        refresh(ref)
      } finally {
        ref.promise = undefined
        --ref.inProgress
      }
    }
    return ref.isRefreshing
      ? runEffect()
      : (ref.promise = Promise.resolve().then(runEffect))
  })
  if (process.env.NODE_ENV !== 'production') {
    function setLabel(atom: Atom<unknown>, label: string) {
      Object.defineProperty(atom, 'debugLabel', {
        get: () => `${effectAtom.debugLabel ?? 'effect'}:${label}`,
      })
      atom.debugPrivate = true
    }
    setLabel(refreshAtom, 'refresh')
    setLabel(refAtom, 'ref')
    setLabel(baseAtom, 'base')
  }
  const effectAtom = atom((get) => void get(baseAtom)) as AtomWithEffect
  effectAtom.effect = effect
  return effectAtom
  function refresh(ref: Ref) {
    try {
      ref.isRefreshing = true
      ref.set(refreshAtom, (v) => v + 1)
    } finally {
      ref.isRefreshing = false
    }
  }
  function cleanup(ref: Ref) {
    if (!ref.cleanup) return
    try {
      ref.fromCleanup = true
      ref.cleanup()
    } finally {
      ref.fromCleanup = false
      ref.cleanup = undefined
    }
  }
  function throwPendingError(ref: Ref) {
    if ('error' in ref) {
      const error = ref.error
      delete ref.error
      throw error
    }
  }
}
