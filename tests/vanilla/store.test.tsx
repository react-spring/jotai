import { waitFor } from '@testing-library/react'
import { assert, describe, expect, it, vi } from 'vitest'
import {
  atom,
  INTERNAL_buildStore as buildStore,
  createStore,
  INTERNAL_getSecretStoreMethods as getSecretStoreMethods,
} from 'jotai/vanilla'
import type { Atom, Getter, PrimitiveAtom } from 'jotai/vanilla'

it('should not fire on subscribe', async () => {
  const store = createStore()
  const countAtom = atom(0)
  const callback1 = vi.fn()
  const callback2 = vi.fn()
  store.sub(countAtom, callback1)
  store.sub(countAtom, callback2)
  expect(callback1).not.toHaveBeenCalled()
  expect(callback2).not.toHaveBeenCalled()
})

it('should not fire subscription if primitive atom value is the same', async () => {
  const store = createStore()
  const countAtom = atom(0)
  const callback = vi.fn()
  store.sub(countAtom, callback)
  const calledTimes = callback.mock.calls.length
  store.set(countAtom, 0)
  expect(callback).toHaveBeenCalledTimes(calledTimes)
})

it('should not fire subscription if derived atom value is the same', async () => {
  const store = createStore()
  const countAtom = atom(0)
  const derivedAtom = atom((get) => get(countAtom) * 0)
  const callback = vi.fn()
  store.sub(derivedAtom, callback)
  const calledTimes = callback.mock.calls.length
  store.set(countAtom, 1)
  expect(callback).toHaveBeenCalledTimes(calledTimes)
})

it('should unmount with store.get', async () => {
  const store = createStore()
  const countAtom = atom(0)
  const callback = vi.fn()
  const unsub = store.sub(countAtom, callback)
  store.get(countAtom)
  unsub()
  const result = Array.from(
    'dev4_get_mounted_atoms' in store ? store.dev4_get_mounted_atoms() : [],
  )
  expect(result).toEqual([])
})

it('should unmount dependencies with store.get', async () => {
  const store = createStore()
  const countAtom = atom(0)
  const derivedAtom = atom((get) => get(countAtom) * 2)
  const callback = vi.fn()
  const unsub = store.sub(derivedAtom, callback)
  store.get(derivedAtom)
  unsub()
  const result = Array.from(
    'dev4_restore_atoms' in store ? store.dev4_get_mounted_atoms() : [],
  )
  expect(result).toEqual([])
})

it('should update async atom with delay (#1813)', async () => {
  const countAtom = atom(0)

  const resolve: (() => void)[] = []
  const delayedAtom = atom(async (get) => {
    const count = get(countAtom)
    await new Promise<void>((r) => resolve.push(r))
    return count
  })

  const store = createStore()
  store.get(delayedAtom)
  store.set(countAtom, 1)
  resolve.splice(0).forEach((fn) => fn())
  await new Promise<void>((r) => setTimeout(r)) // wait for a tick
  const promise = store.get(delayedAtom)
  resolve.splice(0).forEach((fn) => fn())
  expect(await promise).toBe(1)
})

it('should override a promise by setting', async () => {
  const store = createStore()
  const countAtom = atom(Promise.resolve(0))
  const infinitePending = new Promise<never>(() => {})
  store.set(countAtom, infinitePending)
  const promise1 = store.get(countAtom)
  expect(promise1).toBe(infinitePending)
  store.set(countAtom, Promise.resolve(1))
  const promise2 = store.get(countAtom)
  expect(await promise2).toBe(1)
})

it('should update async atom with deps after await (#1905)', async () => {
  const countAtom = atom(0)
  const resolve: (() => void)[] = []
  const delayedAtom = atom(async (get) => {
    await new Promise<void>((r) => resolve.push(r))
    const count = get(countAtom)
    return count
  })
  const derivedAtom = atom(async (get) => {
    const count = await get(delayedAtom)
    return count
  })

  const store = createStore()
  let lastValue = store.get(derivedAtom)
  const unsub = store.sub(derivedAtom, () => {
    lastValue = store.get(derivedAtom)
  })
  store.set(countAtom, 1)
  resolve.splice(0).forEach((fn) => fn())
  expect(await lastValue).toBe(1)
  store.set(countAtom, 2)
  resolve.splice(0).forEach((fn) => fn())
  expect(await lastValue).toBe(2)
  store.set(countAtom, 3)
  resolve.splice(0).forEach((fn) => fn())
  expect(await lastValue).toBe(3)
  unsub()
})

