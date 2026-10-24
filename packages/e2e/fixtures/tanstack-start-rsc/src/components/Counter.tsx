'use client'

import * as React from 'react'

export function Counter({ label }: { label: string }) {
  const [count, setCount] = React.useState(0)

  return (
    <button
      type="button"
      className="rounded border px-2"
      onClick={() => setCount((count) => count + 1)}
    >
      {label}: {count}
    </button>
  )
}
