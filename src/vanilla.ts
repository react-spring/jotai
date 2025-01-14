export { atom } from './vanilla/atom.ts'
export type { Atom, WritableAtom, PrimitiveAtom } from './vanilla/atom.ts'

export {
  createStore,
  getDefaultStore,

  // Internal functions (subject to change without notice)
  // In case you rely on them, be sure to pin the version
  INTERNAL_getSecretStoreMethods,
  INTERNAL_buildStore,
  INTERNAL_createBatch,
  INTERNAL_addBatchFunc,
  INTERNAL_flushBatch,
} from './vanilla/store.ts'

export type {
  Getter,
  Setter,
  ExtractAtomValue,
  ExtractAtomArgs,
  ExtractAtomResult,
  SetStateAction,
} from './vanilla/typeUtils.ts'
