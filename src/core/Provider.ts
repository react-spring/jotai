import React, {
  Dispatch,
  SetStateAction,
  MutableRefObject,
  ReactElement,
  createElement,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
  useDebugValue,
} from 'react'
import {
  unstable_UserBlockingPriority as UserBlockingPriority,
  unstable_runWithPriority as runWithPriority,
} from 'scheduler'
import { createContext, useContextUpdate } from 'use-context-selector'

import {
  Atom,
  WritableAtom,
  AnyAtom,
  AnyWritableAtom,
  Getter,
  Setter,
} from './types'
import { useIsoLayoutEffect } from './useIsoLayoutEffect'
import {
  ImmutableMap,
  mCreate,
  mGet,
  mSet,
  mDel,
  mMerge,
  mToPrintable,
} from './immutableMap'

// guessing if it's react experimental channel
const isReactExperimental =
  !!process.env.IS_REACT_EXPERIMENTAL ||
  !!(React as any).unstable_useMutableSource

const useWeakMapRef = <T extends WeakMap<object, unknown>>() => {
  const ref = useRef<T>()
  if (!ref.current) {
    ref.current = new WeakMap() as T
  }
  return ref.current
}

const warnAtomStateNotFound = (info: string, atom: AnyAtom) => {
  console.warn(
    '[Bug] Atom state not found. Please file an issue with repro: ' + info,
    atom
  )
}

type Revision = number

export type AtomState<Value = unknown> = {
  readE?: Error // read error
  readP?: Promise<void> // read promise
  writeP?: Promise<void> // write promise
  value?: Value
  rev: Revision
  deps: Map<AnyAtom, Revision> // read dependencies
}

type AtomStateMap = ImmutableMap<AnyAtom, AtomState>

type DependentsMap = ImmutableMap<AnyAtom, Set<AnyAtom | symbol>> // symbol is id from useAtom

type State = {
  s: AtomStateMap
  d: DependentsMap
}

// we store last atom state before deleting from provider state
// and reuse it as long as it's not gc'd
type AtomStateCache = WeakMap<AnyAtom, AtomState>

// pending state for adding a new atom and write batching
type PendingStateMap = WeakMap<State, State> // the value is next state

type ContextUpdate = (t: () => void) => void

type WriteThunk = (lastState: State) => State // returns next state

export type Actions = {
  add: <Value>(id: symbol, atom: Atom<Value>) => void
  del: <Value>(id: symbol, atom: Atom<Value>) => void
  read: <Value>(state: State, atom: Atom<Value>) => AtomState<Value>
  write: <Value, Update>(
    atom: WritableAtom<Value, Update>,
    update: Update
  ) => void | Promise<void>
}

const updateAtomState = <Value>(
  prevState: State,
  atom: Atom<Value>,
  partial: Partial<AtomState<Value>>,
  prevPromise?: Promise<void>,
  isNew?: boolean
): State => {
  let atomState = mGet(prevState.s, atom) as AtomState<Value> | undefined
  if (!atomState) {
    if (!isNew && process.env.NODE_ENV !== 'production') {
      warnAtomStateNotFound('updateAtomState', atom)
    }
    atomState = { rev: 0, deps: new Map() }
  }
  if (prevPromise && prevPromise !== atomState.readP) {
    return prevState
  }
  return {
    ...prevState,
    s: mSet(prevState.s, atom, {
      ...atomState,
      ...partial,
      rev: atomState.rev + 1,
    }),
  }
}

