// Reservations: one queue of member ids per book, first come first served.
export function reserve(state, { bookId, memberId }) {
  if (!state.books.some(b => b.id === bookId)) throw new Error('no such book')
  if (!state.members.some(m => m.id === memberId)) throw new Error('no such member')
  if (state.loans.some(l => l.bookId === bookId && l.memberId === memberId)) throw new Error('already has it')
  const queue = state.queue[bookId] ?? []
  if (queue.includes(memberId)) throw new Error('already reserved')
  return { ...state, queue: { ...state.queue, [bookId]: [...queue, memberId] } }
}

export function cancel(state, { bookId, memberId }) {
  const queue = state.queue[bookId] ?? []
  if (!queue.includes(memberId)) throw new Error('not reserved')
  return { ...state, queue: { ...state.queue, [bookId]: queue.filter(id => id !== memberId) } }
}

export function nextFor(state, bookId) {
  return (state.queue[bookId] ?? [])[0] ?? null
}
