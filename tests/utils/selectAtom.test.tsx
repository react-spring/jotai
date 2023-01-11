import { StrictMode, Suspense, useEffect, useRef } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { getTestProvider } from '../testUtils'

const Provider = getTestProvider()

const useCommitCount = () => {
  const commitCountRef = useRef(1)
  useEffect(() => {
    commitCountRef.current += 1
  })
  return commitCountRef.current
}

it('selectAtom works as expected', async () => {
  const bigAtom = atom({ a: 0, b: 'othervalue' })
  const littleAtom = selectAtom(bigAtom, (v) => v.a)

  const Parent = () => {
    const setValue = useSetAtom(bigAtom)
    return (
      <>
        <button
          onClick={() =>
            setValue((oldValue) => ({ ...oldValue, a: oldValue.a + 1 }))
          }>
          increment
        </button>
      </>
    )
  }

  const Selector = () => {
    const a = useAtomValue(littleAtom)
    return (
      <>
        <div>a: {a}</div>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Parent />
        <Selector />
      </Provider>
    </StrictMode>
  )

  await findByText('a: 0')

  fireEvent.click(getByText('increment'))
  await findByText('a: 1')
  fireEvent.click(getByText('increment'))
  await findByText('a: 2')
  fireEvent.click(getByText('increment'))
  await findByText('a: 3')
})

it('selectAtom works with async atom', async () => {
  const bigAtom = atom({ a: 0, b: 'othervalue' })
  const bigAtomAsync = atom((get) => Promise.resolve(get(bigAtom)))
  const littleAtom = selectAtom(bigAtomAsync, (v) => v.a)

  const Parent = () => {
    const setValue = useSetAtom(bigAtom)
    return (
      <>
        <button
          onClick={() =>
            setValue((oldValue) => ({ ...oldValue, a: oldValue.a + 1 }))
          }>
          increment
        </button>
      </>
    )
  }

  const Selector = () => {
    const a = useAtomValue(littleAtom)
    return (
      <>
        <div>a: {a}</div>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback={null}>
          <Parent />
          <Selector />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('a: 0')

  fireEvent.click(getByText('increment'))
  await findByText('a: 1')
  fireEvent.click(getByText('increment'))
  await findByText('a: 2')
  fireEvent.click(getByText('increment'))
  await findByText('a: 3')
})

it('do not update unless equality function says value has changed', async () => {
  const bigAtom = atom({ a: 0 })
  const littleAtom = selectAtom(
    bigAtom,
    (value) => value,
    (left, right) => JSON.stringify(left) === JSON.stringify(right)
  )

  const Parent = () => {
    const setValue = useSetAtom(bigAtom)
    return (
      <>
        <button
          onClick={() =>
            setValue((oldValue) => ({ ...oldValue, a: oldValue.a + 1 }))
          }>
          increment
        </button>
        <button onClick={() => setValue((oldValue) => ({ ...oldValue }))}>
          copy
        </button>
      </>
    )
  }

  const Selector = () => {
    const value = useAtomValue(littleAtom)
    const commits = useCommitCount()
    return (
      <>
        <div>value: {JSON.stringify(value)}</div>
        <div>commits: {commits}</div>
      </>
    )
  }

  const { findByText, getByText } = render(
    <>
      <Provider>
        <Parent />
        <Selector />
      </Provider>
    </>
  )

  await findByText('value: {"a":0}')
  await findByText('commits: 1')
  fireEvent.click(getByText('copy'))
  await findByText('value: {"a":0}')
  await findByText('commits: 1')

  fireEvent.click(getByText('increment'))
  await findByText('value: {"a":1}')
  await findByText('commits: 2')
  fireEvent.click(getByText('copy'))
  await findByText('value: {"a":1}')
  await findByText('commits: 2')

  fireEvent.click(getByText('increment'))
  await findByText('value: {"a":2}')
  await findByText('commits: 3')
  fireEvent.click(getByText('copy'))
  await findByText('value: {"a":2}')
  await findByText('commits: 3')

  fireEvent.click(getByText('increment'))
  await findByText('value: {"a":3}')
  await findByText('commits: 4')
  fireEvent.click(getByText('copy'))
  await findByText('value: {"a":3}')
  await findByText('commits: 4')
})

it('equality function works even if suspend', async () => {
  const bigAtom = atom({ a: 0 })
  const bigAtomAsync = atom((get) => Promise.resolve(get(bigAtom)))
  const littleAtom = selectAtom(
    bigAtomAsync,
    (value) => value,
    (left, right) => left.a === right.a
  )

  const Controls = () => {
    const [value, setValue] = useAtom(bigAtom)
    return (
      <>
        <div>bigValue: {JSON.stringify(value)}</div>
        <button
          onClick={() =>
            setValue((oldValue) => ({ ...oldValue, a: oldValue.a + 1 }))
          }>
          increment
        </button>
        <button onClick={() => setValue((oldValue) => ({ ...oldValue, b: 2 }))}>
          other
        </button>
      </>
    )
  }

  const Selector = () => {
    const value = useAtomValue(littleAtom)
    return <div>littleValue: {JSON.stringify(value)}</div>
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Suspense fallback={null}>
          <Controls />
          <Selector />
        </Suspense>
      </Provider>
    </StrictMode>
  )

  await findByText('bigValue: {"a":0}')
  await findByText('littleValue: {"a":0}')

  fireEvent.click(getByText('increment'))
  await findByText('bigValue: {"a":1}')
  await findByText('littleValue: {"a":1}')

  fireEvent.click(getByText('other'))
  await findByText('bigValue: {"a":1,"b":2}')
  await findByText('littleValue: {"a":1}')
})

it('useSelector with scope', async () => {
  const scope = Symbol()
  const bigAtom = atom({ a: 0, b: 'othervalue' })

  const Parent = () => {
    const setValue = useSetAtom(bigAtom, scope)
    return (
      <>
        <button
          onClick={() =>
            setValue((oldValue) => ({ ...oldValue, a: oldValue.a + 1 }))
          }>
          increment
        </button>
      </>
    )
  }

  const selectA = (value: { a: number }) => value.a
  const Selector = () => {
    const a = useAtomValue(selectAtom(bigAtom, selectA), scope)
    return (
      <>
        <div>a: {a}</div>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider scope={scope}>
        <Parent />
        <Selector />
      </Provider>
    </StrictMode>
  )

  await findByText('a: 0')

  fireEvent.click(getByText('increment'))
  await findByText('a: 1')
})