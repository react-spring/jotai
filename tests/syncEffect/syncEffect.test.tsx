import React, { createElement, useEffect } from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Provider, useAtom, useAtomValue, useSetAtom } from 'jotai/react'
import { atom } from 'jotai/vanilla'
import { syncEffect } from './syncEffect'
import {
  ErrorBoundary,
  assert,
  createDebugStore,
  delay,
  increment,
  incrementLetter,
} from './test-utils'

it('should run the effect on vanilla store', () => {
  const store = createDebugStore()
  const countAtom = atom(0)
  countAtom.debugLabel = 'count'

  const effectAtom = syncEffect((_, set) => {
    set(countAtom, increment)
    return () => {
      set(countAtom, 0)
    }
  })
  effectAtom.debugLabel = 'effect'

  const unsub = store.sub(effectAtom, () => {})
  expect(store.get(countAtom)).toBe(1)
  unsub()
  expect(store.get(countAtom)).toBe(0)
})

it('should run the effect on mount and cleanup on unmount once', () => {
  expect.assertions(5)
  const effect = { mount: 0, unmount: 0 }

  const effectAtom = syncEffect(() => {
    effect.mount++
    return () => {
      effect.unmount++
    }
  })

  function useTest() {
    return useAtomValue(effectAtom)
  }
  const { result, rerender, unmount } = renderHook(useTest)
  // effect does not return a value
  expect(result.current).toBe(undefined)

  // initial render should run the effect
  expect(effect.mount).toBe(1)
  rerender()
  // rerender should not run the effect again
  expect(effect.mount).toBe(1)

  unmount()
  // unmount should run the cleanup
  expect(effect.unmount).toBe(1)

  unmount()
  // a second unmount should not run the cleanup again
  expect(effect.unmount).toBe(1)
})

it('should run the effect on mount and cleanup on unmount and whenever countAtom changes', () => {
  expect.assertions(11)
  const effect = { mount: 0, unmount: 0 }

  const countAtom = atom(0)

  const effectAtom = syncEffect((get) => {
    get(countAtom)
    effect.mount++
    return () => {
      effect.unmount++
    }
  })

  let didMount = false
  const store = createDebugStore()
  function useTest() {
    const [count, setCount] = useAtom(countAtom)
    useAtomValue(effectAtom)
    useEffect(() => {
      didMount = true
    }, [count])
    return setCount
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store as any}>{children}</Provider>
  )
  const { result, rerender, unmount } = renderHook(useTest, { wrapper })
  function incrementCount() {
    const setCount = result.current
    setCount(increment)
  }
  waitFor(() => assert(didMount && effect.mount === 1))

  // initial render should run the effect but not the cleanup
  expect(effect.unmount).toBe(0)
  expect(effect.mount).toBe(1)

  rerender()
  // rerender should not run the effect again
  expect(effect.unmount).toBe(0)
  expect(effect.mount).toBe(1)

  incrementCount()

  // changing the value should run the effect again and the previous cleanup
  expect(effect.unmount).toBe(1)
  expect(effect.mount).toBe(2)

  incrementCount()

  // changing the value should run the effect again and the previous cleanup
  expect(effect.unmount).toBe(2)
  expect(effect.mount).toBe(3)

  unmount()

  // unmount should run the cleanup but not the effect again
  expect(effect.mount).toBe(3)
  expect(effect.unmount).toBe(3)

  unmount()

  // a second unmount should not run the cleanup again
  expect(effect.unmount).toBe(3)
})

it('should not cause infinite loops when effect updates the watched atom', () => {
  expect.assertions(2)
  const watchedAtom = atom(0)
  let runCount = 0
  const effectAtom = syncEffect((get, set) => {
    get(watchedAtom)
    runCount++
    set(watchedAtom, increment)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})

  const incrementWatched = () => store.set(watchedAtom, increment)
  // initial render should run the effect once
  expect(runCount).toBe(1)
  // changing the value should run the effect again one time
  incrementWatched()
  expect(runCount).toBe(2)
})

