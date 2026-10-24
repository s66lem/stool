import { daysBetween } from './loans.mjs'

export function notices(state, date) {
  const out = []
  for (const l of state.loans) {
    const left = daysBetween(date, l.due)
    if (left === 1) out.push(`due-tomorrow ${l.memberId} ${l.bookId}`)
    if (left < 0) out.push(`overdue ${l.memberId} ${l.bookId} ${-left}`)
  }
  for (const h of state.holds) if (h.until >= date) out.push(`hold-ready ${h.memberId} ${h.bookId} until ${h.until}`)
  return out.sort()
}
