import React from 'react'

export const Main = ({ children }) => {
  return (
    <main className="w-full lg:w-2/3 max-w-4xl mx-auto p-8 lg:p-16 pt-26 lg:pt-32 space-y-16">
      {children}
    </main>
  )
}
