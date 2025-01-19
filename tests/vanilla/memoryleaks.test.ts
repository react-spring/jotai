import LeakDetector from 'jest-leak-detector'
import { describe, expect, it } from 'vitest'
import { atom, createStore } from 'jotai/vanilla'
import type { Atom } from 'jotai/vanilla'

describe('memory leaks (get & set only)', () => {
  it('one atom', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector = new LeakDetector(store.get(objAtom))
    objAtom = undefined
    expect(await detector.isLeaking()).toBe(false)
  })

  it('two atoms', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector1 = new LeakDetector(store.get(objAtom))
    let derivedAtom: Atom<object> | undefined = atom((get) => ({
      obj: objAtom && get(objAtom),
    }))
    const detector2 = new LeakDetector(store.get(derivedAtom))
    objAtom = undefined
    derivedAtom = undefined
    expect(await detector1.isLeaking()).toBe(false)
    expect(await detector2.isLeaking()).toBe(false)
  })

  it('should not hold onto dependent atoms that are not mounted', async () => {
    const store = createStore()
    const objAtom = atom({})
    let depAtom: Atom<unknown> | undefined = atom((get) => get(objAtom))
    const detector = new LeakDetector(depAtom)
    store.get(depAtom)
    depAtom = undefined
    await expect(detector.isLeaking()).resolves.toBe(false)
  })

  it('with a long-lived base atom', async () => {
    const store = createStore()
    const objAtom = atom({})
    let derivedAtom: Atom<object> | undefined = atom((get) => ({
      obj: get(objAtom),
    }))
    const detector = new LeakDetector(store.get(derivedAtom))
    derivedAtom = undefined
    expect(await detector.isLeaking()).toBe(false)
  })
})

describe('memory leaks (with subscribe)', () => {
  it('one atom', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector = new LeakDetector(store.get(objAtom))
    let unsub: (() => void) | undefined = store.sub(objAtom, () => {})
    unsub()
    unsub = undefined
    objAtom = undefined
    expect(await detector.isLeaking()).toBe(false)
  })

  it('two atoms', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector1 = new LeakDetector(store.get(objAtom))
    let derivedAtom: Atom<object> | undefined = atom((get) => ({
      obj: objAtom && get(objAtom),
    }))
    const detector2 = new LeakDetector(store.get(derivedAtom))
    let unsub: (() => void) | undefined = store.sub(objAtom, () => {})
    unsub()
    unsub = undefined
    objAtom = undefined
    derivedAtom = undefined
    expect(await detector1.isLeaking()).toBe(false)
    expect(await detector2.isLeaking()).toBe(false)
  })

  it('with a long-lived base atom', async () => {
    const store = createStore()
    const objAtom = atom({})
    let derivedAtom: Atom<object> | undefined = atom((get) => ({
      obj: get(objAtom),
    }))
    const detector = new LeakDetector(store.get(derivedAtom))
    let unsub: (() => void) | undefined = store.sub(objAtom, () => {})
    unsub()
    unsub = undefined
    derivedAtom = undefined
    expect(await detector.isLeaking()).toBe(false)
  })
})

describe('memory leaks (with dependencies)', () => {
  it('sync dependency', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector = new LeakDetector(store.get(objAtom))
    const atom1 = atom(0)
    const atom2 = atom((get) => get(atom1) || (objAtom && get(objAtom)))
    store.sub(atom2, () => {})
    store.set(atom1, 1)
    objAtom = undefined
    expect(await detector.isLeaking()).toBe(false)
  })

  it('async dependency', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector = new LeakDetector(store.get(objAtom))
    const atom1 = atom(0)
    const atom2 = atom(async (get) => get(atom1) || (objAtom && get(objAtom)))
    store.sub(atom2, () => {})
    store.set(atom1, 1)
    objAtom = undefined
    await Promise.resolve()
    expect(await detector.isLeaking()).toBe(false)
  })

  it('async await dependency', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector = new LeakDetector(store.get(objAtom))
    const atom1 = atom(0)
    const atom2 = atom(async (get) => {
      await Promise.resolve()
      return get(atom1) || (objAtom && get(objAtom))
    })
    store.sub(atom2, () => {})
    store.set(atom1, 1)
    objAtom = undefined
    expect(await detector.isLeaking()).toBe(false)
  })

  it('infinite async dependency', async () => {
    const store = createStore()
    let objAtom: Atom<object> | undefined = atom({})
    const detector = new LeakDetector(store.get(objAtom))
    const atom1 = atom(0)
    const atom2 = atom(async (get) => {
      if (get(atom1)) {
        return new Promise(() => {})
      }
      return objAtom && get(objAtom)
    })
    store.sub(atom2, () => {})
    store.set(atom1, 1)
    objAtom = undefined
    await Promise.resolve()
    expect(await detector.isLeaking()).toBe(false)
  })
})
