import { Component, type ErrorInfo, type ReactNode, createElement } from 'react'
import { createStore } from 'jotai/vanilla'

type Store = ReturnType<typeof createStore>
type GetAtomState = Parameters<Parameters<Store['unstable_derive']>[0]>[0]
type DebugStore = Store & { getAtomState: GetAtomState }

export function createDebugStore() {
  let getAtomState: GetAtomState
  const store = createStore().unstable_derive((...storeArgs) => {
    ;[getAtomState] = storeArgs
    const [, setAtomState] = storeArgs
    storeArgs[1] = (atom, atomState) => {
      return setAtomState(
        atom,
        Object.assign(atomState, { label: atom.debugLabel }),
      )
    }
    return storeArgs
  })
  if (getAtomState! === undefined) {
    throw new Error('failed to create debug store')
  }
  return Object.assign(store, { getAtomState }) as DebugStore
}

export function increment(count: number): number {
  return count + 1
}

export function incrementLetter(str: string): string {
  return String.fromCharCode(increment(str.charCodeAt(0)))
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function assert(value: boolean, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? 'assertion failed')
  }
}

export function waitFor(
  condition: () => boolean,
  options?: { interval?: number; timeout?: number },
): Promise<void>
export function waitFor(
  condition: () => void,
  options?: { interval?: number; timeout?: number },
): Promise<void>
export function waitFor(
  condition: () => boolean | void,
  { interval = 10, timeout = 1000 } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const intervalId = setInterval(() => {
      try {
        if (condition() !== false) {
          clearInterval(intervalId)
          clearTimeout(timeoutId)
          resolve()
        }
      } catch {
        // ignore
      }
    }, interval)
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId)
      reject(new Error('timeout'))
    }, timeout)
  })
}

type ErrorBoundaryState = {
  hasError: boolean
}
type ErrorBoundaryProps = {
  componentDidCatch?: (error: Error, errorInfo: ErrorInfo) => void
  children: ReactNode
}
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    this.props.componentDidCatch?.(error, _errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return createElement('div', {}, 'error')
    }
    return this.props.children
  }
}
