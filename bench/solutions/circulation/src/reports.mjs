import { daysBetween } from './loans.mjs'

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true })

export function overdue(state, date) {
  return state.loans
    .map(l => ({ bookId: l.bookId, memberId: l.memberId, daysLate: daysBetween(l.due, date) }))
    .filter(r => r.daysLate > 0)
    .sort((a, b) => b.daysLate - a.daysLate || natural(a.bookId, b.bookId))
}

export function memberSummary(state, memberId) {
  return {
    loans: state.loans.filter(l => l.memberId === memberId).length,
    finesCents: state.fines.filter(f => f.memberId === memberId).reduce((s, f) => s + f.cents, 0),
    holds: state.holds.filter(h => h.memberId === memberId).length,
  }
}