it('should not cause infinite loops when effect updates the watched atom asynchronous', () => {
  expect.assertions(1)
  const watchedAtom = atom(0)
  let runCount = 0
  const effectAtom = syncEffect((get, set) => {
    get(watchedAtom)
    runCount++
    setTimeout(() => {
      set(watchedAtom, increment)
    }, 0)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  // changing the value should run the effect again one time
  store.set(watchedAtom, increment)
  expect(runCount).toBe(2)
})

it('should allow synchronous recursion with set.recurse for first run', () => {
  expect.assertions(1)
  let runCount = 0
  const watchedAtom = atom(0)
  const effectAtom = syncEffect((get, { recurse }) => {
    const value = get(watchedAtom)
    runCount++
    if (value >= 3) {
      return
    }
    recurse(watchedAtom, increment)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  expect({ runCount, watched: store.get(watchedAtom) }).toEqual({
    runCount: 4, // 2
    watched: 3, // 2
  })
})

it('should allow synchronous recursion with set.recurse', () => {
  expect.assertions(2)
  let runCount = 0
  const watchedAtom = atom(0)
  const effectAtom = syncEffect((get, { recurse }) => {
    const value = get(watchedAtom)
    runCount++
    if (value === 0) {
      return
    }
    if (value >= 5) {
      return
    }
    recurse(watchedAtom, increment)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  store.set(watchedAtom, increment)
  expect(store.get(watchedAtom)).toBe(5)
  expect(runCount).toBe(6)
})

it('should allow multiple synchronous recursion with set.recurse', () => {
  expect.assertions(1)
  let runCount = 0
  const watchedAtom = atom(0)
  const effectAtom = syncEffect((get, { recurse }) => {
    const value = get(watchedAtom)
    runCount++
    if (value === 0) {
      return
    }
    if (value >= 3) {
      return
    }
    recurse(watchedAtom, increment)
    recurse(watchedAtom, increment)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  store.set(watchedAtom, increment)
  expect({ runCount, value: store.get(watchedAtom) }).toEqual({
    runCount: 6,
    value: 5,
  })
})

it('should batch updates during synchronous recursion with set.recurse', () => {
  expect.assertions(2)
  let runCount = 0
  const lettersAtom = atom('a')
  const numbersAtom = atom(0)
  const watchedAtom = atom(0)
  const lettersAndNumbersAtom = atom([] as string[])
  const updateAtom = atom(0, (_get, set) => {
    set(lettersAtom, incrementLetter)
    set(numbersAtom, increment)
  })
  const effectAtom = syncEffect((get, set) => {
    const letters = get(lettersAtom)
    const numbers = get(numbersAtom)
    get(watchedAtom)
    const thisRunCount = runCount++
    if (thisRunCount === 0) {
      return
    }
    if (thisRunCount >= 3) {
      return
    }
    set(lettersAndNumbersAtom, (lettersAndNumbers: string[]) => [
      ...lettersAndNumbers,
      letters + String(numbers),
    ])
    set.recurse(updateAtom)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  store.set(watchedAtom, increment)
  expect(store.get(lettersAndNumbersAtom)).toEqual(['a0', 'b1'])
  expect(runCount).toBe(4)
})

it('should allow asynchronous recursion with task delay with set.recurse', async () => {
  expect.assertions(2)
  let runCount = 0
  const watchedAtom = atom(0)
  let done = false
  const effectAtom = syncEffect((get, { recurse }) => {
    const value = get(watchedAtom)
    runCount++
    if (value >= 3) {
      done = true
      return
    }
    delay(0).then(() => {
      recurse(watchedAtom, increment)
    })
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  await waitFor(() => assert(done))
  expect(store.get(watchedAtom)).toBe(3)
  expect(runCount).toBe(4)
})

it('should allow asynchronous recursion with microtask delay with set.recurse', async () => {
  expect.assertions(2)
  let runCount = 0
  const watchedAtom = atom(0)
  watchedAtom.debugLabel = 'watchedAtom' // remove
  const effectAtom = syncEffect((get, { recurse }) => {
    const value = get(watchedAtom)
    runCount++
    if (value >= 3) {
      return
    }
    Promise.resolve().then(() => {
      recurse(watchedAtom, increment)
    })
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  await waitFor(() => assert(store.get(watchedAtom) >= 3))
  expect(store.get(watchedAtom)).toBe(3)
  expect(runCount).toBe(4)
})

it('should work with both set.recurse and set', () => {
  expect.assertions(3)
  let runCount = 0
  const valueAtom = atom(0)
  const countAtom = atom(0)
  const effectAtom = syncEffect((get, set) => {
    const value = get(valueAtom)
    if (value >= 5) {
      throw new Error()
    }
    get(countAtom)
    runCount++
    if (value === 0 || value % 3) {
      set.recurse(valueAtom, increment)
      set(countAtom, increment)
      return
    }
    set(valueAtom, increment)
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  expect(store.get(countAtom)).toBe(3)
  expect(store.get(valueAtom)).toBe(4)
  expect(runCount).toBe(4)
})

it('should disallow synchronous set.recurse in cleanup', () => {
  expect.assertions(1)
  const watchedAtom = atom(0)
  const anotherAtom = atom(0)
  let cleanup
  const effectAtom = syncEffect((get, { recurse }) => {
    get(watchedAtom)
    get(anotherAtom)
    cleanup = vi.fn(() => {
      recurse(watchedAtom, increment)
    })
    return cleanup
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  expect(() => store.set(anotherAtom, increment)).toThrowError(
    'set.recurse is not allowed in cleanup',
  )
})

// FIXME: is there a way to disallow asynchronous infinite loops in cleanup?

it('should return value from set.recurse', () => {
  expect.assertions(1)
  const countAtom = atom(0)
  const incrementCountAtom = atom(null, (get, set) => {
    set(countAtom, increment)
    return get(countAtom)
  })
  const results = [] as number[]
  const effectAtom = syncEffect((get, { recurse }) => {
    const value = get(countAtom)
    if (value < 5) {
      const result = recurse(incrementCountAtom)
      results.unshift(result)
      return
    }
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  expect(results).toEqual([1, 2, 3, 4, 5])
})

it('should conditionally run the effect and cleanup when effectAtom is unmounted', () => {
  expect.assertions(6)

  const booleanAtom = atom(false)
  let effectRunCount = 0
  let cleanupRunCount = 0

  const effectAtom = syncEffect(() => {
    effectRunCount++
    return () => {
      cleanupRunCount++
    }
  })

  const conditionalEffectAtom = atom((get) => {
    if (get(booleanAtom)) get(effectAtom)
  })

  function useTest() {
    useAtomValue(conditionalEffectAtom)
    return useSetAtom(booleanAtom)
  }

  const { result } = renderHook(useTest)
  const setBoolean = result.current
  const toggleBoolean = () => setBoolean((prev) => !prev)

  // Initially the effectAtom should not run as booleanAtom is false
  expect(effectRunCount).toBe(0)
  expect(cleanupRunCount).toBe(0)

  // Set booleanAtom to true, so effectAtom should run
  toggleBoolean()
  expect(effectRunCount).toBe(1)
  expect(cleanupRunCount).toBe(0)

  // Set booleanAtom to false, so effectAtom should cleanup
  toggleBoolean()
  expect(effectRunCount).toBe(1)
  expect(cleanupRunCount).toBe(1)
})

describe('should correctly process synchronous updates to the same atom', () => {
  type SetupProps = {
    effectIncrementCountBy: number
    incrementCountBy: number
  }
  function setup({ effectIncrementCountBy, incrementCountBy }: SetupProps) {
    const countAtom = atom(0)
    const runCount = { current: 0 }
    const effectAtom = syncEffect((get, set) => {
      runCount.current++
      get(countAtom)
      for (let i = 0; i < effectIncrementCountBy; i++) {
        set(countAtom, increment)
      }
    })
    function useTest() {
      useAtomValue(effectAtom)
      const [count, setCount] = useAtom(countAtom)
      const incrementCount = () => {
        for (let i = 0; i < incrementCountBy; i++) {
          setCount(increment)
        }
      }
      return { count, incrementCount }
    }
    const { result } = renderHook(useTest)
    return { result, runCount }
  }

  type Run = {
    runCount: number
    resultCount: number
  }

  type Solution = {
    effectIncrementCountBy: number
    incrementCountBy: number
    runs: [Run, Run]
  }

  const solutions: Solution[] = [
    {
      // 1. initial render causes effect to run: run = 1
      effectIncrementCountBy: 0,
      incrementCountBy: 0,
      runs: [
        { runCount: 1, resultCount: 0 },
        { runCount: 1, resultCount: 0 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. incrementing count: count = 1
      // 3. incrementing count reruns the effect: run = 2
      effectIncrementCountBy: 0,
      incrementCountBy: 1,
      runs: [
        { runCount: 1, resultCount: 0 },
        { runCount: 2, resultCount: 1 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. incrementing count: count = 1
      // 3. incrementing count: count = 2
      // 4. incrementing count reruns the effect (batched): run = 2
      // FIXME: understand why run-result: 3-2
      effectIncrementCountBy: 0,
      incrementCountBy: 2,
      runs: [
        { runCount: 1, resultCount: 0 },
        { runCount: 2, resultCount: 2 },
      ],
    },
    {
      // effect should not rerun when it changes a value it is watching
      // 1. initial render causes effect to run: run = 1
      // 2. effect increments count: count = 1
      effectIncrementCountBy: 1,
      incrementCountBy: 0,
      runs: [
        { runCount: 1, resultCount: 1 },
        { runCount: 1, resultCount: 1 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. effect increments count: count = 1
      // 3. incrementing count: count = 2
      // 4. incrementing count reruns the effect: run = 2
      // 5. effect increments count: count = 3
      effectIncrementCountBy: 1,
      incrementCountBy: 1,
      runs: [
        { runCount: 1, resultCount: 1 },
        { runCount: 2, resultCount: 3 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. effect increments count: count = 1
      // 3. incrementing count: count = 2
      // 4. incrementing count: count = 3
      // 5. incrementing count reruns the effect (batched): run = 2
      // 6. effect increments count: count = 4
      // FIXME: understand why run-result: 3-5
      effectIncrementCountBy: 1,
      incrementCountBy: 2,
      runs: [
        { runCount: 1, resultCount: 1 },
        { runCount: 2, resultCount: 4 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. effect increments count by two: count = 2
      effectIncrementCountBy: 2,
      incrementCountBy: 0,
      runs: [
        { runCount: 1, resultCount: 2 },
        { runCount: 1, resultCount: 2 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. effect increments count by two: count = 2
      // 3. incrementing count: count = 3
      // 4. incrementing count reruns the effect: run = 2
      // 5. effect increments count by two: count = 5
      effectIncrementCountBy: 2,
      incrementCountBy: 1,
      runs: [
        { runCount: 1, resultCount: 2 },
        { runCount: 2, resultCount: 5 },
      ],
    },
    {
      // 1. initial render causes effect to run: run = 1
      // 2. effect increments count by two: count = 2
      // 3. incrementing count: count = 3
      // 4. incrementing count: count = 4
      // 5. incrementing count reruns the effect (batched): run = 2
      // 6. effect increments count by two: count = 6
      // FIXME: understand why run-result: 3-8
      effectIncrementCountBy: 2,
      incrementCountBy: 2,
      runs: [
        { runCount: 1, resultCount: 2 },
        { runCount: 2, resultCount: 6 },
      ],
    },
  ]

  it.each(solutions)(
    'should correctly process synchronous updates when effectIncrementCountBy is $effectIncrementCountBy and incrementCountBy is $incrementCountBy',
    async ({ effectIncrementCountBy, incrementCountBy, runs }) => {
      expect.assertions(3)
      const { result, runCount } = setup({
        effectIncrementCountBy,
        incrementCountBy,
      })

      const [before, after] = runs

      // initial value after $effectIncrementCountBy synchronous updates in the effect
      await waitFor(() => assert(runCount.current === before.runCount))

      // initial render should run the effect once
      expect(runCount.current).toBe(before.runCount)

      // perform $incrementCountBy synchronous updates
      await act(async () => result.current.incrementCount())

      // final value after synchronous updates and rerun of the effect
      expect(result.current.count).toBe(after.resultCount)

      expect(runCount.current).toBe(after.runCount)
    },
  )
})

it('should not batch effect setStates', async () => {
  expect.assertions(4)
  const valueAtom = atom(0)
  const runCount = { current: 0 }
  const derivedAtom = atom((get) => {
    runCount.current++
    return get(valueAtom)
  })
  const triggerAtom = atom(false)
  const effectAtom = syncEffect((get, set) => {
    if (get(triggerAtom)) {
      set(valueAtom, increment)
      set(valueAtom, increment)
    }
  })
  const { result: valueResult } = renderHook(() => useAtomValue(derivedAtom))
  renderHook(() => useAtomValue(effectAtom))
  const { result } = renderHook(() => useSetAtom(triggerAtom))
  const setTrigger = result.current

  expect(valueResult.current).toBe(0)
  expect(runCount.current).toBe(1)

  await act(async () => setTrigger((x) => !x))
  expect(valueResult.current).toBe(2)
  expect(runCount.current).toBe(3) // <--- not batched (we would expect runCount to be 2 if batched)
})

it('should batch synchronous updates as a single transaction', () => {
  expect.assertions(4)
  const lettersAtom = atom('a')
  lettersAtom.debugLabel = 'lettersAtom'
  const numbersAtom = atom(0)
  numbersAtom.debugLabel = 'numbersAtom'
  const lettersAndNumbersAtom = atom([] as string[])
  lettersAndNumbersAtom.debugLabel = 'lettersAndNumbersAtom'
  let runCount = 0
  const effectAtom = syncEffect((get, set) => {
    runCount++
    const letters = get(lettersAtom)
    const numbers = get(numbersAtom)
    set(lettersAndNumbersAtom, (lettersAndNumbers) => [
      ...lettersAndNumbers,
      letters + String(numbers),
    ])
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})

  expect(runCount).toBe(1)
  expect(store.get(lettersAndNumbersAtom)).toEqual(['a0'])
  const w = atom(null, (_get, set) => {
    set(lettersAtom, incrementLetter)
    set(numbersAtom, increment)
  })
  store.set(w)
  expect(runCount).toBe(2)
  expect(store.get(lettersAndNumbersAtom)).toEqual(['a0', 'b1'])
})

it('should run the effect once even if the effect is mounted multiple times', () => {
  expect.assertions(3)
  const lettersAtom = atom('a')
  const numbersAtom = atom(0)
  const lettersAndNumbersAtom = atom(null, (_get, set) => {
    set(lettersAtom, incrementLetter)
    set(numbersAtom, increment)
  })
  let runCount = 0
  const effectAtom = syncEffect((get) => {
    runCount++
    get(lettersAtom)
    get(lettersAtom)
    get(numbersAtom)
    get(numbersAtom)
  })
  const derivedAtom = atom((get) => {
    get(effectAtom)
    get(effectAtom)
  })
  const derivedAtom2 = atom((get) => {
    get(effectAtom)
  })
  const derivedAtom3 = atom((get) => {
    get(derivedAtom2)
  })
  const derivedAtom4 = atom((get) => {
    get(derivedAtom2)
  })
  function useTest() {
    useAtomValue(effectAtom)
    useAtomValue(effectAtom)
    useAtomValue(derivedAtom)
    useAtomValue(derivedAtom)
    useAtomValue(derivedAtom2)
    useAtomValue(derivedAtom3)
    useAtomValue(derivedAtom4)
    return useSetAtom(lettersAndNumbersAtom)
  }
  const { result } = renderHook(useTest)
  const setLettersAndNumbers = result.current
  expect(runCount).toBe(1)
  act(setLettersAndNumbers)
  expect(runCount).toBe(2)
  act(setLettersAndNumbers)
  expect(runCount).toBe(3)
})

it('should abort the previous promise', async () => {
  let runCount = 0
  const abortedRuns: number[] = []
  const completedRuns: number[] = []
  const resolves: (() => void)[] = []
  const countAtom = atom(0)
  const abortControllerAtom = atom<{ abortController: AbortController | null }>(
    {
      abortController: null,
    },
  )
  const effectAtom = syncEffect((get) => {
    const currentRun = runCount++
    get(countAtom)
    const abortControllerRef = get(abortControllerAtom)
    const abortController = new AbortController()
    const { signal } = abortController
    let aborted = false
    const abortCallback = () => {
      abortedRuns.push(currentRun)
      aborted = true
    }
    signal.addEventListener('abort', abortCallback)

    abortControllerRef.abortController = abortController
    new Promise<void>((resolve) => resolves.push(resolve)).then(() => {
      if (aborted) return
      abortControllerRef.abortController = null
      completedRuns.push(currentRun)
    })
    return () => {
      abortControllerRef.abortController?.abort()
      abortControllerRef.abortController = null
      signal.removeEventListener('abort', abortCallback)
    }
  })
  async function resolveAll() {
    resolves.forEach((resolve) => resolve())
    resolves.length = 0
  }
  function useTest() {
    useAtomValue(effectAtom)
    return useSetAtom(countAtom)
  }
  const { result } = renderHook(useTest)
  const setCount = result.current

  await resolveAll()
  expect(runCount).toBe(1)
  expect(abortedRuns).toEqual([])
  expect(completedRuns).toEqual([0])

  act(() => setCount(increment))
  expect(runCount).toBe(2)
  expect(abortedRuns).toEqual([])
  expect(completedRuns).toEqual([0])

  // aborted run
  act(() => setCount(increment))
  expect(runCount).toBe(3)
  expect(abortedRuns).toEqual([1])
  expect(completedRuns).toEqual([0])

  await resolveAll()
  expect(runCount).toBe(3)
  expect(abortedRuns).toEqual([1])
  expect(completedRuns).toEqual([0, 2])
})

it('should not infinite loop with nested atomEffects', async () => {
  const metrics = {
    mounted: 0,
    runCount1: 0,
    runCount2: 0,
    unmounted: 0,
  }
  const countAtom = atom(0)
  countAtom.onMount = () => {
    ++metrics.mounted
    return () => ++metrics.unmounted
  }

  let delayedIncrement = false
  const effectAtom = syncEffect((_get, set) => {
    ++metrics.runCount1
    if (metrics.runCount1 > 1) throw new Error('infinite loop')
    Promise.resolve().then(() => {
      delayedIncrement = true
      set(countAtom, increment)
    })
  })

  const readOnlyAtom = atom((get) => {
    get(effectAtom)
    return get(countAtom)
  })

  const effect2Atom = syncEffect((get, _set) => {
    ++metrics.runCount2
    get(readOnlyAtom)
  })

  const store = createDebugStore()
  store.sub(effect2Atom, () => {})

  await waitFor(() => assert(delayedIncrement))

  if (!('dev4_get_mounted_atoms' in store)) return
  const atomSet = new Set(store.dev4_get_mounted_atoms())
  expect({
    countAtom: atomSet.has(countAtom),
    effectAtom: atomSet.has(effectAtom),
    readOnlyAtom: atomSet.has(readOnlyAtom),
  }).toEqual({
    countAtom: true,
    effectAtom: true,
    readOnlyAtom: true,
  })

  expect(metrics).toEqual({
    mounted: 1,
    runCount1: 1,
    runCount2: 2,
    unmounted: 0,
  })
})

it('should not rerun with get.peek', () => {
  expect.assertions(1)
  const countAtom = atom(0)
  let runCount = 0
  const effectAtom = syncEffect((get) => {
    get.peek(countAtom)
    runCount++
  })
  const store = createDebugStore()
  store.sub(effectAtom, () => {})
  store.set(countAtom, increment)
  expect(runCount).toBe(1)
})

it('should trigger the error boundary when an error is thrown', async () => {
  expect.assertions(1)
  const effectAtom = syncEffect((_get, _set) => {
    throw new Error('effect error')
  })
  function TestComponent() {
    useAtomValue(effectAtom)
    return <div>test</div>
  }
  let didThrow = false
  function wrapper() {
    return (
      <ErrorBoundary componentDidCatch={() => (didThrow = true)}>
        <TestComponent />
      </ErrorBoundary>
    )
  }
  const originalConsoleError = console.error
  try {
    console.error = vi.fn()
    render(<TestComponent />, { wrapper })
  } finally {
    console.error = originalConsoleError
  }
  await waitFor(() => assert(didThrow))
  expect(didThrow).toBe(true)
})

it('should trigger an error boundary when an error is thrown in a cleanup', async () => {
  expect.assertions(1)

  const refreshAtom = atom(0)
  refreshAtom.debugLabel = 'refresh'

  const effectAtom = syncEffect((get, _set) => {
    get(refreshAtom)
    return () => {
      throw new Error('effect cleanup error')
    }
  })
  effectAtom.debugLabel = 'effect'

  const store = createDebugStore()
  function TestComponent() {
    useAtomValue(effectAtom)
    return <div>test</div>
  }
  let didThrow = false
  function wrapper() {
    return (
      <Provider store={store}>
        <ErrorBoundary
          componentDidCatch={(error, _errorInfo) => {
            if (!didThrow) {
              expect(error.message).toBe('effect cleanup error')
            }
            didThrow = true
          }}
        >
          <TestComponent />
        </ErrorBoundary>
      </Provider>
    )
  }
  render(<TestComponent />, { wrapper })
  const originalConsoleError = console.error
  try {
    console.error = vi.fn()
    act(() => store.set(refreshAtom, increment))
  } finally {
    console.error = originalConsoleError
  }
  await waitFor(() => assert(didThrow))
})

it('should not suspend the component', () => {
  const countAtom = atom(0)
  const watchCounterEffect = syncEffect((get) => {
    get(countAtom)
  })
  let didSuspend = false
  function App() {
    try {
      useAtomValue(watchCounterEffect)
    } catch (error) {
      didSuspend ||= error instanceof Promise
    }
    return null
  }
  const store = createDebugStore()
  render(<App />, {
    wrapper: ({ children }) => createElement(Provider, { store }, children),
  })
  act(() => {
    store.set(countAtom, increment)
  })
  expect(didSuspend).toBe(false)
})
