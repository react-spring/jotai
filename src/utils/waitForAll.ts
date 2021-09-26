import { atom } from 'jotai'
import type { Atom } from 'jotai'
import { createMemoizeAtom } from './weakCache'

const memoizeAtom = createMemoizeAtom()

type ResolveType<T> = T extends Promise<infer V> ? V : T

export function waitForAll<Values extends Record<string, unknown>>(atoms: {
  [K in keyof Values]: Atom<Values[K]>
}): Atom<{
  [K in keyof Values]: ResolveType<Values[K]>
}>

export function waitForAll<Values extends readonly unknown[]>(atoms: {
  [K in keyof Values]: Atom<Values[K]>
}): Atom<{
  [K in keyof Values]: ResolveType<Values[K]>
}>

export function waitForAll<
  Values extends Record<string, unknown> | readonly unknown[]
>(atoms: { [K in keyof Values]: Atom<Values[K]> }) {
  const createAtom = () => {
    const unwrappedAtoms = unwrapAtoms(atoms)
    const derivedAtom = atom((get) => {
      const promises: Promise<unknown>[] = []
      const values = unwrappedAtoms.map((anAtom, index) => {
        try {
          return get(anAtom)
        } catch (e) {
          if (e instanceof Promise) {
            promises[index] = e
          } else {
            throw e
          }
        }
      })
      if (promises.length) {
        throw Promise.all(promises)
      }
      return wrapResults(atoms, values)
    })
    return derivedAtom
  }

  if (Array.isArray(atoms)) {
    return memoizeAtom(createAtom, atoms)
  }
  return createAtom()
}

const unwrapAtoms = <
  Values extends Record<string, unknown> | unknown[]
>(atoms: { [K in keyof Values]: Atom<Values[K]> }): Atom<unknown>[] =>
  Array.isArray(atoms)
    ? atoms
    : Object.getOwnPropertyNames(atoms).map((key) => atoms[key as keyof Values])

const wrapResults = <Values extends Record<string, unknown> | unknown[]>(
  atoms: { [K in keyof Values]: Atom<Values[K]> },
  results: unknown[]
): unknown[] | Record<string, unknown> =>
  Array.isArray(atoms)
    ? results
    : Object.getOwnPropertyNames(atoms).reduce(
        (out, key, idx) => ({ ...out, [key]: results[idx] }),
        {}
      )