it('should not fire subscription when async atom promise is the same', async () => {
  const promise = Promise.resolve()
  const promiseAtom = atom(promise)
  const derivedGetter = vi.fn((get: Getter) => get(promiseAtom))
  const derivedAtom = atom(derivedGetter)

  const store = createStore()

  expect(derivedGetter).not.toHaveBeenCalled()

  const promiseListener = vi.fn()
  const promiseUnsub = store.sub(promiseAtom, promiseListener)
  const derivedListener = vi.fn()
  const derivedUnsub = store.sub(derivedAtom, derivedListener)

  expect(derivedGetter).toHaveBeenCalledOnce()
  expect(promiseListener).not.toHaveBeenCalled()
  expect(derivedListener).not.toHaveBeenCalled()

  store.get(promiseAtom)
  store.get(derivedAtom)

  expect(derivedGetter).toHaveBeenCalledOnce()
  expect(promiseListener).not.toHaveBeenCalled()
  expect(derivedListener).not.toHaveBeenCalled()

  store.set(promiseAtom, promise)

  expect(derivedGetter).toHaveBeenCalledOnce()
  expect(promiseListener).not.toHaveBeenCalled()
  expect(derivedListener).not.toHaveBeenCalled()

  store.set(promiseAtom, promise)

  expect(derivedGetter).toHaveBeenCalledOnce()
  expect(promiseListener).not.toHaveBeenCalled()
  expect(derivedListener).not.toHaveBeenCalled()

  promiseUnsub()
  derivedUnsub()
})

it('should notify subscription with tree dependencies (#1956)', async () => {
  const valueAtom = atom(1)
  const dep1Atom = atom((get) => get(valueAtom) * 2)
  const dep2Atom = atom((get) => get(valueAtom) + get(dep1Atom))
  const dep3Atom = atom((get) => get(dep1Atom))

  const cb = vi.fn()
  const store = createStore()
  store.sub(dep2Atom, vi.fn()) // this will cause the bug
  store.sub(dep3Atom, cb)

  expect(cb).toBeCalledTimes(0)
  expect(store.get(dep3Atom)).toBe(2)
  store.set(valueAtom, (c) => c + 1)
  expect(cb).toBeCalledTimes(1)
  expect(store.get(dep3Atom)).toBe(4)
})

it('should notify subscription with tree dependencies with bail-out', async () => {
  const valueAtom = atom(1)
  const dep1Atom = atom((get) => get(valueAtom) * 2)
  const dep2Atom = atom((get) => get(valueAtom) * 0)
  const dep3Atom = atom((get) => get(dep1Atom) + get(dep2Atom))

  const cb = vi.fn()
  const store = createStore()
  store.sub(dep1Atom, vi.fn())
  store.sub(dep3Atom, cb)

  expect(cb).toBeCalledTimes(0)
  expect(store.get(dep3Atom)).toBe(2)
  store.set(valueAtom, (c) => c + 1)
  expect(cb).toBeCalledTimes(1)
  expect(store.get(dep3Atom)).toBe(4)
})

it('should bail out with the same value with chained dependency (#2014)', async () => {
  const store = createStore()
  const objAtom = atom({ count: 1 })
  const countAtom = atom((get) => get(objAtom).count)
  const deriveFn = vi.fn((get: Getter) => get(countAtom))
  const derivedAtom = atom(deriveFn)
  const deriveFurtherFn = vi.fn((get: Getter) => {
    get(objAtom) // intentional extra dependency
    return get(derivedAtom)
  })
  const derivedFurtherAtom = atom(deriveFurtherFn)
  const callback = vi.fn()
  store.sub(derivedFurtherAtom, callback)
  expect(store.get(derivedAtom)).toBe(1)
  expect(store.get(derivedFurtherAtom)).toBe(1)
  expect(callback).toHaveBeenCalledTimes(0)
  expect(deriveFn).toHaveBeenCalledTimes(1)
  expect(deriveFurtherFn).toHaveBeenCalledTimes(1)
  store.set(objAtom, (obj) => ({ ...obj }))
  expect(callback).toHaveBeenCalledTimes(0)
  expect(deriveFn).toHaveBeenCalledTimes(1)
  expect(deriveFurtherFn).toHaveBeenCalledTimes(2)
})

