// Writes the long task's spec and reference data into bench/fixture (docs/SPEC.md, data/*.json), deterministically.
// The appendices are large on purpose: the long task must push its agents past 100k tokens of context.
// Run: node bench/tools/gen-circulation.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { addDays, checkout, createState, returnBook } from '../solutions/circulation/src/loans.mjs'
import { fineFor } from '../solutions/circulation/src/fines.mjs'
import { reserve } from '../solutions/circulation/src/reservations.mjs'
import { overdue } from '../solutions/circulation/src/reports.mjs'
import { notices } from '../solutions/circulation/src/notify.mjs'

const FIXTURE = fileURLToPath(new URL('../fixture/', import.meta.url))
let seed = 20261024
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = xs => xs[Math.floor(rand() * xs.length)]

// 60 member types: 6 kinds x 10 tiers
const KINDS = { adult: [14, 4, 2, 25, 500], student: [21, 6, 3, 10, 300], staff: [28, 10, 5, 0, 0], senior: [21, 5, 4, 5, 200], child: [7, 2, 0, 10, 100], scholar: [42, 12, 7, 50, 2000] }
const TIERS = ['basic', 'plus', 'silver', 'gold', 'platinum', 'branch', 'remote', 'family', 'trial', 'honorary']
const types = {}
Object.entries(KINDS).forEach(([kind, [loanDays, maxLoans, graceDays, finePerDay, fineCap]]) =>
  TIERS.forEach((tier, i) => {
    types[`${kind}-${tier}`] = { loanDays: loanDays + (i % 4) * 7, maxLoans: maxLoans + Math.floor(i / 3), graceDays: graceDays + (i % 3), finePerDay: finePerDay ? finePerDay + i * 5 : 0, fineCap: fineCap ? fineCap + i * 100 : 0 }
  }),
)
const FIRST = ['Ann', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max', 'Nia', 'Oz', 'Pia']
const LAST = ['Reed', 'Stone', 'Hart', 'Vale', 'Moss', 'Lane', 'Frost', 'Wren', 'Pike', 'Shaw']
const members = Array.from({ length: 120 }, (_, i) => ({ id: `m${i + 1}`, name: `${pick(FIRST)} ${pick(LAST)}`, type: pick(Object.keys(types)) }))
const WORDS = ['River', 'Glass', 'Night', 'Stone', 'Garden', 'Winter', 'Signal', 'Harbor', 'Paper', 'Echo', 'Copper', 'Field', 'Lantern', 'Orbit']
const books = Array.from({ length: 300 }, (_, i) => ({ id: `b${i + 1}`, title: `The ${pick(WORDS)} ${pick(WORDS)}`, author: `${pick(FIRST)} ${pick(LAST)}`, year: 1900 + Math.floor(rand() * 125), tags: [] }))

const DATES = Array.from({ length: 15 }, (_, i) => addDays('2026-01-03', i * 23))
const md = []
const p = s => md.push(s)

p(`# Circulation spec

This adds lending to the shelf library: members borrow books, return them (late returns cost a fine), reserve books that are out, and get notices. Five new modules under \`src/\`: \`loans.mjs\`, \`fines.mjs\`, \`reservations.mjs\`, \`reports.mjs\`, \`notify.mjs\`. Helpers they share may live in any of them or in a new file.

Sections refer to each other and to the appendices; Appendix A is the member-type table the code loads from \`data/member-types.json\`, Appendices B-D are worked examples to test against.

## 1. State

Every function takes a state and returns a new one (never mutate the argument):

\`\`\`
{
  books:   [{ id, title, author, year, tags }],          // data/books.json
  members: [{ id, name, type }],                              // data/members.json
  types:   { [typeName]: { loanDays, maxLoans, graceDays, finePerDay, fineCap } },  // data/member-types.json
  loans:   [{ bookId, memberId, out, due }],
  queue:   { [bookId]: [memberId, ...] },                     // reservations, oldest first
  holds:   [{ bookId, memberId, until }],
  fines:   [{ memberId, bookId, cents, date }],
}
\`\`\`

Dates are \`YYYY-MM-DD\` strings, counted in whole UTC days. \`loans.mjs\` exports \`addDays(date, n)\` and \`daysBetween(from, to)\` (\`to - from\` in days, negative when \`to\` is earlier) for the other modules.

\`createState({ books, members, types })\` (in \`loans.mjs\`) returns the state with empty \`loans\`, \`queue\` (\`{}\`), \`holds\` and \`fines\`.

## 2. Loans (\`src/loans.mjs\`)

\`checkout(state, { bookId, memberId, date })\` adds \`{ bookId, memberId, out: date, due: addDays(date, loanDays) }\`, where \`loanDays\` comes from the member's type (Appendix A; Appendix C lists due dates). It throws \`Error\` with exactly these messages, checked in this order:

1. \`no such book\`
2. \`no such member\`
3. \`already on loan\` (anyone has the book)
4. \`held for another member\`: a hold on the book for a different member whose \`until\` is on or after \`date\` (see 4.2). An expired hold blocks nobody.
5. \`loan limit reached\`: the member already has \`maxLoans\` loans.

On success the member's own hold on that book (if any) is removed, and the member is removed from the book's reservation queue (if present).

\`returnBook(state, { bookId, date })\` throws \`not on loan\` when nobody has the book. Otherwise it removes the loan; when the return is late it records a fine \`{ memberId, bookId, cents, date }\` with \`cents = fineFor(daysBetween(due, date), type)\` (section 3), only when \`cents > 0\`. Then, if the book's queue is not empty, its first member leaves the queue and gets a hold \`{ bookId, memberId, until: addDays(date, 3) }\` (section 4.2).

## 3. Fines (\`src/fines.mjs\`)

\`fineFor(daysLate, typeRow)\`: the first \`graceDays\` late days are free; each later day costs \`finePerDay\` cents; the total never exceeds \`fineCap\`. Zero or negative \`daysLate\` costs 0. A type with \`finePerDay\` 0 never pays. Appendix B lists the fine for every type and 1-45 days late.

## 4. Reservations (\`src/reservations.mjs\`)

### 4.1 Queue

\`reserve(state, { bookId, memberId })\` appends the member to the book's queue. Errors, in order: \`no such book\`, \`no such member\`, \`already has it\` (the member has the book on loan), \`already reserved\` (the member is already in that queue). A book need not be on loan to be reserved.

\`cancel(state, { bookId, memberId })\` removes the member from the queue; \`not reserved\` when they are not in it.

\`nextFor(state, bookId)\` returns the first member id in the queue, or \`null\`.

### 4.2 Holds

A hold is made by \`returnBook\` (section 2) and lasts through its \`until\` date (3 days after the return). While it lasts only its member can check the book out; after it, anyone can. Holds are never deleted by time passing; they are only removed when their member checks the book out.

## 5. Reports (\`src/reports.mjs\`)

\`overdue(state, date)\`: one \`{ bookId, memberId, daysLate }\` per loan with \`daysLate = daysBetween(due, date) > 0\`, sorted by \`daysLate\` descending, then by book id in natural order (\`b2\` before \`b10\`).

\`memberSummary(state, memberId)\` returns \`{ loans, finesCents, holds }\`: the member's number of loans, the sum of their fines in cents, and their number of holds (any \`until\`).

## 6. Notices (\`src/notify.mjs\`)

\`notices(state, date)\` returns strings, sorted with the default JavaScript string sort:

- \`due-tomorrow <memberId> <bookId>\` for a loan due the day after \`date\`;
- \`overdue <memberId> <bookId> <daysLate>\` for a loan past due on \`date\` (daysLate as in section 5);
- \`hold-ready <memberId> <bookId> until <until>\` for a hold whose \`until\` is on or after \`date\`.

Appendix D shows notices in context.
`)

p(`## Appendix A: member types (\`data/member-types.json\`)\n\n| type | loanDays | maxLoans | graceDays | finePerDay | fineCap |\n|---|---|---|---|---|---|`)
for (const [n, t] of Object.entries(types)) p(`| ${n} | ${t.loanDays} | ${t.maxLoans} | ${t.graceDays} | ${t.finePerDay} | ${t.fineCap} |`)

p(`\n## Appendix B: fines by type and days late (cents)\n\n| type | days late | fine |\n|---|---|---|`)
for (const [n, t] of Object.entries(types)) for (let d = 1; d <= 45; d++) p(`| ${n} | ${d} | ${fineFor(d, t)} |`)

p(`\n## Appendix C: due dates by type and checkout date\n\n| type | checked out | due |\n|---|---|---|`)
for (const [n, t] of Object.entries(types)) for (const d of DATES) p(`| ${n} | ${d} | ${addDays(d, t.loanDays)} |`)

p(`\n## Appendix D: worked scenarios\n\nEach scenario starts from \`createState\` with the data files and runs the steps in order. "->" shows the result.\n`)
const base = createState({ books, members, types })
for (let k = 1; k <= 420; k++) {
  let s = base
  const steps = []
  const day0 = pick(DATES)
  const bk = pick(books).id
  const [a, b, c] = [pick(members), pick(members), pick(members)]
  const tryStep = (label, fn) => {
    try {
      s = fn(s)
      steps.push(`${label} -> ok`)
    } catch (e) {
      steps.push(`${label} -> error "${e.message}"`)
    }
  }
  tryStep(`checkout ${bk} by ${a.id} (${a.type}) on ${day0}`, x => checkout(x, { bookId: bk, memberId: a.id, date: day0 }))
  tryStep(`reserve ${bk} by ${b.id}`, x => reserve(x, { bookId: bk, memberId: b.id }))
  const back = addDays(day0, Math.floor(rand() * 60))
  tryStep(`return ${bk} on ${back}`, x => returnBook(x, { bookId: bk, date: back }))
  const try2 = addDays(back, 1 + Math.floor(rand() * 5))
  tryStep(`checkout ${bk} by ${c.id} (${c.type}) on ${try2}`, x => checkout(x, { bookId: bk, memberId: c.id, date: try2 }))
  const fines = s.fines.map(f => `${f.memberId} ${f.cents}c`).join(', ') || 'none'
  const od = overdue(s, addDays(try2, 30)).map(r => `${r.bookId}/${r.memberId}/${r.daysLate}`).join(', ') || 'none'
  p(`### D.${k}\n\n${steps.map(x => `- ${x}`).join('\n')}\n- fines: ${fines}\n- overdue on ${addDays(try2, 30)}: ${od}\n- notices on ${try2}: ${notices(s, try2).join('; ') || 'none'}\n`)
}

mkdirSync(join(FIXTURE, 'docs'), { recursive: true })
mkdirSync(join(FIXTURE, 'data'), { recursive: true })
writeFileSync(join(FIXTURE, 'docs', 'SPEC.md'), md.join('\n') + '\n')
writeFileSync(join(FIXTURE, 'data', 'member-types.json'), JSON.stringify(types, null, 2) + '\n')
writeFileSync(join(FIXTURE, 'data', 'members.json'), JSON.stringify(members, null, 2) + '\n')
writeFileSync(join(FIXTURE, 'data', 'books.json'), JSON.stringify(books, null, 2) + '\n')
console.log(`SPEC.md ${(md.join('\n').length / 1024).toFixed(0)} KB`)
