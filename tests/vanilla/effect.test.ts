import { expect, it, vi } from 'vitest'
import type { Atom, Getter, Setter } from 'jotai/vanilla'
import {
  atom,
  createStore,
  INTERNAL_getSecretStoreMethods as getSecretStoreMethods,
} from 'jotai/vanilla'

type Store = ReturnType<typeof createStore>
type AtomState = ReturnType<ReturnType<typeof getSecretStoreMethods>[0]>
type AnyAtom = Atom<unknown>
type Batch = Parameters<NonNullable<AtomState['u']>>[0]

type Cleanup = () => void
type Effect = (get: Getter, set: Setter) => Cleanup | void
type Ref = {
  get?: Getter
  inProgress: number
  epoch: number
  cleanup?: Cleanup | undefined
}

const syncEffectChannelSymbol = Symbol()

function syncEffect(effect: Effect): Atom<void> {
  const refAtom = atom<Ref>(() => ({ inProgress: 0, epoch: 0 }))
  const refreshAtom = atom(0)
  const internalAtom = atom((get) => {
    get(refreshAtom)
    const ref = get(refAtom)
    if (ref.inProgress) {
      return ref.epoch
    }
    ref.get = get
    return ++ref.epoch
  })
  internalAtom.unstable_onInit = (store) => {
    const ref = store.get(refAtom)
    const runEffect = () => {
      const deps = new Set<AnyAtom>()
      ref.cleanup?.()
      ref.cleanup =
        effect(
          (a) => {
            deps.add(a)
            return ref.get!(a)
          },
          (a, ...args) => {
            try {
              ++ref.inProgress
              return store.set(a, ...args)
            } finally {
              deps.forEach(ref.get!)
              --ref.inProgress
            }
          },
        ) || undefined
    }
    const internalAtomState = getAtomState(store, internalAtom)
    const originalMountHook = internalAtomState.h
    internalAtomState.h = (batch) => {
      originalMountHook?.(batch)
      if (internalAtomState.m) {
        // mount
        store.set(refreshAtom, (v) => v + 1)
      } else {
        // unmount
        const syncEffectChannel = ensureBatchChannel(batch)
        syncEffectChannel.add(() => {
          ref.cleanup?.()
          delete ref.cleanup
        })
      }
    }
    const originalUpdateHook = internalAtomState.u
    internalAtomState.u = (batch) => {
      originalUpdateHook?.(batch)
      // update
      const syncEffectChannel = ensureBatchChannel(batch)
      syncEffectChannel.add(runEffect)
    }
  }
  return atom((get) => {
    get(internalAtom)
  })
}

type BatchWithSyncEffect = Batch & {
  [syncEffectChannelSymbol]?: Set<() => void>
}
function ensureBatchChannel(batch: BatchWithSyncEffect) {
  // ensure continuation of the flushBatch while loop
  const originalQueue = batch[1]
  if (!originalQueue) {
    throw new Error('batch[1] must be present')
  }
  if (!batch[syncEffectChannelSymbol]) {
    batch[syncEffectChannelSymbol] = new Set<() => void>()
    batch[1] = {
      ...originalQueue,
      add(item) {
        originalQueue.add(item)
        return this
      },
      clear() {
        batch[syncEffectChannelSymbol]!.clear()
        originalQueue.clear()
      },
      forEach(callback) {
        batch[syncEffectChannelSymbol]!.forEach(callback)
        originalQueue.forEach(callback)
      },
      get size() {
        return batch[syncEffectChannelSymbol]!.size + originalQueue.size
      },
    }
  }
  return batch[syncEffectChannelSymbol]!
}

function getAtomState(store: Store, atom: AnyAtom): AtomState {
  const [ensureAtomState] = getSecretStoreMethods(store)
  return ensureAtomState(atom)!
}

it('fires after recomputeDependents and before atom listeners', async function test() {
  const store = createStore()
  const a = atom({} as { v?: number })
  let r
  const e = syncEffect(function effect(get) {
    r = get(a).v
  })
  const b = atom(function bAtomRead(get) {
    const aValue = get(a)
    get(e)
    // sets property `v` inside recomputeDependents
    aValue.v = 1
    return aValue
  })
  store.sub(b, function bAtomListener() {
    // sets property `v` inside atom listener
    store.get(a).v = 2
  })
  store.set(a, { v: 0 })
  expect(r).toBe(1)
})

it('responds to changes to atoms when subscribed', () => {
  const store = createStore()
  const a = atom(1)
  const b = atom(1)
  const w = atom(null, (_get, set, value: number) => {
    set(a, value)
    set(b, value)
  })
  const results: number[] = []
  const cleanup = vi.fn()
  const effect = vi.fn((get: Getter) => {
    results.push(get(a) * 10 + get(b))
    return cleanup
  })
  const e = syncEffect(effect)
  const unsub = store.sub(e, () => {}) // mount syncEffect
  expect(effect).toBeCalledTimes(1)
  expect(results).toStrictEqual([11]) // initial values at time of effect mount
  store.set(a, 2)
  expect(results).toStrictEqual([11, 21])
  store.set(b, 2)
  expect(results).toStrictEqual([11, 21, 22])
  store.set(w, 3)
  // intermediate state of '32' should not be recorded since the effect runs _after_ graph has been computed
  expect(results).toStrictEqual([11, 21, 22, 33])
  expect(cleanup).toBeCalledTimes(3)
  expect(effect).toBeCalledTimes(4)
  unsub()
  expect(cleanup).toBeCalledTimes(4)
  expect(effect).toBeCalledTimes(4)
  store.set(a, 4)
  // the effect is unmounted so no more updates
  expect(results).toStrictEqual([11, 21, 22, 33])
  expect(effect).toBeCalledTimes(4)
})

it('responds to changes to atoms when mounted with get', () => {
  const store = createStore()
  const a = atom(1)
  const b = atom(1)
  const w = atom(null, (_get, set, value: number) => {
    set(a, value)
    set(b, value)
  })
  const results: number[] = []
  const cleanup = vi.fn()
  const effect = vi.fn((get: Getter) => {
    results.push(get(a) * 10 + get(b))
    return cleanup
  })
  const e = syncEffect(effect)
  const d = atom((get) => get(e))
  const unsub = store.sub(d, () => {}) // mount syncEffect
  expect(effect).toBeCalledTimes(1)
  expect(results).toStrictEqual([11]) // initial values at time of effect mount
  store.set(a, 2)
  expect(results).toStrictEqual([11, 21])
  store.set(b, 2)
  expect(results).toStrictEqual([11, 21, 22])
  store.set(w, 3)
  // intermediate state of '32' should not be recorded since the effect runs _after_ graph has been computed
  expect(results).toStrictEqual([11, 21, 22, 33])
  expect(cleanup).toBeCalledTimes(3)
  expect(effect).toBeCalledTimes(4)
  unsub()
  expect(cleanup).toBeCalledTimes(4)
  expect(effect).toBeCalledTimes(4)
})

it('sets values to atoms without causing infinite loop', () => {
  const store = createStore()
  const a = atom(1)
  const effect = vi.fn((get: Getter, set: Setter) => {
    set(a, get(a) + 1)
  })
  const e = syncEffect(effect)
  const unsub = store.sub(e, () => {}) // mount syncEffect
  expect(effect).toBeCalledTimes(1)
  expect(store.get(a)).toBe(2) // initial values at time of effect mount
  store.set(a, (v) => ++v)
  expect(store.get(a)).toBe(4)
  expect(effect).toBeCalledTimes(2)
  unsub()
  expect(effect).toBeCalledTimes(2)
})
