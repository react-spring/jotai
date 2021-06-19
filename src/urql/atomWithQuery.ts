import { pipe, subscribe } from 'wonka'
import {
  TypedDocumentNode,
  OperationContext,
  OperationResult,
  RequestPolicy,
} from '@urql/core'
import { atom } from 'jotai'
import type { Atom, Getter } from 'jotai'
import { clientAtom } from './clientAtom'

type QueryArgs<Data, Variables extends object> = {
  query: TypedDocumentNode<Data, Variables>
  variables?: Variables
  requestPolicy?: RequestPolicy
  context?: Partial<OperationContext>
}

export function atomWithQuery<Data, Variables extends object>(
  createQueryArgs: (get: Getter) => QueryArgs<Data, Variables>
): Atom<OperationResult<Data, Variables>> {
  const queryResultAtom = atom((get) => {
    const client = get(clientAtom)
    const args = createQueryArgs(get)
    let resolve: ((result: OperationResult<Data, Variables>) => void) | null =
      null
    const resultAtom = atom<
      | OperationResult<Data, Variables>
      | Promise<OperationResult<Data, Variables>>
    >(
      new Promise<OperationResult<Data, Variables>>((r) => {
        resolve = r
      })
    )
    let setResult: (result: OperationResult<Data, Variables>) => void = () => {
      throw new Error('setting result without mount')
    }
    const listener = (result: OperationResult<Data, Variables>) => {
      if (resolve) {
        resolve(result)
        resolve = null
      } else {
        setResult(result)
      }
    }
    client
      .query(args.query, args.variables, {
        requestPolicy: args.requestPolicy,
        ...args.context,
      })
      .toPromise()
      .then(listener)
      .catch(() => {
        // TODO error handling
      })
    resultAtom.onMount = (update) => {
      setResult = update
      const subscription = pipe(
        client.query(args.query, args.variables, {
          requestPolicy: args.requestPolicy,
          ...args.context,
        }),
        subscribe(listener)
      )
      return () => subscription.unsubscribe()
    }
    return { resultAtom, args }
  })
  const queryAtom = atom((get) => {
    const { resultAtom } = get(queryResultAtom)
    return get(resultAtom)
  })
  return queryAtom
}
