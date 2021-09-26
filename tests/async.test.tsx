import { StrictMode, Suspense, useEffect, useRef } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { atom, useAtom } from 'jotai'
import type { Atom } from 'jotai'
import { getTestProvider } from './testUtils'

const Provider = getTestProvider()

const useCommitCount = () => {
  const commitCountRef = useRef(1)
  useEffect(() => {
    commitCountRef.current += 1
  })
  return commitCountRef.current
}

it('does not show async stale result', async () => {
  const countAtom = atom(0)
  const asyncCountAtom = atom(async (get) => {
    await new Promise((r) => setTimeout(r, 100))
    return get(countAtom)
  })

  const committed: number[] = []

  const Counter = () => {
    const [count, setCount] = useAtom(countAtom)
    const onClick = async () => {
      setCount((c) => c + 1)
      await new Promise((r) => setTimeout(r, 10))
      setCount((c) => c + 1)
    }
    return (
      <>
        <div>count: {count}</div>
        <button onClick={onClick}>button</button>
      </>
    )
  }

  const DelayedCounter = () => {
    const [delayedCount] = useAtom(asyncCountAtom)
    useEffect(() => {
      committed.push(delayedCount)
    })
    return <div>delayedCount: {delayedCount}</div>
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
        <Suspense fallback="loading">
          <DelayedCounter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await waitFor(() => {
    getByText('count: 0')
    getByText('delayedCount: 0')
  })
  expect(committed).toEqual([0])

  fireEvent.click(getByText('button'))
  await findByText('loading')
  await waitFor(() => {
    getByText('count: 2')
    getByText('delayedCount: 2')
  })
  expect(committed).toEqual([0, 2])
})

it('works with async get with extra deps', async () => {
  const countAtom = atom(0)
  const anotherAtom = atom(-1)
  const asyncCountAtom = atom(async (get) => {
    get(anotherAtom)
    await new Promise((r) => setTimeout(r, 10))
    return get(countAtom)
  })

  const Counter = () => {
    const [count, setCount] = useAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={() => setCount((c) => c + 1)}>button</button>
      </>
    )
  }

  const DelayedCounter = () => {
    const [delayedCount] = useAtom(asyncCountAtom)
    return <div>delayedCount: {delayedCount}</div>
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
          <DelayedCounter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await waitFor(() => {
    getByText('count: 0')
    getByText('delayedCount: 0')
  })
  fireEvent.click(getByText('button'))
  await findByText('loading')
  await waitFor(() => {
    getByText('count: 1')
    getByText('delayedCount: 1')
  })
})

it('reuses promises on initial read', async () => {
  let invokeCount = 0
  const asyncAtom = atom(async () => {
    invokeCount += 1
    await new Promise((r) => setTimeout(r, 10))
    return 'ready'
  })

  const Child = () => {
    const [str] = useAtom(asyncAtom)
    return <div>{str}</div>
  }

  const { findByText, findAllByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Child />
          <Child />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findAllByText('ready')
  expect(invokeCount).toBe(1)
})

it('uses multiple async atoms at once', async () => {
  const someAtom = atom(async () => {
    await new Promise((r) => setTimeout(r, 10))
    return 'ready'
  })
  const someAtom2 = atom(async () => {
    await new Promise((r) => setTimeout(r, 10))
    return 'ready2'
  })

  const Component = () => {
    const [some] = useAtom(someAtom)
    const [some2] = useAtom(someAtom2)
    return (
      <>
        <div>
          {some} {some2}
        </div>
      </>
    )
  }

  const { findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Component />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('ready ready2')
})

it('uses async atom in the middle of dependency chain', async () => {
  const countAtom = atom(0)
  const asyncCountAtom = atom(async (get) => {
    await new Promise((r) => setTimeout(r, 10))
    return get(countAtom)
  })
  const delayedCountAtom = atom((get) => get(asyncCountAtom))

  const Counter = () => {
    const [count, setCount] = useAtom(countAtom)
    const [delayedCount] = useAtom(delayedCountAtom)
    return (
      <>
        <div>
          count: {count}, delayed: {delayedCount}
        </div>
        <button onClick={() => setCount((c) => c + 1)}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('count: 0, delayed: 0')

  fireEvent.click(getByText('button'))
  // no loading
  await findByText('count: 1, delayed: 1')
})

it('updates an async atom in child useEffect on remount without setTimeout', async () => {
  const toggleAtom = atom(true)
  const countAtom = atom(0)
  const asyncCountAtom = atom(
    async (get) => get(countAtom),
    async (get, set) => set(countAtom, get(countAtom) + 1)
  )

  const Counter = () => {
    const [count, incCount] = useAtom(asyncCountAtom)
    useEffect(() => {
      incCount()
    }, [incCount])
    return <div>count: {count}</div>
  }

  const Parent = () => {
    const [toggle, setToggle] = useAtom(toggleAtom)
    return (
      <>
        <button onClick={() => setToggle((x) => !x)}>button</button>
        {toggle ? <Counter /> : <div>no child</div>}
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Parent />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('count: 1')

  fireEvent.click(getByText('button'))
  await findByText('no child')

  fireEvent.click(getByText('button'))
  await findByText('count: 2')
})

it('updates an async atom in child useEffect on remount', async () => {
  const toggleAtom = atom(true)
  const countAtom = atom(0)
  const asyncCountAtom = atom(
    async (get) => {
      await new Promise((r) => setTimeout(r, 10))
      return get(countAtom)
    },
    async (get, set) => {
      await new Promise((r) => setTimeout(r, 10))
      set(countAtom, get(countAtom) + 1)
    }
  )

  const Counter = () => {
    const [count, incCount] = useAtom(asyncCountAtom)
    useEffect(() => {
      incCount()
    }, [incCount])
    return <div>count: {count}</div>
  }

  const Parent = () => {
    const [toggle, setToggle] = useAtom(toggleAtom)
    return (
      <>
        <button onClick={() => setToggle((x) => !x)}>button</button>
        {toggle ? <Counter /> : <div>no child</div>}
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Parent />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('count: 1')

  fireEvent.click(getByText('button'))
  await findByText('no child')

  fireEvent.click(getByText('button'))
  await findByText('count: 2')
})

it('async get and useEffect on parent', async () => {
  const countAtom = atom(0)
  const asyncAtom = atom(async (get) => {
    const count = get(countAtom)
    if (!count) return 'none'
    return 'resolved'
  })

  const AsyncComponent = () => {
    const [text] = useAtom(asyncAtom)
    return <div>text: {text}</div>
  }

  const Parent = () => {
    const [count, setCount] = useAtom(countAtom)
    useEffect(() => {
      setCount((c) => c + 1)
    }, [setCount])
    return (
      <>
        <div>count: {count}</div>
        <button onClick={() => setCount((c) => c + 1)}>button</button>
        <AsyncComponent />
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Parent />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await waitFor(() => {
    getByText('count: 1')
    getByText('text: resolved')
  })
})

it('async get with another dep and useEffect on parent', async () => {
  const countAtom = atom(0)
  const derivedAtom = atom((get) => get(countAtom))
  const asyncAtom = atom(async (get) => {
    const count = get(derivedAtom)
    if (!count) return 'none'
    return count
  })

  const AsyncComponent = () => {
    const [count] = useAtom(asyncAtom)
    return <div>async: {count}</div>
  }

  const Parent = () => {
    const [count, setCount] = useAtom(countAtom)
    useEffect(() => {
      setCount((c) => c + 1)
    }, [setCount])
    return (
      <>
        <div>count: {count}</div>
        <button onClick={() => setCount((c) => c + 1)}>button</button>
        <AsyncComponent />
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Parent />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await waitFor(() => {
    getByText('count: 1')
    getByText('async: 1')
  })

  fireEvent.click(getByText('button'))
  await waitFor(() => {
    getByText('count: 2')
    getByText('async: 2')
  })
})

it('set promise atom value on write (#304)', async () => {
  const countAtom = atom(Promise.resolve(0))
  countAtom.debugLabel = 'countAtom'
  const asyncAtom = atom(null, (get, set, _arg) => {
    set(
      countAtom,
      Promise.resolve(get(countAtom)).then((c) => c + 1)
    )
  })
  asyncAtom.debugLabel = 'asyncAtom'

  const Counter = () => {
    const [count] = useAtom(countAtom)
    return <div>count: {count * 1}</div>
  }

  const Parent = () => {
    const [, dispatch] = useAtom(asyncAtom)
    return (
      <>
        <Counter />
        <button onClick={dispatch}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Parent />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('count: 0')

  fireEvent.click(getByText('button'))
  await findByText('loading')
  await findByText('count: 1')
})

it('uses async atom double chain (#306)', async () => {
  const countAtom = atom(0)
  const asyncCountAtom = atom(async (get) => {
    await new Promise((r) => setTimeout(r, 10))
    return get(countAtom)
  })
  const delayedCountAtom = atom(async (get) => {
    return get(asyncCountAtom)
  })

  const Counter = () => {
    const [count, setCount] = useAtom(countAtom)
    const [delayedCount] = useAtom(delayedCountAtom)
    return (
      <>
        <div>
          count: {count}, delayed: {delayedCount}
        </div>
        <button onClick={() => setCount((c) => c + 1)}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('count: 0, delayed: 0')

  fireEvent.click(getByText('button'))
  await findByText('loading')
  await findByText('count: 1, delayed: 1')
})

it('uses an async atom that depends on another async atom', async () => {
  const asyncAtom = atom(async (get) => {
    await new Promise((r) => setTimeout(r, 10))
    get(anotherAsyncAtom)
    return 1
  })
  const anotherAsyncAtom = atom(async () => {
    return 2
  })

  const Counter = () => {
    const [num] = useAtom(asyncAtom)
    return <div>num: {num}</div>
  }

  const { findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('num: 1')
})

it('a derived atom from a newly created async atom (#351)', async () => {
  const countAtom = atom(1)
  const atomCache = new Map<number, Atom<Promise<number>>>()
  const getAsyncAtom = (n: number) => {
    if (!atomCache.has(n)) {
      atomCache.set(
        n,
        atom(async () => {
          await new Promise((r) => setTimeout(r, 10))
          return n + 10
        })
      )
    }
    return atomCache.get(n) as Atom<Promise<number>>
  }
  const derivedAtom = atom((get) => get(getAsyncAtom(get(countAtom))))

  const Counter = () => {
    const [, setCount] = useAtom(countAtom)
    const [derived] = useAtom(derivedAtom)
    return (
      <>
        <div>
          derived: {derived}, commits: {useCommitCount()}
        </div>
        <button onClick={() => setCount((c) => c + 1)}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('derived: 11, commits: 1')

  fireEvent.click(getByText('button'))
  await findByText('loading')
  await findByText('derived: 12, commits: 2')

  fireEvent.click(getByText('button'))
  await findByText('loading')
  await findByText('derived: 13, commits: 3')
})

it('Handles synchronously invoked async set (#375)', async () => {
  const loadingAtom = atom(false)
  const documentAtom = atom<string | undefined>(undefined)
  const loadDocumentAtom = atom(null, (_get, set) => {
    const fetch = async () => {
      set(loadingAtom, true)
      const response = await new Promise<string>((resolve) =>
        setTimeout(() => resolve('great document'), 10)
      )
      set(documentAtom, response)
      set(loadingAtom, false)
    }
    fetch()
  })

  const ListDocuments = () => {
    const [loading] = useAtom(loadingAtom)
    const [document] = useAtom(documentAtom)
    const [, loadDocument] = useAtom(loadDocumentAtom)

    useEffect(() => {
      loadDocument()
    }, [loadDocument])

    return (
      <>
        {loading && <div>loading</div>}
        {!loading && <div>{document}</div>}
      </>
    )
  }

  const { findByText } = render(
    <StrictMode>
      <Provider>
        <ListDocuments />
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('great document')
})

it('async write self atom', async () => {
  const countAtom = atom(0, async (get, set, _arg) => {
    set(countAtom, get(countAtom) + 1)
    await new Promise((r) => setTimeout(r, 100))
    set(countAtom, -1)
  })

  const Counter = () => {
    const [count, inc] = useAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={inc}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('button'))
  await findByText('loading') // write pending
  await findByText('count: -1')
})

it('non suspense async write self atom with setTimeout (#389)', async () => {
  const countAtom = atom(0, (get, set, _arg) => {
    set(countAtom, get(countAtom) + 1)
    setTimeout(() => {
      set(countAtom, -1)
    }, 0)
  })

  const Counter = () => {
    const [count, inc] = useAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={inc}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Counter />
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('button'))
  await findByText('count: 1')
  await findByText('count: -1')
})

it('should override promise as atom value (#430)', async () => {
  const countAtom = atom(
    new Promise<number>((r) => setTimeout(() => r(-1), 3600 * 1000))
  )
  const setCountAtom = atom(null, (_get, set, arg: number) => {
    set(countAtom, Promise.resolve(arg))
  })

  const Counter = () => {
    const [count] = useAtom(countAtom)
    return <div>count: {count * 1}</div>
  }

  const Control = () => {
    const [, setCount] = useAtom(setCountAtom)
    return <button onClick={() => setCount(1)}>button</button>
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
        <Control />
      </Provider>
    </StrictMode>
  )

  await findByText('loading')

  fireEvent.click(getByText('button'))
  await findByText('count: 1')
})

it('combine two promise atom values (#442)', async () => {
  const count1Atom = atom(
    new Promise<number>((r) => setTimeout(() => r(-1), 3600 * 1000))
  )
  const count2Atom = atom(
    new Promise<number>((r) => setTimeout(() => r(-1), 3600 * 1000))
  )
  const derivedAtom = atom((get) => get(count1Atom) + get(count2Atom))
  const initAtom = atom(null, (_get, set) => {
    setTimeout(() => {
      set(count1Atom, Promise.resolve(1))
    }, 100)
    setTimeout(() => {
      set(count2Atom, Promise.resolve(2))
    }, 100)
  })
  initAtom.onMount = (init) => {
    init()
  }

  const Counter = () => {
    const [count] = useAtom(derivedAtom)
    return <div>count: {count}</div>
  }

  const Control = () => {
    useAtom(initAtom)
    return null
  }

  const { findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
        <Control />
      </Provider>
    </StrictMode>
  )

  await findByText('loading')
  await findByText('count: 3')
})

it('set two promise atoms at once', async () => {
  const count1Atom = atom(
    new Promise<number>((r) => setTimeout(() => r(-1), 3600 * 1000))
  )
  const count2Atom = atom(
    new Promise<number>((r) => setTimeout(() => r(-1), 3600 * 1000))
  )
  const derivedAtom = atom((get) => get(count1Atom) + get(count2Atom))
  const setCountsAtom = atom(null, (_get, set) => {
    set(count1Atom, Promise.resolve(1))
    set(count2Atom, Promise.resolve(2))
  })

  const Counter = () => {
    const [count] = useAtom(derivedAtom)
    return <div>count: {count}</div>
  }

  const Control = () => {
    const [, setCounts] = useAtom(setCountsAtom)
    return <button onClick={() => setCounts()}>button</button>
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
        <Control />
      </Provider>
    </StrictMode>
  )

  await findByText('loading')

  fireEvent.click(getByText('button'))
  await findByText('count: 3')
})

it('async write chain', async () => {
  const countAtom = atom(0)
  const asyncWriteAtom = atom(null, async (_get, set, _arg) => {
    await new Promise((r) => setTimeout(r, 20))
    set(countAtom, 2)
  })
  const controlAtom = atom(null, async (_get, set, _arg) => {
    set(countAtom, 1)
    await set(asyncWriteAtom, null)
    await new Promise((r) => setTimeout(r, 10))
    set(countAtom, 3)
  })

  const Counter = () => {
    const [count] = useAtom(countAtom)
    return <div>count: {count}</div>
  }

  const Control = () => {
    const [, invoke] = useAtom(controlAtom)
    return <button onClick={invoke}>button</button>
  }

  const { getByText, findByText } = render(
    <StrictMode>
      <Provider>
        <Counter />
        <Suspense fallback="loading">
          <Control />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('button'))
  await waitFor(() => {
    getByText('count: 1')
    getByText('loading') // write pending
  })
  await waitFor(() => {
    getByText('count: 2')
    getByText('loading') // write pending
  })
  await findByText('count: 3')
})