it('should not call read function for unmounted atoms (#2076)', async () => {
  const store = createStore()
  const countAtom = atom(1)
  const derive1Fn = vi.fn((get: Getter) => get(countAtom))
  const derived1Atom = atom(derive1Fn)
  const derive2Fn = vi.fn((get: Getter) => get(countAtom))
  const derived2Atom = atom(derive2Fn)
  expect(store.get(derived1Atom)).toBe(1)
  expect(store.get(derived2Atom)).toBe(1)
  expect(derive1Fn).toHaveBeenCalledTimes(1)
  expect(derive2Fn).toHaveBeenCalledTimes(1)
  store.sub(derived2Atom, vi.fn())
  store.set(countAtom, (c) => c + 1)
  expect(derive1Fn).toHaveBeenCalledTimes(1)
  expect(derive2Fn).toHaveBeenCalledTimes(2)
})

it('should update with conditional dependencies (#2084)', async () => {
  const store = createStore()
  const f1 = atom(false)
  const f2 = atom(false)
  const f3 = atom(
    (get) => get(f1) && get(f2),
    (_get, set, val: boolean) => {
      set(f1, val)
      set(f2, val)
    },
  )
  store.sub(f1, vi.fn())
  store.sub(f2, vi.fn())
  store.sub(f3, vi.fn())
  store.set(f3, true)
  expect(store.get(f3)).toBe(true)
})

it("should recompute dependents' state after onMount (#2098)", async () => {
  const store = createStore()

  const condAtom = atom(false)
  const baseAtom = atom(false)
  baseAtom.onMount = (set) => set(true)
  const derivedAtom = atom(
    (get) => get(baseAtom),
    (_get, set, update: boolean) => set(baseAtom, update),
  )
  const finalAtom = atom(
    (get) => (get(condAtom) ? get(derivedAtom) : undefined),
    (_get, set, value: boolean) => set(derivedAtom, value),
  )

  store.sub(finalAtom, () => {}) // mounts finalAtom, but not baseAtom
  expect(store.get(baseAtom)).toBe(false)
  expect(store.get(derivedAtom)).toBe(false)
  expect(store.get(finalAtom)).toBe(undefined)

  store.set(condAtom, true) // mounts baseAtom
  expect(store.get(baseAtom)).toBe(true)
  expect(store.get(derivedAtom)).toBe(true)
  expect(store.get(finalAtom)).toBe(true)

  store.set(finalAtom, false)
  expect(store.get(baseAtom)).toBe(false)
  expect(store.get(derivedAtom)).toBe(false)
  expect(store.get(finalAtom)).toBe(false)
})

it('should update derived atoms during write (#2107)', async () => {
  const store = createStore()

  const baseCountAtom = atom(1)
  const countAtom = atom(
    (get) => get(baseCountAtom),
    (get, set, newValue: number) => {
      set(baseCountAtom, newValue)
      if (get(countAtom) !== newValue) {
        throw new Error('mismatch')
      }
    },
  )

  store.sub(countAtom, () => {})
  expect(store.get(countAtom)).toBe(1)
  store.set(countAtom, 2)
  expect(store.get(countAtom)).toBe(2)
})

it('resolves dependencies reliably after a delay (#2192)', async () => {
  expect.assertions(1)
  const countAtom = atom(0)
  let result: number | null = null

  const resolve: (() => void)[] = []
  const asyncAtom = atom(async (get) => {
    const count = get(countAtom)
    await new Promise<void>((r) => resolve.push(r))
    return count
  })

  const derivedAtom = atom(
    async (get, { setSelf }) => {
      get(countAtom)
      await Promise.resolve()
      result = await get(asyncAtom)
      if (result === 2) setSelf() // <-- necessary
    },
    () => {},
  )

  const store = createStore()
  store.sub(derivedAtom, () => {})

  await waitFor(() => assert(resolve.length === 1))

  resolve[0]!()
  const increment = (c: number) => c + 1
  store.set(countAtom, increment)
  store.set(countAtom, increment)

  await waitFor(() => assert(resolve.length === 3))

  resolve[1]!()
  resolve[2]!()
  await waitFor(() => assert(result === 2))

  store.set(countAtom, increment)
  store.set(countAtom, increment)

  await waitFor(() => assert(resolve.length === 5))

  resolve[3]!()
  resolve[4]!()

  await Promise.resolve()
  await waitFor(() => assert(store.get(countAtom) === 4))

  expect(result).toBe(4) // 3
})

