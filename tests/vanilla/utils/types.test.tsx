import { expectType } from 'ts-expect'
import type { TypeEqual } from 'ts-expect'
import { it } from 'vitest'
import { atom } from 'jotai/vanilla'
import type { Atom } from 'jotai/vanilla'
import { selectAtom } from 'jotai/vanilla/utils'
import { unstable_unwrap as unwrap } from 'jotai/vanilla/utils'

it('selectAtom() should return the correct types', () => {
  const doubleCount = (x: number) => x * 2
  const syncAtom = atom(0)
  const syncSelectedAtom = selectAtom(syncAtom, doubleCount)
  expectType<TypeEqual<Atom<number>, typeof syncSelectedAtom>>(true)

  const asyncAtom = atom(Promise.resolve(0))
  const asyncSelectedAtom = selectAtom(asyncAtom, doubleCount)
  expectType<TypeEqual<Atom<Promise<number>>, typeof asyncSelectedAtom>>(true)

  const maybeAsyncAtom = atom(Promise.resolve(0) as number | Promise<number>)
  const maybeAsyncSelectedAtom = selectAtom(maybeAsyncAtom, doubleCount)
  expectType<
    TypeEqual<Atom<number | Promise<number>>, typeof maybeAsyncSelectedAtom>
  >(true)
})

it('unwrap() should return the correct types', () => {
  const getFallbackValue = () => -1
  const syncAtom = atom(0)
  const syncUnwrappedAtom = unwrap(syncAtom, getFallbackValue)
  expectType<TypeEqual<Atom<number>, typeof syncUnwrappedAtom>>(true)

  const asyncAtom = atom(Promise.resolve(0))
  const asyncUnwrappedAtom = unwrap(asyncAtom, getFallbackValue)
  expectType<TypeEqual<Atom<number>, typeof asyncUnwrappedAtom>>(true)

  const maybeAsyncAtom = atom(Promise.resolve(0) as number | Promise<number>)
  const maybeAsyncUnwrappedAtom = unwrap(maybeAsyncAtom, getFallbackValue)
  expectType<TypeEqual<Atom<number>, typeof maybeAsyncUnwrappedAtom>>(true)
})