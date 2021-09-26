import { Suspense } from 'react'
import { fireEvent, render } from '@testing-library/react'
import type { Client } from '@urql/core'
import { fromValue, interval, map, pipe, take, toPromise } from 'wonka'
import { atom, useAtom } from '../../src/'
import { atomWithQuery } from '../../src/urql'
import { getTestProvider } from '../testUtils'

const withPromise = (source$: any) => {
  source$.toPromise = () => pipe(source$, take(1), toPromise)
  return source$
}
const clientMock = {
  query: () =>
    withPromise(
      pipe(
        interval(10),
        map((i: number) => ({ data: { count: i } }))
      )
    ),
} as unknown as Client

const generateClient = (id: string) =>
  ({
    query: () => withPromise(fromValue({ data: { id } })),
  } as unknown as Client)

const Provider = getTestProvider()

it('query basic test', async () => {
  const countAtom = atomWithQuery<{ count: number }, {}>(
    () => ({
      query: '{ count }',
    }),
    () => clientMock
  )

  const Counter = () => {
    const [{ data }] = useAtom(countAtom)
    return (
      <>
        <div>count: {data.count}</div>
      </>
    )
  }

  const { findByText } = render(
    <Provider>
      <Suspense fallback="loading">
        <Counter />
      </Suspense>
    </Provider>
  )

  await findByText('loading')
  await findByText('count: 0')
})

it('query dependency test', async () => {
  type Update = (prev: number) => number
  const dummyAtom = atom(10)
  const setDummyAtom = atom(null, (_get, set, update: Update) =>
    set(dummyAtom, update)
  )
  const countAtom = atomWithQuery<{ count: number }, { dummy: number }>(
    (get) => ({
      query: '{ count }',
      variables: {
        dummy: get(dummyAtom),
      },
    }),
    () => clientMock
  )

  const Counter = () => {
    const [{ data }] = useAtom(countAtom)
    return (
      <>
        <div>count: {data.count}</div>
      </>
    )
  }

  const Controls = () => {
    const [, setDummy] = useAtom(setDummyAtom)
    return <button onClick={() => setDummy((c) => c + 1)}>dummy</button>
  }

  const { getByText, findByText } = render(
    <Provider>
      <Suspense fallback="loading">
        <Counter />
      </Suspense>
      <Controls />
    </Provider>
  )

  await findByText('loading')
  await findByText('count: 0')

  fireEvent.click(getByText('dummy'))
  await findByText('loading')
  await findByText('count: 1')
})

it('query change client at runtime', async () => {
  const firstClient = generateClient('first')
  const secondClient = generateClient('second')
  const clientAtom = atom(firstClient)
  const idAtom = atomWithQuery<{ id: string }, {}>(
    () => ({
      query: '{ id }',
    }),
    (get) => get(clientAtom)
  )

  const Identifier = () => {
    const [{ data }] = useAtom(idAtom)
    return (
      <>
        <div>id: {data.id}</div>
      </>
    )
  }

  const Controls = () => {
    const [, setClient] = useAtom(clientAtom)
    return (
      <>
        <button onClick={() => setClient(firstClient)}>first</button>
        <button onClick={() => setClient(secondClient)}>second</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <Provider>
      <Suspense fallback="loading">
        <Identifier />
      </Suspense>
      <Controls />
    </Provider>
  )

  await findByText('loading')
  await findByText('id: first')
  fireEvent.click(getByText('second'))
  await findByText('loading')
  await findByText('id: second')
  fireEvent.click(getByText('first'))
  await findByText('loading')
  await findByText('id: first')
})

it('pause test', async () => {
  const enabledAtom = atom(false)
  const countAtom = atomWithQuery<{ count: number }, {}>(
    (get) => ({
      query: '{ count }',
      pause: !get(enabledAtom),
    }),
    () => clientMock
  )

  const Counter = () => {
    const [result] = useAtom(countAtom)
    return (
      <>
        <div>count: {result ? result.data.count : 'paused'}</div>
      </>
    )
  }

  const Controls = () => {
    const [, setEnabled] = useAtom(enabledAtom)
    return <button onClick={() => setEnabled((x) => !x)}>toggle</button>
  }

  const { getByText, findByText } = render(
    <Provider>
      <Suspense fallback="loading">
        <Counter />
      </Suspense>
      <Controls />
    </Provider>
  )

  await findByText('count: paused')

  fireEvent.click(getByText('toggle'))
  await findByText('loading')
  await findByText('count: 0')
})

it('reexecute test', async () => {
  const countAtom = atomWithQuery<{ count: number }, {}>(
    () => ({
      query: '{ count }',
    }),
    () => clientMock
  )

  const Counter = () => {
    const [{ data }, dispatch] = useAtom(countAtom)
    return (
      <>
        <div>count: {data.count}</div>
        <button onClick={() => dispatch({ type: 'reexecute' })}>button</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <Provider>
      <Suspense fallback="loading">
        <Counter />
      </Suspense>
    </Provider>
  )

  await findByText('loading')
  await findByText('count: 0')

  fireEvent.click(getByText('button'))
  await findByText('loading')
  await findByText('count: 1')
})

it('query null client suspense', async () => {
  const client = generateClient('client is set')
  const clientAtom = atom<Client | null>(null)
  const idAtom = atomWithQuery<{ id: string }, {}>(
    () => ({
      query: '{ id }',
    }),
    (get) => get(clientAtom) as Client
  )
  // Derived Atom to safe guard when client is null
  const guardedIdAtom = atom((get): { data?: { id: string } } => {
    const client = get(clientAtom)
    if (client === null) return {}
    return get(idAtom)
  })

  const Identifier = () => {
    const [{ data }] = useAtom(guardedIdAtom)
    return (
      <>
        <div>{data?.id ? data?.id : 'no data'}</div>
      </>
    )
  }

  const Controls = () => {
    const [, setClient] = useAtom(clientAtom)
    return (
      <>
        <button onClick={() => setClient(null)}>unset</button>
        <button onClick={() => setClient(client)}>set</button>
      </>
    )
  }

  const { getByText, findByText } = render(
    <Provider>
      <Suspense fallback="loading">
        <Identifier />
      </Suspense>
      <Controls />
    </Provider>
  )

  await findByText('no data')
  fireEvent.click(getByText('set'))
  await findByText('loading')
  await findByText('client is set')
  fireEvent.click(getByText('unset'))
  await findByText('no data')
  fireEvent.click(getByText('set'))
  await findByText('loading')
  await findByText('client is set')
})