it('should not recompute a derived atom value if unchanged (#2168)', async () => {
  const store = createStore()
  const countAtom = atom(1)
  const derived1Atom = atom((get) => get(countAtom) * 0)
  const derive2Fn = vi.fn((get: Getter) => get(derived1Atom))
  const derived2Atom = atom(derive2Fn)
  expect(store.get(derived2Atom)).toBe(0)
  store.set(countAtom, (c) => c + 1)
  expect(store.get(derived2Atom)).toBe(0)
  expect(derive2Fn).toHaveBeenCalledTimes(1)
})

it('should mount once with atom creator atom (#2314)', async () => {
  const countAtom = atom(1)
  countAtom.onMount = vi.fn((setAtom: (v: number) => void) => {
    setAtom(2)
  })
  const atomCreatorAtom = atom((get) => {
    const derivedAtom = atom((get) => get(countAtom))
    get(derivedAtom)
  })
  const store = createStore()
  store.sub(atomCreatorAtom, () => {})
  expect(countAtom.onMount).toHaveBeenCalledTimes(1)
})

it('should flush pending write triggered asynchronously and indirectly (#2451)', async () => {
  const store = createStore()
  const anAtom = atom('initial')

  const callbackFn = vi.fn((_value: string) => {})
  const unsub = store.sub(anAtom, () => {
    callbackFn(store.get(anAtom))
  })

  const actionAtom = atom(null, async (_get, set) => {
    await Promise.resolve() // waiting a microtask
    set(indirectSetAtom)
  })

  const indirectSetAtom = atom(null, (_get, set) => {
    set(anAtom, 'next')
  })

  // executing the chain reaction
  await store.set(actionAtom)

  expect(callbackFn).toHaveBeenCalledOnce()
  expect(callbackFn).toHaveBeenCalledWith('next')
  unsub()
})

describe('async atom with subtle timing', () => {
  it('case 1', async () => {
    const store = createStore()
    const resolve: (() => void)[] = []
    const a = atom(1)
    const b = atom(async (get) => {
      await new Promise<void>((r) => resolve.push(r))
      return get(a)
    })
    const bValue = store.get(b)
    store.set(a, 2)
    resolve.splice(0).forEach((fn) => fn())
    const bValue2 = store.get(b)
    resolve.splice(0).forEach((fn) => fn())
    expect(await bValue).toBe(2)
    expect(await bValue2).toBe(2)
  })

  it('case 2', async () => {
    const store = createStore()
    const resolve: (() => void)[] = []
    const a = atom(1)
    const b = atom(async (get) => {
      const aValue = get(a)
      await new Promise<void>((r) => resolve.push(r))
      return aValue
    })
    const bValue = store.get(b)
    store.set(a, 2)
    resolve.splice(0).forEach((fn) => fn())
    const bValue2 = store.get(b)
    resolve.splice(0).forEach((fn) => fn())
    expect(await bValue).toBe(1) // returns old value
    expect(await bValue2).toBe(2)
  })
})

