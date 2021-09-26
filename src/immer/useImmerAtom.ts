/* eslint-disable import/named */
import { useCallback } from 'react'
import { produce } from 'immer'
import type { Draft } from 'immer'
import { useAtom } from 'jotai'
import type { WritableAtom } from 'jotai'
import type { Scope } from '../core/atom'

export function useImmerAtom<Value, Result extends void | Promise<void>>(
  anAtom: WritableAtom<Value, (draft: Draft<Value>) => void, Result>,
  scope?: Scope
): [Value, (fn: (draft: Draft<Value>) => void) => Result]

export function useImmerAtom<Value, Result extends void | Promise<void>>(
  anAtom: WritableAtom<Value, (value: Value) => Value, Result>,
  scope?: Scope
): [Value, (fn: (draft: Draft<Value>) => void) => Result]

export function useImmerAtom<Value, Result extends void | Promise<void>>(
  anAtom: WritableAtom<Value, (value: Value) => Value, Result>,
  scope?: Scope
) {
  const [state, setState] = useAtom(anAtom, scope)
  const setStateWithImmer = useCallback(
    (fn) => setState(produce((draft) => fn(draft)) as (value: Value) => Value),
    [setState]
  )
  return [state, setStateWithImmer]
}
