import { useCallback } from 'react'
import type {
  ExtractAtomArgs,
  ExtractAtomResult,
  WritableAtom,
} from 'jotai/vanilla'
import { useStore } from './Provider'

type SetAtom<Args extends unknown[], Result> = (...args: Args) => Result
type Store = ReturnType<typeof useStore>

type Options = {
  store?: Store
}

export function useSetAtom<AtomType extends WritableAtom<any, any[], any>>(
  atom: AtomType,
  options?: Options
): SetAtom<ExtractAtomArgs<AtomType>, ExtractAtomResult<AtomType>> {
  const store = useStore(options)
  const setAtom = useCallback(
    (...args: ExtractAtomArgs<AtomType>) => {
      if (__DEV__ && !('write' in atom)) {
        // useAtom can pass non writable atom with wrong type assertion,
        // so we should check here.
        throw new Error('not writable atom')
      }
      return store.set(atom, ...args)
    },
    [store, atom]
  )
  return setAtom
}
