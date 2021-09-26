import { atom } from 'jotai'
import type { Atom, SetStateAction, WritableAtom } from 'jotai'
import { RESET } from './constants'

type Read<Value> = Atom<Value>['read']

export function atomWithDefault<Value>(
  getDefault: Read<Value | Promise<Value>>
): WritableAtom<Value, SetStateAction<Value> | typeof RESET>

export function atomWithDefault<Value>(
  getDefault: Read<Promise<Value>>
): WritableAtom<Value, SetStateAction<Value> | typeof RESET>

export function atomWithDefault<Value>(
  getDefault: Read<Value>
): WritableAtom<Value, SetStateAction<Value> | typeof RESET>

export function atomWithDefault<Value>(getDefault: Read<Value>) {
  const EMPTY = Symbol()
  const overwrittenAtom = atom<Value | typeof EMPTY>(EMPTY)
  const anAtom: WritableAtom<Value, SetStateAction<Value> | typeof RESET> =
    atom(
      (get) => {
        const overwritten = get(overwrittenAtom)
        if (overwritten !== EMPTY) {
          return overwritten
        }
        return getDefault(get)
      },
      (get, set, update: SetStateAction<Value> | typeof RESET) => {
        if (update === RESET) {
          return set(overwrittenAtom, EMPTY)
        }
        return set(
          overwrittenAtom,
          typeof update === 'function'
            ? (update as (prev: Value) => Value)(get(anAtom))
            : update
        )
      }
    )
  return anAtom
}