const addDependency = (
  prevState: State,
  atom: AnyAtom,
  dependency: AnyAtom
): State => {
  let nextAtomStateMap = prevState.s
  let nextDependentsMap = prevState.d
  const atomState = mGet(nextAtomStateMap, atom)
  const dependencyState = mGet(nextAtomStateMap, dependency)
  if (atomState && dependencyState) {
    const newDeps = new Map(atomState.deps).set(dependency, dependencyState.rev)
    nextAtomStateMap = mSet(nextAtomStateMap, atom, {
      ...atomState,
      deps: newDeps,
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warnAtomStateNotFound('addDependency.setState', atom)
  }
  const dependents = mGet(nextDependentsMap, dependency)
  const newDependents = new Set(dependents).add(atom)
  nextDependentsMap = mSet(nextDependentsMap, dependency, newDependents)
  if (nextAtomStateMap === prevState.s && nextDependentsMap === prevState.d) {
    return prevState
  }
  return { s: nextAtomStateMap, d: nextDependentsMap }
}

const replaceDependencies = (
  prevState: State,
  atom: AnyAtom,
  dependenciesToReplace: Set<AnyAtom>
): State => {
  let nextAtomStateMap = prevState.s
  let nextDependentsMap = prevState.d
  const atomState = mGet(nextAtomStateMap, atom)
  if (!atomState) {
    if (process.env.NODE_ENV !== 'production') {
      warnAtomStateNotFound('replaceDependencies.atomState', atom)
    }
    return prevState
  }
  const prevDeps = atomState.deps
  nextAtomStateMap = mSet(nextAtomStateMap, atom, {
    ...atomState,
    deps: new Map(
      [...dependenciesToReplace].map((a) => [
        a,
        mGet(nextAtomStateMap, a)?.rev ?? 0,
      ])
    ),
  })
  const dependencies = new Set(dependenciesToReplace)
  prevDeps.forEach((_, a) => {
    const aDependents = mGet(nextDependentsMap, a)
    if (dependencies.has(a)) {
      // not changed
      dependencies.delete(a)
    } else {
      const newDependents = new Set(aDependents)
      newDependents.delete(atom)
      nextDependentsMap = mSet(nextDependentsMap, a, newDependents)
    }
  })
  dependencies.forEach((a) => {
    const aDependents = mGet(nextDependentsMap, a)
    const newDependents = new Set(aDependents).add(atom)
    nextDependentsMap = mSet(nextDependentsMap, a, newDependents)
  })
  return { s: nextAtomStateMap, d: nextDependentsMap }
}

const readAtomState = <Value>(
  prevState: State,
  atom: Atom<Value>,
  setState: Dispatch<(prev: State) => State>,
  atomStateCache: AtomStateCache,
  force?: boolean
): readonly [AtomState<Value>, State] => {
  if (!force) {
    let atomState = mGet(prevState.s, atom) as AtomState<Value> | undefined
    if (atomState) {
      return [atomState, prevState]
    }
    atomState = atomStateCache.get(atom) as AtomState<Value> | undefined
    if (
      atomState &&
      [...atomState.deps.entries()].every(
        ([a, r]) => mGet(prevState.s, a)?.rev === r
      )
    ) {
      return [
        atomState,
        { ...prevState, s: mSet(prevState.s, atom, atomState) },
      ]
    }
  }
  let isSync = true
  let nextState = prevState
  let error: Error | undefined = undefined
  let promise: Promise<void> | undefined = undefined
  let value: Value | undefined = undefined
  let dependencies: Set<AnyAtom> | null = new Set()
  let flushDependencies = false
  try {
    const promiseOrValue = atom.read(((a: AnyAtom) => {
      if (dependencies) {
        dependencies.add(a)
      } else {
        setState((prev) => addDependency(prev, atom, a))
      }
      if (a !== atom) {
        const [aState, nextNextState] = readAtomState(
          nextState,
          a,
          setState,
          atomStateCache
        )
        if (isSync) {
          nextState = nextNextState
        } else {
          // XXX is this really correct?
          setState((prev) => ({
            s: mMerge(nextNextState.s, prev.s),
            d: mMerge(nextNextState.d, prev.d),
          }))
        }
        if (aState.readE) {
          throw aState.readE
        }
        if (aState.readP) {
          throw aState.readP
        }
        return aState.value
      }
      // a === atom
      const aState = mGet(nextState.s, a)
      if (aState) {
        if (aState.readP) {
          throw aState.readP
        }
        return aState.value
      }
      return a.init // this should not be undefined
    }) as Getter)
    if (promiseOrValue instanceof Promise) {
      promise = promiseOrValue
        .then((value) => {
          const dependenciesToReplace = dependencies as Set<AnyAtom>
          dependencies = null
          setState((prev) =>
            updateAtomState(
              replaceDependencies(prev, atom, dependenciesToReplace),
              atom,
              { readE: undefined, readP: undefined, value },
              promise
            )
          )
        })
        .catch((e) => {
          const dependenciesToReplace = dependencies as Set<AnyAtom>
          dependencies = null
          setState((prev) =>
            updateAtomState(
              replaceDependencies(prev, atom, dependenciesToReplace),
              atom,
              {
                readE: e instanceof Error ? e : new Error(e),
                readP: undefined,
              },
              promise
            )
          )
        })
    } else {
      value = promiseOrValue
      flushDependencies = true
    }
  } catch (errorOrPromise) {
    if (errorOrPromise instanceof Promise) {
      promise = errorOrPromise.then(() => {
        setState(
          (prev) =>
            readAtomState(
              { ...prev, s: mDel(prev.s, atom) },
              atom,
              setState,
              atomStateCache
            )[1]
        )
      })
    } else if (errorOrPromise instanceof Error) {
      error = errorOrPromise
    } else {
      error = new Error(errorOrPromise)
    }
    flushDependencies = true
  }
  nextState = updateAtomState(
    nextState,
    atom,
    {
      readE: error,
      readP: promise,
      value: promise ? atom.init : value,
    },
    undefined,
    true
  )
  if (flushDependencies) {
    nextState = replaceDependencies(nextState, atom, dependencies)
    dependencies = null
  }
  const atomState = mGet(nextState.s, atom) as AtomState<Value>
  isSync = false
  return [atomState, nextState] as const
}

const updateDependentsState = <Value>(
  prevState: State,
  atom: Atom<Value>,
  setState: Dispatch<(prev: State) => State>,
  atomStateCache: AtomStateCache
) => {
  const dependents = mGet(prevState.d, atom)
  if (!dependents) {
    if (process.env.NODE_ENV !== 'production') {
      warnAtomStateNotFound('updateDependentsState', atom)
    }
    return prevState
  }
  let nextState = prevState
  dependents.forEach((dependent) => {
    if (
      dependent === atom ||
      typeof dependent === 'symbol' ||
      !mGet(nextState.s, dependent)
    ) {
      return
    }
    const [dependentState, nextNextState] = readAtomState(
      nextState,
      dependent,
      setState,
      atomStateCache,
      true
    )
    const promise = dependentState.readP
    if (promise) {
      promise.then(() => {
        setState((prev) =>
          updateDependentsState(prev, dependent, setState, atomStateCache)
        )
      })
      nextState = nextNextState
    } else {
      nextState = updateDependentsState(
        nextNextState,
        dependent,
        setState,
        atomStateCache
      )
    }
  })
  return nextState
}

const readAtom = <Value>(
  state: State,
  readingAtom: Atom<Value>,
  setState: Dispatch<SetStateAction<State>>,
  pendingStateMap: PendingStateMap,
  atomStateCache: AtomStateCache
) => {
  const prevState = pendingStateMap.get(state) || state
  const [atomState, nextState] = readAtomState(
    prevState,
    readingAtom,
    setState,
    atomStateCache
  )
  if (nextState !== prevState) {
    pendingStateMap.set(state, nextState)
  }
  return atomState
}

const addAtom = <Value>(
  id: symbol,
  addingAtom: Atom<Value>,
  setState: Dispatch<SetStateAction<State>>
) => {
  setState((prev) => {
    let nextDependentsMap = prev.d
    const dependents = mGet(nextDependentsMap, addingAtom)
    const newDependents = new Set(dependents).add(id)
    nextDependentsMap = mSet(nextDependentsMap, addingAtom, newDependents)
    return { ...prev, d: nextDependentsMap }
  })
}

const delAtom = <Value>(
  id: symbol,
  deletingAtom: Atom<Value>,
  setState: Dispatch<SetStateAction<State>>,
  atomStateCache: AtomStateCache
) => {
  setState((prev) => {
    let nextAtomStateMap = prev.s
    let nextDependentsMap = prev.d
    const del = (atom: AnyAtom, dependent: AnyAtom | symbol) => {
      const dependents = mGet(nextDependentsMap, atom)
      const newDependents = new Set(dependents)
      newDependents.delete(dependent)
      const size = newDependents.size
      const isEmpty = size === 0 || (size === 1 && newDependents.has(atom))
      if (isEmpty) {
        const atomState = mGet(nextAtomStateMap, atom)
        if (atomState) {
          // XXX side effect in render (how should we fix this)
          atomStateCache.set(atom, atomState)
          nextAtomStateMap = mDel(nextAtomStateMap, atom)
          atomState.deps.forEach((_, a) => {
            del(a, atom)
          })
        } else if (process.env.NODE_ENV !== 'production') {
          warnAtomStateNotFound('delAtom', atom)
        }
      }
    }
    del(deletingAtom, id)
    return { s: nextAtomStateMap, d: nextDependentsMap }
  })
}

const writeAtom = <Value, Update>(
  writingAtom: WritableAtom<Value, Update>,
  update: Update,
  setState: Dispatch<(prev: State) => State>,
  atomStateCache: AtomStateCache,
  addWriteThunk: (thunk: WriteThunk) => void
) => {
  const pendingPromises: Promise<void>[] = []

  const writeAtomState = <Value, Update>(
    prevState: State,
    atom: WritableAtom<Value, Update>,
    update: Update
  ) => {
    const prevAtomState = mGet(prevState.s, atom)
    if (prevAtomState && prevAtomState.writeP) {
      const promise = prevAtomState.writeP.then(() => {
        addWriteThunk((prev) => writeAtomState(prev, atom, update))
      })
      pendingPromises.push(promise)
      return prevState
    }
    let nextState = prevState
    let isSync = true
    try {
      const promiseOrVoid = atom.write(
        ((a: AnyAtom) => {
          const aState = mGet(nextState.s, a)
          if (!aState) {
            if (process.env.NODE_ENV !== 'production') {
              warnAtomStateNotFound('writeAtomState', a)
            }
            return a.init
          }
          if (aState.readP && process.env.NODE_ENV !== 'production') {
            // TODO will try to detect this
            console.warn(
              'Reading pending atom state in write operation. We need to detect this and fallback. Please file an issue with repro.',
              a
            )
          }
          return aState.value
        }) as Getter,
        ((a: AnyWritableAtom, v: unknown) => {
          if (a === atom) {
            const partialAtomState = {
              readE: undefined,
              readP: undefined,
              value: v,
            }
            if (isSync) {
              nextState = updateDependentsState(
                updateAtomState(nextState, a, partialAtomState),
                a,
                setState,
                atomStateCache
              )
            } else {
              setState((prev) =>
                updateDependentsState(
                  updateAtomState(prev, a, partialAtomState),
                  a,
                  setState,
                  atomStateCache
                )
              )
            }
          } else {
            if (isSync) {
              nextState = writeAtomState(nextState, a, v)
            } else {
              addWriteThunk((prev) => writeAtomState(prev, a, v))
            }
          }
        }) as Setter,
        update
      )
      if (promiseOrVoid instanceof Promise) {
        pendingPromises.push(promiseOrVoid)
        nextState = updateAtomState(nextState, atom, {
          writeP: promiseOrVoid.then(() => {
            addWriteThunk((prev) =>
              updateAtomState(prev, atom, { writeP: undefined })
            )
          }),
        })
      }
    } catch (e) {
      if (pendingPromises.length) {
        pendingPromises.push(
          new Promise((_resolve, reject) => {
            reject(e)
          })
        )
      } else {
        throw e
      }
    }
    isSync = false
    return nextState
  }

  let isSync = true
  let writeResolve: () => void
  const writePromise = new Promise<void>((resolve) => {
    writeResolve = resolve
  })
  pendingPromises.unshift(writePromise)
  addWriteThunk((prevState) => {
    if (isSync) {
      pendingPromises.shift()
    }
    const nextState = writeAtomState(prevState, writingAtom, update)
    if (!isSync) {
      writeResolve()
    }
    return nextState
  })
  isSync = false

  if (pendingPromises.length) {
    return new Promise<void>((resolve, reject) => {
      const loop = () => {
        const len = pendingPromises.length
        if (len === 0) {
          resolve()
        } else {
          Promise.all(pendingPromises)
            .then(() => {
              pendingPromises.splice(0, len)
              loop()
            })
            .catch(reject)
        }
      }
      loop()
    })
  }
}

const runWriteThunk = (
  lastStateRef: MutableRefObject<State>,
  isLastStateValidRef: MutableRefObject<boolean>,
  pendingStateMap: PendingStateMap,
  setState: Dispatch<State>,
  contextUpdate: ContextUpdate,
  writeThunkQueue: WriteThunk[]
) => {
  while (true) {
    if (!isLastStateValidRef.current || !writeThunkQueue.length) {
      return
    }
    const thunk = writeThunkQueue.shift() as WriteThunk
    const prevState =
      pendingStateMap.get(lastStateRef.current) || lastStateRef.current
    const nextState = thunk(prevState)
    if (nextState !== prevState) {
      pendingStateMap.set(lastStateRef.current, nextState)
      Promise.resolve().then(() => {
        const pendingState = pendingStateMap.get(lastStateRef.current)
        if (pendingState) {
          pendingStateMap.delete(lastStateRef.current)
          contextUpdate(() => {
            setState(pendingState)
          })
        }
      })
    }
  }
}

export const ActionsContext = createContext<Actions | null>(null)
export const StateContext = createContext<State | null>(null)

const InnerProvider: React.FC<{
  r: MutableRefObject<ContextUpdate | undefined>
}> = ({ r, children }) => {
  const contextUpdate = useContextUpdate(StateContext)
  if (!r.current) {
    if (isReactExperimental) {
      r.current = (f) => {
        contextUpdate(() => {
          runWithPriority(UserBlockingPriority, f)
        })
      }
    } else {
      r.current = (f) => {
        f()
      }
    }
  }
  return children as ReactElement
}

export const Provider: React.FC<{
  initialValues?: Iterable<readonly [AnyAtom, unknown]>
}> = ({ initialValues, children }) => {
  const contextUpdateRef = useRef<ContextUpdate>()

  const pendingStateMap = useWeakMapRef<PendingStateMap>()

  const atomStateCache = useWeakMapRef<AtomStateCache>()

  const [state, setStateOrig] = useState(() => {
    let atomStateMap: AtomStateMap = mCreate()
    if (initialValues) {
      for (const [atom, value] of initialValues) {
        atomStateMap = mSet(atomStateMap, atom, {
          value,
          rev: 0,
          deps: new Map(),
        })
      }
    }
    const initialState: State = { s: atomStateMap, d: mCreate() }
    return initialState
  })
  const lastStateRef = useRef<State>(state)
  const isLastStateValidRef = useRef(false)
  const setState = useCallback(
    (setStateAction: SetStateAction<State>) => {
      const pendingState = pendingStateMap.get(lastStateRef.current)
      if (pendingState) {
        if (
          typeof setStateAction !== 'function' &&
          process.env.NODE_ENV !== 'production'
        ) {
          console.warn(
            '[Bug] pendingState can only be applied with function update'
          )
        }
        setStateOrig(pendingState)
      }
      isLastStateValidRef.current = false
      setStateOrig(setStateAction)
    },
    [pendingStateMap]
  )

  useIsoLayoutEffect(() => {
    const pendingState = pendingStateMap.get(state)
    if (pendingState) {
      pendingStateMap.delete(state)
      setState(pendingState)
      return
    }
    lastStateRef.current = state
    isLastStateValidRef.current = true
  })

  const writeThunkQueueRef = useRef<WriteThunk[]>([])
  useEffect(() => {
    runWriteThunk(
      lastStateRef,
      isLastStateValidRef,
      pendingStateMap,
      setState,
      contextUpdateRef.current as ContextUpdate,
      writeThunkQueueRef.current
    )
  }, [state, setState, pendingStateMap])

  const actions = useMemo(
    () => ({
      add: <Value>(id: symbol, atom: Atom<Value>) => {
        addAtom(id, atom, setState)
      },
      del: <Value>(id: symbol, atom: Atom<Value>) => {
        delAtom(id, atom, setState, atomStateCache)
      },
      read: <Value>(state: State, atom: Atom<Value>) =>
        readAtom(state, atom, setState, pendingStateMap, atomStateCache),
      write: <Value, Update>(
        atom: WritableAtom<Value, Update>,
        update: Update
      ) =>
        writeAtom(
          atom,
          update,
          setState,
          atomStateCache,
          (thunk: WriteThunk) => {
            writeThunkQueueRef.current.push(thunk)
            if (isLastStateValidRef.current) {
              runWriteThunk(
                lastStateRef,
                isLastStateValidRef,
                pendingStateMap,
                setState,
                contextUpdateRef.current as ContextUpdate,
                writeThunkQueueRef.current
              )
            } else {
              // force update (FIXME this is a workaround for now)
              setState((prev) => ({ ...prev }))
            }
          }
        ),
    }),
    [pendingStateMap, atomStateCache, setState]
  )
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDebugState(state)
  }
  return createElement(
    ActionsContext.Provider,
    { value: actions },
    createElement(
      StateContext.Provider,
      { value: state },
      createElement(InnerProvider, { r: contextUpdateRef }, children)
    )
  )
}

const atomToPrintable = (atom: AnyAtom) =>
  `${atom.key}:${atom.debugLabel ?? '<no debugLabel>'}`

const isNotSymbol = <T>(x: T): x is T extends symbol ? never : T =>
  typeof x !== 'symbol'

const stateToPrintable = (state: State) => ({
  values: mToPrintable(
    state.s,
    atomToPrintable,
    (v) => v.readE || v.readP || v.writeP || v.value
  ),
  dependents: mToPrintable(state.d, atomToPrintable, (v) =>
    [...v].filter(isNotSymbol).map(atomToPrintable)
  ),
})

const useDebugState = (state: State) => {
  useDebugValue(state, stateToPrintable)
}
