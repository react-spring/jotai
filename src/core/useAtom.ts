import {
  useCallback,
  useContext,
  useDebugValue,
  useEffect,
  useReducer,
} from 'react'
import type { Atom, Scope, SetAtom, WritableAtom } from './atom'
import { getScopeContext } from './contexts'
import { COMMIT_ATOM, READ_ATOM, SUBSCRIBE_ATOM, WRITE_ATOM } from './store'

const isWritable = <Value, Update>(
  atom: Atom<Value> | WritableAtom<Value, Update>
): atom is WritableAtom<Value, Update> =>
  !!(atom as WritableAtom<Value, Update>).write

export function useAtom<Value, Update>(
  atom: WritableAtom<Value | Promise<Value>, Update>,
  scope?: Scope
): [Value, SetAtom<Update>]

export function useAtom<Value, Update>(
  atom: WritableAtom<Promise<Value>, Update>,
  scope?: Scope
): [Value, SetAtom<Update>]

export function useAtom<Value, Update>(
  atom: WritableAtom<Value, Update>,
  scope?: Scope
): [Value, SetAtom<Update>]

export function useAtom<Value>(
  atom: Atom<Value | Promise<Value>>,
  scope?: Scope
): [Value, never]

export function useAtom<Value>(
  atom: Atom<Promise<Value>>,
  scope?: Scope
): [Value, never]

export function useAtom<Value>(atom: Atom<Value>, scope?: Scope): [Value, never]

export function useAtom<Value, Update>(
  atom: Atom<Value> | WritableAtom<Value, Update>,
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
      return atomState.v as Value
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
    store[COMMIT_ATOM](atom)
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
