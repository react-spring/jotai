import * as O from 'optics-ts'
import { atom } from 'jotai'
import type { SetStateAction, WritableAtom } from 'jotai'
import { createMemoizeAtom } from '../utils/weakCache'

const memoizeAtom = createMemoizeAtom()

const isFunction = <T>(x: T): x is T & Function => typeof x === 'function'

type NonFunction<T> = [T] extends [Function] ? never : T

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<Promise<S>, NonFunction<S>, R>,
  callback: (optic: O.OpticFor<S>) => O.Prism<S, any, A>
): WritableAtom<A | undefined, SetStateAction<A>, R>

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<Promise<S>, NonFunction<S>, R>,
  callback: (optic: O.OpticFor<S>) => O.Traversal<S, any, A>
): WritableAtom<A[], SetStateAction<A>, R>

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<Promise<S>, NonFunction<S>, R>,
  callback: (
    optic: O.OpticFor<S>
  ) => O.Lens<S, any, A> | O.Equivalence<S, any, A> | O.Iso<S, any, A>
): WritableAtom<A, SetStateAction<A>, R>

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<S, NonFunction<S>, R>,
  callback: (optic: O.OpticFor<S>) => O.Prism<S, any, A>
): WritableAtom<A | undefined, SetStateAction<A>, R>

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<S, NonFunction<S>, R>,
  callback: (optic: O.OpticFor<S>) => O.Traversal<S, any, A>
): WritableAtom<A[], SetStateAction<A>, R>

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<S, NonFunction<S>, R>,
  callback: (
    optic: O.OpticFor<S>
  ) => O.Lens<S, any, A> | O.Equivalence<S, any, A> | O.Iso<S, any, A>
): WritableAtom<A, SetStateAction<A>, R>

export function focusAtom<S, A, R extends void | Promise<void>>(
  baseAtom: WritableAtom<S, NonFunction<S>, R>,
  callback: (
    optic: O.OpticFor<S>
  ) =>
    | O.Lens<S, any, A>
    | O.Equivalence<S, any, A>
    | O.Iso<S, any, A>
    | O.Prism<S, any, A>
    | O.Traversal<S, any, A>
) {
  return memoizeAtom(() => {
    const focus = callback(O.optic<S>())
    const derivedAtom = atom(
      (get) => getValueUsingOptic(focus, get(baseAtom)),
      (get, set, update: SetStateAction<A>) => {
        const newValueProducer = isFunction(update)
          ? O.modify(focus)(update)
          : O.set(focus)(update)
        return set(baseAtom, newValueProducer(get(baseAtom)) as NonFunction<S>)
      }
    )
    return derivedAtom
  }, [baseAtom, callback])
}

const getValueUsingOptic = <S, A>(
  focus:
    | O.Lens<S, any, A>
    | O.Equivalence<S, any, A>
    | O.Iso<S, any, A>
    | O.Prism<S, any, A>
    | O.Traversal<S, any, A>,
  bigValue: S
) => {
  if (focus._tag === 'Traversal') {
    const values = O.collect(focus)(bigValue)
    return values
  }
  if (focus._tag === 'Prism') {
    const value = O.preview(focus)(bigValue)
    return value
  }
  const value = O.get(focus)(bigValue)
  return value
}