describe('aborting atoms', () => {
  // We can't use signal.throwIfAborted as it is not available
  // in earlier versions of TS that this is tested on.
  const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) {
      throw new Error('aborted')
    }
  }

  it('should abort the signal when dependencies change', async () => {
    const a = atom(1)
    const callBeforeAbort = vi.fn()
    const callAfterAbort = vi.fn()
    const resolve: (() => void)[] = []

    const store = createStore()

    const derivedAtom = atom(async (get, { signal }) => {
      const aVal = get(a)
      await new Promise<void>((r) => resolve.push(r))
      callBeforeAbort()
      throwIfAborted(signal)
      callAfterAbort()
      return aVal + 1
    })

    const promise = store.get(derivedAtom)
    store.set(a, 3)
    const promise2 = store.get(derivedAtom)

    resolve.splice(0).forEach((fn) => fn())
    await expect(promise).rejects.toThrow('aborted')
    await expect(promise2).resolves.toEqual(4)
    expect(callBeforeAbort).toHaveBeenCalledTimes(2)
    expect(callAfterAbort).toHaveBeenCalledTimes(1)
  })

  it('should abort the signal when dependencies change and the atom is mounted', async () => {
    const a = atom(1)
    const callBeforeAbort = vi.fn()
    const callAfterAbort = vi.fn()
    const resolve: (() => void)[] = []

    const store = createStore()

    const derivedAtom = atom(async (get, { signal }) => {
      const aVal = get(a)
      await new Promise<void>((r) => resolve.push(r))
      callBeforeAbort()
      throwIfAborted(signal)
      callAfterAbort()
      return aVal + 1
    })

    store.sub(derivedAtom, () => {})
    store.set(a, 3)

    resolve.splice(0).forEach((fn) => fn())
    await new Promise((r) => setTimeout(r)) // wait for a tick
    expect(callBeforeAbort).toHaveBeenCalledTimes(2)
    expect(callAfterAbort).toHaveBeenCalledTimes(1)
  })

  it('should not abort the signal when unsubscribed', async () => {
    const a = atom(1)
    const callBeforeAbort = vi.fn()
    const callAfterAbort = vi.fn()
    const resolve: (() => void)[] = []

    const store = createStore()

    const derivedAtom = atom(async (get, { signal }) => {
      const aVal = get(a)
      await new Promise<void>((r) => resolve.push(r))
      callBeforeAbort()
      throwIfAborted(signal)
      callAfterAbort()
      return aVal + 1
    })

    const unsub = store.sub(derivedAtom, () => {})
    unsub()
    resolve.splice(0).forEach((fn) => fn())

    expect(await store.get(derivedAtom)).toEqual(2)
    expect(callBeforeAbort).toHaveBeenCalledTimes(1)
    expect(callAfterAbort).toHaveBeenCalledTimes(1)
  })
})

it('Unmount an atom that is no longer dependent within a derived atom (#2658)', async () => {
  const condAtom = atom(true)

  const baseAtom = atom(0)
  const onUnmount = vi.fn()
  baseAtom.onMount = () => onUnmount

  const derivedAtom = atom((get) => {
    if (get(condAtom)) get(baseAtom)
  })

  const store = createStore()
  store.sub(derivedAtom, () => {})
  store.set(condAtom, false)
  expect(onUnmount).toHaveBeenCalledTimes(1)
})

it('should update derived atom even if dependances changed (#2697)', () => {
  const primitiveAtom = atom<number | undefined>(undefined)
  const derivedAtom = atom((get) => get(primitiveAtom))
  const conditionalAtom = atom((get) => {
    const base = get(primitiveAtom)
    if (!base) return
    return get(derivedAtom)
  })

  const store = createStore()
  const onChangeDerived = vi.fn()

  store.sub(derivedAtom, onChangeDerived)
  store.sub(conditionalAtom, () => {})

  expect(onChangeDerived).toHaveBeenCalledTimes(0)
  store.set(primitiveAtom, 1)
  expect(onChangeDerived).toHaveBeenCalledTimes(1)
})

