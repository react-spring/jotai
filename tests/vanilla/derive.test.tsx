import { describe, expect, it, vi } from 'vitest'
import {
  atom,
  INTERNAL_buildStore as buildStore,
  createStore,
  INTERNAL_getSecretStoreMethods as getSecretStoreMethods,
} from 'jotai/vanilla'
import type { Atom, Getter } from 'jotai/vanilla'

type EnsureAtomState = ReturnType<typeof getSecretStoreMethods>[0]

const deriveStore = (
  store: ReturnType<typeof createStore>,
  enhanceEnsureAtomState: (fn: EnsureAtomState) => EnsureAtomState,
  atomRead?: Parameters<typeof buildStore>[1],
) => {
  const [ensureAtomState] = getSecretStoreMethods(store)
  const newEnsureAtomState = enhanceEnsureAtomState(ensureAtomState)
  const derivedStore = buildStore(newEnsureAtomState, atomRead)
  return derivedStore
}

describe('derive for scoping atoms', () => {
  /**
   * a
   * S1[a]: a1
   */
  it('primitive atom', () => {
    const a = atom('a')
    a.onMount = (setSelf) => setSelf((v) => v + ':mounted')
    const scopedAtoms = new Set<Atom<unknown>>([a])

    const store = createStore()
    const scopedAtomStateMap = new WeakMap()
    const derivedStore = deriveStore(store, (ensureAtomState) => {
      return (atom) => {
        if (scopedAtoms.has(atom)) {
          let atomState = scopedAtomStateMap.get(atom)
          if (!atomState) {
            atomState = { d: new Map(), p: new Set(), n: 0 }
            scopedAtomStateMap.set(atom, atomState)
          }
          return atomState
        }
        return ensureAtomState(atom)
      }
    })

    expect(store.get(a)).toBe('a')
    expect(derivedStore.get(a)).toBe('a')

    derivedStore.sub(a, vi.fn())
    expect(store.get(a)).toBe('a')
    expect(derivedStore.get(a)).toBe('a:mounted')

    derivedStore.set(a, (v) => v + ':updated')
    expect(store.get(a)).toBe('a')
    expect(derivedStore.get(a)).toBe('a:mounted:updated')
  })

  /**
   * a, b, c(a + b)
   * S1[a]: a1, b0, c0(a1 + b0)
   */
  it('derived atom (scoping primitive)', () => {
    const a = atom('a')
    const b = atom('b')
    const c = atom((get) => get(a) + get(b))
    const scopedAtoms = new Set<Atom<unknown>>([a])

    const store = createStore()
    const scopedAtomStateMap = new WeakMap()
    const derivedStore = deriveStore(store, (ensureAtomState) => {
      return (atom) => {
        if (scopedAtoms.has(atom)) {
          let atomState = scopedAtomStateMap.get(atom)
          if (!atomState) {
            atomState = { d: new Map(), p: new Set(), n: 0 }
            scopedAtomStateMap.set(atom, atomState)
          }
          return atomState
        }
        return ensureAtomState(atom)
      }
    })

    expect(store.get(c)).toBe('ab')
    expect(derivedStore.get(c)).toBe('ab')

    derivedStore.set(a, 'a2')
    expect(store.get(c)).toBe('ab')
    expect(derivedStore.get(c)).toBe('a2b')
  })

  /**
   * a, b(a)
   * S1[a]: a1, b0(a1)
   */
  it('derived atom with subscribe', () => {
    const a = atom('a')
    const b = atom(
      (get) => get(a),
      (_get, set, v: string) => set(a, v),
    )
    const scopedAtoms = new Set<Atom<unknown>>([a])

    function makeStores() {
      const store = createStore()
      const scopedAtomStateMap = new WeakMap()
      const derivedStore = deriveStore(
        store,
        (ensureAtomState) => {
          return (atom) => {
            if (scopedAtoms.has(atom)) {
              let atomState = scopedAtomStateMap.get(atom)
              if (!atomState) {
                atomState = { d: new Map(), p: new Set(), n: 0 }
                scopedAtomStateMap.set(atom, atomState)
              }
              return atomState
            }
            return ensureAtomState(atom)
          }
        },
        (a, get, options) => {
          const myGet: Getter = (aa) => {
            if (scopedAtoms.has(aa)) {
              scopedAtoms.add(a) // Is this too naive?
            }
            return get(aa)
          }
          return a.read(myGet, options)
        },
      )

      expect(store.get(b)).toBe('a')
      expect(derivedStore.get(b)).toBe('a')
      return { store, derivedStore }
    }

    /**
     * Ba[ ]: a0, b0(a0)
     * S1[a]: a1, b0(a1)
     */
    {
      const { store, derivedStore } = makeStores()
      store.set(b, '*')
      expect(store.get(b)).toBe('*')
      expect(derivedStore.get(b)).toBe('a')
    }
    {
      const { store, derivedStore } = makeStores()
      derivedStore.set(b, '*')
      expect(store.get(b)).toBe('a')
      expect(derivedStore.get(b)).toBe('*')
    }
    {
      const { store, derivedStore } = makeStores()
      const storeCallback = vi.fn()
      const derivedCallback = vi.fn()
      store.sub(b, storeCallback)
      derivedStore.sub(b, derivedCallback)
      store.set(b, '*')
      expect(store.get(b)).toBe('*')
      expect(derivedStore.get(b)).toBe('a') // FIXME: received '*'
      expect(storeCallback).toHaveBeenCalledTimes(1)
      expect(derivedCallback).toHaveBeenCalledTimes(0) // FIXME: received 1
    }
    {
      const { store, derivedStore } = makeStores()
      const storeCallback = vi.fn()
      const derivedCallback = vi.fn()
      store.sub(b, storeCallback)
      derivedStore.sub(b, derivedCallback)
      derivedStore.set(b, '*')
      expect(store.get(b)).toBe('a')
      expect(derivedStore.get(b)).toBe('*') // FIXME: received 'a'
      expect(storeCallback).toHaveBeenCalledTimes(0)
      expect(derivedCallback).toHaveBeenCalledTimes(1) // FIXME: received 1
    }
  })
})

it('should pass the correct store instance to the atom initializer', () => {
  expect.assertions(2)
  const baseStore = createStore()
  const initializedAtoms = new WeakSet()
  const derivedStore = deriveStore(baseStore, (ensureAtomState) => {
    return (atom) => {
      if (!initializedAtoms.has(atom)) {
        initializedAtoms.add(atom)
        const atomState = ensureAtomState(atom, () => {})
        atom.unstable_onInit?.(derivedStore)
        return atomState
      }
      return ensureAtomState(atom)
    }
  })
  const a = atom(null)
  a.unstable_onInit = (store) => {
    expect(store).toBe(baseStore)
  }
  baseStore.get(a)
  a.unstable_onInit = (store) => {
    expect(store).toBe(derivedStore)
  }
  derivedStore.get(a)
})
