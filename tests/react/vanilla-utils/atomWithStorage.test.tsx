import { StrictMode, Suspense } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { useAtom } from 'jotai/react'
import { atom, createStore } from 'jotai/vanilla'
import {
  RESET,
  atomWithStorage,
  createJSONStorage,
  unstable_withStorageValidator as withStorageValidator,
} from 'jotai/vanilla/utils'
import type { SyncStringStorage } from 'jotai/vanilla/utils/atomWithStorage'

const resolve: (() => void)[] = []

describe('atomWithStorage (sync)', () => {
  const storageData: Record<string, number> = {
    count: 10,
  }
  const dummyStorage = {
    getItem: (key: string, initialValue: number) => {
      if (!(key in storageData)) {
        return initialValue
      }
      return storageData[key] as number
    },
    setItem: (key: string, newValue: number) => {
      storageData[key] = newValue
    },
    removeItem: (key: string) => {
      delete storageData[key]
    },
    listeners: new Set<(key: string, value: number | null) => void>(),
    emitStorageEvent: (key: string, newValue: number | null) => {
      dummyStorage.listeners.forEach((listener) => {
        listener(key, newValue)
      })
    },
    subscribe: (
      key: string,
      callback: (value: number) => void,
      initialValue: number,
    ) => {
      const listener = (k: string, value: number | null) => {
        if (k === key) {
          callback(value ?? initialValue)
        }
      }
      dummyStorage.listeners.add(listener)
      return () => dummyStorage.listeners.delete(listener)
    },
  }

  it('simple count', async () => {
    const countAtom = atomWithStorage('count', 1, dummyStorage)

    const Counter = () => {
      const [count, setCount] = useAtom(countAtom)
      return (
        <>
          <div>count: {count}</div>
          <button onClick={() => setCount((c) => c + 1)}>button</button>
          <button onClick={() => setCount(RESET)}>reset</button>
        </>
      )
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('count: 10')

    await userEvent.click(screen.getByText('button'))
    await screen.findByText('count: 11')
    expect(storageData.count).toBe(11)

    await userEvent.click(screen.getByText('reset'))
    await screen.findByText('count: 1')
    expect(storageData.count).toBeUndefined()
  })

  it('storage updates before mount (#1079)', async () => {
    dummyStorage.setItem('count', 10)
    const countAtom = atomWithStorage('count', 1, dummyStorage)

    const Counter = () => {
      const [count] = useAtom(countAtom)
      // emulating updating before mount
      if (dummyStorage.getItem('count', 1) !== 9) {
        dummyStorage.emitStorageEvent('count', 9)
      }
      return <div>count: {count}</div>
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('count: 9')
  })
})

describe('with sync string storage', () => {
  const storageData: Record<string, string> = {
    count: '10',
  }
  const stringStorage = {
    getItem: (key: string) => {
      return storageData[key] || null
    },
    setItem: (key: string, newValue: string) => {
      storageData[key] = newValue
    },
    removeItem: (key: string) => {
      delete storageData[key]
    },
    listeners: new Set<(key: string, value: string | null) => void>(),
    emitStorageEvent: (key: string, newValue: string | null) => {
      stringStorage.listeners.forEach((listener) => {
        listener(key, newValue)
      })
    },
  }
  const dummyStorage = createJSONStorage<number>(() => stringStorage)
  dummyStorage.subscribe = (key, callback, initialValue) => {
    const listener = (k: string, value: string | null) => {
      if (k === key) {
        let newValue: number
        try {
          newValue = JSON.parse(value ?? '')
        } catch {
          newValue = initialValue
        }
        callback(newValue)
      }
    }
    stringStorage.listeners.add(listener)
    return () => stringStorage.listeners.delete(listener)
  }

  it('simple count', async () => {
    const countAtom = atomWithStorage('count', 1, dummyStorage)

    const Counter = () => {
      const [count, setCount] = useAtom(countAtom)
      return (
        <>
          <div>count: {count}</div>
          <button onClick={() => setCount((c) => c + 1)}>button</button>
          <button onClick={() => setCount(RESET)}>reset</button>
          <button onClick={() => setCount((c) => (c === 2 ? RESET : c + 1))}>
            conditional reset
          </button>
        </>
      )
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('count: 10')

    await userEvent.click(screen.getByText('button'))
    await screen.findByText('count: 11')
    expect(storageData.count).toBe('11')

    await userEvent.click(screen.getByText('reset'))
    await screen.findByText('count: 1')
    expect(storageData.count).toBeUndefined()

    await userEvent.click(screen.getByText('button'))
    await screen.findByText('count: 2')
    expect(storageData.count).toBe('2')

    await userEvent.click(screen.getByText('conditional reset'))
    await screen.findByText('count: 1')
    expect(storageData.count).toBeUndefined()
  })

  it('no entry (#1086)', async () => {
    const noentryAtom = atomWithStorage('noentry', -1, dummyStorage)

    const Counter = () => {
      const [noentry] = useAtom(noentryAtom)
      return <div>noentry: {noentry}</div>
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('noentry: -1')
  })
})

describe('atomWithStorage (async)', () => {
  const asyncStorageData: Record<string, number> = {
    count: 10,
  }
  const asyncDummyStorage = {
    getItem: async (key: string, initialValue: number) => {
      await new Promise<void>((r) => resolve.push(r))
      if (!(key in asyncStorageData)) {
        return initialValue
      }
      return asyncStorageData[key] as number
    },
    setItem: async (key: string, newValue: number) => {
      await new Promise<void>((r) => resolve.push(r))
      asyncStorageData[key] = newValue
    },
    removeItem: async (key: string) => {
      await new Promise<void>((r) => resolve.push(r))
      delete asyncStorageData[key]
    },
  }

  it('async count', async () => {
    const countAtom = atomWithStorage('count', 1, asyncDummyStorage)

    const Counter = () => {
      const [count, setCount] = useAtom(countAtom)
      return (
        <>
          <div>count: {count}</div>
          <button onClick={() => setCount(async (c) => (await c) + 1)}>
            button
          </button>
          <button onClick={() => setCount(RESET)}>reset</button>
        </>
      )
    }

    await act(async () => {
      render(
        <StrictMode>
          <Suspense fallback="loading">
            <Counter />
          </Suspense>
        </StrictMode>,
      )
    })

    resolve.splice(0).forEach((fn) => fn())
    await screen.findByText('count: 10')

    await userEvent.click(screen.getByText('button'))
    resolve.splice(0).forEach((fn) => fn())
    await screen.findByText('count: 11')
    resolve.splice(0).forEach((fn) => fn())
    await waitFor(() => {
      expect(asyncStorageData.count).toBe(11)
    })

    await userEvent.click(screen.getByText('reset'))
    resolve.splice(0).forEach((fn) => fn())
    await screen.findByText('count: 1')
    await waitFor(() => {
      expect(asyncStorageData.count).toBeUndefined()
    })
  })

  it('async new count', async () => {
    const countAtom = atomWithStorage('count2', 20, asyncDummyStorage)

    const Counter = () => {
      const [count, setCount] = useAtom(countAtom)
      return (
        <>
          <div>count: {count}</div>
          <button onClick={() => setCount(async (c) => (await c) + 1)}>
            button
          </button>
        </>
      )
    }

    render(
      <StrictMode>
        <Suspense fallback="loading">
          <Counter />
        </Suspense>
      </StrictMode>,
    )

    await screen.findByText('count: 20')

    await userEvent.click(screen.getByText('button'))
    resolve.splice(0).forEach((fn) => fn())
    await screen.findByText('count: 21')
    resolve.splice(0).forEach((fn) => fn())
    await waitFor(() => {
      expect(asyncStorageData.count2).toBe(21)
    })
  })
})

describe('atomWithStorage (without localStorage) (#949)', () => {
  it('createJSONStorage without localStorage', async () => {
    const countAtom = atomWithStorage(
      'count',
      1,
      createJSONStorage(() => undefined as any),
    )

    const Counter = () => {
      const [count, setCount] = useAtom(countAtom)
      return (
        <>
          <div>count: {count}</div>
          <button onClick={() => setCount(async (c) => (await c) + 1)}>
            button
          </button>
        </>
      )
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('count: 1')
  })
})

describe('atomWithStorage (in non-browser environment)', () => {
  const asyncStorageData: Record<string, string> = {
    count: '10',
  }
  const asyncDummyStorage = {
    getItem: async (key: string) => {
      await new Promise<void>((r) => resolve.push(r))
      return asyncStorageData[key] as string
    },
    setItem: async (key: string, newValue: string) => {
      await new Promise<void>((r) => resolve.push(r))
      asyncStorageData[key] = newValue
    },
    removeItem: async (key: string) => {
      await new Promise<void>((r) => resolve.push(r))
      delete asyncStorageData[key]
    },
  }

  const addEventListener = window.addEventListener
  const localStorage = window.localStorage
  const sessionStorage = window.sessionStorage
  const consoleWarn = window.console.warn

  beforeAll(() => {
    ;(window as any).addEventListener = undefined
    // patch console.warn to prevent logging along test results
    Object.defineProperty(window.console, 'warn', {
      value: () => {},
    })
    Object.defineProperties(window, {
      localStorage: {
        get() {
          throw new Error('localStorage is not available.')
        },
      },
      sessionStorage: {
        get() {
          throw new Error('sessionStorage is not available.')
        },
      },
    })
  })

  afterAll(() => {
    window.addEventListener = addEventListener
    Object.defineProperty(window.console, 'warn', {
      value: consoleWarn,
    })
    Object.defineProperties(window, {
      localStorage: {
        get() {
          return localStorage
        },
      },
      sessionStorage: {
        get() {
          return sessionStorage
        },
      },
    })
  })

  it('createJSONStorage with undefined window.addEventListener', async () => {
    const storage = createJSONStorage(() => asyncDummyStorage)
    expect(storage.subscribe).toBeUndefined()
  })

  it('createJSONStorage with localStorage', async () => {
    expect(() => createJSONStorage()).not.toThrow()
    expect(() => createJSONStorage(() => window.localStorage)).not.toThrow()
  })

  it('createJSONStorage with sessionStorage', async () => {
    expect(() => createJSONStorage(() => window.sessionStorage)).not.toThrow()
  })
})

describe('atomWithStorage (with browser storage)', () => {
  const addEventListener = window.addEventListener
  const mockAddEventListener = vi.fn()

  beforeAll(() => {
    ;(window as any).addEventListener = mockAddEventListener
  })

  afterAll(() => {
    window.addEventListener = addEventListener
  })

  it('createJSONStorage subscribes to specific window storage events', async () => {
    const store = createStore()
    const mockNativeStorage = Object.create(window.Storage.prototype)
    mockNativeStorage.setItem = vi.fn() as Storage['setItem']
    mockNativeStorage.getItem = vi.fn(() => null) as Storage['getItem']
    mockNativeStorage.removeItem = vi.fn() as Storage['removeItem']

    const dummyAtom = atomWithStorage<number>(
      'dummy',
      1,
      createJSONStorage<number>(() => mockNativeStorage),
    )

    const DummyComponent = () => {
      const [value] = useAtom(dummyAtom, { store })
      return (
        <>
          <div>{value}</div>
        </>
      )
    }

    render(
      <StrictMode>
        <DummyComponent />
      </StrictMode>,
    )

    expect(mockAddEventListener).toHaveBeenCalledWith(
      'storage',
      expect.any(Function),
    )

    const storageEventHandler = mockAddEventListener.mock.calls
      .filter(([eventName]: any) => eventName === 'storage')
      .pop()?.[1] as (e: StorageEvent) => void

    expect(store.get(dummyAtom)).toBe(1)

    act(() => {
      storageEventHandler?.({
        key: 'dummy',
        newValue: '2',
        storageArea: {},
      } as StorageEvent)
    })

    expect(store.get(dummyAtom)).toBe(1)

    act(() => {
      storageEventHandler?.({
        key: 'dummy',
        newValue: '2',
        storageArea: mockNativeStorage,
      } as StorageEvent)
    })

    expect(store.get(dummyAtom)).toBe(2)

    act(() => {
      // simulate removeItem() from another window
      storageEventHandler?.({
        key: 'dummy',
        newValue: null,
        storageArea: mockNativeStorage,
      } as StorageEvent)
    })

    expect(store.get(dummyAtom)).toBe(1)
  })

  it("should recompute dependents' state after onMount (#2098)", async () => {
    const store = createStore()
    let currentValue: string | null = 'true'
    const mockNativeStorage = {
      setItem: vi.fn((_key: string, value: string) => (currentValue = value)),
      getItem: vi.fn(() => currentValue),
      removeItem: vi.fn(() => (currentValue = null)),
    }

    const isLoggedAtom = atom(false)
    const isDevModeStorageAtom = atomWithStorage(
      'isDevModeStorageAtom',
      false,
      createJSONStorage<boolean>(() => mockNativeStorage),
    )
    const isDevModeState = atom(
      (get) => {
        if (!get(isLoggedAtom)) return false
        return get(isDevModeStorageAtom)
      },
      (_get, set, value: boolean) => {
        set(isDevModeStorageAtom, value)
      },
    )

    const DummyComponent = () => {
      const [isLogged] = useAtom(isLoggedAtom, { store })
      const [value, setValue] = useAtom(isDevModeState, { store })
      return isLogged ? (
        <input
          type="checkbox"
          checked={value}
          onChange={() => setValue(!value)}
        />
      ) : null
    }

    render(
      <StrictMode>
        <DummyComponent />
      </StrictMode>,
    )

    act(() => store.set(isLoggedAtom, true))

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement

    expect(store.get(isLoggedAtom)).toBeTruthy()
    expect(store.get(isDevModeStorageAtom)).toBeTruthy()

    expect(checkbox).toBeChecked()
    await userEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })
})

describe('atomWithStorage (with disabled browser storage)', () => {
  const savedLocalStorage = window.localStorage

  beforeAll(() => {
    // Firefox and chromium based browser throw DOMException when cookies are disabled
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.')
      },
    })
  })

  afterAll(() => {
    // TS < 4.5 causes type error without `as any`
    ;(window as any).localStorage = savedLocalStorage
  })

  it('initial value of atomWithStorage can be used when cookies are disabled', async () => {
    const countAtom = atomWithStorage<number>('counter', 4)

    const Counter = () => {
      const [value] = useAtom(countAtom)
      return (
        <>
          <div>count: {value}</div>
        </>
      )
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('count: 4')
  })
})

describe('atomWithStorage (with non-browser storage)', () => {
  const addEventListener = window.addEventListener
  const mockAddEventListener = vi.fn()

  beforeAll(() => {
    ;(window as any).addEventListener = mockAddEventListener
  })

  afterAll(() => {
    window.addEventListener = addEventListener
  })

  it('createJSONStorage avoids attaching event handler for non-browser storage', async () => {
    const store = createStore()
    const mockNonNativeStorage = {
      setItem: vi.fn() as Storage['setItem'],
      getItem: vi.fn(() => null) as Storage['getItem'],
      removeItem: vi.fn() as Storage['removeItem'],
    }

    const dummyAtom = atomWithStorage<number>(
      'dummy',
      1,
      createJSONStorage<number>(() => mockNonNativeStorage),
    )

    const DummyComponent = () => {
      const [value] = useAtom(dummyAtom, { store })
      return (
        <>
          <div>{value}</div>
        </>
      )
    }

    render(
      <StrictMode>
        <DummyComponent />
      </StrictMode>,
    )

    expect(mockAddEventListener).not.toHaveBeenCalledWith(
      'storage',
      expect.any(Function),
    )
  })
})

describe('withStorageValidator', () => {
  it('should use withStorageValidator with isNumber', () => {
    const storage = createJSONStorage()
    const isNumber = (v: unknown): v is number => typeof v === 'number'
    atomWithStorage('my-number', 0, withStorageValidator(isNumber)(storage))
  })
})

describe('with subscribe method in string storage', () => {
  it('createJSONStorage subscriber is called correctly', async () => {
    const store = createStore()

    const subscribe = vi.fn()
    const stringStorage = {
      getItem: () => {
        return null
      },
      setItem: () => {},
      removeItem: () => {},
      subscribe,
    }

    const dummyStorage = createJSONStorage<number>(() => stringStorage)

    const dummyAtom = atomWithStorage<number>('dummy', 1, dummyStorage)

    const DummyComponent = () => {
      const [value] = useAtom(dummyAtom, { store })
      return (
        <>
          <div>{value}</div>
        </>
      )
    }

    render(
      <StrictMode>
        <DummyComponent />
      </StrictMode>,
    )

    expect(subscribe).toHaveBeenCalledWith('dummy', expect.any(Function))
  })

  it('createJSONStorage subscriber responds to events correctly', async () => {
    const storageData: Record<string, string> = {
      count: '10',
    }

    const stringStorage = {
      getItem: (key: string) => {
        return storageData[key] || null
      },
      setItem: (key: string, newValue: string) => {
        storageData[key] = newValue
      },
      removeItem: (key: string) => {
        delete storageData[key]
      },
      subscribe(_key, callback) {
        function handler(event: CustomEvent<string>) {
          callback(event.detail)
        }

        window.addEventListener('dummystoragechange', handler as EventListener)
        return () =>
          window.removeEventListener(
            'dummystoragechange',
            handler as EventListener,
          )
      },
    } as SyncStringStorage

    const dummyStorage = createJSONStorage<number>(() => stringStorage)

    const countAtom = atomWithStorage('count', 1, dummyStorage)

    const Counter = () => {
      const [count] = useAtom(countAtom)
      return (
        <>
          <div>count: {count}</div>
        </>
      )
    }

    render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    )

    await screen.findByText('count: 10')

    storageData.count = '12'
    fireEvent(
      window,
      new CustomEvent('dummystoragechange', {
        detail: '12',
      }),
    )
    await screen.findByText('count: 12')
    // expect(storageData.count).toBe('11')
  })
})

describe('with custom async storage', () => {
  it('does not infinite loop (#2931)', async () => {
    let storedValue = 0
    let cachedPromise:
      | [typeof storedValue, Promise<typeof storedValue>]
      | null = null
    const counterAtom = atomWithStorage('counter', 0, {
      getItem(_key: string, _initialValue: number) {
        if (cachedPromise && cachedPromise[0] === storedValue) {
          return cachedPromise[1]
        }
        const promise = Promise.resolve(storedValue)
        cachedPromise = [storedValue, promise]
        return promise
      },
      async setItem(_key, newValue) {
        storedValue = await new Promise((resolve) => resolve(newValue))
      },
      async removeItem() {},
    })
    const Component = () => {
      const [count, setCount] = useAtom(counterAtom)
      return (
        <>
          <div>count: {count}</div>
          <button onClick={() => setCount(async (c) => (await c) + 1)}>
            button
          </button>
        </>
      )
    }
    await act(async () => {
      render(
        <StrictMode>
          <Suspense fallback="loading">
            <Component />
          </Suspense>
        </StrictMode>,
      )
    })
    await screen.findByText('count: 0')
    await userEvent.click(screen.getByText('button'))
    await screen.findByText('count: 1')
    await userEvent.click(screen.getByText('button'))
    await screen.findByText('count: 2')
  })
})
