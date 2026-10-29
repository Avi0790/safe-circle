import type { KeyboardEvent } from 'react'

// For something that isn't a <button> but acts like one (a whole list row or
// card): Enter and Space activate it, as they would a button.
export function activateOnKey(activate: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate()
    }
  }
}