describe('should invoke flushPending only after all atoms are updated (#2804)', () => {
  const store = createStore()

  it('should invoke flushPending only after all atoms are updated with set', () => {
    const a = atom(0)
    const setResult = []
    const w = atom(null, (_get, set, value: number) => {
      setResult.push('before set')
      set(a, value)
      setResult.push('after set')
    })
    store.sub(a, () => {
      setResult.push('a value changed - ' + store.get(a))
    })
    setResult.push('before store.set')
    store.set(w, 1)
    setResult.push('after store.set')
    expect(setResult).not.toEqual([
      'before store.set',
      'before set',
      'a value changed - 1',
      'after set',
      'after store.set',
    ])
    expect(setResult).toEqual([
      'before store.set',
      'before set',
      'after set',
      'a value changed - 1',
      'after store.set',
    ])
  })

  it('should invoke flushPending only after all atoms are updated with mount', () => {
    const mountResult = []
    const a = atom(0)
    const m = atom(null, (_get, set, value: number) => {
      set(a, value)
    })
    m.onMount = (setSelf) => {
      mountResult.push('before onMount setSelf')
      setSelf(1)
      mountResult.push('after onMount setSelf')
    }
    mountResult.push('before store.sub')
    store.sub(a, () => {
      mountResult.push('a value changed - ' + store.get(a))
    })
    store.sub(m, () => {})
    mountResult.push('after store.sub')
    expect(mountResult).not.toEqual([
      'before store.sub',
      'before onMount setSelf',
      'a value changed - 1',
      'after onMount setSelf',
      'after store.sub',
    ])
    expect(mountResult).toEqual([
      'before store.sub',
      'before onMount setSelf',
      'after onMount setSelf',
      'a value changed - 1',
      'after store.sub',
    ])
  })
})

