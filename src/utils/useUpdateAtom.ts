import { useCallback, useContext } from 'react'
import { SECRET_INTERNAL_getScopeContext as getScopeContext } from 'jotai'
import type { WritableAtom } from 'jotai'
import type { Scope, SetAtom } from '../core/atom'
import { WRITE_ATOM } from '../core/store'

export function useUpdateAtom<
  Value,
  Update,
  Result extends void | Promise<void>
>(anAtom: WritableAtom<Value, Update, Result>, scope?: Scope) {
  const ScopeContext = getScopeContext(scope)
  const store = useContext(ScopeContext).s
  const setAtom = useCallback(
    (update: Update) => store[WRITE_ATOM](anAtom, update),
    [store, anAtom]
  )
  return setAtom as SetAtom<Update, Result>
}
