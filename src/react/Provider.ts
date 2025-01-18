import { createContext, createElement, useContext, useState } from 'react'
import type { FunctionComponent, ReactElement, ReactNode } from 'react'
import { createStore, getDefaultStore } from '../vanilla.ts'

type Store = ReturnType<typeof createStore>

type StoreContextType = ReturnType<typeof createContext<Store | undefined>>
const StoreContext: StoreContextType = createContext<Store | undefined>(
  undefined,
)

type Options = {
  store?: Store
}

export const useStore = (options?: Options): Store => {
  const store = useContext(StoreContext)
  return options?.store || store || getDefaultStore()
}

const storeCache = new WeakMap<object, Store>()
const getStoreForProvider = (key: object) => {
  let store = storeCache.get(key)
  if (!store) {
    store = createStore()
    storeCache.set(key, store)
  }
  return store
}

export const Provider = ({
  children,
  store,
}: {
  children?: ReactNode
  store?: Store
}): ReactElement<
  { value: Store | undefined },
  FunctionComponent<{ value: Store | undefined }>
> => {
  const [key] = useState<object>({})
  return createElement(
    StoreContext.Provider,
    {
      value: store || getStoreForProvider(key),
    },
    children,
  )
}