describe('should mount and trigger listeners even when an error is thrown', () => {
  it('in asynchronous read', async () => {
    const store = createStore()
    const a = atom(0)
    a.onMount = vi.fn()
    const e = atom(
      () => {
        throw new Error('error')
      },
      () => {},
    )
    e.onMount = vi.fn()
    const b = atom((get) => {
      setTimeout(() => {
        get(a)
        try {
          get(e)
        } catch {
          // expect error
        }
      })
    })
    store.sub(b, () => {})
    await new Promise((r) => setTimeout(r))
    expect(a.onMount).toHaveBeenCalledOnce()
    expect(e.onMount).toHaveBeenCalledOnce()
  })

  it('in read setSelf', async () => {
    const store = createStore()
    const a = atom(0)
    const e = atom(
      () => {
        throw new Error('error')
      },
      () => {},
    )
    const b = atom(
      (_, { setSelf }) => {
        setTimeout(() => {
          try {
            setSelf()
          } catch {
            // expect error
          }
        })
      },
      (get, set) => {
        set(a, 1)
        get(e)
      },
    )
    const listener = vi.fn()
    store.sub(a, listener)
    store.sub(b, () => {})
    await new Promise((r) => setTimeout(r))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('in read promise on settled', async () => {
    const store = createStore()
    const a = atom(0)
    a.onMount = vi.fn()
    const e = atom(
      () => {
        throw new Error('error')
      },
      () => {},
    )
    const b = atom(async (get) => {
      await new Promise((r) => setTimeout(r))
      get(a)
      get(e)
    })
    store.sub(b, () => {})
    await new Promise((r) => setTimeout(r))
    expect(a.onMount).toHaveBeenCalledOnce()
  })

  it('in asynchronous write', async () => {
    const store = createStore()
    const a = atom(0)
    const e = atom(() => {
      throw new Error('error')
    })
    const b = atom(null, (get, set) => {
      set(a, 1)
      get(e)
    })
    const w = atom(null, async (_get, set) => {
      setTimeout(() => {
        try {
          set(b)
        } catch {
          // expect error
        }
      })
    })
    const listener = vi.fn()
    store.sub(a, listener)
    store.set(w)
    await new Promise((r) => setTimeout(r))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('in synchronous write', () => {
    const store = createStore()
    const a = atom(0)
    a.debugLabel = 'a'
    const e = atom(() => {
      throw new Error('error')
    })
    e.debugLabel = 'e'
    const b = atom(null, (get, set) => {
      set(a, 1)
      get(e)
    })
    b.debugLabel = 'b'
    const listener = vi.fn()
    store.sub(a, listener)
    try {
      store.set(b)
    } catch {
      // expect error
    }
    expect(listener).toHaveBeenCalledOnce()
  })

  it('in onmount/onunmount asynchronous setAtom', async () => {
    const store = createStore()
    const a = atom(0)
    const e = atom(() => {
      throw new Error('error')
    })
    const b = atom(null, (get, set) => {
      set(a, (v) => ++v)
      get(e)
    })
    b.onMount = (setAtom) => {
      setTimeout(() => {
        try {
          setAtom()
        } catch {
          // expect error
        }
      })
      return () => {
        setTimeout(() => {
          try {
            setAtom()
          } catch {
            // expect error
          }
        })
      }
    }
    const listener = vi.fn()
    store.sub(a, listener)
    const unsub = store.sub(b, () => {})
    await new Promise((r) => setTimeout(r))
    expect(listener).toHaveBeenCalledOnce()
    listener.mockClear()
    unsub()
    await new Promise((r) => setTimeout(r))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('in synchronous onmount', () => {
    const store = createStore()
    const a = atom(0)
    const aUnmount = vi.fn()
    a.onMount = vi.fn(() => aUnmount)
    const b = atom(
      (get) => get(a),
      () => {},
    )
    b.onMount = () => {
      throw new Error('error')
    }
    try {
      store.sub(b, () => {})
    } catch {
      // expect error
    }
    expect(a.onMount).toHaveBeenCalledOnce()
  })

  it('in synchronous onunmount', () => {
    const store = createStore()
    const a = atom(0)
    const aUnmount = vi.fn()
    a.onMount = () => aUnmount
    const b = atom(
      (get) => get(a),
      () => {},
    )
    b.onMount = () => () => {
      throw new Error('error')
    }
    const unsub = store.sub(b, () => {})
    try {
      unsub()
    } catch {
      // expect error
    }
    expect(aUnmount).toHaveBeenCalledOnce()
  })

  it('in synchronous listener', () => {
    const store = createStore()
    const a = atom(0)
    const e = atom(0)
    const b = atom(null, (_, set) => {
      set(a, 1)
      set(e, 1)
    })
    store.sub(e, () => {
      throw new Error('error')
    })
    const listener = vi.fn()
    store.sub(a, listener)
    try {
      store.set(b)
    } catch {
      // expect error
    }
    expect(listener).toHaveBeenCalledOnce()
  })
})

it('throws falsy errors in onMount, onUnmount, and listeners', () => {
  const store = createStore()
  const a = atom(0)
  a.onMount = () => {
    throw ''
  }
  expect(() => store.sub(a, () => {})).toThrow('')
  const b = atom(0)
  b.onMount = () => () => {
    throw ''
  }
  const unsub = store.sub(b, () => {})
  expect(() => unsub()).toThrow('')
  const c = atom(0)
  store.sub(c, () => {
    throw ''
  })
  expect(() => store.set(c, 1)).toThrow('')
})

it('should use the correct pending on unmount', () => {
  const store = createStore()
  const a = atom(0)
  const b = atom(0, (_, set, update: number) => set(a, update))
  b.onMount = (setAtom) => () => setAtom(1)
  const aListener = vi.fn()
  store.sub(a, aListener)
  const unsub = store.sub(b, () => {})
  aListener.mockClear()
  unsub()
  expect(store.get(a)).toBe(1)
  expect(aListener).toHaveBeenCalledTimes(1)
})

it('should call subscribers after setAtom updates atom value on mount but not on unmount', () => {
  const store = createStore()
  const a = atom(0)
  let unmount
  a.onMount = vi.fn(((setAtom) => {
    setAtom(1)
    unmount = vi.fn(() => {
      setAtom(2)
    })
    return unmount
  }) as NonNullable<(typeof a)['onMount']>)
  const listener = vi.fn()
  const unsub = store.sub(a, listener)
  expect(store.get(a)).toBe(1)
  expect(a.onMount).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenCalledTimes(1)
  listener.mockClear()
  unsub()
  expect(store.get(a)).toBe(2)
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenCalledTimes(0)
})

it('processes deep atom a graph beyond maxDepth', () => {
  function getMaxDepth() {
    let depth = 0
    function d(): number {
      ++depth
      try {
        return d()
      } catch (error) {
        return depth
      }
    }
    return d()
  }
  const maxDepth = getMaxDepth()
  const store = createStore()
  const baseAtom = atom(0)
  const atoms: [PrimitiveAtom<number>, ...Atom<number>[]] = [baseAtom]
  Array.from({ length: maxDepth }, (_, i) => {
    const prevAtom = atoms[i]!
    const a = atom((get) => get(prevAtom))
    atoms.push(a)
  })
  const lastAtom = atoms[maxDepth]!
  // store.get(lastAtom) // FIXME: This is causing a stack overflow
  expect(() => store.sub(lastAtom, () => {})).not.toThrow()
  // store.get(lastAtom) // FIXME: This is causing a stack overflow
  expect(() => store.set(baseAtom, 1)).not.toThrow()
  // store.set(lastAtom) // FIXME: This is causing a stack overflow
})

it('mounted atom should be recomputed eagerly', () => {
  const result: string[] = []
  const a = atom(0)
  const b = atom((get) => {
    result.push('bRead')
    return get(a)
  })
  const store = createStore()
  store.sub(a, () => {
    result.push('aCallback')
  })
  store.sub(b, () => {
    result.push('bCallback')
  })
  expect(result).toEqual(['bRead'])
  result.splice(0)
  store.set(a, 1)
  expect(result).toEqual(['bRead', 'aCallback', 'bCallback'])
})

it('should process all atom listeners even if some of them throw errors', () => {
  const store = createStore()
  const a = atom(0)
  const listenerA = vi.fn()
  const listenerB = vi.fn(() => {
    throw new Error('error')
  })
  const listenerC = vi.fn()

  store.sub(a, listenerA)
  store.sub(a, listenerB)
  store.sub(a, listenerC)
  try {
    store.set(a, 1)
  } catch {
    // expect empty
  }
  expect(listenerA).toHaveBeenCalledTimes(1)
  expect(listenerB).toHaveBeenCalledTimes(1)
  expect(listenerC).toHaveBeenCalledTimes(1)
})

it('should call onInit only once per atom', () => {
  const store = createStore()
  const a = atom(0)
  const onInit = vi.fn()
  a.unstable_onInit = onInit
  store.get(a)
  expect(onInit).toHaveBeenCalledTimes(1)
  expect(onInit).toHaveBeenCalledWith(store)
  onInit.mockClear()
  store.get(a)
  store.set(a, 1)
  const unsub = store.sub(a, () => {})
  unsub()
  const b = atom((get) => get(a))
  store.get(b)
  store.sub(b, () => {})
  expect(onInit).not.toHaveBeenCalled()
})

type EnsureAtomState = ReturnType<typeof getSecretStoreMethods>[0]

const deriveStore = (
  store: ReturnType<typeof createStore>,
  enhanceEnsureAtomState: (fn: EnsureAtomState) => EnsureAtomState,
) => {
  const [ensureAtomState] = getSecretStoreMethods(store)
  const newEnsureAtomState = enhanceEnsureAtomState(ensureAtomState)
  const derivedStore = buildStore(newEnsureAtomState)
  return derivedStore
}

it('should call onInit only once per store', () => {
  const a = atom(0)
  const aOnInit = vi.fn()
  a.unstable_onInit = aOnInit
  const b = atom(0)
  const bOnInit = vi.fn()
  b.unstable_onInit = bOnInit
  type Store = ReturnType<typeof createStore>
  function testInStore(store: Store) {
    store.get(a)
    store.get(b)
    expect(aOnInit).toHaveBeenCalledTimes(1)
    expect(bOnInit).toHaveBeenCalledTimes(1)
    aOnInit.mockClear()
    bOnInit.mockClear()
    return store
  }
  testInStore(createStore())
  const store = testInStore(createStore())
  const derivedStore = deriveStore(store, (ensureAtomState) => {
    const initializedAtoms = new WeakSet()
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
  testInStore(derivedStore)
})

it('should pass store and atomState to the atom initializer', () => {
  expect.assertions(1)
  const store = createStore()
  const a = atom(null)
  a.unstable_onInit = (store) => {
    expect(store).toBe(store)
  }
  store.get(a)
})

it('recomputes dependents of unmounted atoms', () => {
  const a = atom(0)
  a.debugLabel = 'a'
  const bRead = vi.fn((get: Getter) => {
    console.log('bRead')
    return get(a)
  })
  const b = atom(bRead)
  b.debugLabel = 'b'
  const c = atom((get) => get(b))
  c.debugLabel = 'c'
  const w = atom(null, (get, set) => {
    set(a, 1)
    get(c)
    set(a, 2)
    bRead.mockClear()
  })
  const store = createStore()
  store.set(w)
  expect(bRead).not.toHaveBeenCalled()
})
