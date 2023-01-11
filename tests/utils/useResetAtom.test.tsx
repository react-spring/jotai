import { StrictMode } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { atom, useAtom } from 'jotai'
import {
  RESET,
  atomWithReducer,
  atomWithReset,
  useResetAtom,
} from 'jotai/utils'
import { getTestProvider } from '../testUtils'

const Provider = getTestProvider()

it('atomWithReset resets to its first value', async () => {
  const countAtom = atomWithReset(0)

  const Parent = () => {
    const [count, setValue] = useAtom(countAtom)
    const resetAtom = useResetAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={resetAtom}>reset</button>
        <button onClick={() => setValue((oldValue) => oldValue + 1)}>
          increment
        </button>
        <button onClick={() => setValue(10)}>set to 10</button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Parent />
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('increment'))
  await findByText('count: 1')
  fireEvent.click(getByText('increment'))
  await findByText('count: 2')
  fireEvent.click(getByText('increment'))
  await findByText('count: 3')

  fireEvent.click(getByText('reset'))
  await findByText('count: 0')

  fireEvent.click(getByText('set to 10'))
  await findByText('count: 10')

  fireEvent.click(getByText('increment'))
  await findByText('count: 11')
  fireEvent.click(getByText('increment'))
  await findByText('count: 12')
  fireEvent.click(getByText('increment'))
  await findByText('count: 13')
})

it('atomWithReset reset based on previous value', async () => {
  const countAtom = atomWithReset(0)

  const Parent = () => {
    const [count, setValue] = useAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button
          onClick={() =>
            setValue((oldValue) => (oldValue === 3 ? RESET : oldValue + 1))
          }>
          increment till 3, then reset
        </button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Parent />
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('increment till 3, then reset'))
  await findByText('count: 1')
  fireEvent.click(getByText('increment till 3, then reset'))
  await findByText('count: 2')
  fireEvent.click(getByText('increment till 3, then reset'))
  await findByText('count: 3')

  fireEvent.click(getByText('increment till 3, then reset'))
  await findByText('count: 0')
})

it('atomWithReset through read-write atom', async () => {
  const primitiveAtom = atomWithReset(0)
  const countAtom = atom(
    (get) => get(primitiveAtom),
    (_get, set, newValue: number | typeof RESET) => set(primitiveAtom, newValue)
  )

  const Parent = () => {
    const [count, setValue] = useAtom(countAtom)
    const resetAtom = useResetAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={resetAtom}>reset</button>
        <button onClick={() => setValue(10)}>set to 10</button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Parent />
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('set to 10'))
  await findByText('count: 10')

  fireEvent.click(getByText('reset'))
  await findByText('count: 0')
})

it('useResetAtom with custom atom', async () => {
  const reducer = (state: number, action: 'INCREASE' | typeof RESET) => {
    switch (action) {
      case 'INCREASE':
        return state + 1
      case RESET:
        return 0
    }
  }

  const countAtom = atomWithReducer(0, reducer)

  const Parent = () => {
    const [count, dispatch] = useAtom(countAtom)
    const resetAtom = useResetAtom(countAtom)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={resetAtom}>reset</button>
        <button onClick={() => dispatch('INCREASE')}>increment</button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider>
        <Parent />
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('increment'))
  await findByText('count: 1')
  fireEvent.click(getByText('increment'))
  await findByText('count: 2')
  fireEvent.click(getByText('increment'))
  await findByText('count: 3')

  fireEvent.click(getByText('reset'))
  await findByText('count: 0')
})

it('useResetAtom with scope', async () => {
  const scope = Symbol()
  const countAtom = atomWithReset(0)

  const Parent = () => {
    const [count, setValue] = useAtom(countAtom, scope)
    const resetAtom = useResetAtom(countAtom, scope)
    return (
      <>
        <div>count: {count}</div>
        <button onClick={resetAtom}>reset</button>
        <button onClick={() => setValue((oldValue) => oldValue + 1)}>
          increment
        </button>
      </>
    )
  }

  const { findByText, getByText } = render(
    <StrictMode>
      <Provider scope={scope}>
        <Parent />
      </Provider>
    </StrictMode>
  )

  await findByText('count: 0')

  fireEvent.click(getByText('increment'))
  await findByText('count: 1')

  fireEvent.click(getByText('reset'))
  await findByText('count: 0')
})