import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { checkout, createState, returnBook } from '../src/loans.mjs'
import { fineFor } from '../src/fines.mjs'
import { cancel, nextFor, reserve } from '../src/reservations.mjs'
import { memberSummary, overdue } from '../src/reports.mjs'
import { notices } from '../src/notify.mjs'

const types = {
  adult: { loanDays: 14, maxLoans: 2, graceDays: 2, finePerDay: 25, fineCap: 300 },
  child: { loanDays: 7, maxLoans: 1, graceDays: 0, finePerDay: 10, fineCap: 50 },
}
const books = ['b1', 'b2', 'b3', 'b10'].map(id => ({ id, title: `T${id}`, author: 'A', year: 2000 }))
const members = [{ id: 'm1', name: 'Ann', type: 'adult' }, { id: 'm2', name: 'Bo', type: 'child' }, { id: 'm3', name: 'Cy', type: 'adult' }]
const fresh = () => createState({ books, members, types })
const err = (fn, message) => assert.throws(fn, { message })

test('fineFor applies grace days, the daily rate and the cap', () => {
  assert.equal(fineFor(0, types.adult), 0)
  assert.equal(fineFor(-3, types.adult), 0)
  assert.equal(fineFor(2, types.adult), 0)
  assert.equal(fineFor(5, types.adult), 75)
  assert.equal(fineFor(40, types.adult), 300)
  assert.equal(fineFor(3, types.child), 30)
})

test('fineFor matches the reference table for every member type', () => {
  const table = JSON.parse(readFileSync(new URL('../data/member-types.json', import.meta.url), 'utf8'))
  for (const [name, t] of Object.entries(table)) for (const d of [1, 4, 9, 30]) assert.equal(fineFor(d, t), Math.min(Math.max(0, d - t.graceDays) * t.finePerDay, t.fineCap), name)
})

test('checkout sets the due date and enforces its rules in order', () => {
  const s = checkout(fresh(), { bookId: 'b1', memberId: 'm1', date: '2026-02-20' })
  assert.deepEqual(s.loans, [{ bookId: 'b1', memberId: 'm1', out: '2026-02-20', due: '2026-03-06' }])
  err(() => checkout(s, { bookId: 'b9', memberId: 'm1', date: '2026-02-20' }), 'no such book')
  err(() => checkout(s, { bookId: 'b2', memberId: 'm9', date: '2026-02-20' }), 'no such member')
  err(() => checkout(s, { bookId: 'b1', memberId: 'm3', date: '2026-02-20' }), 'already on loan')
  const two = checkout(s, { bookId: 'b2', memberId: 'm1', date: '2026-02-20' })
  err(() => checkout(two, { bookId: 'b3', memberId: 'm1', date: '2026-02-20' }), 'loan limit reached')
  assert.equal(fresh().loans.length, 0)
})

test('returning late records a fine; the next in the queue gets a 3-day hold that blocks others', () => {
  let s = checkout(fresh(), { bookId: 'b1', memberId: 'm2', date: '2026-01-01' })
  s = reserve(s, { bookId: 'b1', memberId: 'm3' })
  s = reserve(s, { bookId: 'b1', memberId: 'm1' })
  err(() => reserve(s, { bookId: 'b1', memberId: 'm3' }), 'already reserved')
  err(() => reserve(s, { bookId: 'b1', memberId: 'm2' }), 'already has it')
  assert.equal(nextFor(s, 'b1'), 'm3')
  s = returnBook(s, { bookId: 'b1', date: '2026-01-11' })
  assert.deepEqual(s.fines, [{ memberId: 'm2', bookId: 'b1', cents: 30, date: '2026-01-11' }])
  assert.deepEqual(s.holds, [{ bookId: 'b1', memberId: 'm3', until: '2026-01-14' }])
  assert.equal(nextFor(s, 'b1'), 'm1')
  err(() => checkout(s, { bookId: 'b1', memberId: 'm1', date: '2026-01-12' }), 'held for another member')
  const late = checkout(s, { bookId: 'b1', memberId: 'm1', date: '2026-01-15' })
  assert.equal(late.loans[0].memberId, 'm1')
  assert.equal(nextFor(late, 'b1'), null)
  const own = checkout(s, { bookId: 'b1', memberId: 'm3', date: '2026-01-12' })
  assert.deepEqual(own.holds, [])
  err(() => returnBook(own, { bookId: 'b2', date: '2026-01-12' }), 'not on loan')
})

test('cancel removes a reservation', () => {
  const s = reserve(fresh(), { bookId: 'b2', memberId: 'm1' })
  assert.equal(nextFor(cancel(s, { bookId: 'b2', memberId: 'm1' }), 'b2'), null)
  err(() => cancel(s, { bookId: 'b2', memberId: 'm3' }), 'not reserved')
  err(() => reserve(s, { bookId: 'bx', memberId: 'm1' }), 'no such book')
})

test('overdue sorts by days late, then book id in natural order; summaries and notices', () => {
  let s = fresh()
  s = checkout(s, { bookId: 'b10', memberId: 'm1', date: '2026-03-01' })
  s = checkout(s, { bookId: 'b2', memberId: 'm3', date: '2026-03-01' })
  s = checkout(s, { bookId: 'b3', memberId: 'm2', date: '2026-03-10' })
  assert.deepEqual(overdue(s, '2026-03-20'), [
    { bookId: 'b2', memberId: 'm3', daysLate: 5 },
    { bookId: 'b10', memberId: 'm1', daysLate: 5 },
    { bookId: 'b3', memberId: 'm2', daysLate: 3 },
  ])
  assert.deepEqual(overdue(s, '2026-03-15'), [])
  assert.deepEqual(notices(s, '2026-03-18'), ['overdue m1 b10 3', 'overdue m2 b3 1', 'overdue m3 b2 3'])
  assert.deepEqual(notices(s, '2026-03-14'), ['due-tomorrow m1 b10', 'due-tomorrow m3 b2'])
  s = reserve(s, { bookId: 'b3', memberId: 'm1' })
  s = returnBook(s, { bookId: 'b3', date: '2026-03-20' })
  assert.deepEqual(memberSummary(s, 'm2'), { loans: 0, finesCents: 30, holds: 0 })
  assert.deepEqual(memberSummary(s, 'm1'), { loans: 1, finesCents: 0, holds: 1 })
  assert.ok(notices(s, '2026-03-21').includes('hold-ready m1 b3 until 2026-03-23'))
  assert.ok(!notices(s, '2026-03-24').some(n => n.startsWith('hold-ready')))
})
