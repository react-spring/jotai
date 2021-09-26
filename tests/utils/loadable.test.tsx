import { fireEvent, render } from '@testing-library/react'
import { Atom, atom } from '../../src/index'
import { loadable, useAtomValue, useUpdateAtom } from '../../src/utils'
import { getTestProvider } from '../testUtils'

const Provider = getTestProvider()

it('loadable turns suspense into values', async () => {
  let resolveAsync!: (x: number) => void
  const asyncAtom = atom(() => {
    return new Promise<number>((resolve) => (resolveAsync = resolve))
  })

  const { findByText } = render(
    <Provider>
      <LoadableComponent asyncAtom={asyncAtom} />
    </Provider>
  )

  await findByText('Loading...')
  resolveAsync(5)
  await findByText('Data: 5')
})

it('loadable turns errors into values', async () => {
  let rejectAsync!: (error: unknown) => void
  const asyncAtom = atom(() => {
    return new Promise<number>((_resolve, reject) => (rejectAsync = reject))
  })

  const { findByText } = render(
    <Provider>
      <LoadableComponent asyncAtom={asyncAtom} />
    </Provider>
  )

  await findByText('Loading...')
  rejectAsync(new Error('An error occurred'))
  await findByText('Error: An error occurred')
})

it('loadable turns primitive throws into values', async () => {
  let rejectAsync!: (error: unknown) => void
  const asyncAtom = atom(() => {
    return new Promise<number>((_resolve, reject) => (rejectAsync = reject))
  })

  const { findByText } = render(
    <Provider>
      <LoadableComponent asyncAtom={asyncAtom} />
    </Provider>
  )

  await findByText('Loading...')
  rejectAsync('An error occurred')
  await findByText('An error occurred')
})

it('loadable goes back to loading after re-fetch', async () => {
  let resolveAsync!: (x: number) => void
  const refreshAtom = atom(0)
  const asyncAtom = atom((get) => {
    get(refreshAtom)
    return new Promise<number>((resolve) => (resolveAsync = resolve))
  })

  const Refresh = () => {
    const setRefresh = useUpdateAtom(refreshAtom)
    return (
      <>
        <button onClick={() => setRefresh((value) => value + 1)}>
          refresh
        </button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <Provider>
      <Refresh />
      <LoadableComponent asyncAtom={asyncAtom} />
    </Provider>
  )

  getByText('Loading...')
  resolveAsync(5)
  await findByText('Data: 5')
  fireEvent.click(getByText('refresh'))
  await findByText('Loading...')
  resolveAsync(6)
  await findByText('Data: 6')
})

it('loadable can recover from error', async () => {
  let resolveAsync!: (x: number) => void
  let rejectAsync!: (error: unknown) => void
  const refreshAtom = atom(0)
  const asyncAtom = atom((get) => {
    get(refreshAtom)
    return new Promise<number>((resolve, reject) => {
      resolveAsync = resolve
      rejectAsync = reject
    })
  })

  const Refresh = () => {
    const setRefresh = useUpdateAtom(refreshAtom)
    return (
      <>
        <button onClick={() => setRefresh((value) => value + 1)}>
          refresh
        </button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <Provider>
      <Refresh />
      <LoadableComponent asyncAtom={asyncAtom} />
    </Provider>
  )

  getByText('Loading...')
  rejectAsync(new Error('An error occurred'))
  await findByText('Error: An error occurred')
  fireEvent.click(getByText('refresh'))
  await findByText('Loading...')
  resolveAsync(6)
  await findByText('Data: 6')
})

interface LoadableComponentProps {
  asyncAtom: Atom<Promise<number> | Promise<string>>
}

const LoadableComponent = ({ asyncAtom }: LoadableComponentProps) => {
  const value = useAtomValue(loadable(asyncAtom))

  if (value.state === 'loading') {
    return <>Loading...</>
  }

  if (value.state === 'hasError') {
    return <>{String(value.error)}</>
  }

  return <>Data: {value.data}</>
}
