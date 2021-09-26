import type { Atom, WritableAtom } from 'jotai'

type ShouldRemove<Param> = (createdAt: number, param: Param) => boolean

type AtomFamily<Param, AtomType> = {
  (param: Param): AtomType
  remove(param: Param): void
  setShouldRemove(shouldRemove: ShouldRemove<Param> | null): void
}

export function atomFamily<Param, AtomType extends Atom<unknown>>(
  initializeAtom: (param: Param) => AtomType,
  areEqual?: (a: Param, b: Param) => boolean
): AtomFamily<Param, AtomType>

/**
 * @deprecated type (use atomFamily<Param, AtomType extends Atom<unknown>>)
 */
export function atomFamily<Param, Value, Update>(
  initializeAtom: (param: Param) => WritableAtom<Value, Update>,
  areEqual?: (a: Param, b: Param) => boolean
): AtomFamily<Param, WritableAtom<Value, Update>>

/**
 * @deprecated type (use atomFamily<Param, AtomType extends Atom<unknown>>)
 */
export function atomFamily<Param, Value>(
  initializeAtom: (param: Param) => Atom<Value>,
  areEqual?: (a: Param, b: Param) => boolean
): AtomFamily<Param, Atom<Value>>

export function atomFamily<Param, AtomType extends Atom<unknown>>(
  initializeAtom: (param: Param) => AtomType,
  areEqual?: (a: Param, b: Param) => boolean
) {
  type CreatedAt = number // in milliseconds
  let shouldRemove: ShouldRemove<Param> | null = null
  const atoms: Map<Param, [AtomType, CreatedAt]> = new Map()
  const createAtom = (param: Param) => {
    let item: [AtomType, CreatedAt] | undefined
    if (areEqual === undefined) {
      item = atoms.get(param)
    } else {
      // Custom comparator, iterate over all elements
      for (let [key, value] of atoms) {
        if (areEqual(key, param)) {
          item = value
          break
        }
      }
    }

    if (item !== undefined) {
      if (shouldRemove?.(item[1], param)) {
        atoms.delete(param)
      } else {
        return item[0]
      }
    }

    const newAtom = initializeAtom(param)
    atoms.set(param, [newAtom, Date.now()])
    return newAtom
  }

  createAtom.remove = (param: Param) => {
    if (areEqual === undefined) {
      atoms.delete(param)
    } else {
      for (let [key] of atoms) {
        if (areEqual(key, param)) {
          atoms.delete(key)
          break
        }
      }
    }
  }

  createAtom.setShouldRemove = (fn: ShouldRemove<Param> | null) => {
    shouldRemove = fn
    if (!shouldRemove) return
    for (let [key, value] of atoms) {
      if (shouldRemove(value[1], key)) {
        atoms.delete(key)
      }
    }
  }
  return createAtom
}
