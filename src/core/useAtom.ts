import {
  useCallback,
  useContext,
  useDebugValue,
  useEffect,
  useReducer,
} from 'react'
import type { Atom, Scope, SetAtom, WritableAtom } from './atom'
import { getScopeContext } from './contexts'
import { FLUSH_PENDING, READ_ATOM, SUBSCRIBE_ATOM, WRITE_ATOM } from './store'

type ResolveType<T> = T extends Promise<infer V> ? V : T

const isWritable = <Value, Update, Result extends void | Promise<void>>(
  atom: Atom<Value> | WritableAtom<Value, Update, Result>
): atom is WritableAtom<Value, Update, Result> =>
  !!(atom as WritableAtom<Value, Update, Result>).write

export function useAtom<Value, Update, Result extends void | Promise<void>>(
  atom: WritableAtom<Value, Update, Result>,
  scope?: Scope
): [ResolveType<Value>, SetAtom<Update, Result>]

export function useAtom<Value>(
  atom: Atom<Value>,
  scope?: Scope
): [ResolveType<Value>, never]

export function useAtom<Value, Update, Result extends void | Promise<void>>(
  atom: Atom<Value> | WritableAtom<Value, Update, Result>,
  scope?: Scope
) {
  if ('scope' in atom) {
    console.warn(
      'atom.scope is deprecated. Please do useAtom(atom, scope) instead.'
    )
    scope = (atom as { scope: Scope }).scope
  }

  const ScopeContext = getScopeContext(scope)
  const store = useContext(ScopeContext).s

  const getAtomValue = useCallback(() => {
    const atomState = store[READ_ATOM](atom)
    if ('e' in atomState) {
      throw atomState.e // read error
    }
    if (atomState.p) {
      throw atomState.p // read promise
    }
    if (atomState.w) {
      throw atomState.w // write promise
    }
    if ('v' in atomState) {
      return atomState.v as ResolveType<Value>
    }
    throw new Error('no atom value')
  }, [store, atom])

  const [value, forceUpdate] = useReducer(getAtomValue, undefined, getAtomValue)

  useEffect(() => {
    const unsubscribe = store[SUBSCRIBE_ATOM](atom, forceUpdate)
    forceUpdate()
    return unsubscribe
  }, [store, atom])

  useEffect(() => {
    store[FLUSH_PENDING]()
  })

  const setAtom = useCallback(
    (update: Update) => {
      if (isWritable(atom)) {
        return store[WRITE_ATOM](atom, update)
      } else {
        throw new Error('not writable atom')
      }
    },
    [store, atom]
  )

  useDebugValue(value)
  return [value, setAtom]
}
