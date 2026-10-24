// Loans: checking books out and back in. State is never mutated; every function returns a new state.
import { fineFor } from './fines.mjs'

export const HOLD_DAYS = 3
const DAY = 86_400_000

export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

export function createState({ books, members, types }) {
  return { books, members, types, loans: [], queue: {}, holds: [], fines: [] }
}

export function checkout(state, { bookId, memberId, date }) {
  if (!state.books.some(b => b.id === bookId)) throw new Error('no such book')
  const member = state.members.find(m => m.id === memberId)
  if (!member) throw new Error('no such member')
  if (state.loans.some(l => l.bookId === bookId)) throw new Error('already on loan')
  if (state.holds.some(h => h.bookId === bookId && h.memberId !== memberId && h.until >= date)) throw new Error('held for another member')
  const type = state.types[member.type]
  if (state.loans.filter(l => l.memberId === memberId).length >= type.maxLoans) throw new Error('loan limit reached')
  const queue = (state.queue[bookId] ?? []).filter(id => id !== memberId)
  return {
    ...state,
    loans: [...state.loans, { bookId, memberId, out: date, due: addDays(date, type.loanDays) }],
    holds: state.holds.filter(h => !(h.bookId === bookId && h.memberId === memberId)),
    queue: { ...state.queue, [bookId]: queue },
  }
}

export function returnBook(state, { bookId, date }) {
  const loan = state.loans.find(l => l.bookId === bookId)
  if (!loan) throw new Error('not on loan')
  const member = state.members.find(m => m.id === loan.memberId)
  const cents = fineFor(daysBetween(loan.due, date), state.types[member.type])
  const [next, ...rest] = state.queue[bookId] ?? []
  return {
    ...state,
    loans: state.loans.filter(l => l !== loan),
    fines: cents > 0 ? [...state.fines, { memberId: loan.memberId, bookId, cents, date }] : state.fines,
    queue: { ...state.queue, [bookId]: rest },
    holds: next ? [...state.holds, { bookId, memberId: next, until: addDays(date, HOLD_DAYS) }] : state.holds,
  }
}
