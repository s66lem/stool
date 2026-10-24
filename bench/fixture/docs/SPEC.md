# Circulation spec

This adds lending to the shelf library: members borrow books, return them (late returns cost a fine), reserve books that are out, and get notices. Five new modules under `src/`: `loans.mjs`, `fines.mjs`, `reservations.mjs`, `reports.mjs`, `notify.mjs`. Helpers they share may live in any of them or in a new file.

Sections refer to each other and to the appendices; Appendix A is the member-type table the code loads from `data/member-types.json`, Appendices B-D are worked examples to test against.

## 1. State

Every function takes a state and returns a new one (never mutate the argument):

```
{
  books:   [{ id, title, author, year, tags }],          // data/books.json
  members: [{ id, name, type }],                              // data/members.json
  types:   { [typeName]: { loanDays, maxLoans, graceDays, finePerDay, fineCap } },  // data/member-types.json
  loans:   [{ bookId, memberId, out, due }],
  queue:   { [bookId]: [memberId, ...] },                     // reservations, oldest first
  holds:   [{ bookId, memberId, until }],
  fines:   [{ memberId, bookId, cents, date }],
}
```

Dates are `YYYY-MM-DD` strings, counted in whole UTC days. `loans.mjs` exports `addDays(date, n)` and `daysBetween(from, to)` (`to - from` in days, negative when `to` is earlier) for the other modules.

`createState({ books, members, types })` (in `loans.mjs`) returns the state with empty `loans`, `queue` (`{}`), `holds` and `fines`.

## 2. Loans (`src/loans.mjs`)

`checkout(state, { bookId, memberId, date })` adds `{ bookId, memberId, out: date, due: addDays(date, loanDays) }`, where `loanDays` comes from the member's type (Appendix A; Appendix C lists due dates). It throws `Error` with exactly these messages, checked in this order:

1. `no such book`
2. `no such member`
3. `already on loan` (anyone has the book)
4. `held for another member`: a hold on the book for a different member whose `until` is on or after `date` (see 4.2). An expired hold blocks nobody.
5. `loan limit reached`: the member already has `maxLoans` loans.

On success the member's own hold on that book (if any) is removed, and the member is removed from the book's reservation queue (if present).

`returnBook(state, { bookId, date })` throws `not on loan` when nobody has the book. Otherwise it removes the loan; when the return is late it records a fine `{ memberId, bookId, cents, date }` with `cents = fineFor(daysBetween(due, date), type)` (section 3), only when `cents > 0`. Then, if the book's queue is not empty, its first member leaves the queue and gets a hold `{ bookId, memberId, until: addDays(date, 3) }` (section 4.2).

## 3. Fines (`src/fines.mjs`)

`fineFor(daysLate, typeRow)`: the first `graceDays` late days are free; each later day costs `finePerDay` cents; the total never exceeds `fineCap`. Zero or negative `daysLate` costs 0. A type with `finePerDay` 0 never pays. Appendix B lists the fine for every type and 1-45 days late.

## 4. Reservations (`src/reservations.mjs`)

### 4.1 Queue

`reserve(state, { bookId, memberId })` appends the member to the book's queue. Errors, in order: `no such book`, `no such member`, `already has it` (the member has the book on loan), `already reserved` (the member is already in that queue). A book need not be on loan to be reserved.

`cancel(state, { bookId, memberId })` removes the member from the queue; `not reserved` when they are not in it.

`nextFor(state, bookId)` returns the first member id in the queue, or `null`.

### 4.2 Holds

A hold is made by `returnBook` (section 2) and lasts through its `until` date (3 days after the return). While it lasts only its member can check the book out; after it, anyone can. Holds are never deleted by time passing; they are only removed when their member checks the book out.

## 5. Reports (`src/reports.mjs`)

`overdue(state, date)`: one `{ bookId, memberId, daysLate }` per loan with `daysLate = daysBetween(due, date) > 0`, sorted by `daysLate` descending, then by book id in natural order (`b2` before `b10`).

`memberSummary(state, memberId)` returns `{ loans, finesCents, holds }`: the member's number of loans, the sum of their fines in cents, and their number of holds (any `until`).

## 6. Notices (`src/notify.mjs`)

`notices(state, date)` returns strings, sorted with the default JavaScript string sort:

- `due-tomorrow <memberId> <bookId>` for a loan due the day after `date`;
- `overdue <memberId> <bookId> <daysLate>` for a loan past due on `date` (daysLate as in section 5);
- `hold-ready <memberId> <bookId> until <until>` for a hold whose `until` is on or after `date`.

Appendix D shows notices in context.

## Appendix A: member types (`data/member-types.json`)

| type | loanDays | maxLoans | graceDays | finePerDay | fineCap |
|---|---|---|---|---|---|
| adult-basic | 14 | 4 | 2 | 25 | 500 |
| adult-plus | 21 | 4 | 3 | 30 | 600 |
| adult-silver | 28 | 4 | 4 | 35 | 700 |
| adult-gold | 35 | 5 | 2 | 40 | 800 |
| adult-platinum | 14 | 5 | 3 | 45 | 900 |
| adult-branch | 21 | 5 | 4 | 50 | 1000 |
| adult-remote | 28 | 6 | 2 | 55 | 1100 |
| adult-family | 35 | 6 | 3 | 60 | 1200 |
| adult-trial | 14 | 6 | 4 | 65 | 1300 |
| adult-honorary | 21 | 7 | 2 | 70 | 1400 |
| student-basic | 21 | 6 | 3 | 10 | 300 |
| student-plus | 28 | 6 | 4 | 15 | 400 |
| student-silver | 35 | 6 | 5 | 20 | 500 |
| student-gold | 42 | 7 | 3 | 25 | 600 |
| student-platinum | 21 | 7 | 4 | 30 | 700 |
| student-branch | 28 | 7 | 5 | 35 | 800 |
| student-remote | 35 | 8 | 3 | 40 | 900 |
| student-family | 42 | 8 | 4 | 45 | 1000 |
| student-trial | 21 | 8 | 5 | 50 | 1100 |
| student-honorary | 28 | 9 | 3 | 55 | 1200 |
| staff-basic | 28 | 10 | 5 | 0 | 0 |
| staff-plus | 35 | 10 | 6 | 0 | 0 |
| staff-silver | 42 | 10 | 7 | 0 | 0 |
| staff-gold | 49 | 11 | 5 | 0 | 0 |
| staff-platinum | 28 | 11 | 6 | 0 | 0 |
| staff-branch | 35 | 11 | 7 | 0 | 0 |
| staff-remote | 42 | 12 | 5 | 0 | 0 |
| staff-family | 49 | 12 | 6 | 0 | 0 |
| staff-trial | 28 | 12 | 7 | 0 | 0 |
| staff-honorary | 35 | 13 | 5 | 0 | 0 |
| senior-basic | 21 | 5 | 4 | 5 | 200 |
| senior-plus | 28 | 5 | 5 | 10 | 300 |
| senior-silver | 35 | 5 | 6 | 15 | 400 |
| senior-gold | 42 | 6 | 4 | 20 | 500 |
| senior-platinum | 21 | 6 | 5 | 25 | 600 |
| senior-branch | 28 | 6 | 6 | 30 | 700 |
| senior-remote | 35 | 7 | 4 | 35 | 800 |
| senior-family | 42 | 7 | 5 | 40 | 900 |
| senior-trial | 21 | 7 | 6 | 45 | 1000 |
| senior-honorary | 28 | 8 | 4 | 50 | 1100 |
| child-basic | 7 | 2 | 0 | 10 | 100 |
| child-plus | 14 | 2 | 1 | 15 | 200 |
| child-silver | 21 | 2 | 2 | 20 | 300 |
| child-gold | 28 | 3 | 0 | 25 | 400 |
| child-platinum | 7 | 3 | 1 | 30 | 500 |
| child-branch | 14 | 3 | 2 | 35 | 600 |
| child-remote | 21 | 4 | 0 | 40 | 700 |
| child-family | 28 | 4 | 1 | 45 | 800 |
| child-trial | 7 | 4 | 2 | 50 | 900 |
| child-honorary | 14 | 5 | 0 | 55 | 1000 |
| scholar-basic | 42 | 12 | 7 | 50 | 2000 |
| scholar-plus | 49 | 12 | 8 | 55 | 2100 |
| scholar-silver | 56 | 12 | 9 | 60 | 2200 |
| scholar-gold | 63 | 13 | 7 | 65 | 2300 |
| scholar-platinum | 42 | 13 | 8 | 70 | 2400 |
| scholar-branch | 49 | 13 | 9 | 75 | 2500 |
| scholar-remote | 56 | 14 | 7 | 80 | 2600 |
| scholar-family | 63 | 14 | 8 | 85 | 2700 |
| scholar-trial | 42 | 14 | 9 | 90 | 2800 |
| scholar-honorary | 49 | 15 | 7 | 95 | 2900 |

## Appendix B: fines by type and days late (cents)

| type | days late | fine |
|---|---|---|
| adult-basic | 1 | 0 |
| adult-basic | 2 | 0 |
| adult-basic | 3 | 25 |
| adult-basic | 4 | 50 |
| adult-basic | 5 | 75 |
| adult-basic | 6 | 100 |
| adult-basic | 7 | 125 |
| adult-basic | 8 | 150 |
| adult-basic | 9 | 175 |
| adult-basic | 10 | 200 |
| adult-basic | 11 | 225 |
| adult-basic | 12 | 250 |
| adult-basic | 13 | 275 |
| adult-basic | 14 | 300 |
| adult-basic | 15 | 325 |
| adult-basic | 16 | 350 |
| adult-basic | 17 | 375 |
| adult-basic | 18 | 400 |
| adult-basic | 19 | 425 |
| adult-basic | 20 | 450 |
| adult-basic | 21 | 475 |
| adult-basic | 22 | 500 |
| adult-basic | 23 | 500 |
| adult-basic | 24 | 500 |
| adult-basic | 25 | 500 |
| adult-basic | 26 | 500 |
| adult-basic | 27 | 500 |
| adult-basic | 28 | 500 |
| adult-basic | 29 | 500 |
| adult-basic | 30 | 500 |
| adult-basic | 31 | 500 |
| adult-basic | 32 | 500 |
| adult-basic | 33 | 500 |
| adult-basic | 34 | 500 |
| adult-basic | 35 | 500 |
| adult-basic | 36 | 500 |
| adult-basic | 37 | 500 |
| adult-basic | 38 | 500 |
| adult-basic | 39 | 500 |
| adult-basic | 40 | 500 |
| adult-basic | 41 | 500 |
| adult-basic | 42 | 500 |
| adult-basic | 43 | 500 |
| adult-basic | 44 | 500 |
| adult-basic | 45 | 500 |
| adult-plus | 1 | 0 |
| adult-plus | 2 | 0 |
| adult-plus | 3 | 0 |
| adult-plus | 4 | 30 |
| adult-plus | 5 | 60 |
| adult-plus | 6 | 90 |
| adult-plus | 7 | 120 |
| adult-plus | 8 | 150 |
| adult-plus | 9 | 180 |
| adult-plus | 10 | 210 |
| adult-plus | 11 | 240 |
| adult-plus | 12 | 270 |
| adult-plus | 13 | 300 |
| adult-plus | 14 | 330 |
| adult-plus | 15 | 360 |
| adult-plus | 16 | 390 |
| adult-plus | 17 | 420 |
| adult-plus | 18 | 450 |
| adult-plus | 19 | 480 |
| adult-plus | 20 | 510 |
| adult-plus | 21 | 540 |
| adult-plus | 22 | 570 |
| adult-plus | 23 | 600 |
| adult-plus | 24 | 600 |
| adult-plus | 25 | 600 |
| adult-plus | 26 | 600 |
| adult-plus | 27 | 600 |
| adult-plus | 28 | 600 |
| adult-plus | 29 | 600 |
| adult-plus | 30 | 600 |
| adult-plus | 31 | 600 |
| adult-plus | 32 | 600 |
| adult-plus | 33 | 600 |
| adult-plus | 34 | 600 |
| adult-plus | 35 | 600 |
| adult-plus | 36 | 600 |
| adult-plus | 37 | 600 |
| adult-plus | 38 | 600 |
| adult-plus | 39 | 600 |
| adult-plus | 40 | 600 |
| adult-plus | 41 | 600 |
| adult-plus | 42 | 600 |
| adult-plus | 43 | 600 |
| adult-plus | 44 | 600 |
| adult-plus | 45 | 600 |
| adult-silver | 1 | 0 |
| adult-silver | 2 | 0 |
| adult-silver | 3 | 0 |
| adult-silver | 4 | 0 |
| adult-silver | 5 | 35 |
| adult-silver | 6 | 70 |
| adult-silver | 7 | 105 |
| adult-silver | 8 | 140 |
| adult-silver | 9 | 175 |
| adult-silver | 10 | 210 |
| adult-silver | 11 | 245 |
| adult-silver | 12 | 280 |
| adult-silver | 13 | 315 |
| adult-silver | 14 | 350 |
| adult-silver | 15 | 385 |
| adult-silver | 16 | 420 |
| adult-silver | 17 | 455 |
| adult-silver | 18 | 490 |
| adult-silver | 19 | 525 |
| adult-silver | 20 | 560 |
| adult-silver | 21 | 595 |
| adult-silver | 22 | 630 |
| adult-silver | 23 | 665 |
| adult-silver | 24 | 700 |
| adult-silver | 25 | 700 |
| adult-silver | 26 | 700 |
| adult-silver | 27 | 700 |
| adult-silver | 28 | 700 |
| adult-silver | 29 | 700 |
| adult-silver | 30 | 700 |
| adult-silver | 31 | 700 |
| adult-silver | 32 | 700 |
| adult-silver | 33 | 700 |
| adult-silver | 34 | 700 |
| adult-silver | 35 | 700 |
| adult-silver | 36 | 700 |
| adult-silver | 37 | 700 |
| adult-silver | 38 | 700 |
| adult-silver | 39 | 700 |
| adult-silver | 40 | 700 |
| adult-silver | 41 | 700 |
| adult-silver | 42 | 700 |
| adult-silver | 43 | 700 |
| adult-silver | 44 | 700 |
| adult-silver | 45 | 700 |
| adult-gold | 1 | 0 |
| adult-gold | 2 | 0 |
| adult-gold | 3 | 40 |
| adult-gold | 4 | 80 |
| adult-gold | 5 | 120 |
| adult-gold | 6 | 160 |
| adult-gold | 7 | 200 |
| adult-gold | 8 | 240 |
| adult-gold | 9 | 280 |
| adult-gold | 10 | 320 |
| adult-gold | 11 | 360 |
| adult-gold | 12 | 400 |
| adult-gold | 13 | 440 |
| adult-gold | 14 | 480 |
| adult-gold | 15 | 520 |
| adult-gold | 16 | 560 |
| adult-gold | 17 | 600 |
| adult-gold | 18 | 640 |
| adult-gold | 19 | 680 |
| adult-gold | 20 | 720 |
| adult-gold | 21 | 760 |
| adult-gold | 22 | 800 |
| adult-gold | 23 | 800 |
| adult-gold | 24 | 800 |
| adult-gold | 25 | 800 |
| adult-gold | 26 | 800 |
| adult-gold | 27 | 800 |
| adult-gold | 28 | 800 |
| adult-gold | 29 | 800 |
| adult-gold | 30 | 800 |
| adult-gold | 31 | 800 |
| adult-gold | 32 | 800 |
| adult-gold | 33 | 800 |
| adult-gold | 34 | 800 |
| adult-gold | 35 | 800 |
| adult-gold | 36 | 800 |
| adult-gold | 37 | 800 |
| adult-gold | 38 | 800 |
| adult-gold | 39 | 800 |
| adult-gold | 40 | 800 |
| adult-gold | 41 | 800 |
| adult-gold | 42 | 800 |
| adult-gold | 43 | 800 |
| adult-gold | 44 | 800 |
| adult-gold | 45 | 800 |
| adult-platinum | 1 | 0 |
| adult-platinum | 2 | 0 |
| adult-platinum | 3 | 0 |
| adult-platinum | 4 | 45 |
| adult-platinum | 5 | 90 |
| adult-platinum | 6 | 135 |
| adult-platinum | 7 | 180 |
| adult-platinum | 8 | 225 |
| adult-platinum | 9 | 270 |
| adult-platinum | 10 | 315 |
| adult-platinum | 11 | 360 |
| adult-platinum | 12 | 405 |
| adult-platinum | 13 | 450 |
| adult-platinum | 14 | 495 |
| adult-platinum | 15 | 540 |
| adult-platinum | 16 | 585 |
| adult-platinum | 17 | 630 |
| adult-platinum | 18 | 675 |
| adult-platinum | 19 | 720 |
| adult-platinum | 20 | 765 |
| adult-platinum | 21 | 810 |
| adult-platinum | 22 | 855 |
| adult-platinum | 23 | 900 |
| adult-platinum | 24 | 900 |
| adult-platinum | 25 | 900 |
| adult-platinum | 26 | 900 |
| adult-platinum | 27 | 900 |
| adult-platinum | 28 | 900 |
| adult-platinum | 29 | 900 |
| adult-platinum | 30 | 900 |
| adult-platinum | 31 | 900 |
| adult-platinum | 32 | 900 |
| adult-platinum | 33 | 900 |
| adult-platinum | 34 | 900 |
| adult-platinum | 35 | 900 |
| adult-platinum | 36 | 900 |
| adult-platinum | 37 | 900 |
| adult-platinum | 38 | 900 |
| adult-platinum | 39 | 900 |
| adult-platinum | 40 | 900 |
| adult-platinum | 41 | 900 |
| adult-platinum | 42 | 900 |
| adult-platinum | 43 | 900 |
| adult-platinum | 44 | 900 |
| adult-platinum | 45 | 900 |
| adult-branch | 1 | 0 |
| adult-branch | 2 | 0 |
| adult-branch | 3 | 0 |
| adult-branch | 4 | 0 |
| adult-branch | 5 | 50 |
| adult-branch | 6 | 100 |
| adult-branch | 7 | 150 |
| adult-branch | 8 | 200 |
| adult-branch | 9 | 250 |
| adult-branch | 10 | 300 |
| adult-branch | 11 | 350 |
| adult-branch | 12 | 400 |
| adult-branch | 13 | 450 |
| adult-branch | 14 | 500 |
| adult-branch | 15 | 550 |
| adult-branch | 16 | 600 |
| adult-branch | 17 | 650 |
| adult-branch | 18 | 700 |
| adult-branch | 19 | 750 |
| adult-branch | 20 | 800 |
| adult-branch | 21 | 850 |
| adult-branch | 22 | 900 |
| adult-branch | 23 | 950 |
| adult-branch | 24 | 1000 |
| adult-branch | 25 | 1000 |
| adult-branch | 26 | 1000 |
| adult-branch | 27 | 1000 |
| adult-branch | 28 | 1000 |
| adult-branch | 29 | 1000 |
| adult-branch | 30 | 1000 |
| adult-branch | 31 | 1000 |
| adult-branch | 32 | 1000 |
| adult-branch | 33 | 1000 |
| adult-branch | 34 | 1000 |
| adult-branch | 35 | 1000 |
| adult-branch | 36 | 1000 |
| adult-branch | 37 | 1000 |
| adult-branch | 38 | 1000 |
| adult-branch | 39 | 1000 |
| adult-branch | 40 | 1000 |
| adult-branch | 41 | 1000 |
| adult-branch | 42 | 1000 |
| adult-branch | 43 | 1000 |
| adult-branch | 44 | 1000 |
| adult-branch | 45 | 1000 |
| adult-remote | 1 | 0 |
| adult-remote | 2 | 0 |
| adult-remote | 3 | 55 |
| adult-remote | 4 | 110 |
| adult-remote | 5 | 165 |
| adult-remote | 6 | 220 |
| adult-remote | 7 | 275 |
| adult-remote | 8 | 330 |
| adult-remote | 9 | 385 |
| adult-remote | 10 | 440 |
| adult-remote | 11 | 495 |
| adult-remote | 12 | 550 |
| adult-remote | 13 | 605 |
| adult-remote | 14 | 660 |
| adult-remote | 15 | 715 |
| adult-remote | 16 | 770 |
| adult-remote | 17 | 825 |
| adult-remote | 18 | 880 |
| adult-remote | 19 | 935 |
| adult-remote | 20 | 990 |
| adult-remote | 21 | 1045 |
| adult-remote | 22 | 1100 |
| adult-remote | 23 | 1100 |
| adult-remote | 24 | 1100 |
| adult-remote | 25 | 1100 |
| adult-remote | 26 | 1100 |
| adult-remote | 27 | 1100 |
| adult-remote | 28 | 1100 |
| adult-remote | 29 | 1100 |
| adult-remote | 30 | 1100 |
| adult-remote | 31 | 1100 |
| adult-remote | 32 | 1100 |
| adult-remote | 33 | 1100 |
| adult-remote | 34 | 1100 |
| adult-remote | 35 | 1100 |
| adult-remote | 36 | 1100 |
| adult-remote | 37 | 1100 |
| adult-remote | 38 | 1100 |
| adult-remote | 39 | 1100 |
| adult-remote | 40 | 1100 |
| adult-remote | 41 | 1100 |
| adult-remote | 42 | 1100 |
| adult-remote | 43 | 1100 |
| adult-remote | 44 | 1100 |
| adult-remote | 45 | 1100 |
| adult-family | 1 | 0 |
| adult-family | 2 | 0 |
| adult-family | 3 | 0 |
| adult-family | 4 | 60 |
| adult-family | 5 | 120 |
| adult-family | 6 | 180 |
| adult-family | 7 | 240 |
| adult-family | 8 | 300 |
| adult-family | 9 | 360 |
| adult-family | 10 | 420 |
| adult-family | 11 | 480 |
| adult-family | 12 | 540 |
| adult-family | 13 | 600 |
| adult-family | 14 | 660 |
| adult-family | 15 | 720 |
| adult-family | 16 | 780 |
| adult-family | 17 | 840 |
| adult-family | 18 | 900 |
| adult-family | 19 | 960 |
| adult-family | 20 | 1020 |
| adult-family | 21 | 1080 |
| adult-family | 22 | 1140 |
| adult-family | 23 | 1200 |
| adult-family | 24 | 1200 |
| adult-family | 25 | 1200 |
| adult-family | 26 | 1200 |
| adult-family | 27 | 1200 |
| adult-family | 28 | 1200 |
| adult-family | 29 | 1200 |
| adult-family | 30 | 1200 |
| adult-family | 31 | 1200 |
| adult-family | 32 | 1200 |
| adult-family | 33 | 1200 |
| adult-family | 34 | 1200 |
| adult-family | 35 | 1200 |
| adult-family | 36 | 1200 |
| adult-family | 37 | 1200 |
| adult-family | 38 | 1200 |
| adult-family | 39 | 1200 |
| adult-family | 40 | 1200 |
| adult-family | 41 | 1200 |
| adult-family | 42 | 1200 |
| adult-family | 43 | 1200 |
| adult-family | 44 | 1200 |
| adult-family | 45 | 1200 |
| adult-trial | 1 | 0 |
| adult-trial | 2 | 0 |
| adult-trial | 3 | 0 |
| adult-trial | 4 | 0 |
| adult-trial | 5 | 65 |
| adult-trial | 6 | 130 |
| adult-trial | 7 | 195 |
| adult-trial | 8 | 260 |
| adult-trial | 9 | 325 |
| adult-trial | 10 | 390 |
| adult-trial | 11 | 455 |
| adult-trial | 12 | 520 |
| adult-trial | 13 | 585 |
| adult-trial | 14 | 650 |
| adult-trial | 15 | 715 |
| adult-trial | 16 | 780 |
| adult-trial | 17 | 845 |
| adult-trial | 18 | 910 |
| adult-trial | 19 | 975 |
| adult-trial | 20 | 1040 |
| adult-trial | 21 | 1105 |
| adult-trial | 22 | 1170 |
| adult-trial | 23 | 1235 |
| adult-trial | 24 | 1300 |
| adult-trial | 25 | 1300 |
| adult-trial | 26 | 1300 |
| adult-trial | 27 | 1300 |
| adult-trial | 28 | 1300 |
| adult-trial | 29 | 1300 |
| adult-trial | 30 | 1300 |
| adult-trial | 31 | 1300 |
| adult-trial | 32 | 1300 |
| adult-trial | 33 | 1300 |
| adult-trial | 34 | 1300 |
| adult-trial | 35 | 1300 |
| adult-trial | 36 | 1300 |
| adult-trial | 37 | 1300 |
| adult-trial | 38 | 1300 |
| adult-trial | 39 | 1300 |
| adult-trial | 40 | 1300 |
| adult-trial | 41 | 1300 |
| adult-trial | 42 | 1300 |
| adult-trial | 43 | 1300 |
| adult-trial | 44 | 1300 |
| adult-trial | 45 | 1300 |
| adult-honorary | 1 | 0 |
| adult-honorary | 2 | 0 |
| adult-honorary | 3 | 70 |
| adult-honorary | 4 | 140 |
| adult-honorary | 5 | 210 |
| adult-honorary | 6 | 280 |
| adult-honorary | 7 | 350 |
| adult-honorary | 8 | 420 |
| adult-honorary | 9 | 490 |
| adult-honorary | 10 | 560 |
| adult-honorary | 11 | 630 |
| adult-honorary | 12 | 700 |
| adult-honorary | 13 | 770 |
| adult-honorary | 14 | 840 |
| adult-honorary | 15 | 910 |
| adult-honorary | 16 | 980 |
| adult-honorary | 17 | 1050 |
| adult-honorary | 18 | 1120 |
| adult-honorary | 19 | 1190 |
| adult-honorary | 20 | 1260 |
| adult-honorary | 21 | 1330 |
| adult-honorary | 22 | 1400 |
| adult-honorary | 23 | 1400 |
| adult-honorary | 24 | 1400 |
| adult-honorary | 25 | 1400 |
| adult-honorary | 26 | 1400 |
| adult-honorary | 27 | 1400 |
| adult-honorary | 28 | 1400 |
| adult-honorary | 29 | 1400 |
| adult-honorary | 30 | 1400 |
| adult-honorary | 31 | 1400 |
| adult-honorary | 32 | 1400 |
| adult-honorary | 33 | 1400 |
| adult-honorary | 34 | 1400 |
| adult-honorary | 35 | 1400 |
| adult-honorary | 36 | 1400 |
| adult-honorary | 37 | 1400 |
| adult-honorary | 38 | 1400 |
| adult-honorary | 39 | 1400 |
| adult-honorary | 40 | 1400 |
| adult-honorary | 41 | 1400 |
| adult-honorary | 42 | 1400 |
| adult-honorary | 43 | 1400 |
| adult-honorary | 44 | 1400 |
| adult-honorary | 45 | 1400 |
| student-basic | 1 | 0 |
| student-basic | 2 | 0 |
| student-basic | 3 | 0 |
| student-basic | 4 | 10 |
| student-basic | 5 | 20 |
| student-basic | 6 | 30 |
| student-basic | 7 | 40 |
| student-basic | 8 | 50 |
| student-basic | 9 | 60 |
| student-basic | 10 | 70 |
| student-basic | 11 | 80 |
| student-basic | 12 | 90 |
| student-basic | 13 | 100 |
| student-basic | 14 | 110 |
| student-basic | 15 | 120 |
| student-basic | 16 | 130 |
| student-basic | 17 | 140 |
| student-basic | 18 | 150 |
| student-basic | 19 | 160 |
| student-basic | 20 | 170 |
| student-basic | 21 | 180 |
| student-basic | 22 | 190 |
| student-basic | 23 | 200 |
| student-basic | 24 | 210 |
| student-basic | 25 | 220 |
| student-basic | 26 | 230 |
| student-basic | 27 | 240 |
| student-basic | 28 | 250 |
| student-basic | 29 | 260 |
| student-basic | 30 | 270 |
| student-basic | 31 | 280 |
| student-basic | 32 | 290 |
| student-basic | 33 | 300 |
| student-basic | 34 | 300 |
| student-basic | 35 | 300 |
| student-basic | 36 | 300 |
| student-basic | 37 | 300 |
| student-basic | 38 | 300 |
| student-basic | 39 | 300 |
| student-basic | 40 | 300 |
| student-basic | 41 | 300 |
| student-basic | 42 | 300 |
| student-basic | 43 | 300 |
| student-basic | 44 | 300 |
| student-basic | 45 | 300 |
| student-plus | 1 | 0 |
| student-plus | 2 | 0 |
| student-plus | 3 | 0 |
| student-plus | 4 | 0 |
| student-plus | 5 | 15 |
| student-plus | 6 | 30 |
| student-plus | 7 | 45 |
| student-plus | 8 | 60 |
| student-plus | 9 | 75 |
| student-plus | 10 | 90 |
| student-plus | 11 | 105 |
| student-plus | 12 | 120 |
| student-plus | 13 | 135 |
| student-plus | 14 | 150 |
| student-plus | 15 | 165 |
| student-plus | 16 | 180 |
| student-plus | 17 | 195 |
| student-plus | 18 | 210 |
| student-plus | 19 | 225 |
| student-plus | 20 | 240 |
| student-plus | 21 | 255 |
| student-plus | 22 | 270 |
| student-plus | 23 | 285 |
| student-plus | 24 | 300 |
| student-plus | 25 | 315 |
| student-plus | 26 | 330 |
| student-plus | 27 | 345 |
| student-plus | 28 | 360 |
| student-plus | 29 | 375 |
| student-plus | 30 | 390 |
| student-plus | 31 | 400 |
| student-plus | 32 | 400 |
| student-plus | 33 | 400 |
| student-plus | 34 | 400 |
| student-plus | 35 | 400 |
| student-plus | 36 | 400 |
| student-plus | 37 | 400 |
| student-plus | 38 | 400 |
| student-plus | 39 | 400 |
| student-plus | 40 | 400 |
| student-plus | 41 | 400 |
| student-plus | 42 | 400 |
| student-plus | 43 | 400 |
| student-plus | 44 | 400 |
| student-plus | 45 | 400 |
| student-silver | 1 | 0 |
| student-silver | 2 | 0 |
| student-silver | 3 | 0 |
| student-silver | 4 | 0 |
| student-silver | 5 | 0 |
| student-silver | 6 | 20 |
| student-silver | 7 | 40 |
| student-silver | 8 | 60 |
| student-silver | 9 | 80 |
| student-silver | 10 | 100 |
| student-silver | 11 | 120 |
| student-silver | 12 | 140 |
| student-silver | 13 | 160 |
| student-silver | 14 | 180 |
| student-silver | 15 | 200 |
| student-silver | 16 | 220 |
| student-silver | 17 | 240 |
| student-silver | 18 | 260 |
| student-silver | 19 | 280 |
| student-silver | 20 | 300 |
| student-silver | 21 | 320 |
| student-silver | 22 | 340 |
| student-silver | 23 | 360 |
| student-silver | 24 | 380 |
| student-silver | 25 | 400 |
| student-silver | 26 | 420 |
| student-silver | 27 | 440 |
| student-silver | 28 | 460 |
| student-silver | 29 | 480 |
| student-silver | 30 | 500 |
| student-silver | 31 | 500 |
| student-silver | 32 | 500 |
| student-silver | 33 | 500 |
| student-silver | 34 | 500 |
| student-silver | 35 | 500 |
| student-silver | 36 | 500 |
| student-silver | 37 | 500 |
| student-silver | 38 | 500 |
| student-silver | 39 | 500 |
| student-silver | 40 | 500 |
| student-silver | 41 | 500 |
| student-silver | 42 | 500 |
| student-silver | 43 | 500 |
| student-silver | 44 | 500 |
| student-silver | 45 | 500 |
| student-gold | 1 | 0 |
| student-gold | 2 | 0 |
| student-gold | 3 | 0 |
| student-gold | 4 | 25 |
| student-gold | 5 | 50 |
| student-gold | 6 | 75 |
| student-gold | 7 | 100 |
| student-gold | 8 | 125 |
| student-gold | 9 | 150 |
| student-gold | 10 | 175 |
| student-gold | 11 | 200 |
| student-gold | 12 | 225 |
| student-gold | 13 | 250 |
| student-gold | 14 | 275 |
| student-gold | 15 | 300 |
| student-gold | 16 | 325 |
| student-gold | 17 | 350 |
| student-gold | 18 | 375 |
| student-gold | 19 | 400 |
| student-gold | 20 | 425 |
| student-gold | 21 | 450 |
| student-gold | 22 | 475 |
| student-gold | 23 | 500 |
| student-gold | 24 | 525 |
| student-gold | 25 | 550 |
| student-gold | 26 | 575 |
| student-gold | 27 | 600 |
| student-gold | 28 | 600 |
| student-gold | 29 | 600 |
| student-gold | 30 | 600 |
| student-gold | 31 | 600 |
| student-gold | 32 | 600 |
| student-gold | 33 | 600 |
| student-gold | 34 | 600 |
| student-gold | 35 | 600 |
| student-gold | 36 | 600 |
| student-gold | 37 | 600 |
| student-gold | 38 | 600 |
| student-gold | 39 | 600 |
| student-gold | 40 | 600 |
| student-gold | 41 | 600 |
| student-gold | 42 | 600 |
| student-gold | 43 | 600 |
| student-gold | 44 | 600 |
| student-gold | 45 | 600 |
| student-platinum | 1 | 0 |
| student-platinum | 2 | 0 |
| student-platinum | 3 | 0 |
| student-platinum | 4 | 0 |
| student-platinum | 5 | 30 |
| student-platinum | 6 | 60 |
| student-platinum | 7 | 90 |
| student-platinum | 8 | 120 |
| student-platinum | 9 | 150 |
| student-platinum | 10 | 180 |
| student-platinum | 11 | 210 |
| student-platinum | 12 | 240 |
| student-platinum | 13 | 270 |
| student-platinum | 14 | 300 |
| student-platinum | 15 | 330 |
| student-platinum | 16 | 360 |
| student-platinum | 17 | 390 |
| student-platinum | 18 | 420 |
| student-platinum | 19 | 450 |
| student-platinum | 20 | 480 |
| student-platinum | 21 | 510 |
| student-platinum | 22 | 540 |
| student-platinum | 23 | 570 |
| student-platinum | 24 | 600 |
| student-platinum | 25 | 630 |
| student-platinum | 26 | 660 |
| student-platinum | 27 | 690 |
| student-platinum | 28 | 700 |
| student-platinum | 29 | 700 |
| student-platinum | 30 | 700 |
| student-platinum | 31 | 700 |
| student-platinum | 32 | 700 |
| student-platinum | 33 | 700 |
| student-platinum | 34 | 700 |
| student-platinum | 35 | 700 |
| student-platinum | 36 | 700 |
| student-platinum | 37 | 700 |
| student-platinum | 38 | 700 |
| student-platinum | 39 | 700 |
| student-platinum | 40 | 700 |
| student-platinum | 41 | 700 |
| student-platinum | 42 | 700 |
| student-platinum | 43 | 700 |
| student-platinum | 44 | 700 |
| student-platinum | 45 | 700 |
| student-branch | 1 | 0 |
| student-branch | 2 | 0 |
| student-branch | 3 | 0 |
| student-branch | 4 | 0 |
| student-branch | 5 | 0 |
| student-branch | 6 | 35 |
| student-branch | 7 | 70 |
| student-branch | 8 | 105 |
| student-branch | 9 | 140 |
| student-branch | 10 | 175 |
| student-branch | 11 | 210 |
| student-branch | 12 | 245 |
| student-branch | 13 | 280 |
| student-branch | 14 | 315 |
| student-branch | 15 | 350 |
| student-branch | 16 | 385 |
| student-branch | 17 | 420 |
| student-branch | 18 | 455 |
| student-branch | 19 | 490 |
| student-branch | 20 | 525 |
| student-branch | 21 | 560 |
| student-branch | 22 | 595 |
| student-branch | 23 | 630 |
| student-branch | 24 | 665 |
| student-branch | 25 | 700 |
| student-branch | 26 | 735 |
| student-branch | 27 | 770 |
| student-branch | 28 | 800 |
| student-branch | 29 | 800 |
| student-branch | 30 | 800 |
| student-branch | 31 | 800 |
| student-branch | 32 | 800 |
| student-branch | 33 | 800 |
| student-branch | 34 | 800 |
| student-branch | 35 | 800 |
| student-branch | 36 | 800 |
| student-branch | 37 | 800 |
| student-branch | 38 | 800 |
| student-branch | 39 | 800 |
| student-branch | 40 | 800 |
| student-branch | 41 | 800 |
| student-branch | 42 | 800 |
| student-branch | 43 | 800 |
| student-branch | 44 | 800 |
| student-branch | 45 | 800 |
| student-remote | 1 | 0 |
| student-remote | 2 | 0 |
| student-remote | 3 | 0 |
| student-remote | 4 | 40 |
| student-remote | 5 | 80 |
| student-remote | 6 | 120 |
| student-remote | 7 | 160 |
| student-remote | 8 | 200 |
| student-remote | 9 | 240 |
| student-remote | 10 | 280 |
| student-remote | 11 | 320 |
| student-remote | 12 | 360 |
| student-remote | 13 | 400 |
| student-remote | 14 | 440 |
| student-remote | 15 | 480 |
| student-remote | 16 | 520 |
| student-remote | 17 | 560 |
| student-remote | 18 | 600 |
| student-remote | 19 | 640 |
| student-remote | 20 | 680 |
| student-remote | 21 | 720 |
| student-remote | 22 | 760 |
| student-remote | 23 | 800 |
| student-remote | 24 | 840 |
| student-remote | 25 | 880 |
| student-remote | 26 | 900 |
| student-remote | 27 | 900 |
| student-remote | 28 | 900 |
| student-remote | 29 | 900 |
| student-remote | 30 | 900 |
| student-remote | 31 | 900 |
| student-remote | 32 | 900 |
| student-remote | 33 | 900 |
| student-remote | 34 | 900 |
| student-remote | 35 | 900 |
| student-remote | 36 | 900 |
| student-remote | 37 | 900 |
| student-remote | 38 | 900 |
| student-remote | 39 | 900 |
| student-remote | 40 | 900 |
| student-remote | 41 | 900 |
| student-remote | 42 | 900 |
| student-remote | 43 | 900 |
| student-remote | 44 | 900 |
| student-remote | 45 | 900 |
| student-family | 1 | 0 |
| student-family | 2 | 0 |
| student-family | 3 | 0 |
| student-family | 4 | 0 |
| student-family | 5 | 45 |
| student-family | 6 | 90 |
| student-family | 7 | 135 |
| student-family | 8 | 180 |
| student-family | 9 | 225 |
| student-family | 10 | 270 |
| student-family | 11 | 315 |
| student-family | 12 | 360 |
| student-family | 13 | 405 |
| student-family | 14 | 450 |
| student-family | 15 | 495 |
| student-family | 16 | 540 |
| student-family | 17 | 585 |
| student-family | 18 | 630 |
| student-family | 19 | 675 |
| student-family | 20 | 720 |
| student-family | 21 | 765 |
| student-family | 22 | 810 |
| student-family | 23 | 855 |
| student-family | 24 | 900 |
| student-family | 25 | 945 |
| student-family | 26 | 990 |
| student-family | 27 | 1000 |
| student-family | 28 | 1000 |
| student-family | 29 | 1000 |
| student-family | 30 | 1000 |
| student-family | 31 | 1000 |
| student-family | 32 | 1000 |
| student-family | 33 | 1000 |
| student-family | 34 | 1000 |
| student-family | 35 | 1000 |
| student-family | 36 | 1000 |
| student-family | 37 | 1000 |
| student-family | 38 | 1000 |
| student-family | 39 | 1000 |
| student-family | 40 | 1000 |
| student-family | 41 | 1000 |
| student-family | 42 | 1000 |
| student-family | 43 | 1000 |
| student-family | 44 | 1000 |
| student-family | 45 | 1000 |
| student-trial | 1 | 0 |
| student-trial | 2 | 0 |
| student-trial | 3 | 0 |
| student-trial | 4 | 0 |
| student-trial | 5 | 0 |
| student-trial | 6 | 50 |
| student-trial | 7 | 100 |
| student-trial | 8 | 150 |
| student-trial | 9 | 200 |
| student-trial | 10 | 250 |
| student-trial | 11 | 300 |
| student-trial | 12 | 350 |
| student-trial | 13 | 400 |
| student-trial | 14 | 450 |
| student-trial | 15 | 500 |
| student-trial | 16 | 550 |
| student-trial | 17 | 600 |
| student-trial | 18 | 650 |
| student-trial | 19 | 700 |
| student-trial | 20 | 750 |
| student-trial | 21 | 800 |
| student-trial | 22 | 850 |
| student-trial | 23 | 900 |
| student-trial | 24 | 950 |
| student-trial | 25 | 1000 |
| student-trial | 26 | 1050 |
| student-trial | 27 | 1100 |
| student-trial | 28 | 1100 |
| student-trial | 29 | 1100 |
| student-trial | 30 | 1100 |
| student-trial | 31 | 1100 |
| student-trial | 32 | 1100 |
| student-trial | 33 | 1100 |
| student-trial | 34 | 1100 |
| student-trial | 35 | 1100 |
| student-trial | 36 | 1100 |
| student-trial | 37 | 1100 |
| student-trial | 38 | 1100 |
| student-trial | 39 | 1100 |
| student-trial | 40 | 1100 |
| student-trial | 41 | 1100 |
| student-trial | 42 | 1100 |
| student-trial | 43 | 1100 |
| student-trial | 44 | 1100 |
| student-trial | 45 | 1100 |
| student-honorary | 1 | 0 |
| student-honorary | 2 | 0 |
| student-honorary | 3 | 0 |
| student-honorary | 4 | 55 |
| student-honorary | 5 | 110 |
| student-honorary | 6 | 165 |
| student-honorary | 7 | 220 |
| student-honorary | 8 | 275 |
| student-honorary | 9 | 330 |
| student-honorary | 10 | 385 |
| student-honorary | 11 | 440 |
| student-honorary | 12 | 495 |
| student-honorary | 13 | 550 |
| student-honorary | 14 | 605 |
| student-honorary | 15 | 660 |
| student-honorary | 16 | 715 |
| student-honorary | 17 | 770 |
| student-honorary | 18 | 825 |
| student-honorary | 19 | 880 |
| student-honorary | 20 | 935 |
| student-honorary | 21 | 990 |
| student-honorary | 22 | 1045 |
| student-honorary | 23 | 1100 |
| student-honorary | 24 | 1155 |
| student-honorary | 25 | 1200 |
| student-honorary | 26 | 1200 |
| student-honorary | 27 | 1200 |
| student-honorary | 28 | 1200 |
| student-honorary | 29 | 1200 |
| student-honorary | 30 | 1200 |
| student-honorary | 31 | 1200 |
| student-honorary | 32 | 1200 |
| student-honorary | 33 | 1200 |
| student-honorary | 34 | 1200 |
| student-honorary | 35 | 1200 |
| student-honorary | 36 | 1200 |
| student-honorary | 37 | 1200 |
| student-honorary | 38 | 1200 |
| student-honorary | 39 | 1200 |
| student-honorary | 40 | 1200 |
| student-honorary | 41 | 1200 |
| student-honorary | 42 | 1200 |
| student-honorary | 43 | 1200 |
| student-honorary | 44 | 1200 |
| student-honorary | 45 | 1200 |
| staff-basic | 1 | 0 |
| staff-basic | 2 | 0 |
| staff-basic | 3 | 0 |
| staff-basic | 4 | 0 |
| staff-basic | 5 | 0 |
| staff-basic | 6 | 0 |
| staff-basic | 7 | 0 |
| staff-basic | 8 | 0 |
| staff-basic | 9 | 0 |
| staff-basic | 10 | 0 |
| staff-basic | 11 | 0 |
| staff-basic | 12 | 0 |
| staff-basic | 13 | 0 |
| staff-basic | 14 | 0 |
| staff-basic | 15 | 0 |
| staff-basic | 16 | 0 |
| staff-basic | 17 | 0 |
| staff-basic | 18 | 0 |
| staff-basic | 19 | 0 |
| staff-basic | 20 | 0 |
| staff-basic | 21 | 0 |
| staff-basic | 22 | 0 |
| staff-basic | 23 | 0 |
| staff-basic | 24 | 0 |
| staff-basic | 25 | 0 |
| staff-basic | 26 | 0 |
| staff-basic | 27 | 0 |
| staff-basic | 28 | 0 |
| staff-basic | 29 | 0 |
| staff-basic | 30 | 0 |
| staff-basic | 31 | 0 |
| staff-basic | 32 | 0 |
| staff-basic | 33 | 0 |
| staff-basic | 34 | 0 |
| staff-basic | 35 | 0 |
| staff-basic | 36 | 0 |
| staff-basic | 37 | 0 |
| staff-basic | 38 | 0 |
| staff-basic | 39 | 0 |
| staff-basic | 40 | 0 |
| staff-basic | 41 | 0 |
| staff-basic | 42 | 0 |
| staff-basic | 43 | 0 |
| staff-basic | 44 | 0 |
| staff-basic | 45 | 0 |
| staff-plus | 1 | 0 |
| staff-plus | 2 | 0 |
| staff-plus | 3 | 0 |
| staff-plus | 4 | 0 |
| staff-plus | 5 | 0 |
| staff-plus | 6 | 0 |
| staff-plus | 7 | 0 |
| staff-plus | 8 | 0 |
| staff-plus | 9 | 0 |
| staff-plus | 10 | 0 |
| staff-plus | 11 | 0 |
| staff-plus | 12 | 0 |
| staff-plus | 13 | 0 |
| staff-plus | 14 | 0 |
| staff-plus | 15 | 0 |
| staff-plus | 16 | 0 |
| staff-plus | 17 | 0 |
| staff-plus | 18 | 0 |
| staff-plus | 19 | 0 |
| staff-plus | 20 | 0 |
| staff-plus | 21 | 0 |
| staff-plus | 22 | 0 |
| staff-plus | 23 | 0 |
| staff-plus | 24 | 0 |
| staff-plus | 25 | 0 |
| staff-plus | 26 | 0 |
| staff-plus | 27 | 0 |
| staff-plus | 28 | 0 |
| staff-plus | 29 | 0 |
| staff-plus | 30 | 0 |
| staff-plus | 31 | 0 |
| staff-plus | 32 | 0 |
| staff-plus | 33 | 0 |
| staff-plus | 34 | 0 |
| staff-plus | 35 | 0 |
| staff-plus | 36 | 0 |
| staff-plus | 37 | 0 |
| staff-plus | 38 | 0 |
| staff-plus | 39 | 0 |
| staff-plus | 40 | 0 |
| staff-plus | 41 | 0 |
| staff-plus | 42 | 0 |
| staff-plus | 43 | 0 |
| staff-plus | 44 | 0 |
| staff-plus | 45 | 0 |
| staff-silver | 1 | 0 |
| staff-silver | 2 | 0 |
| staff-silver | 3 | 0 |
| staff-silver | 4 | 0 |
| staff-silver | 5 | 0 |
| staff-silver | 6 | 0 |
| staff-silver | 7 | 0 |
| staff-silver | 8 | 0 |
| staff-silver | 9 | 0 |
| staff-silver | 10 | 0 |
| staff-silver | 11 | 0 |
| staff-silver | 12 | 0 |
| staff-silver | 13 | 0 |
| staff-silver | 14 | 0 |
| staff-silver | 15 | 0 |
| staff-silver | 16 | 0 |
| staff-silver | 17 | 0 |
| staff-silver | 18 | 0 |
| staff-silver | 19 | 0 |
| staff-silver | 20 | 0 |
| staff-silver | 21 | 0 |
| staff-silver | 22 | 0 |
| staff-silver | 23 | 0 |
| staff-silver | 24 | 0 |
| staff-silver | 25 | 0 |
| staff-silver | 26 | 0 |
| staff-silver | 27 | 0 |
| staff-silver | 28 | 0 |
| staff-silver | 29 | 0 |
| staff-silver | 30 | 0 |
| staff-silver | 31 | 0 |
| staff-silver | 32 | 0 |
| staff-silver | 33 | 0 |
| staff-silver | 34 | 0 |
| staff-silver | 35 | 0 |
| staff-silver | 36 | 0 |
| staff-silver | 37 | 0 |
| staff-silver | 38 | 0 |
| staff-silver | 39 | 0 |
| staff-silver | 40 | 0 |
| staff-silver | 41 | 0 |
| staff-silver | 42 | 0 |
| staff-silver | 43 | 0 |
| staff-silver | 44 | 0 |
| staff-silver | 45 | 0 |
| staff-gold | 1 | 0 |
| staff-gold | 2 | 0 |
| staff-gold | 3 | 0 |
| staff-gold | 4 | 0 |
| staff-gold | 5 | 0 |
| staff-gold | 6 | 0 |
| staff-gold | 7 | 0 |
| staff-gold | 8 | 0 |
| staff-gold | 9 | 0 |
| staff-gold | 10 | 0 |
| staff-gold | 11 | 0 |
| staff-gold | 12 | 0 |
| staff-gold | 13 | 0 |
| staff-gold | 14 | 0 |
| staff-gold | 15 | 0 |
| staff-gold | 16 | 0 |
| staff-gold | 17 | 0 |
| staff-gold | 18 | 0 |
| staff-gold | 19 | 0 |
| staff-gold | 20 | 0 |
| staff-gold | 21 | 0 |
| staff-gold | 22 | 0 |
| staff-gold | 23 | 0 |
| staff-gold | 24 | 0 |
| staff-gold | 25 | 0 |
| staff-gold | 26 | 0 |
| staff-gold | 27 | 0 |
| staff-gold | 28 | 0 |
| staff-gold | 29 | 0 |
| staff-gold | 30 | 0 |
| staff-gold | 31 | 0 |
| staff-gold | 32 | 0 |
| staff-gold | 33 | 0 |
| staff-gold | 34 | 0 |
| staff-gold | 35 | 0 |
| staff-gold | 36 | 0 |
| staff-gold | 37 | 0 |
| staff-gold | 38 | 0 |
| staff-gold | 39 | 0 |
| staff-gold | 40 | 0 |
| staff-gold | 41 | 0 |
| staff-gold | 42 | 0 |
| staff-gold | 43 | 0 |
| staff-gold | 44 | 0 |
| staff-gold | 45 | 0 |
| staff-platinum | 1 | 0 |
| staff-platinum | 2 | 0 |
| staff-platinum | 3 | 0 |
| staff-platinum | 4 | 0 |
| staff-platinum | 5 | 0 |
| staff-platinum | 6 | 0 |
| staff-platinum | 7 | 0 |
| staff-platinum | 8 | 0 |
| staff-platinum | 9 | 0 |
| staff-platinum | 10 | 0 |
| staff-platinum | 11 | 0 |
| staff-platinum | 12 | 0 |
| staff-platinum | 13 | 0 |
| staff-platinum | 14 | 0 |
| staff-platinum | 15 | 0 |
| staff-platinum | 16 | 0 |
| staff-platinum | 17 | 0 |
| staff-platinum | 18 | 0 |
| staff-platinum | 19 | 0 |
| staff-platinum | 20 | 0 |
| staff-platinum | 21 | 0 |
| staff-platinum | 22 | 0 |
| staff-platinum | 23 | 0 |
| staff-platinum | 24 | 0 |
| staff-platinum | 25 | 0 |
| staff-platinum | 26 | 0 |
| staff-platinum | 27 | 0 |
| staff-platinum | 28 | 0 |
| staff-platinum | 29 | 0 |
| staff-platinum | 30 | 0 |
| staff-platinum | 31 | 0 |
| staff-platinum | 32 | 0 |
| staff-platinum | 33 | 0 |
| staff-platinum | 34 | 0 |
| staff-platinum | 35 | 0 |
| staff-platinum | 36 | 0 |
| staff-platinum | 37 | 0 |
| staff-platinum | 38 | 0 |
| staff-platinum | 39 | 0 |
| staff-platinum | 40 | 0 |
| staff-platinum | 41 | 0 |
| staff-platinum | 42 | 0 |
| staff-platinum | 43 | 0 |
| staff-platinum | 44 | 0 |
| staff-platinum | 45 | 0 |
| staff-branch | 1 | 0 |
| staff-branch | 2 | 0 |
| staff-branch | 3 | 0 |
| staff-branch | 4 | 0 |
| staff-branch | 5 | 0 |
| staff-branch | 6 | 0 |
| staff-branch | 7 | 0 |
| staff-branch | 8 | 0 |
| staff-branch | 9 | 0 |
| staff-branch | 10 | 0 |
| staff-branch | 11 | 0 |
| staff-branch | 12 | 0 |
| staff-branch | 13 | 0 |
| staff-branch | 14 | 0 |
| staff-branch | 15 | 0 |
| staff-branch | 16 | 0 |
| staff-branch | 17 | 0 |
| staff-branch | 18 | 0 |
| staff-branch | 19 | 0 |
| staff-branch | 20 | 0 |
| staff-branch | 21 | 0 |
| staff-branch | 22 | 0 |
| staff-branch | 23 | 0 |
| staff-branch | 24 | 0 |
| staff-branch | 25 | 0 |
| staff-branch | 26 | 0 |
| staff-branch | 27 | 0 |
| staff-branch | 28 | 0 |
| staff-branch | 29 | 0 |
| staff-branch | 30 | 0 |
| staff-branch | 31 | 0 |
| staff-branch | 32 | 0 |
| staff-branch | 33 | 0 |
| staff-branch | 34 | 0 |
| staff-branch | 35 | 0 |
| staff-branch | 36 | 0 |
| staff-branch | 37 | 0 |
| staff-branch | 38 | 0 |
| staff-branch | 39 | 0 |
| staff-branch | 40 | 0 |
| staff-branch | 41 | 0 |
| staff-branch | 42 | 0 |
| staff-branch | 43 | 0 |
| staff-branch | 44 | 0 |
| staff-branch | 45 | 0 |
| staff-remote | 1 | 0 |
| staff-remote | 2 | 0 |
| staff-remote | 3 | 0 |
| staff-remote | 4 | 0 |
| staff-remote | 5 | 0 |
| staff-remote | 6 | 0 |
| staff-remote | 7 | 0 |
| staff-remote | 8 | 0 |
| staff-remote | 9 | 0 |
| staff-remote | 10 | 0 |
| staff-remote | 11 | 0 |
| staff-remote | 12 | 0 |
| staff-remote | 13 | 0 |
| staff-remote | 14 | 0 |
| staff-remote | 15 | 0 |
| staff-remote | 16 | 0 |
| staff-remote | 17 | 0 |
| staff-remote | 18 | 0 |
| staff-remote | 19 | 0 |
| staff-remote | 20 | 0 |
| staff-remote | 21 | 0 |
| staff-remote | 22 | 0 |
| staff-remote | 23 | 0 |
| staff-remote | 24 | 0 |
| staff-remote | 25 | 0 |
| staff-remote | 26 | 0 |
| staff-remote | 27 | 0 |
| staff-remote | 28 | 0 |
| staff-remote | 29 | 0 |
| staff-remote | 30 | 0 |
| staff-remote | 31 | 0 |
| staff-remote | 32 | 0 |
| staff-remote | 33 | 0 |
| staff-remote | 34 | 0 |
| staff-remote | 35 | 0 |
| staff-remote | 36 | 0 |
| staff-remote | 37 | 0 |
| staff-remote | 38 | 0 |
| staff-remote | 39 | 0 |
| staff-remote | 40 | 0 |
| staff-remote | 41 | 0 |
| staff-remote | 42 | 0 |
| staff-remote | 43 | 0 |
| staff-remote | 44 | 0 |
| staff-remote | 45 | 0 |
| staff-family | 1 | 0 |
| staff-family | 2 | 0 |
| staff-family | 3 | 0 |
| staff-family | 4 | 0 |
| staff-family | 5 | 0 |
| staff-family | 6 | 0 |
| staff-family | 7 | 0 |
| staff-family | 8 | 0 |
| staff-family | 9 | 0 |
| staff-family | 10 | 0 |
| staff-family | 11 | 0 |
| staff-family | 12 | 0 |
| staff-family | 13 | 0 |
| staff-family | 14 | 0 |
| staff-family | 15 | 0 |
| staff-family | 16 | 0 |
| staff-family | 17 | 0 |
| staff-family | 18 | 0 |
| staff-family | 19 | 0 |
| staff-family | 20 | 0 |
| staff-family | 21 | 0 |
| staff-family | 22 | 0 |
| staff-family | 23 | 0 |
| staff-family | 24 | 0 |
| staff-family | 25 | 0 |
| staff-family | 26 | 0 |
| staff-family | 27 | 0 |
| staff-family | 28 | 0 |
| staff-family | 29 | 0 |
| staff-family | 30 | 0 |
| staff-family | 31 | 0 |
| staff-family | 32 | 0 |
| staff-family | 33 | 0 |
| staff-family | 34 | 0 |
| staff-family | 35 | 0 |
| staff-family | 36 | 0 |
| staff-family | 37 | 0 |
| staff-family | 38 | 0 |
| staff-family | 39 | 0 |
| staff-family | 40 | 0 |
| staff-family | 41 | 0 |
| staff-family | 42 | 0 |
| staff-family | 43 | 0 |
| staff-family | 44 | 0 |
| staff-family | 45 | 0 |
| staff-trial | 1 | 0 |
| staff-trial | 2 | 0 |
| staff-trial | 3 | 0 |
| staff-trial | 4 | 0 |
| staff-trial | 5 | 0 |
| staff-trial | 6 | 0 |
| staff-trial | 7 | 0 |
| staff-trial | 8 | 0 |
| staff-trial | 9 | 0 |
| staff-trial | 10 | 0 |
| staff-trial | 11 | 0 |
| staff-trial | 12 | 0 |
| staff-trial | 13 | 0 |
| staff-trial | 14 | 0 |
| staff-trial | 15 | 0 |
| staff-trial | 16 | 0 |
| staff-trial | 17 | 0 |
| staff-trial | 18 | 0 |
| staff-trial | 19 | 0 |
| staff-trial | 20 | 0 |
| staff-trial | 21 | 0 |
| staff-trial | 22 | 0 |
| staff-trial | 23 | 0 |
| staff-trial | 24 | 0 |
| staff-trial | 25 | 0 |
| staff-trial | 26 | 0 |
| staff-trial | 27 | 0 |
| staff-trial | 28 | 0 |
| staff-trial | 29 | 0 |
| staff-trial | 30 | 0 |
| staff-trial | 31 | 0 |
| staff-trial | 32 | 0 |
| staff-trial | 33 | 0 |
| staff-trial | 34 | 0 |
| staff-trial | 35 | 0 |
| staff-trial | 36 | 0 |
| staff-trial | 37 | 0 |
| staff-trial | 38 | 0 |
| staff-trial | 39 | 0 |
| staff-trial | 40 | 0 |
| staff-trial | 41 | 0 |
| staff-trial | 42 | 0 |
| staff-trial | 43 | 0 |
| staff-trial | 44 | 0 |
| staff-trial | 45 | 0 |
| staff-honorary | 1 | 0 |
| staff-honorary | 2 | 0 |
| staff-honorary | 3 | 0 |
| staff-honorary | 4 | 0 |
| staff-honorary | 5 | 0 |
| staff-honorary | 6 | 0 |
| staff-honorary | 7 | 0 |
| staff-honorary | 8 | 0 |
| staff-honorary | 9 | 0 |
| staff-honorary | 10 | 0 |
| staff-honorary | 11 | 0 |
| staff-honorary | 12 | 0 |
| staff-honorary | 13 | 0 |
| staff-honorary | 14 | 0 |
| staff-honorary | 15 | 0 |
| staff-honorary | 16 | 0 |
| staff-honorary | 17 | 0 |
| staff-honorary | 18 | 0 |
| staff-honorary | 19 | 0 |
| staff-honorary | 20 | 0 |
| staff-honorary | 21 | 0 |
| staff-honorary | 22 | 0 |
| staff-honorary | 23 | 0 |
| staff-honorary | 24 | 0 |
| staff-honorary | 25 | 0 |
| staff-honorary | 26 | 0 |
| staff-honorary | 27 | 0 |
| staff-honorary | 28 | 0 |
| staff-honorary | 29 | 0 |
| staff-honorary | 30 | 0 |
| staff-honorary | 31 | 0 |
| staff-honorary | 32 | 0 |
| staff-honorary | 33 | 0 |
| staff-honorary | 34 | 0 |
| staff-honorary | 35 | 0 |
| staff-honorary | 36 | 0 |
| staff-honorary | 37 | 0 |
| staff-honorary | 38 | 0 |
| staff-honorary | 39 | 0 |
| staff-honorary | 40 | 0 |
| staff-honorary | 41 | 0 |
| staff-honorary | 42 | 0 |
| staff-honorary | 43 | 0 |
| staff-honorary | 44 | 0 |
| staff-honorary | 45 | 0 |
| senior-basic | 1 | 0 |
| senior-basic | 2 | 0 |
| senior-basic | 3 | 0 |
| senior-basic | 4 | 0 |
| senior-basic | 5 | 5 |
| senior-basic | 6 | 10 |
| senior-basic | 7 | 15 |
| senior-basic | 8 | 20 |
| senior-basic | 9 | 25 |
| senior-basic | 10 | 30 |
| senior-basic | 11 | 35 |
| senior-basic | 12 | 40 |
| senior-basic | 13 | 45 |
| senior-basic | 14 | 50 |
| senior-basic | 15 | 55 |
| senior-basic | 16 | 60 |
| senior-basic | 17 | 65 |
| senior-basic | 18 | 70 |
| senior-basic | 19 | 75 |
| senior-basic | 20 | 80 |
| senior-basic | 21 | 85 |
| senior-basic | 22 | 90 |
| senior-basic | 23 | 95 |
| senior-basic | 24 | 100 |
| senior-basic | 25 | 105 |
| senior-basic | 26 | 110 |
| senior-basic | 27 | 115 |
| senior-basic | 28 | 120 |
| senior-basic | 29 | 125 |
| senior-basic | 30 | 130 |
| senior-basic | 31 | 135 |
| senior-basic | 32 | 140 |
| senior-basic | 33 | 145 |
| senior-basic | 34 | 150 |
| senior-basic | 35 | 155 |
| senior-basic | 36 | 160 |
| senior-basic | 37 | 165 |
| senior-basic | 38 | 170 |
| senior-basic | 39 | 175 |
| senior-basic | 40 | 180 |
| senior-basic | 41 | 185 |
| senior-basic | 42 | 190 |
| senior-basic | 43 | 195 |
| senior-basic | 44 | 200 |
| senior-basic | 45 | 200 |
| senior-plus | 1 | 0 |
| senior-plus | 2 | 0 |
| senior-plus | 3 | 0 |
| senior-plus | 4 | 0 |
| senior-plus | 5 | 0 |
| senior-plus | 6 | 10 |
| senior-plus | 7 | 20 |
| senior-plus | 8 | 30 |
| senior-plus | 9 | 40 |
| senior-plus | 10 | 50 |
| senior-plus | 11 | 60 |
| senior-plus | 12 | 70 |
| senior-plus | 13 | 80 |
| senior-plus | 14 | 90 |
| senior-plus | 15 | 100 |
| senior-plus | 16 | 110 |
| senior-plus | 17 | 120 |
| senior-plus | 18 | 130 |
| senior-plus | 19 | 140 |
| senior-plus | 20 | 150 |
| senior-plus | 21 | 160 |
| senior-plus | 22 | 170 |
| senior-plus | 23 | 180 |
| senior-plus | 24 | 190 |
| senior-plus | 25 | 200 |
| senior-plus | 26 | 210 |
| senior-plus | 27 | 220 |
| senior-plus | 28 | 230 |
| senior-plus | 29 | 240 |
| senior-plus | 30 | 250 |
| senior-plus | 31 | 260 |
| senior-plus | 32 | 270 |
| senior-plus | 33 | 280 |
| senior-plus | 34 | 290 |
| senior-plus | 35 | 300 |
| senior-plus | 36 | 300 |
| senior-plus | 37 | 300 |
| senior-plus | 38 | 300 |
| senior-plus | 39 | 300 |
| senior-plus | 40 | 300 |
| senior-plus | 41 | 300 |
| senior-plus | 42 | 300 |
| senior-plus | 43 | 300 |
| senior-plus | 44 | 300 |
| senior-plus | 45 | 300 |
| senior-silver | 1 | 0 |
| senior-silver | 2 | 0 |
| senior-silver | 3 | 0 |
| senior-silver | 4 | 0 |
| senior-silver | 5 | 0 |
| senior-silver | 6 | 0 |
| senior-silver | 7 | 15 |
| senior-silver | 8 | 30 |
| senior-silver | 9 | 45 |
| senior-silver | 10 | 60 |
| senior-silver | 11 | 75 |
| senior-silver | 12 | 90 |
| senior-silver | 13 | 105 |
| senior-silver | 14 | 120 |
| senior-silver | 15 | 135 |
| senior-silver | 16 | 150 |
| senior-silver | 17 | 165 |
| senior-silver | 18 | 180 |
| senior-silver | 19 | 195 |
| senior-silver | 20 | 210 |
| senior-silver | 21 | 225 |
| senior-silver | 22 | 240 |
| senior-silver | 23 | 255 |
| senior-silver | 24 | 270 |
| senior-silver | 25 | 285 |
| senior-silver | 26 | 300 |
| senior-silver | 27 | 315 |
| senior-silver | 28 | 330 |
| senior-silver | 29 | 345 |
| senior-silver | 30 | 360 |
| senior-silver | 31 | 375 |
| senior-silver | 32 | 390 |
| senior-silver | 33 | 400 |
| senior-silver | 34 | 400 |
| senior-silver | 35 | 400 |
| senior-silver | 36 | 400 |
| senior-silver | 37 | 400 |
| senior-silver | 38 | 400 |
| senior-silver | 39 | 400 |
| senior-silver | 40 | 400 |
| senior-silver | 41 | 400 |
| senior-silver | 42 | 400 |
| senior-silver | 43 | 400 |
| senior-silver | 44 | 400 |
| senior-silver | 45 | 400 |
| senior-gold | 1 | 0 |
| senior-gold | 2 | 0 |
| senior-gold | 3 | 0 |
| senior-gold | 4 | 0 |
| senior-gold | 5 | 20 |
| senior-gold | 6 | 40 |
| senior-gold | 7 | 60 |
| senior-gold | 8 | 80 |
| senior-gold | 9 | 100 |
| senior-gold | 10 | 120 |
| senior-gold | 11 | 140 |
| senior-gold | 12 | 160 |
| senior-gold | 13 | 180 |
| senior-gold | 14 | 200 |
| senior-gold | 15 | 220 |
| senior-gold | 16 | 240 |
| senior-gold | 17 | 260 |
| senior-gold | 18 | 280 |
| senior-gold | 19 | 300 |
| senior-gold | 20 | 320 |
| senior-gold | 21 | 340 |
| senior-gold | 22 | 360 |
| senior-gold | 23 | 380 |
| senior-gold | 24 | 400 |
| senior-gold | 25 | 420 |
| senior-gold | 26 | 440 |
| senior-gold | 27 | 460 |
| senior-gold | 28 | 480 |
| senior-gold | 29 | 500 |
| senior-gold | 30 | 500 |
| senior-gold | 31 | 500 |
| senior-gold | 32 | 500 |
| senior-gold | 33 | 500 |
| senior-gold | 34 | 500 |
| senior-gold | 35 | 500 |
| senior-gold | 36 | 500 |
| senior-gold | 37 | 500 |
| senior-gold | 38 | 500 |
| senior-gold | 39 | 500 |
| senior-gold | 40 | 500 |
| senior-gold | 41 | 500 |
| senior-gold | 42 | 500 |
| senior-gold | 43 | 500 |
| senior-gold | 44 | 500 |
| senior-gold | 45 | 500 |
| senior-platinum | 1 | 0 |
| senior-platinum | 2 | 0 |
| senior-platinum | 3 | 0 |
| senior-platinum | 4 | 0 |
| senior-platinum | 5 | 0 |
| senior-platinum | 6 | 25 |
| senior-platinum | 7 | 50 |
| senior-platinum | 8 | 75 |
| senior-platinum | 9 | 100 |
| senior-platinum | 10 | 125 |
| senior-platinum | 11 | 150 |
| senior-platinum | 12 | 175 |
| senior-platinum | 13 | 200 |
| senior-platinum | 14 | 225 |
| senior-platinum | 15 | 250 |
| senior-platinum | 16 | 275 |
| senior-platinum | 17 | 300 |
| senior-platinum | 18 | 325 |
| senior-platinum | 19 | 350 |
| senior-platinum | 20 | 375 |
| senior-platinum | 21 | 400 |
| senior-platinum | 22 | 425 |
| senior-platinum | 23 | 450 |
| senior-platinum | 24 | 475 |
| senior-platinum | 25 | 500 |
| senior-platinum | 26 | 525 |
| senior-platinum | 27 | 550 |
| senior-platinum | 28 | 575 |
| senior-platinum | 29 | 600 |
| senior-platinum | 30 | 600 |
| senior-platinum | 31 | 600 |
| senior-platinum | 32 | 600 |
| senior-platinum | 33 | 600 |
| senior-platinum | 34 | 600 |
| senior-platinum | 35 | 600 |
| senior-platinum | 36 | 600 |
| senior-platinum | 37 | 600 |
| senior-platinum | 38 | 600 |
| senior-platinum | 39 | 600 |
| senior-platinum | 40 | 600 |
| senior-platinum | 41 | 600 |
| senior-platinum | 42 | 600 |
| senior-platinum | 43 | 600 |
| senior-platinum | 44 | 600 |
| senior-platinum | 45 | 600 |
| senior-branch | 1 | 0 |
| senior-branch | 2 | 0 |
| senior-branch | 3 | 0 |
| senior-branch | 4 | 0 |
| senior-branch | 5 | 0 |
| senior-branch | 6 | 0 |
| senior-branch | 7 | 30 |
| senior-branch | 8 | 60 |
| senior-branch | 9 | 90 |
| senior-branch | 10 | 120 |
| senior-branch | 11 | 150 |
| senior-branch | 12 | 180 |
| senior-branch | 13 | 210 |
| senior-branch | 14 | 240 |
| senior-branch | 15 | 270 |
| senior-branch | 16 | 300 |
| senior-branch | 17 | 330 |
| senior-branch | 18 | 360 |
| senior-branch | 19 | 390 |
| senior-branch | 20 | 420 |
| senior-branch | 21 | 450 |
| senior-branch | 22 | 480 |
| senior-branch | 23 | 510 |
| senior-branch | 24 | 540 |
| senior-branch | 25 | 570 |
| senior-branch | 26 | 600 |
| senior-branch | 27 | 630 |
| senior-branch | 28 | 660 |
| senior-branch | 29 | 690 |
| senior-branch | 30 | 700 |
| senior-branch | 31 | 700 |
| senior-branch | 32 | 700 |
| senior-branch | 33 | 700 |
| senior-branch | 34 | 700 |
| senior-branch | 35 | 700 |
| senior-branch | 36 | 700 |
| senior-branch | 37 | 700 |
| senior-branch | 38 | 700 |
| senior-branch | 39 | 700 |
| senior-branch | 40 | 700 |
| senior-branch | 41 | 700 |
| senior-branch | 42 | 700 |
| senior-branch | 43 | 700 |
| senior-branch | 44 | 700 |
| senior-branch | 45 | 700 |
| senior-remote | 1 | 0 |
| senior-remote | 2 | 0 |
| senior-remote | 3 | 0 |
| senior-remote | 4 | 0 |
| senior-remote | 5 | 35 |
| senior-remote | 6 | 70 |
| senior-remote | 7 | 105 |
| senior-remote | 8 | 140 |
| senior-remote | 9 | 175 |
| senior-remote | 10 | 210 |
| senior-remote | 11 | 245 |
| senior-remote | 12 | 280 |
| senior-remote | 13 | 315 |
| senior-remote | 14 | 350 |
| senior-remote | 15 | 385 |
| senior-remote | 16 | 420 |
| senior-remote | 17 | 455 |
| senior-remote | 18 | 490 |
| senior-remote | 19 | 525 |
| senior-remote | 20 | 560 |
| senior-remote | 21 | 595 |
| senior-remote | 22 | 630 |
| senior-remote | 23 | 665 |
| senior-remote | 24 | 700 |
| senior-remote | 25 | 735 |
| senior-remote | 26 | 770 |
| senior-remote | 27 | 800 |
| senior-remote | 28 | 800 |
| senior-remote | 29 | 800 |
| senior-remote | 30 | 800 |
| senior-remote | 31 | 800 |
| senior-remote | 32 | 800 |
| senior-remote | 33 | 800 |
| senior-remote | 34 | 800 |
| senior-remote | 35 | 800 |
| senior-remote | 36 | 800 |
| senior-remote | 37 | 800 |
| senior-remote | 38 | 800 |
| senior-remote | 39 | 800 |
| senior-remote | 40 | 800 |
| senior-remote | 41 | 800 |
| senior-remote | 42 | 800 |
| senior-remote | 43 | 800 |
| senior-remote | 44 | 800 |
| senior-remote | 45 | 800 |
| senior-family | 1 | 0 |
| senior-family | 2 | 0 |
| senior-family | 3 | 0 |
| senior-family | 4 | 0 |
| senior-family | 5 | 0 |
| senior-family | 6 | 40 |
| senior-family | 7 | 80 |
| senior-family | 8 | 120 |
| senior-family | 9 | 160 |
| senior-family | 10 | 200 |
| senior-family | 11 | 240 |
| senior-family | 12 | 280 |
| senior-family | 13 | 320 |
| senior-family | 14 | 360 |
| senior-family | 15 | 400 |
| senior-family | 16 | 440 |
| senior-family | 17 | 480 |
| senior-family | 18 | 520 |
| senior-family | 19 | 560 |
| senior-family | 20 | 600 |
| senior-family | 21 | 640 |
| senior-family | 22 | 680 |
| senior-family | 23 | 720 |
| senior-family | 24 | 760 |
| senior-family | 25 | 800 |
| senior-family | 26 | 840 |
| senior-family | 27 | 880 |
| senior-family | 28 | 900 |
| senior-family | 29 | 900 |
| senior-family | 30 | 900 |
| senior-family | 31 | 900 |
| senior-family | 32 | 900 |
| senior-family | 33 | 900 |
| senior-family | 34 | 900 |
| senior-family | 35 | 900 |
| senior-family | 36 | 900 |
| senior-family | 37 | 900 |
| senior-family | 38 | 900 |
| senior-family | 39 | 900 |
| senior-family | 40 | 900 |
| senior-family | 41 | 900 |
| senior-family | 42 | 900 |
| senior-family | 43 | 900 |
| senior-family | 44 | 900 |
| senior-family | 45 | 900 |
| senior-trial | 1 | 0 |
| senior-trial | 2 | 0 |
| senior-trial | 3 | 0 |
| senior-trial | 4 | 0 |
| senior-trial | 5 | 0 |
| senior-trial | 6 | 0 |
| senior-trial | 7 | 45 |
| senior-trial | 8 | 90 |
| senior-trial | 9 | 135 |
| senior-trial | 10 | 180 |
| senior-trial | 11 | 225 |
| senior-trial | 12 | 270 |
| senior-trial | 13 | 315 |
| senior-trial | 14 | 360 |
| senior-trial | 15 | 405 |
| senior-trial | 16 | 450 |
| senior-trial | 17 | 495 |
| senior-trial | 18 | 540 |
| senior-trial | 19 | 585 |
| senior-trial | 20 | 630 |
| senior-trial | 21 | 675 |
| senior-trial | 22 | 720 |
| senior-trial | 23 | 765 |
| senior-trial | 24 | 810 |
| senior-trial | 25 | 855 |
| senior-trial | 26 | 900 |
| senior-trial | 27 | 945 |
| senior-trial | 28 | 990 |
| senior-trial | 29 | 1000 |
| senior-trial | 30 | 1000 |
| senior-trial | 31 | 1000 |
| senior-trial | 32 | 1000 |
| senior-trial | 33 | 1000 |
| senior-trial | 34 | 1000 |
| senior-trial | 35 | 1000 |
| senior-trial | 36 | 1000 |
| senior-trial | 37 | 1000 |
| senior-trial | 38 | 1000 |
| senior-trial | 39 | 1000 |
| senior-trial | 40 | 1000 |
| senior-trial | 41 | 1000 |
| senior-trial | 42 | 1000 |
| senior-trial | 43 | 1000 |
| senior-trial | 44 | 1000 |
| senior-trial | 45 | 1000 |
| senior-honorary | 1 | 0 |
| senior-honorary | 2 | 0 |
| senior-honorary | 3 | 0 |
| senior-honorary | 4 | 0 |
| senior-honorary | 5 | 50 |
| senior-honorary | 6 | 100 |
| senior-honorary | 7 | 150 |
| senior-honorary | 8 | 200 |
| senior-honorary | 9 | 250 |
| senior-honorary | 10 | 300 |
| senior-honorary | 11 | 350 |
| senior-honorary | 12 | 400 |
| senior-honorary | 13 | 450 |
| senior-honorary | 14 | 500 |
| senior-honorary | 15 | 550 |
| senior-honorary | 16 | 600 |
| senior-honorary | 17 | 650 |
| senior-honorary | 18 | 700 |
| senior-honorary | 19 | 750 |
| senior-honorary | 20 | 800 |
| senior-honorary | 21 | 850 |
| senior-honorary | 22 | 900 |
| senior-honorary | 23 | 950 |
| senior-honorary | 24 | 1000 |
| senior-honorary | 25 | 1050 |
| senior-honorary | 26 | 1100 |
| senior-honorary | 27 | 1100 |
| senior-honorary | 28 | 1100 |
| senior-honorary | 29 | 1100 |
| senior-honorary | 30 | 1100 |
| senior-honorary | 31 | 1100 |
| senior-honorary | 32 | 1100 |
| senior-honorary | 33 | 1100 |
| senior-honorary | 34 | 1100 |
| senior-honorary | 35 | 1100 |
| senior-honorary | 36 | 1100 |
| senior-honorary | 37 | 1100 |
| senior-honorary | 38 | 1100 |
| senior-honorary | 39 | 1100 |
| senior-honorary | 40 | 1100 |
| senior-honorary | 41 | 1100 |
| senior-honorary | 42 | 1100 |
| senior-honorary | 43 | 1100 |
| senior-honorary | 44 | 1100 |
| senior-honorary | 45 | 1100 |
| child-basic | 1 | 10 |
| child-basic | 2 | 20 |
| child-basic | 3 | 30 |
| child-basic | 4 | 40 |
| child-basic | 5 | 50 |
| child-basic | 6 | 60 |
| child-basic | 7 | 70 |
| child-basic | 8 | 80 |
| child-basic | 9 | 90 |
| child-basic | 10 | 100 |
| child-basic | 11 | 100 |
| child-basic | 12 | 100 |
| child-basic | 13 | 100 |
| child-basic | 14 | 100 |
| child-basic | 15 | 100 |
| child-basic | 16 | 100 |
| child-basic | 17 | 100 |
| child-basic | 18 | 100 |
| child-basic | 19 | 100 |
| child-basic | 20 | 100 |
| child-basic | 21 | 100 |
| child-basic | 22 | 100 |
| child-basic | 23 | 100 |
| child-basic | 24 | 100 |
| child-basic | 25 | 100 |
| child-basic | 26 | 100 |
| child-basic | 27 | 100 |
| child-basic | 28 | 100 |
| child-basic | 29 | 100 |
| child-basic | 30 | 100 |
| child-basic | 31 | 100 |
| child-basic | 32 | 100 |
| child-basic | 33 | 100 |
| child-basic | 34 | 100 |
| child-basic | 35 | 100 |
| child-basic | 36 | 100 |
| child-basic | 37 | 100 |
| child-basic | 38 | 100 |
| child-basic | 39 | 100 |
| child-basic | 40 | 100 |
| child-basic | 41 | 100 |
| child-basic | 42 | 100 |
| child-basic | 43 | 100 |
| child-basic | 44 | 100 |
| child-basic | 45 | 100 |
| child-plus | 1 | 0 |
| child-plus | 2 | 15 |
| child-plus | 3 | 30 |
| child-plus | 4 | 45 |
| child-plus | 5 | 60 |
| child-plus | 6 | 75 |
| child-plus | 7 | 90 |
| child-plus | 8 | 105 |
| child-plus | 9 | 120 |
| child-plus | 10 | 135 |
| child-plus | 11 | 150 |
| child-plus | 12 | 165 |
| child-plus | 13 | 180 |
| child-plus | 14 | 195 |
| child-plus | 15 | 200 |
| child-plus | 16 | 200 |
| child-plus | 17 | 200 |
| child-plus | 18 | 200 |
| child-plus | 19 | 200 |
| child-plus | 20 | 200 |
| child-plus | 21 | 200 |
| child-plus | 22 | 200 |
| child-plus | 23 | 200 |
| child-plus | 24 | 200 |
| child-plus | 25 | 200 |
| child-plus | 26 | 200 |
| child-plus | 27 | 200 |
| child-plus | 28 | 200 |
| child-plus | 29 | 200 |
| child-plus | 30 | 200 |
| child-plus | 31 | 200 |
| child-plus | 32 | 200 |
| child-plus | 33 | 200 |
| child-plus | 34 | 200 |
| child-plus | 35 | 200 |
| child-plus | 36 | 200 |
| child-plus | 37 | 200 |
| child-plus | 38 | 200 |
| child-plus | 39 | 200 |
| child-plus | 40 | 200 |
| child-plus | 41 | 200 |
| child-plus | 42 | 200 |
| child-plus | 43 | 200 |
| child-plus | 44 | 200 |
| child-plus | 45 | 200 |
| child-silver | 1 | 0 |
| child-silver | 2 | 0 |
| child-silver | 3 | 20 |
| child-silver | 4 | 40 |
| child-silver | 5 | 60 |
| child-silver | 6 | 80 |
| child-silver | 7 | 100 |
| child-silver | 8 | 120 |
| child-silver | 9 | 140 |
| child-silver | 10 | 160 |
| child-silver | 11 | 180 |
| child-silver | 12 | 200 |
| child-silver | 13 | 220 |
| child-silver | 14 | 240 |
| child-silver | 15 | 260 |
| child-silver | 16 | 280 |
| child-silver | 17 | 300 |
| child-silver | 18 | 300 |
| child-silver | 19 | 300 |
| child-silver | 20 | 300 |
| child-silver | 21 | 300 |
| child-silver | 22 | 300 |
| child-silver | 23 | 300 |
| child-silver | 24 | 300 |
| child-silver | 25 | 300 |
| child-silver | 26 | 300 |
| child-silver | 27 | 300 |
| child-silver | 28 | 300 |
| child-silver | 29 | 300 |
| child-silver | 30 | 300 |
| child-silver | 31 | 300 |
| child-silver | 32 | 300 |
| child-silver | 33 | 300 |
| child-silver | 34 | 300 |
| child-silver | 35 | 300 |
| child-silver | 36 | 300 |
| child-silver | 37 | 300 |
| child-silver | 38 | 300 |
| child-silver | 39 | 300 |
| child-silver | 40 | 300 |
| child-silver | 41 | 300 |
| child-silver | 42 | 300 |
| child-silver | 43 | 300 |
| child-silver | 44 | 300 |
| child-silver | 45 | 300 |
| child-gold | 1 | 25 |
| child-gold | 2 | 50 |
| child-gold | 3 | 75 |
| child-gold | 4 | 100 |
| child-gold | 5 | 125 |
| child-gold | 6 | 150 |
| child-gold | 7 | 175 |
| child-gold | 8 | 200 |
| child-gold | 9 | 225 |
| child-gold | 10 | 250 |
| child-gold | 11 | 275 |
| child-gold | 12 | 300 |
| child-gold | 13 | 325 |
| child-gold | 14 | 350 |
| child-gold | 15 | 375 |
| child-gold | 16 | 400 |
| child-gold | 17 | 400 |
| child-gold | 18 | 400 |
| child-gold | 19 | 400 |
| child-gold | 20 | 400 |
| child-gold | 21 | 400 |
| child-gold | 22 | 400 |
| child-gold | 23 | 400 |
| child-gold | 24 | 400 |
| child-gold | 25 | 400 |
| child-gold | 26 | 400 |
| child-gold | 27 | 400 |
| child-gold | 28 | 400 |
| child-gold | 29 | 400 |
| child-gold | 30 | 400 |
| child-gold | 31 | 400 |
| child-gold | 32 | 400 |
| child-gold | 33 | 400 |
| child-gold | 34 | 400 |
| child-gold | 35 | 400 |
| child-gold | 36 | 400 |
| child-gold | 37 | 400 |
| child-gold | 38 | 400 |
| child-gold | 39 | 400 |
| child-gold | 40 | 400 |
| child-gold | 41 | 400 |
| child-gold | 42 | 400 |
| child-gold | 43 | 400 |
| child-gold | 44 | 400 |
| child-gold | 45 | 400 |
| child-platinum | 1 | 0 |
| child-platinum | 2 | 30 |
| child-platinum | 3 | 60 |
| child-platinum | 4 | 90 |
| child-platinum | 5 | 120 |
| child-platinum | 6 | 150 |
| child-platinum | 7 | 180 |
| child-platinum | 8 | 210 |
| child-platinum | 9 | 240 |
| child-platinum | 10 | 270 |
| child-platinum | 11 | 300 |
| child-platinum | 12 | 330 |
| child-platinum | 13 | 360 |
| child-platinum | 14 | 390 |
| child-platinum | 15 | 420 |
| child-platinum | 16 | 450 |
| child-platinum | 17 | 480 |
| child-platinum | 18 | 500 |
| child-platinum | 19 | 500 |
| child-platinum | 20 | 500 |
| child-platinum | 21 | 500 |
| child-platinum | 22 | 500 |
| child-platinum | 23 | 500 |
| child-platinum | 24 | 500 |
| child-platinum | 25 | 500 |
| child-platinum | 26 | 500 |
| child-platinum | 27 | 500 |
| child-platinum | 28 | 500 |
| child-platinum | 29 | 500 |
| child-platinum | 30 | 500 |
| child-platinum | 31 | 500 |
| child-platinum | 32 | 500 |
| child-platinum | 33 | 500 |
| child-platinum | 34 | 500 |
| child-platinum | 35 | 500 |
| child-platinum | 36 | 500 |
| child-platinum | 37 | 500 |
| child-platinum | 38 | 500 |
| child-platinum | 39 | 500 |
| child-platinum | 40 | 500 |
| child-platinum | 41 | 500 |
| child-platinum | 42 | 500 |
| child-platinum | 43 | 500 |
| child-platinum | 44 | 500 |
| child-platinum | 45 | 500 |
| child-branch | 1 | 0 |
| child-branch | 2 | 0 |
| child-branch | 3 | 35 |
| child-branch | 4 | 70 |
| child-branch | 5 | 105 |
| child-branch | 6 | 140 |
| child-branch | 7 | 175 |
| child-branch | 8 | 210 |
| child-branch | 9 | 245 |
| child-branch | 10 | 280 |
| child-branch | 11 | 315 |
| child-branch | 12 | 350 |
| child-branch | 13 | 385 |
| child-branch | 14 | 420 |
| child-branch | 15 | 455 |
| child-branch | 16 | 490 |
| child-branch | 17 | 525 |
| child-branch | 18 | 560 |
| child-branch | 19 | 595 |
| child-branch | 20 | 600 |
| child-branch | 21 | 600 |
| child-branch | 22 | 600 |
| child-branch | 23 | 600 |
| child-branch | 24 | 600 |
| child-branch | 25 | 600 |
| child-branch | 26 | 600 |
| child-branch | 27 | 600 |
| child-branch | 28 | 600 |
| child-branch | 29 | 600 |
| child-branch | 30 | 600 |
| child-branch | 31 | 600 |
| child-branch | 32 | 600 |
| child-branch | 33 | 600 |
| child-branch | 34 | 600 |
| child-branch | 35 | 600 |
| child-branch | 36 | 600 |
| child-branch | 37 | 600 |
| child-branch | 38 | 600 |
| child-branch | 39 | 600 |
| child-branch | 40 | 600 |
| child-branch | 41 | 600 |
| child-branch | 42 | 600 |
| child-branch | 43 | 600 |
| child-branch | 44 | 600 |
| child-branch | 45 | 600 |
| child-remote | 1 | 40 |
| child-remote | 2 | 80 |
| child-remote | 3 | 120 |
| child-remote | 4 | 160 |
| child-remote | 5 | 200 |
| child-remote | 6 | 240 |
| child-remote | 7 | 280 |
| child-remote | 8 | 320 |
| child-remote | 9 | 360 |
| child-remote | 10 | 400 |
| child-remote | 11 | 440 |
| child-remote | 12 | 480 |
| child-remote | 13 | 520 |
| child-remote | 14 | 560 |
| child-remote | 15 | 600 |
| child-remote | 16 | 640 |
| child-remote | 17 | 680 |
| child-remote | 18 | 700 |
| child-remote | 19 | 700 |
| child-remote | 20 | 700 |
| child-remote | 21 | 700 |
| child-remote | 22 | 700 |
| child-remote | 23 | 700 |
| child-remote | 24 | 700 |
| child-remote | 25 | 700 |
| child-remote | 26 | 700 |
| child-remote | 27 | 700 |
| child-remote | 28 | 700 |
| child-remote | 29 | 700 |
| child-remote | 30 | 700 |
| child-remote | 31 | 700 |
| child-remote | 32 | 700 |
| child-remote | 33 | 700 |
| child-remote | 34 | 700 |
| child-remote | 35 | 700 |
| child-remote | 36 | 700 |
| child-remote | 37 | 700 |
| child-remote | 38 | 700 |
| child-remote | 39 | 700 |
| child-remote | 40 | 700 |
| child-remote | 41 | 700 |
| child-remote | 42 | 700 |
| child-remote | 43 | 700 |
| child-remote | 44 | 700 |
| child-remote | 45 | 700 |
| child-family | 1 | 0 |
| child-family | 2 | 45 |
| child-family | 3 | 90 |
| child-family | 4 | 135 |
| child-family | 5 | 180 |
| child-family | 6 | 225 |
| child-family | 7 | 270 |
| child-family | 8 | 315 |
| child-family | 9 | 360 |
| child-family | 10 | 405 |
| child-family | 11 | 450 |
| child-family | 12 | 495 |
| child-family | 13 | 540 |
| child-family | 14 | 585 |
| child-family | 15 | 630 |
| child-family | 16 | 675 |
| child-family | 17 | 720 |
| child-family | 18 | 765 |
| child-family | 19 | 800 |
| child-family | 20 | 800 |
| child-family | 21 | 800 |
| child-family | 22 | 800 |
| child-family | 23 | 800 |
| child-family | 24 | 800 |
| child-family | 25 | 800 |
| child-family | 26 | 800 |
| child-family | 27 | 800 |
| child-family | 28 | 800 |
| child-family | 29 | 800 |
| child-family | 30 | 800 |
| child-family | 31 | 800 |
| child-family | 32 | 800 |
| child-family | 33 | 800 |
| child-family | 34 | 800 |
| child-family | 35 | 800 |
| child-family | 36 | 800 |
| child-family | 37 | 800 |
| child-family | 38 | 800 |
| child-family | 39 | 800 |
| child-family | 40 | 800 |
| child-family | 41 | 800 |
| child-family | 42 | 800 |
| child-family | 43 | 800 |
| child-family | 44 | 800 |
| child-family | 45 | 800 |
| child-trial | 1 | 0 |
| child-trial | 2 | 0 |
| child-trial | 3 | 50 |
| child-trial | 4 | 100 |
| child-trial | 5 | 150 |
| child-trial | 6 | 200 |
| child-trial | 7 | 250 |
| child-trial | 8 | 300 |
| child-trial | 9 | 350 |
| child-trial | 10 | 400 |
| child-trial | 11 | 450 |
| child-trial | 12 | 500 |
| child-trial | 13 | 550 |
| child-trial | 14 | 600 |
| child-trial | 15 | 650 |
| child-trial | 16 | 700 |
| child-trial | 17 | 750 |
| child-trial | 18 | 800 |
| child-trial | 19 | 850 |
| child-trial | 20 | 900 |
| child-trial | 21 | 900 |
| child-trial | 22 | 900 |
| child-trial | 23 | 900 |
| child-trial | 24 | 900 |
| child-trial | 25 | 900 |
| child-trial | 26 | 900 |
| child-trial | 27 | 900 |
| child-trial | 28 | 900 |
| child-trial | 29 | 900 |
| child-trial | 30 | 900 |
| child-trial | 31 | 900 |
| child-trial | 32 | 900 |
| child-trial | 33 | 900 |
| child-trial | 34 | 900 |
| child-trial | 35 | 900 |
| child-trial | 36 | 900 |
| child-trial | 37 | 900 |
| child-trial | 38 | 900 |
| child-trial | 39 | 900 |
| child-trial | 40 | 900 |
| child-trial | 41 | 900 |
| child-trial | 42 | 900 |
| child-trial | 43 | 900 |
| child-trial | 44 | 900 |
| child-trial | 45 | 900 |
| child-honorary | 1 | 55 |
| child-honorary | 2 | 110 |
| child-honorary | 3 | 165 |
| child-honorary | 4 | 220 |
| child-honorary | 5 | 275 |
| child-honorary | 6 | 330 |
| child-honorary | 7 | 385 |
| child-honorary | 8 | 440 |
| child-honorary | 9 | 495 |
| child-honorary | 10 | 550 |
| child-honorary | 11 | 605 |
| child-honorary | 12 | 660 |
| child-honorary | 13 | 715 |
| child-honorary | 14 | 770 |
| child-honorary | 15 | 825 |
| child-honorary | 16 | 880 |
| child-honorary | 17 | 935 |
| child-honorary | 18 | 990 |
| child-honorary | 19 | 1000 |
| child-honorary | 20 | 1000 |
| child-honorary | 21 | 1000 |
| child-honorary | 22 | 1000 |
| child-honorary | 23 | 1000 |
| child-honorary | 24 | 1000 |
| child-honorary | 25 | 1000 |
| child-honorary | 26 | 1000 |
| child-honorary | 27 | 1000 |
| child-honorary | 28 | 1000 |
| child-honorary | 29 | 1000 |
| child-honorary | 30 | 1000 |
| child-honorary | 31 | 1000 |
| child-honorary | 32 | 1000 |
| child-honorary | 33 | 1000 |
| child-honorary | 34 | 1000 |
| child-honorary | 35 | 1000 |
| child-honorary | 36 | 1000 |
| child-honorary | 37 | 1000 |
| child-honorary | 38 | 1000 |
| child-honorary | 39 | 1000 |
| child-honorary | 40 | 1000 |
| child-honorary | 41 | 1000 |
| child-honorary | 42 | 1000 |
| child-honorary | 43 | 1000 |
| child-honorary | 44 | 1000 |
| child-honorary | 45 | 1000 |
| scholar-basic | 1 | 0 |
| scholar-basic | 2 | 0 |
| scholar-basic | 3 | 0 |
| scholar-basic | 4 | 0 |
| scholar-basic | 5 | 0 |
| scholar-basic | 6 | 0 |
| scholar-basic | 7 | 0 |
| scholar-basic | 8 | 50 |
| scholar-basic | 9 | 100 |
| scholar-basic | 10 | 150 |
| scholar-basic | 11 | 200 |
| scholar-basic | 12 | 250 |
| scholar-basic | 13 | 300 |
| scholar-basic | 14 | 350 |
| scholar-basic | 15 | 400 |
| scholar-basic | 16 | 450 |
| scholar-basic | 17 | 500 |
| scholar-basic | 18 | 550 |
| scholar-basic | 19 | 600 |
| scholar-basic | 20 | 650 |
| scholar-basic | 21 | 700 |
| scholar-basic | 22 | 750 |
| scholar-basic | 23 | 800 |
| scholar-basic | 24 | 850 |
| scholar-basic | 25 | 900 |
| scholar-basic | 26 | 950 |
| scholar-basic | 27 | 1000 |
| scholar-basic | 28 | 1050 |
| scholar-basic | 29 | 1100 |
| scholar-basic | 30 | 1150 |
| scholar-basic | 31 | 1200 |
| scholar-basic | 32 | 1250 |
| scholar-basic | 33 | 1300 |
| scholar-basic | 34 | 1350 |
| scholar-basic | 35 | 1400 |
| scholar-basic | 36 | 1450 |
| scholar-basic | 37 | 1500 |
| scholar-basic | 38 | 1550 |
| scholar-basic | 39 | 1600 |
| scholar-basic | 40 | 1650 |
| scholar-basic | 41 | 1700 |
| scholar-basic | 42 | 1750 |
| scholar-basic | 43 | 1800 |
| scholar-basic | 44 | 1850 |
| scholar-basic | 45 | 1900 |
| scholar-plus | 1 | 0 |
| scholar-plus | 2 | 0 |
| scholar-plus | 3 | 0 |
| scholar-plus | 4 | 0 |
| scholar-plus | 5 | 0 |
| scholar-plus | 6 | 0 |
| scholar-plus | 7 | 0 |
| scholar-plus | 8 | 0 |
| scholar-plus | 9 | 55 |
| scholar-plus | 10 | 110 |
| scholar-plus | 11 | 165 |
| scholar-plus | 12 | 220 |
| scholar-plus | 13 | 275 |
| scholar-plus | 14 | 330 |
| scholar-plus | 15 | 385 |
| scholar-plus | 16 | 440 |
| scholar-plus | 17 | 495 |
| scholar-plus | 18 | 550 |
| scholar-plus | 19 | 605 |
| scholar-plus | 20 | 660 |
| scholar-plus | 21 | 715 |
| scholar-plus | 22 | 770 |
| scholar-plus | 23 | 825 |
| scholar-plus | 24 | 880 |
| scholar-plus | 25 | 935 |
| scholar-plus | 26 | 990 |
| scholar-plus | 27 | 1045 |
| scholar-plus | 28 | 1100 |
| scholar-plus | 29 | 1155 |
| scholar-plus | 30 | 1210 |
| scholar-plus | 31 | 1265 |
| scholar-plus | 32 | 1320 |
| scholar-plus | 33 | 1375 |
| scholar-plus | 34 | 1430 |
| scholar-plus | 35 | 1485 |
| scholar-plus | 36 | 1540 |
| scholar-plus | 37 | 1595 |
| scholar-plus | 38 | 1650 |
| scholar-plus | 39 | 1705 |
| scholar-plus | 40 | 1760 |
| scholar-plus | 41 | 1815 |
| scholar-plus | 42 | 1870 |
| scholar-plus | 43 | 1925 |
| scholar-plus | 44 | 1980 |
| scholar-plus | 45 | 2035 |
| scholar-silver | 1 | 0 |
| scholar-silver | 2 | 0 |
| scholar-silver | 3 | 0 |
| scholar-silver | 4 | 0 |
| scholar-silver | 5 | 0 |
| scholar-silver | 6 | 0 |
| scholar-silver | 7 | 0 |
| scholar-silver | 8 | 0 |
| scholar-silver | 9 | 0 |
| scholar-silver | 10 | 60 |
| scholar-silver | 11 | 120 |
| scholar-silver | 12 | 180 |
| scholar-silver | 13 | 240 |
| scholar-silver | 14 | 300 |
| scholar-silver | 15 | 360 |
| scholar-silver | 16 | 420 |
| scholar-silver | 17 | 480 |
| scholar-silver | 18 | 540 |
| scholar-silver | 19 | 600 |
| scholar-silver | 20 | 660 |
| scholar-silver | 21 | 720 |
| scholar-silver | 22 | 780 |
| scholar-silver | 23 | 840 |
| scholar-silver | 24 | 900 |
| scholar-silver | 25 | 960 |
| scholar-silver | 26 | 1020 |
| scholar-silver | 27 | 1080 |
| scholar-silver | 28 | 1140 |
| scholar-silver | 29 | 1200 |
| scholar-silver | 30 | 1260 |
| scholar-silver | 31 | 1320 |
| scholar-silver | 32 | 1380 |
| scholar-silver | 33 | 1440 |
| scholar-silver | 34 | 1500 |
| scholar-silver | 35 | 1560 |
| scholar-silver | 36 | 1620 |
| scholar-silver | 37 | 1680 |
| scholar-silver | 38 | 1740 |
| scholar-silver | 39 | 1800 |
| scholar-silver | 40 | 1860 |
| scholar-silver | 41 | 1920 |
| scholar-silver | 42 | 1980 |
| scholar-silver | 43 | 2040 |
| scholar-silver | 44 | 2100 |
| scholar-silver | 45 | 2160 |
| scholar-gold | 1 | 0 |
| scholar-gold | 2 | 0 |
| scholar-gold | 3 | 0 |
| scholar-gold | 4 | 0 |
| scholar-gold | 5 | 0 |
| scholar-gold | 6 | 0 |
| scholar-gold | 7 | 0 |
| scholar-gold | 8 | 65 |
| scholar-gold | 9 | 130 |
| scholar-gold | 10 | 195 |
| scholar-gold | 11 | 260 |
| scholar-gold | 12 | 325 |
| scholar-gold | 13 | 390 |
| scholar-gold | 14 | 455 |
| scholar-gold | 15 | 520 |
| scholar-gold | 16 | 585 |
| scholar-gold | 17 | 650 |
| scholar-gold | 18 | 715 |
| scholar-gold | 19 | 780 |
| scholar-gold | 20 | 845 |
| scholar-gold | 21 | 910 |
| scholar-gold | 22 | 975 |
| scholar-gold | 23 | 1040 |
| scholar-gold | 24 | 1105 |
| scholar-gold | 25 | 1170 |
| scholar-gold | 26 | 1235 |
| scholar-gold | 27 | 1300 |
| scholar-gold | 28 | 1365 |
| scholar-gold | 29 | 1430 |
| scholar-gold | 30 | 1495 |
| scholar-gold | 31 | 1560 |
| scholar-gold | 32 | 1625 |
| scholar-gold | 33 | 1690 |
| scholar-gold | 34 | 1755 |
| scholar-gold | 35 | 1820 |
| scholar-gold | 36 | 1885 |
| scholar-gold | 37 | 1950 |
| scholar-gold | 38 | 2015 |
| scholar-gold | 39 | 2080 |
| scholar-gold | 40 | 2145 |
| scholar-gold | 41 | 2210 |
| scholar-gold | 42 | 2275 |
| scholar-gold | 43 | 2300 |
| scholar-gold | 44 | 2300 |
| scholar-gold | 45 | 2300 |
| scholar-platinum | 1 | 0 |
| scholar-platinum | 2 | 0 |
| scholar-platinum | 3 | 0 |
| scholar-platinum | 4 | 0 |
| scholar-platinum | 5 | 0 |
| scholar-platinum | 6 | 0 |
| scholar-platinum | 7 | 0 |
| scholar-platinum | 8 | 0 |
| scholar-platinum | 9 | 70 |
| scholar-platinum | 10 | 140 |
| scholar-platinum | 11 | 210 |
| scholar-platinum | 12 | 280 |
| scholar-platinum | 13 | 350 |
| scholar-platinum | 14 | 420 |
| scholar-platinum | 15 | 490 |
| scholar-platinum | 16 | 560 |
| scholar-platinum | 17 | 630 |
| scholar-platinum | 18 | 700 |
| scholar-platinum | 19 | 770 |
| scholar-platinum | 20 | 840 |
| scholar-platinum | 21 | 910 |
| scholar-platinum | 22 | 980 |
| scholar-platinum | 23 | 1050 |
| scholar-platinum | 24 | 1120 |
| scholar-platinum | 25 | 1190 |
| scholar-platinum | 26 | 1260 |
| scholar-platinum | 27 | 1330 |
| scholar-platinum | 28 | 1400 |
| scholar-platinum | 29 | 1470 |
| scholar-platinum | 30 | 1540 |
| scholar-platinum | 31 | 1610 |
| scholar-platinum | 32 | 1680 |
| scholar-platinum | 33 | 1750 |
| scholar-platinum | 34 | 1820 |
| scholar-platinum | 35 | 1890 |
| scholar-platinum | 36 | 1960 |
| scholar-platinum | 37 | 2030 |
| scholar-platinum | 38 | 2100 |
| scholar-platinum | 39 | 2170 |
| scholar-platinum | 40 | 2240 |
| scholar-platinum | 41 | 2310 |
| scholar-platinum | 42 | 2380 |
| scholar-platinum | 43 | 2400 |
| scholar-platinum | 44 | 2400 |
| scholar-platinum | 45 | 2400 |
| scholar-branch | 1 | 0 |
| scholar-branch | 2 | 0 |
| scholar-branch | 3 | 0 |
| scholar-branch | 4 | 0 |
| scholar-branch | 5 | 0 |
| scholar-branch | 6 | 0 |
| scholar-branch | 7 | 0 |
| scholar-branch | 8 | 0 |
| scholar-branch | 9 | 0 |
| scholar-branch | 10 | 75 |
| scholar-branch | 11 | 150 |
| scholar-branch | 12 | 225 |
| scholar-branch | 13 | 300 |
| scholar-branch | 14 | 375 |
| scholar-branch | 15 | 450 |
| scholar-branch | 16 | 525 |
| scholar-branch | 17 | 600 |
| scholar-branch | 18 | 675 |
| scholar-branch | 19 | 750 |
| scholar-branch | 20 | 825 |
| scholar-branch | 21 | 900 |
| scholar-branch | 22 | 975 |
| scholar-branch | 23 | 1050 |
| scholar-branch | 24 | 1125 |
| scholar-branch | 25 | 1200 |
| scholar-branch | 26 | 1275 |
| scholar-branch | 27 | 1350 |
| scholar-branch | 28 | 1425 |
| scholar-branch | 29 | 1500 |
| scholar-branch | 30 | 1575 |
| scholar-branch | 31 | 1650 |
| scholar-branch | 32 | 1725 |
| scholar-branch | 33 | 1800 |
| scholar-branch | 34 | 1875 |
| scholar-branch | 35 | 1950 |
| scholar-branch | 36 | 2025 |
| scholar-branch | 37 | 2100 |
| scholar-branch | 38 | 2175 |
| scholar-branch | 39 | 2250 |
| scholar-branch | 40 | 2325 |
| scholar-branch | 41 | 2400 |
| scholar-branch | 42 | 2475 |
| scholar-branch | 43 | 2500 |
| scholar-branch | 44 | 2500 |
| scholar-branch | 45 | 2500 |
| scholar-remote | 1 | 0 |
| scholar-remote | 2 | 0 |
| scholar-remote | 3 | 0 |
| scholar-remote | 4 | 0 |
| scholar-remote | 5 | 0 |
| scholar-remote | 6 | 0 |
| scholar-remote | 7 | 0 |
| scholar-remote | 8 | 80 |
| scholar-remote | 9 | 160 |
| scholar-remote | 10 | 240 |
| scholar-remote | 11 | 320 |
| scholar-remote | 12 | 400 |
| scholar-remote | 13 | 480 |
| scholar-remote | 14 | 560 |
| scholar-remote | 15 | 640 |
| scholar-remote | 16 | 720 |
| scholar-remote | 17 | 800 |
| scholar-remote | 18 | 880 |
| scholar-remote | 19 | 960 |
| scholar-remote | 20 | 1040 |
| scholar-remote | 21 | 1120 |
| scholar-remote | 22 | 1200 |
| scholar-remote | 23 | 1280 |
| scholar-remote | 24 | 1360 |
| scholar-remote | 25 | 1440 |
| scholar-remote | 26 | 1520 |
| scholar-remote | 27 | 1600 |
| scholar-remote | 28 | 1680 |
| scholar-remote | 29 | 1760 |
| scholar-remote | 30 | 1840 |
| scholar-remote | 31 | 1920 |
| scholar-remote | 32 | 2000 |
| scholar-remote | 33 | 2080 |
| scholar-remote | 34 | 2160 |
| scholar-remote | 35 | 2240 |
| scholar-remote | 36 | 2320 |
| scholar-remote | 37 | 2400 |
| scholar-remote | 38 | 2480 |
| scholar-remote | 39 | 2560 |
| scholar-remote | 40 | 2600 |
| scholar-remote | 41 | 2600 |
| scholar-remote | 42 | 2600 |
| scholar-remote | 43 | 2600 |
| scholar-remote | 44 | 2600 |
| scholar-remote | 45 | 2600 |
| scholar-family | 1 | 0 |
| scholar-family | 2 | 0 |
| scholar-family | 3 | 0 |
| scholar-family | 4 | 0 |
| scholar-family | 5 | 0 |
| scholar-family | 6 | 0 |
| scholar-family | 7 | 0 |
| scholar-family | 8 | 0 |
| scholar-family | 9 | 85 |
| scholar-family | 10 | 170 |
| scholar-family | 11 | 255 |
| scholar-family | 12 | 340 |
| scholar-family | 13 | 425 |
| scholar-family | 14 | 510 |
| scholar-family | 15 | 595 |
| scholar-family | 16 | 680 |
| scholar-family | 17 | 765 |
| scholar-family | 18 | 850 |
| scholar-family | 19 | 935 |
| scholar-family | 20 | 1020 |
| scholar-family | 21 | 1105 |
| scholar-family | 22 | 1190 |
| scholar-family | 23 | 1275 |
| scholar-family | 24 | 1360 |
| scholar-family | 25 | 1445 |
| scholar-family | 26 | 1530 |
| scholar-family | 27 | 1615 |
| scholar-family | 28 | 1700 |
| scholar-family | 29 | 1785 |
| scholar-family | 30 | 1870 |
| scholar-family | 31 | 1955 |
| scholar-family | 32 | 2040 |
| scholar-family | 33 | 2125 |
| scholar-family | 34 | 2210 |
| scholar-family | 35 | 2295 |
| scholar-family | 36 | 2380 |
| scholar-family | 37 | 2465 |
| scholar-family | 38 | 2550 |
| scholar-family | 39 | 2635 |
| scholar-family | 40 | 2700 |
| scholar-family | 41 | 2700 |
| scholar-family | 42 | 2700 |
| scholar-family | 43 | 2700 |
| scholar-family | 44 | 2700 |
| scholar-family | 45 | 2700 |
| scholar-trial | 1 | 0 |
| scholar-trial | 2 | 0 |
| scholar-trial | 3 | 0 |
| scholar-trial | 4 | 0 |
| scholar-trial | 5 | 0 |
| scholar-trial | 6 | 0 |
| scholar-trial | 7 | 0 |
| scholar-trial | 8 | 0 |
| scholar-trial | 9 | 0 |
| scholar-trial | 10 | 90 |
| scholar-trial | 11 | 180 |
| scholar-trial | 12 | 270 |
| scholar-trial | 13 | 360 |
| scholar-trial | 14 | 450 |
| scholar-trial | 15 | 540 |
| scholar-trial | 16 | 630 |
| scholar-trial | 17 | 720 |
| scholar-trial | 18 | 810 |
| scholar-trial | 19 | 900 |
| scholar-trial | 20 | 990 |
| scholar-trial | 21 | 1080 |
| scholar-trial | 22 | 1170 |
| scholar-trial | 23 | 1260 |
| scholar-trial | 24 | 1350 |
| scholar-trial | 25 | 1440 |
| scholar-trial | 26 | 1530 |
| scholar-trial | 27 | 1620 |
| scholar-trial | 28 | 1710 |
| scholar-trial | 29 | 1800 |
| scholar-trial | 30 | 1890 |
| scholar-trial | 31 | 1980 |
| scholar-trial | 32 | 2070 |
| scholar-trial | 33 | 2160 |
| scholar-trial | 34 | 2250 |
| scholar-trial | 35 | 2340 |
| scholar-trial | 36 | 2430 |
| scholar-trial | 37 | 2520 |
| scholar-trial | 38 | 2610 |
| scholar-trial | 39 | 2700 |
| scholar-trial | 40 | 2790 |
| scholar-trial | 41 | 2800 |
| scholar-trial | 42 | 2800 |
| scholar-trial | 43 | 2800 |
| scholar-trial | 44 | 2800 |
| scholar-trial | 45 | 2800 |
| scholar-honorary | 1 | 0 |
| scholar-honorary | 2 | 0 |
| scholar-honorary | 3 | 0 |
| scholar-honorary | 4 | 0 |
| scholar-honorary | 5 | 0 |
| scholar-honorary | 6 | 0 |
| scholar-honorary | 7 | 0 |
| scholar-honorary | 8 | 95 |
| scholar-honorary | 9 | 190 |
| scholar-honorary | 10 | 285 |
| scholar-honorary | 11 | 380 |
| scholar-honorary | 12 | 475 |
| scholar-honorary | 13 | 570 |
| scholar-honorary | 14 | 665 |
| scholar-honorary | 15 | 760 |
| scholar-honorary | 16 | 855 |
| scholar-honorary | 17 | 950 |
| scholar-honorary | 18 | 1045 |
| scholar-honorary | 19 | 1140 |
| scholar-honorary | 20 | 1235 |
| scholar-honorary | 21 | 1330 |
| scholar-honorary | 22 | 1425 |
| scholar-honorary | 23 | 1520 |
| scholar-honorary | 24 | 1615 |
| scholar-honorary | 25 | 1710 |
| scholar-honorary | 26 | 1805 |
| scholar-honorary | 27 | 1900 |
| scholar-honorary | 28 | 1995 |
| scholar-honorary | 29 | 2090 |
| scholar-honorary | 30 | 2185 |
| scholar-honorary | 31 | 2280 |
| scholar-honorary | 32 | 2375 |
| scholar-honorary | 33 | 2470 |
| scholar-honorary | 34 | 2565 |
| scholar-honorary | 35 | 2660 |
| scholar-honorary | 36 | 2755 |
| scholar-honorary | 37 | 2850 |
| scholar-honorary | 38 | 2900 |
| scholar-honorary | 39 | 2900 |
| scholar-honorary | 40 | 2900 |
| scholar-honorary | 41 | 2900 |
| scholar-honorary | 42 | 2900 |
| scholar-honorary | 43 | 2900 |
| scholar-honorary | 44 | 2900 |
| scholar-honorary | 45 | 2900 |

## Appendix C: due dates by type and checkout date

| type | checked out | due |
|---|---|---|
| adult-basic | 2026-01-03 | 2026-01-17 |
| adult-basic | 2026-01-26 | 2026-02-09 |
| adult-basic | 2026-02-18 | 2026-03-04 |
| adult-basic | 2026-03-13 | 2026-03-27 |
| adult-basic | 2026-04-05 | 2026-04-19 |
| adult-basic | 2026-04-28 | 2026-05-12 |
| adult-basic | 2026-05-21 | 2026-06-04 |
| adult-basic | 2026-06-13 | 2026-06-27 |
| adult-basic | 2026-07-06 | 2026-07-20 |
| adult-basic | 2026-07-29 | 2026-08-12 |
| adult-basic | 2026-08-21 | 2026-09-04 |
| adult-basic | 2026-09-13 | 2026-09-27 |
| adult-basic | 2026-10-06 | 2026-10-20 |
| adult-basic | 2026-10-29 | 2026-11-12 |
| adult-basic | 2026-11-21 | 2026-12-05 |
| adult-plus | 2026-01-03 | 2026-01-24 |
| adult-plus | 2026-01-26 | 2026-02-16 |
| adult-plus | 2026-02-18 | 2026-03-11 |
| adult-plus | 2026-03-13 | 2026-04-03 |
| adult-plus | 2026-04-05 | 2026-04-26 |
| adult-plus | 2026-04-28 | 2026-05-19 |
| adult-plus | 2026-05-21 | 2026-06-11 |
| adult-plus | 2026-06-13 | 2026-07-04 |
| adult-plus | 2026-07-06 | 2026-07-27 |
| adult-plus | 2026-07-29 | 2026-08-19 |
| adult-plus | 2026-08-21 | 2026-09-11 |
| adult-plus | 2026-09-13 | 2026-10-04 |
| adult-plus | 2026-10-06 | 2026-10-27 |
| adult-plus | 2026-10-29 | 2026-11-19 |
| adult-plus | 2026-11-21 | 2026-12-12 |
| adult-silver | 2026-01-03 | 2026-01-31 |
| adult-silver | 2026-01-26 | 2026-02-23 |
| adult-silver | 2026-02-18 | 2026-03-18 |
| adult-silver | 2026-03-13 | 2026-04-10 |
| adult-silver | 2026-04-05 | 2026-05-03 |
| adult-silver | 2026-04-28 | 2026-05-26 |
| adult-silver | 2026-05-21 | 2026-06-18 |
| adult-silver | 2026-06-13 | 2026-07-11 |
| adult-silver | 2026-07-06 | 2026-08-03 |
| adult-silver | 2026-07-29 | 2026-08-26 |
| adult-silver | 2026-08-21 | 2026-09-18 |
| adult-silver | 2026-09-13 | 2026-10-11 |
| adult-silver | 2026-10-06 | 2026-11-03 |
| adult-silver | 2026-10-29 | 2026-11-26 |
| adult-silver | 2026-11-21 | 2026-12-19 |
| adult-gold | 2026-01-03 | 2026-02-07 |
| adult-gold | 2026-01-26 | 2026-03-02 |
| adult-gold | 2026-02-18 | 2026-03-25 |
| adult-gold | 2026-03-13 | 2026-04-17 |
| adult-gold | 2026-04-05 | 2026-05-10 |
| adult-gold | 2026-04-28 | 2026-06-02 |
| adult-gold | 2026-05-21 | 2026-06-25 |
| adult-gold | 2026-06-13 | 2026-07-18 |
| adult-gold | 2026-07-06 | 2026-08-10 |
| adult-gold | 2026-07-29 | 2026-09-02 |
| adult-gold | 2026-08-21 | 2026-09-25 |
| adult-gold | 2026-09-13 | 2026-10-18 |
| adult-gold | 2026-10-06 | 2026-11-10 |
| adult-gold | 2026-10-29 | 2026-12-03 |
| adult-gold | 2026-11-21 | 2026-12-26 |
| adult-platinum | 2026-01-03 | 2026-01-17 |
| adult-platinum | 2026-01-26 | 2026-02-09 |
| adult-platinum | 2026-02-18 | 2026-03-04 |
| adult-platinum | 2026-03-13 | 2026-03-27 |
| adult-platinum | 2026-04-05 | 2026-04-19 |
| adult-platinum | 2026-04-28 | 2026-05-12 |
| adult-platinum | 2026-05-21 | 2026-06-04 |
| adult-platinum | 2026-06-13 | 2026-06-27 |
| adult-platinum | 2026-07-06 | 2026-07-20 |
| adult-platinum | 2026-07-29 | 2026-08-12 |
| adult-platinum | 2026-08-21 | 2026-09-04 |
| adult-platinum | 2026-09-13 | 2026-09-27 |
| adult-platinum | 2026-10-06 | 2026-10-20 |
| adult-platinum | 2026-10-29 | 2026-11-12 |
| adult-platinum | 2026-11-21 | 2026-12-05 |
| adult-branch | 2026-01-03 | 2026-01-24 |
| adult-branch | 2026-01-26 | 2026-02-16 |
| adult-branch | 2026-02-18 | 2026-03-11 |
| adult-branch | 2026-03-13 | 2026-04-03 |
| adult-branch | 2026-04-05 | 2026-04-26 |
| adult-branch | 2026-04-28 | 2026-05-19 |
| adult-branch | 2026-05-21 | 2026-06-11 |
| adult-branch | 2026-06-13 | 2026-07-04 |
| adult-branch | 2026-07-06 | 2026-07-27 |
| adult-branch | 2026-07-29 | 2026-08-19 |
| adult-branch | 2026-08-21 | 2026-09-11 |
| adult-branch | 2026-09-13 | 2026-10-04 |
| adult-branch | 2026-10-06 | 2026-10-27 |
| adult-branch | 2026-10-29 | 2026-11-19 |
| adult-branch | 2026-11-21 | 2026-12-12 |
| adult-remote | 2026-01-03 | 2026-01-31 |
| adult-remote | 2026-01-26 | 2026-02-23 |
| adult-remote | 2026-02-18 | 2026-03-18 |
| adult-remote | 2026-03-13 | 2026-04-10 |
| adult-remote | 2026-04-05 | 2026-05-03 |
| adult-remote | 2026-04-28 | 2026-05-26 |
| adult-remote | 2026-05-21 | 2026-06-18 |
| adult-remote | 2026-06-13 | 2026-07-11 |
| adult-remote | 2026-07-06 | 2026-08-03 |
| adult-remote | 2026-07-29 | 2026-08-26 |
| adult-remote | 2026-08-21 | 2026-09-18 |
| adult-remote | 2026-09-13 | 2026-10-11 |
| adult-remote | 2026-10-06 | 2026-11-03 |
| adult-remote | 2026-10-29 | 2026-11-26 |
| adult-remote | 2026-11-21 | 2026-12-19 |
| adult-family | 2026-01-03 | 2026-02-07 |
| adult-family | 2026-01-26 | 2026-03-02 |
| adult-family | 2026-02-18 | 2026-03-25 |
| adult-family | 2026-03-13 | 2026-04-17 |
| adult-family | 2026-04-05 | 2026-05-10 |
| adult-family | 2026-04-28 | 2026-06-02 |
| adult-family | 2026-05-21 | 2026-06-25 |
| adult-family | 2026-06-13 | 2026-07-18 |
| adult-family | 2026-07-06 | 2026-08-10 |
| adult-family | 2026-07-29 | 2026-09-02 |
| adult-family | 2026-08-21 | 2026-09-25 |
| adult-family | 2026-09-13 | 2026-10-18 |
| adult-family | 2026-10-06 | 2026-11-10 |
| adult-family | 2026-10-29 | 2026-12-03 |
| adult-family | 2026-11-21 | 2026-12-26 |
| adult-trial | 2026-01-03 | 2026-01-17 |
| adult-trial | 2026-01-26 | 2026-02-09 |
| adult-trial | 2026-02-18 | 2026-03-04 |
| adult-trial | 2026-03-13 | 2026-03-27 |
| adult-trial | 2026-04-05 | 2026-04-19 |
| adult-trial | 2026-04-28 | 2026-05-12 |
| adult-trial | 2026-05-21 | 2026-06-04 |
| adult-trial | 2026-06-13 | 2026-06-27 |
| adult-trial | 2026-07-06 | 2026-07-20 |
| adult-trial | 2026-07-29 | 2026-08-12 |
| adult-trial | 2026-08-21 | 2026-09-04 |
| adult-trial | 2026-09-13 | 2026-09-27 |
| adult-trial | 2026-10-06 | 2026-10-20 |
| adult-trial | 2026-10-29 | 2026-11-12 |
| adult-trial | 2026-11-21 | 2026-12-05 |
| adult-honorary | 2026-01-03 | 2026-01-24 |
| adult-honorary | 2026-01-26 | 2026-02-16 |
| adult-honorary | 2026-02-18 | 2026-03-11 |
| adult-honorary | 2026-03-13 | 2026-04-03 |
| adult-honorary | 2026-04-05 | 2026-04-26 |
| adult-honorary | 2026-04-28 | 2026-05-19 |
| adult-honorary | 2026-05-21 | 2026-06-11 |
| adult-honorary | 2026-06-13 | 2026-07-04 |
| adult-honorary | 2026-07-06 | 2026-07-27 |
| adult-honorary | 2026-07-29 | 2026-08-19 |
| adult-honorary | 2026-08-21 | 2026-09-11 |
| adult-honorary | 2026-09-13 | 2026-10-04 |
| adult-honorary | 2026-10-06 | 2026-10-27 |
| adult-honorary | 2026-10-29 | 2026-11-19 |
| adult-honorary | 2026-11-21 | 2026-12-12 |
| student-basic | 2026-01-03 | 2026-01-24 |
| student-basic | 2026-01-26 | 2026-02-16 |
| student-basic | 2026-02-18 | 2026-03-11 |
| student-basic | 2026-03-13 | 2026-04-03 |
| student-basic | 2026-04-05 | 2026-04-26 |
| student-basic | 2026-04-28 | 2026-05-19 |
| student-basic | 2026-05-21 | 2026-06-11 |
| student-basic | 2026-06-13 | 2026-07-04 |
| student-basic | 2026-07-06 | 2026-07-27 |
| student-basic | 2026-07-29 | 2026-08-19 |
| student-basic | 2026-08-21 | 2026-09-11 |
| student-basic | 2026-09-13 | 2026-10-04 |
| student-basic | 2026-10-06 | 2026-10-27 |
| student-basic | 2026-10-29 | 2026-11-19 |
| student-basic | 2026-11-21 | 2026-12-12 |
| student-plus | 2026-01-03 | 2026-01-31 |
| student-plus | 2026-01-26 | 2026-02-23 |
| student-plus | 2026-02-18 | 2026-03-18 |
| student-plus | 2026-03-13 | 2026-04-10 |
| student-plus | 2026-04-05 | 2026-05-03 |
| student-plus | 2026-04-28 | 2026-05-26 |
| student-plus | 2026-05-21 | 2026-06-18 |
| student-plus | 2026-06-13 | 2026-07-11 |
| student-plus | 2026-07-06 | 2026-08-03 |
| student-plus | 2026-07-29 | 2026-08-26 |
| student-plus | 2026-08-21 | 2026-09-18 |
| student-plus | 2026-09-13 | 2026-10-11 |
| student-plus | 2026-10-06 | 2026-11-03 |
| student-plus | 2026-10-29 | 2026-11-26 |
| student-plus | 2026-11-21 | 2026-12-19 |
| student-silver | 2026-01-03 | 2026-02-07 |
| student-silver | 2026-01-26 | 2026-03-02 |
| student-silver | 2026-02-18 | 2026-03-25 |
| student-silver | 2026-03-13 | 2026-04-17 |
| student-silver | 2026-04-05 | 2026-05-10 |
| student-silver | 2026-04-28 | 2026-06-02 |
| student-silver | 2026-05-21 | 2026-06-25 |
| student-silver | 2026-06-13 | 2026-07-18 |
| student-silver | 2026-07-06 | 2026-08-10 |
| student-silver | 2026-07-29 | 2026-09-02 |
| student-silver | 2026-08-21 | 2026-09-25 |
| student-silver | 2026-09-13 | 2026-10-18 |
| student-silver | 2026-10-06 | 2026-11-10 |
| student-silver | 2026-10-29 | 2026-12-03 |
| student-silver | 2026-11-21 | 2026-12-26 |
| student-gold | 2026-01-03 | 2026-02-14 |
| student-gold | 2026-01-26 | 2026-03-09 |
| student-gold | 2026-02-18 | 2026-04-01 |
| student-gold | 2026-03-13 | 2026-04-24 |
| student-gold | 2026-04-05 | 2026-05-17 |
| student-gold | 2026-04-28 | 2026-06-09 |
| student-gold | 2026-05-21 | 2026-07-02 |
| student-gold | 2026-06-13 | 2026-07-25 |
| student-gold | 2026-07-06 | 2026-08-17 |
| student-gold | 2026-07-29 | 2026-09-09 |
| student-gold | 2026-08-21 | 2026-10-02 |
| student-gold | 2026-09-13 | 2026-10-25 |
| student-gold | 2026-10-06 | 2026-11-17 |
| student-gold | 2026-10-29 | 2026-12-10 |
| student-gold | 2026-11-21 | 2027-01-02 |
| student-platinum | 2026-01-03 | 2026-01-24 |
| student-platinum | 2026-01-26 | 2026-02-16 |
| student-platinum | 2026-02-18 | 2026-03-11 |
| student-platinum | 2026-03-13 | 2026-04-03 |
| student-platinum | 2026-04-05 | 2026-04-26 |
| student-platinum | 2026-04-28 | 2026-05-19 |
| student-platinum | 2026-05-21 | 2026-06-11 |
| student-platinum | 2026-06-13 | 2026-07-04 |
| student-platinum | 2026-07-06 | 2026-07-27 |
| student-platinum | 2026-07-29 | 2026-08-19 |
| student-platinum | 2026-08-21 | 2026-09-11 |
| student-platinum | 2026-09-13 | 2026-10-04 |
| student-platinum | 2026-10-06 | 2026-10-27 |
| student-platinum | 2026-10-29 | 2026-11-19 |
| student-platinum | 2026-11-21 | 2026-12-12 |
| student-branch | 2026-01-03 | 2026-01-31 |
| student-branch | 2026-01-26 | 2026-02-23 |
| student-branch | 2026-02-18 | 2026-03-18 |
| student-branch | 2026-03-13 | 2026-04-10 |
| student-branch | 2026-04-05 | 2026-05-03 |
| student-branch | 2026-04-28 | 2026-05-26 |
| student-branch | 2026-05-21 | 2026-06-18 |
| student-branch | 2026-06-13 | 2026-07-11 |
| student-branch | 2026-07-06 | 2026-08-03 |
| student-branch | 2026-07-29 | 2026-08-26 |
| student-branch | 2026-08-21 | 2026-09-18 |
| student-branch | 2026-09-13 | 2026-10-11 |
| student-branch | 2026-10-06 | 2026-11-03 |
| student-branch | 2026-10-29 | 2026-11-26 |
| student-branch | 2026-11-21 | 2026-12-19 |
| student-remote | 2026-01-03 | 2026-02-07 |
| student-remote | 2026-01-26 | 2026-03-02 |
| student-remote | 2026-02-18 | 2026-03-25 |
| student-remote | 2026-03-13 | 2026-04-17 |
| student-remote | 2026-04-05 | 2026-05-10 |
| student-remote | 2026-04-28 | 2026-06-02 |
| student-remote | 2026-05-21 | 2026-06-25 |
| student-remote | 2026-06-13 | 2026-07-18 |
| student-remote | 2026-07-06 | 2026-08-10 |
| student-remote | 2026-07-29 | 2026-09-02 |
| student-remote | 2026-08-21 | 2026-09-25 |
| student-remote | 2026-09-13 | 2026-10-18 |
| student-remote | 2026-10-06 | 2026-11-10 |
| student-remote | 2026-10-29 | 2026-12-03 |
| student-remote | 2026-11-21 | 2026-12-26 |
| student-family | 2026-01-03 | 2026-02-14 |
| student-family | 2026-01-26 | 2026-03-09 |
| student-family | 2026-02-18 | 2026-04-01 |
| student-family | 2026-03-13 | 2026-04-24 |
| student-family | 2026-04-05 | 2026-05-17 |
| student-family | 2026-04-28 | 2026-06-09 |
| student-family | 2026-05-21 | 2026-07-02 |
| student-family | 2026-06-13 | 2026-07-25 |
| student-family | 2026-07-06 | 2026-08-17 |
| student-family | 2026-07-29 | 2026-09-09 |
| student-family | 2026-08-21 | 2026-10-02 |
| student-family | 2026-09-13 | 2026-10-25 |
| student-family | 2026-10-06 | 2026-11-17 |
| student-family | 2026-10-29 | 2026-12-10 |
| student-family | 2026-11-21 | 2027-01-02 |
| student-trial | 2026-01-03 | 2026-01-24 |
| student-trial | 2026-01-26 | 2026-02-16 |
| student-trial | 2026-02-18 | 2026-03-11 |
| student-trial | 2026-03-13 | 2026-04-03 |
| student-trial | 2026-04-05 | 2026-04-26 |
| student-trial | 2026-04-28 | 2026-05-19 |
| student-trial | 2026-05-21 | 2026-06-11 |
| student-trial | 2026-06-13 | 2026-07-04 |
| student-trial | 2026-07-06 | 2026-07-27 |
| student-trial | 2026-07-29 | 2026-08-19 |
| student-trial | 2026-08-21 | 2026-09-11 |
| student-trial | 2026-09-13 | 2026-10-04 |
| student-trial | 2026-10-06 | 2026-10-27 |
| student-trial | 2026-10-29 | 2026-11-19 |
| student-trial | 2026-11-21 | 2026-12-12 |
| student-honorary | 2026-01-03 | 2026-01-31 |
| student-honorary | 2026-01-26 | 2026-02-23 |
| student-honorary | 2026-02-18 | 2026-03-18 |
| student-honorary | 2026-03-13 | 2026-04-10 |
| student-honorary | 2026-04-05 | 2026-05-03 |
| student-honorary | 2026-04-28 | 2026-05-26 |
| student-honorary | 2026-05-21 | 2026-06-18 |
| student-honorary | 2026-06-13 | 2026-07-11 |
| student-honorary | 2026-07-06 | 2026-08-03 |
| student-honorary | 2026-07-29 | 2026-08-26 |
| student-honorary | 2026-08-21 | 2026-09-18 |
| student-honorary | 2026-09-13 | 2026-10-11 |
| student-honorary | 2026-10-06 | 2026-11-03 |
| student-honorary | 2026-10-29 | 2026-11-26 |
| student-honorary | 2026-11-21 | 2026-12-19 |
| staff-basic | 2026-01-03 | 2026-01-31 |
| staff-basic | 2026-01-26 | 2026-02-23 |
| staff-basic | 2026-02-18 | 2026-03-18 |
| staff-basic | 2026-03-13 | 2026-04-10 |
| staff-basic | 2026-04-05 | 2026-05-03 |
| staff-basic | 2026-04-28 | 2026-05-26 |
| staff-basic | 2026-05-21 | 2026-06-18 |
| staff-basic | 2026-06-13 | 2026-07-11 |
| staff-basic | 2026-07-06 | 2026-08-03 |
| staff-basic | 2026-07-29 | 2026-08-26 |
| staff-basic | 2026-08-21 | 2026-09-18 |
| staff-basic | 2026-09-13 | 2026-10-11 |
| staff-basic | 2026-10-06 | 2026-11-03 |
| staff-basic | 2026-10-29 | 2026-11-26 |
| staff-basic | 2026-11-21 | 2026-12-19 |
| staff-plus | 2026-01-03 | 2026-02-07 |
| staff-plus | 2026-01-26 | 2026-03-02 |
| staff-plus | 2026-02-18 | 2026-03-25 |
| staff-plus | 2026-03-13 | 2026-04-17 |
| staff-plus | 2026-04-05 | 2026-05-10 |
| staff-plus | 2026-04-28 | 2026-06-02 |
| staff-plus | 2026-05-21 | 2026-06-25 |
| staff-plus | 2026-06-13 | 2026-07-18 |
| staff-plus | 2026-07-06 | 2026-08-10 |
| staff-plus | 2026-07-29 | 2026-09-02 |
| staff-plus | 2026-08-21 | 2026-09-25 |
| staff-plus | 2026-09-13 | 2026-10-18 |
| staff-plus | 2026-10-06 | 2026-11-10 |
| staff-plus | 2026-10-29 | 2026-12-03 |
| staff-plus | 2026-11-21 | 2026-12-26 |
| staff-silver | 2026-01-03 | 2026-02-14 |
| staff-silver | 2026-01-26 | 2026-03-09 |
| staff-silver | 2026-02-18 | 2026-04-01 |
| staff-silver | 2026-03-13 | 2026-04-24 |
| staff-silver | 2026-04-05 | 2026-05-17 |
| staff-silver | 2026-04-28 | 2026-06-09 |
| staff-silver | 2026-05-21 | 2026-07-02 |
| staff-silver | 2026-06-13 | 2026-07-25 |
| staff-silver | 2026-07-06 | 2026-08-17 |
| staff-silver | 2026-07-29 | 2026-09-09 |
| staff-silver | 2026-08-21 | 2026-10-02 |
| staff-silver | 2026-09-13 | 2026-10-25 |
| staff-silver | 2026-10-06 | 2026-11-17 |
| staff-silver | 2026-10-29 | 2026-12-10 |
| staff-silver | 2026-11-21 | 2027-01-02 |
| staff-gold | 2026-01-03 | 2026-02-21 |
| staff-gold | 2026-01-26 | 2026-03-16 |
| staff-gold | 2026-02-18 | 2026-04-08 |
| staff-gold | 2026-03-13 | 2026-05-01 |
| staff-gold | 2026-04-05 | 2026-05-24 |
| staff-gold | 2026-04-28 | 2026-06-16 |
| staff-gold | 2026-05-21 | 2026-07-09 |
| staff-gold | 2026-06-13 | 2026-08-01 |
| staff-gold | 2026-07-06 | 2026-08-24 |
| staff-gold | 2026-07-29 | 2026-09-16 |
| staff-gold | 2026-08-21 | 2026-10-09 |
| staff-gold | 2026-09-13 | 2026-11-01 |
| staff-gold | 2026-10-06 | 2026-11-24 |
| staff-gold | 2026-10-29 | 2026-12-17 |
| staff-gold | 2026-11-21 | 2027-01-09 |
| staff-platinum | 2026-01-03 | 2026-01-31 |
| staff-platinum | 2026-01-26 | 2026-02-23 |
| staff-platinum | 2026-02-18 | 2026-03-18 |
| staff-platinum | 2026-03-13 | 2026-04-10 |
| staff-platinum | 2026-04-05 | 2026-05-03 |
| staff-platinum | 2026-04-28 | 2026-05-26 |
| staff-platinum | 2026-05-21 | 2026-06-18 |
| staff-platinum | 2026-06-13 | 2026-07-11 |
| staff-platinum | 2026-07-06 | 2026-08-03 |
| staff-platinum | 2026-07-29 | 2026-08-26 |
| staff-platinum | 2026-08-21 | 2026-09-18 |
| staff-platinum | 2026-09-13 | 2026-10-11 |
| staff-platinum | 2026-10-06 | 2026-11-03 |
| staff-platinum | 2026-10-29 | 2026-11-26 |
| staff-platinum | 2026-11-21 | 2026-12-19 |
| staff-branch | 2026-01-03 | 2026-02-07 |
| staff-branch | 2026-01-26 | 2026-03-02 |
| staff-branch | 2026-02-18 | 2026-03-25 |
| staff-branch | 2026-03-13 | 2026-04-17 |
| staff-branch | 2026-04-05 | 2026-05-10 |
| staff-branch | 2026-04-28 | 2026-06-02 |
| staff-branch | 2026-05-21 | 2026-06-25 |
| staff-branch | 2026-06-13 | 2026-07-18 |
| staff-branch | 2026-07-06 | 2026-08-10 |
| staff-branch | 2026-07-29 | 2026-09-02 |
| staff-branch | 2026-08-21 | 2026-09-25 |
| staff-branch | 2026-09-13 | 2026-10-18 |
| staff-branch | 2026-10-06 | 2026-11-10 |
| staff-branch | 2026-10-29 | 2026-12-03 |
| staff-branch | 2026-11-21 | 2026-12-26 |
| staff-remote | 2026-01-03 | 2026-02-14 |
| staff-remote | 2026-01-26 | 2026-03-09 |
| staff-remote | 2026-02-18 | 2026-04-01 |
| staff-remote | 2026-03-13 | 2026-04-24 |
| staff-remote | 2026-04-05 | 2026-05-17 |
| staff-remote | 2026-04-28 | 2026-06-09 |
| staff-remote | 2026-05-21 | 2026-07-02 |
| staff-remote | 2026-06-13 | 2026-07-25 |
| staff-remote | 2026-07-06 | 2026-08-17 |
| staff-remote | 2026-07-29 | 2026-09-09 |
| staff-remote | 2026-08-21 | 2026-10-02 |
| staff-remote | 2026-09-13 | 2026-10-25 |
| staff-remote | 2026-10-06 | 2026-11-17 |
| staff-remote | 2026-10-29 | 2026-12-10 |
| staff-remote | 2026-11-21 | 2027-01-02 |
| staff-family | 2026-01-03 | 2026-02-21 |
| staff-family | 2026-01-26 | 2026-03-16 |
| staff-family | 2026-02-18 | 2026-04-08 |
| staff-family | 2026-03-13 | 2026-05-01 |
| staff-family | 2026-04-05 | 2026-05-24 |
| staff-family | 2026-04-28 | 2026-06-16 |
| staff-family | 2026-05-21 | 2026-07-09 |
| staff-family | 2026-06-13 | 2026-08-01 |
| staff-family | 2026-07-06 | 2026-08-24 |
| staff-family | 2026-07-29 | 2026-09-16 |
| staff-family | 2026-08-21 | 2026-10-09 |
| staff-family | 2026-09-13 | 2026-11-01 |
| staff-family | 2026-10-06 | 2026-11-24 |
| staff-family | 2026-10-29 | 2026-12-17 |
| staff-family | 2026-11-21 | 2027-01-09 |
| staff-trial | 2026-01-03 | 2026-01-31 |
| staff-trial | 2026-01-26 | 2026-02-23 |
| staff-trial | 2026-02-18 | 2026-03-18 |
| staff-trial | 2026-03-13 | 2026-04-10 |
| staff-trial | 2026-04-05 | 2026-05-03 |
| staff-trial | 2026-04-28 | 2026-05-26 |
| staff-trial | 2026-05-21 | 2026-06-18 |
| staff-trial | 2026-06-13 | 2026-07-11 |
| staff-trial | 2026-07-06 | 2026-08-03 |
| staff-trial | 2026-07-29 | 2026-08-26 |
| staff-trial | 2026-08-21 | 2026-09-18 |
| staff-trial | 2026-09-13 | 2026-10-11 |
| staff-trial | 2026-10-06 | 2026-11-03 |
| staff-trial | 2026-10-29 | 2026-11-26 |
| staff-trial | 2026-11-21 | 2026-12-19 |
| staff-honorary | 2026-01-03 | 2026-02-07 |
| staff-honorary | 2026-01-26 | 2026-03-02 |
| staff-honorary | 2026-02-18 | 2026-03-25 |
| staff-honorary | 2026-03-13 | 2026-04-17 |
| staff-honorary | 2026-04-05 | 2026-05-10 |
| staff-honorary | 2026-04-28 | 2026-06-02 |
| staff-honorary | 2026-05-21 | 2026-06-25 |
| staff-honorary | 2026-06-13 | 2026-07-18 |
| staff-honorary | 2026-07-06 | 2026-08-10 |
| staff-honorary | 2026-07-29 | 2026-09-02 |
| staff-honorary | 2026-08-21 | 2026-09-25 |
| staff-honorary | 2026-09-13 | 2026-10-18 |
| staff-honorary | 2026-10-06 | 2026-11-10 |
| staff-honorary | 2026-10-29 | 2026-12-03 |
| staff-honorary | 2026-11-21 | 2026-12-26 |
| senior-basic | 2026-01-03 | 2026-01-24 |
| senior-basic | 2026-01-26 | 2026-02-16 |
| senior-basic | 2026-02-18 | 2026-03-11 |
| senior-basic | 2026-03-13 | 2026-04-03 |
| senior-basic | 2026-04-05 | 2026-04-26 |
| senior-basic | 2026-04-28 | 2026-05-19 |
| senior-basic | 2026-05-21 | 2026-06-11 |
| senior-basic | 2026-06-13 | 2026-07-04 |
| senior-basic | 2026-07-06 | 2026-07-27 |
| senior-basic | 2026-07-29 | 2026-08-19 |
| senior-basic | 2026-08-21 | 2026-09-11 |
| senior-basic | 2026-09-13 | 2026-10-04 |
| senior-basic | 2026-10-06 | 2026-10-27 |
| senior-basic | 2026-10-29 | 2026-11-19 |
| senior-basic | 2026-11-21 | 2026-12-12 |
| senior-plus | 2026-01-03 | 2026-01-31 |
| senior-plus | 2026-01-26 | 2026-02-23 |
| senior-plus | 2026-02-18 | 2026-03-18 |
| senior-plus | 2026-03-13 | 2026-04-10 |
| senior-plus | 2026-04-05 | 2026-05-03 |
| senior-plus | 2026-04-28 | 2026-05-26 |
| senior-plus | 2026-05-21 | 2026-06-18 |
| senior-plus | 2026-06-13 | 2026-07-11 |
| senior-plus | 2026-07-06 | 2026-08-03 |
| senior-plus | 2026-07-29 | 2026-08-26 |
| senior-plus | 2026-08-21 | 2026-09-18 |
| senior-plus | 2026-09-13 | 2026-10-11 |
| senior-plus | 2026-10-06 | 2026-11-03 |
| senior-plus | 2026-10-29 | 2026-11-26 |
| senior-plus | 2026-11-21 | 2026-12-19 |
| senior-silver | 2026-01-03 | 2026-02-07 |
| senior-silver | 2026-01-26 | 2026-03-02 |
| senior-silver | 2026-02-18 | 2026-03-25 |
| senior-silver | 2026-03-13 | 2026-04-17 |
| senior-silver | 2026-04-05 | 2026-05-10 |
| senior-silver | 2026-04-28 | 2026-06-02 |
| senior-silver | 2026-05-21 | 2026-06-25 |
| senior-silver | 2026-06-13 | 2026-07-18 |
| senior-silver | 2026-07-06 | 2026-08-10 |
| senior-silver | 2026-07-29 | 2026-09-02 |
| senior-silver | 2026-08-21 | 2026-09-25 |
| senior-silver | 2026-09-13 | 2026-10-18 |
| senior-silver | 2026-10-06 | 2026-11-10 |
| senior-silver | 2026-10-29 | 2026-12-03 |
| senior-silver | 2026-11-21 | 2026-12-26 |
| senior-gold | 2026-01-03 | 2026-02-14 |
| senior-gold | 2026-01-26 | 2026-03-09 |
| senior-gold | 2026-02-18 | 2026-04-01 |
| senior-gold | 2026-03-13 | 2026-04-24 |
| senior-gold | 2026-04-05 | 2026-05-17 |
| senior-gold | 2026-04-28 | 2026-06-09 |
| senior-gold | 2026-05-21 | 2026-07-02 |
| senior-gold | 2026-06-13 | 2026-07-25 |
| senior-gold | 2026-07-06 | 2026-08-17 |
| senior-gold | 2026-07-29 | 2026-09-09 |
| senior-gold | 2026-08-21 | 2026-10-02 |
| senior-gold | 2026-09-13 | 2026-10-25 |
| senior-gold | 2026-10-06 | 2026-11-17 |
| senior-gold | 2026-10-29 | 2026-12-10 |
| senior-gold | 2026-11-21 | 2027-01-02 |
| senior-platinum | 2026-01-03 | 2026-01-24 |
| senior-platinum | 2026-01-26 | 2026-02-16 |
| senior-platinum | 2026-02-18 | 2026-03-11 |
| senior-platinum | 2026-03-13 | 2026-04-03 |
| senior-platinum | 2026-04-05 | 2026-04-26 |
| senior-platinum | 2026-04-28 | 2026-05-19 |
| senior-platinum | 2026-05-21 | 2026-06-11 |
| senior-platinum | 2026-06-13 | 2026-07-04 |
| senior-platinum | 2026-07-06 | 2026-07-27 |
| senior-platinum | 2026-07-29 | 2026-08-19 |
| senior-platinum | 2026-08-21 | 2026-09-11 |
| senior-platinum | 2026-09-13 | 2026-10-04 |
| senior-platinum | 2026-10-06 | 2026-10-27 |
| senior-platinum | 2026-10-29 | 2026-11-19 |
| senior-platinum | 2026-11-21 | 2026-12-12 |
| senior-branch | 2026-01-03 | 2026-01-31 |
| senior-branch | 2026-01-26 | 2026-02-23 |
| senior-branch | 2026-02-18 | 2026-03-18 |
| senior-branch | 2026-03-13 | 2026-04-10 |
| senior-branch | 2026-04-05 | 2026-05-03 |
| senior-branch | 2026-04-28 | 2026-05-26 |
| senior-branch | 2026-05-21 | 2026-06-18 |
| senior-branch | 2026-06-13 | 2026-07-11 |
| senior-branch | 2026-07-06 | 2026-08-03 |
| senior-branch | 2026-07-29 | 2026-08-26 |
| senior-branch | 2026-08-21 | 2026-09-18 |
| senior-branch | 2026-09-13 | 2026-10-11 |
| senior-branch | 2026-10-06 | 2026-11-03 |
| senior-branch | 2026-10-29 | 2026-11-26 |
| senior-branch | 2026-11-21 | 2026-12-19 |
| senior-remote | 2026-01-03 | 2026-02-07 |
| senior-remote | 2026-01-26 | 2026-03-02 |
| senior-remote | 2026-02-18 | 2026-03-25 |
| senior-remote | 2026-03-13 | 2026-04-17 |
| senior-remote | 2026-04-05 | 2026-05-10 |
| senior-remote | 2026-04-28 | 2026-06-02 |
| senior-remote | 2026-05-21 | 2026-06-25 |
| senior-remote | 2026-06-13 | 2026-07-18 |
| senior-remote | 2026-07-06 | 2026-08-10 |
| senior-remote | 2026-07-29 | 2026-09-02 |
| senior-remote | 2026-08-21 | 2026-09-25 |
| senior-remote | 2026-09-13 | 2026-10-18 |
| senior-remote | 2026-10-06 | 2026-11-10 |
| senior-remote | 2026-10-29 | 2026-12-03 |
| senior-remote | 2026-11-21 | 2026-12-26 |
| senior-family | 2026-01-03 | 2026-02-14 |
| senior-family | 2026-01-26 | 2026-03-09 |
| senior-family | 2026-02-18 | 2026-04-01 |
| senior-family | 2026-03-13 | 2026-04-24 |
| senior-family | 2026-04-05 | 2026-05-17 |
| senior-family | 2026-04-28 | 2026-06-09 |
| senior-family | 2026-05-21 | 2026-07-02 |
| senior-family | 2026-06-13 | 2026-07-25 |
| senior-family | 2026-07-06 | 2026-08-17 |
| senior-family | 2026-07-29 | 2026-09-09 |
| senior-family | 2026-08-21 | 2026-10-02 |
| senior-family | 2026-09-13 | 2026-10-25 |
| senior-family | 2026-10-06 | 2026-11-17 |
| senior-family | 2026-10-29 | 2026-12-10 |
| senior-family | 2026-11-21 | 2027-01-02 |
| senior-trial | 2026-01-03 | 2026-01-24 |
| senior-trial | 2026-01-26 | 2026-02-16 |
| senior-trial | 2026-02-18 | 2026-03-11 |
| senior-trial | 2026-03-13 | 2026-04-03 |
| senior-trial | 2026-04-05 | 2026-04-26 |
| senior-trial | 2026-04-28 | 2026-05-19 |
| senior-trial | 2026-05-21 | 2026-06-11 |
| senior-trial | 2026-06-13 | 2026-07-04 |
| senior-trial | 2026-07-06 | 2026-07-27 |
| senior-trial | 2026-07-29 | 2026-08-19 |
| senior-trial | 2026-08-21 | 2026-09-11 |
| senior-trial | 2026-09-13 | 2026-10-04 |
| senior-trial | 2026-10-06 | 2026-10-27 |
| senior-trial | 2026-10-29 | 2026-11-19 |
| senior-trial | 2026-11-21 | 2026-12-12 |
| senior-honorary | 2026-01-03 | 2026-01-31 |
| senior-honorary | 2026-01-26 | 2026-02-23 |
| senior-honorary | 2026-02-18 | 2026-03-18 |
| senior-honorary | 2026-03-13 | 2026-04-10 |
| senior-honorary | 2026-04-05 | 2026-05-03 |
| senior-honorary | 2026-04-28 | 2026-05-26 |
| senior-honorary | 2026-05-21 | 2026-06-18 |
| senior-honorary | 2026-06-13 | 2026-07-11 |
| senior-honorary | 2026-07-06 | 2026-08-03 |
| senior-honorary | 2026-07-29 | 2026-08-26 |
| senior-honorary | 2026-08-21 | 2026-09-18 |
| senior-honorary | 2026-09-13 | 2026-10-11 |
| senior-honorary | 2026-10-06 | 2026-11-03 |
| senior-honorary | 2026-10-29 | 2026-11-26 |
| senior-honorary | 2026-11-21 | 2026-12-19 |
| child-basic | 2026-01-03 | 2026-01-10 |
| child-basic | 2026-01-26 | 2026-02-02 |
| child-basic | 2026-02-18 | 2026-02-25 |
| child-basic | 2026-03-13 | 2026-03-20 |
| child-basic | 2026-04-05 | 2026-04-12 |
| child-basic | 2026-04-28 | 2026-05-05 |
| child-basic | 2026-05-21 | 2026-05-28 |
| child-basic | 2026-06-13 | 2026-06-20 |
| child-basic | 2026-07-06 | 2026-07-13 |
| child-basic | 2026-07-29 | 2026-08-05 |
| child-basic | 2026-08-21 | 2026-08-28 |
| child-basic | 2026-09-13 | 2026-09-20 |
| child-basic | 2026-10-06 | 2026-10-13 |
| child-basic | 2026-10-29 | 2026-11-05 |
| child-basic | 2026-11-21 | 2026-11-28 |
| child-plus | 2026-01-03 | 2026-01-17 |
| child-plus | 2026-01-26 | 2026-02-09 |
| child-plus | 2026-02-18 | 2026-03-04 |
| child-plus | 2026-03-13 | 2026-03-27 |
| child-plus | 2026-04-05 | 2026-04-19 |
| child-plus | 2026-04-28 | 2026-05-12 |
| child-plus | 2026-05-21 | 2026-06-04 |
| child-plus | 2026-06-13 | 2026-06-27 |
| child-plus | 2026-07-06 | 2026-07-20 |
| child-plus | 2026-07-29 | 2026-08-12 |
| child-plus | 2026-08-21 | 2026-09-04 |
| child-plus | 2026-09-13 | 2026-09-27 |
| child-plus | 2026-10-06 | 2026-10-20 |
| child-plus | 2026-10-29 | 2026-11-12 |
| child-plus | 2026-11-21 | 2026-12-05 |
| child-silver | 2026-01-03 | 2026-01-24 |
| child-silver | 2026-01-26 | 2026-02-16 |
| child-silver | 2026-02-18 | 2026-03-11 |
| child-silver | 2026-03-13 | 2026-04-03 |
| child-silver | 2026-04-05 | 2026-04-26 |
| child-silver | 2026-04-28 | 2026-05-19 |
| child-silver | 2026-05-21 | 2026-06-11 |
| child-silver | 2026-06-13 | 2026-07-04 |
| child-silver | 2026-07-06 | 2026-07-27 |
| child-silver | 2026-07-29 | 2026-08-19 |
| child-silver | 2026-08-21 | 2026-09-11 |
| child-silver | 2026-09-13 | 2026-10-04 |
| child-silver | 2026-10-06 | 2026-10-27 |
| child-silver | 2026-10-29 | 2026-11-19 |
| child-silver | 2026-11-21 | 2026-12-12 |
| child-gold | 2026-01-03 | 2026-01-31 |
| child-gold | 2026-01-26 | 2026-02-23 |
| child-gold | 2026-02-18 | 2026-03-18 |
| child-gold | 2026-03-13 | 2026-04-10 |
| child-gold | 2026-04-05 | 2026-05-03 |
| child-gold | 2026-04-28 | 2026-05-26 |
| child-gold | 2026-05-21 | 2026-06-18 |
| child-gold | 2026-06-13 | 2026-07-11 |
| child-gold | 2026-07-06 | 2026-08-03 |
| child-gold | 2026-07-29 | 2026-08-26 |
| child-gold | 2026-08-21 | 2026-09-18 |
| child-gold | 2026-09-13 | 2026-10-11 |
| child-gold | 2026-10-06 | 2026-11-03 |
| child-gold | 2026-10-29 | 2026-11-26 |
| child-gold | 2026-11-21 | 2026-12-19 |
| child-platinum | 2026-01-03 | 2026-01-10 |
| child-platinum | 2026-01-26 | 2026-02-02 |
| child-platinum | 2026-02-18 | 2026-02-25 |
| child-platinum | 2026-03-13 | 2026-03-20 |
| child-platinum | 2026-04-05 | 2026-04-12 |
| child-platinum | 2026-04-28 | 2026-05-05 |
| child-platinum | 2026-05-21 | 2026-05-28 |
| child-platinum | 2026-06-13 | 2026-06-20 |
| child-platinum | 2026-07-06 | 2026-07-13 |
| child-platinum | 2026-07-29 | 2026-08-05 |
| child-platinum | 2026-08-21 | 2026-08-28 |
| child-platinum | 2026-09-13 | 2026-09-20 |
| child-platinum | 2026-10-06 | 2026-10-13 |
| child-platinum | 2026-10-29 | 2026-11-05 |
| child-platinum | 2026-11-21 | 2026-11-28 |
| child-branch | 2026-01-03 | 2026-01-17 |
| child-branch | 2026-01-26 | 2026-02-09 |
| child-branch | 2026-02-18 | 2026-03-04 |
| child-branch | 2026-03-13 | 2026-03-27 |
| child-branch | 2026-04-05 | 2026-04-19 |
| child-branch | 2026-04-28 | 2026-05-12 |
| child-branch | 2026-05-21 | 2026-06-04 |
| child-branch | 2026-06-13 | 2026-06-27 |
| child-branch | 2026-07-06 | 2026-07-20 |
| child-branch | 2026-07-29 | 2026-08-12 |
| child-branch | 2026-08-21 | 2026-09-04 |
| child-branch | 2026-09-13 | 2026-09-27 |
| child-branch | 2026-10-06 | 2026-10-20 |
| child-branch | 2026-10-29 | 2026-11-12 |
| child-branch | 2026-11-21 | 2026-12-05 |
| child-remote | 2026-01-03 | 2026-01-24 |
| child-remote | 2026-01-26 | 2026-02-16 |
| child-remote | 2026-02-18 | 2026-03-11 |
| child-remote | 2026-03-13 | 2026-04-03 |
| child-remote | 2026-04-05 | 2026-04-26 |
| child-remote | 2026-04-28 | 2026-05-19 |
| child-remote | 2026-05-21 | 2026-06-11 |
| child-remote | 2026-06-13 | 2026-07-04 |
| child-remote | 2026-07-06 | 2026-07-27 |
| child-remote | 2026-07-29 | 2026-08-19 |
| child-remote | 2026-08-21 | 2026-09-11 |
| child-remote | 2026-09-13 | 2026-10-04 |
| child-remote | 2026-10-06 | 2026-10-27 |
| child-remote | 2026-10-29 | 2026-11-19 |
| child-remote | 2026-11-21 | 2026-12-12 |
| child-family | 2026-01-03 | 2026-01-31 |
| child-family | 2026-01-26 | 2026-02-23 |
| child-family | 2026-02-18 | 2026-03-18 |
| child-family | 2026-03-13 | 2026-04-10 |
| child-family | 2026-04-05 | 2026-05-03 |
| child-family | 2026-04-28 | 2026-05-26 |
| child-family | 2026-05-21 | 2026-06-18 |
| child-family | 2026-06-13 | 2026-07-11 |
| child-family | 2026-07-06 | 2026-08-03 |
| child-family | 2026-07-29 | 2026-08-26 |
| child-family | 2026-08-21 | 2026-09-18 |
| child-family | 2026-09-13 | 2026-10-11 |
| child-family | 2026-10-06 | 2026-11-03 |
| child-family | 2026-10-29 | 2026-11-26 |
| child-family | 2026-11-21 | 2026-12-19 |
| child-trial | 2026-01-03 | 2026-01-10 |
| child-trial | 2026-01-26 | 2026-02-02 |
| child-trial | 2026-02-18 | 2026-02-25 |
| child-trial | 2026-03-13 | 2026-03-20 |
| child-trial | 2026-04-05 | 2026-04-12 |
| child-trial | 2026-04-28 | 2026-05-05 |
| child-trial | 2026-05-21 | 2026-05-28 |
| child-trial | 2026-06-13 | 2026-06-20 |
| child-trial | 2026-07-06 | 2026-07-13 |
| child-trial | 2026-07-29 | 2026-08-05 |
| child-trial | 2026-08-21 | 2026-08-28 |
| child-trial | 2026-09-13 | 2026-09-20 |
| child-trial | 2026-10-06 | 2026-10-13 |
| child-trial | 2026-10-29 | 2026-11-05 |
| child-trial | 2026-11-21 | 2026-11-28 |
| child-honorary | 2026-01-03 | 2026-01-17 |
| child-honorary | 2026-01-26 | 2026-02-09 |
| child-honorary | 2026-02-18 | 2026-03-04 |
| child-honorary | 2026-03-13 | 2026-03-27 |
| child-honorary | 2026-04-05 | 2026-04-19 |
| child-honorary | 2026-04-28 | 2026-05-12 |
| child-honorary | 2026-05-21 | 2026-06-04 |
| child-honorary | 2026-06-13 | 2026-06-27 |
| child-honorary | 2026-07-06 | 2026-07-20 |
| child-honorary | 2026-07-29 | 2026-08-12 |
| child-honorary | 2026-08-21 | 2026-09-04 |
| child-honorary | 2026-09-13 | 2026-09-27 |
| child-honorary | 2026-10-06 | 2026-10-20 |
| child-honorary | 2026-10-29 | 2026-11-12 |
| child-honorary | 2026-11-21 | 2026-12-05 |
| scholar-basic | 2026-01-03 | 2026-02-14 |
| scholar-basic | 2026-01-26 | 2026-03-09 |
| scholar-basic | 2026-02-18 | 2026-04-01 |
| scholar-basic | 2026-03-13 | 2026-04-24 |
| scholar-basic | 2026-04-05 | 2026-05-17 |
| scholar-basic | 2026-04-28 | 2026-06-09 |
| scholar-basic | 2026-05-21 | 2026-07-02 |
| scholar-basic | 2026-06-13 | 2026-07-25 |
| scholar-basic | 2026-07-06 | 2026-08-17 |
| scholar-basic | 2026-07-29 | 2026-09-09 |
| scholar-basic | 2026-08-21 | 2026-10-02 |
| scholar-basic | 2026-09-13 | 2026-10-25 |
| scholar-basic | 2026-10-06 | 2026-11-17 |
| scholar-basic | 2026-10-29 | 2026-12-10 |
| scholar-basic | 2026-11-21 | 2027-01-02 |
| scholar-plus | 2026-01-03 | 2026-02-21 |
| scholar-plus | 2026-01-26 | 2026-03-16 |
| scholar-plus | 2026-02-18 | 2026-04-08 |
| scholar-plus | 2026-03-13 | 2026-05-01 |
| scholar-plus | 2026-04-05 | 2026-05-24 |
| scholar-plus | 2026-04-28 | 2026-06-16 |
| scholar-plus | 2026-05-21 | 2026-07-09 |
| scholar-plus | 2026-06-13 | 2026-08-01 |
| scholar-plus | 2026-07-06 | 2026-08-24 |
| scholar-plus | 2026-07-29 | 2026-09-16 |
| scholar-plus | 2026-08-21 | 2026-10-09 |
| scholar-plus | 2026-09-13 | 2026-11-01 |
| scholar-plus | 2026-10-06 | 2026-11-24 |
| scholar-plus | 2026-10-29 | 2026-12-17 |
| scholar-plus | 2026-11-21 | 2027-01-09 |
| scholar-silver | 2026-01-03 | 2026-02-28 |
| scholar-silver | 2026-01-26 | 2026-03-23 |
| scholar-silver | 2026-02-18 | 2026-04-15 |
| scholar-silver | 2026-03-13 | 2026-05-08 |
| scholar-silver | 2026-04-05 | 2026-05-31 |
| scholar-silver | 2026-04-28 | 2026-06-23 |
| scholar-silver | 2026-05-21 | 2026-07-16 |
| scholar-silver | 2026-06-13 | 2026-08-08 |
| scholar-silver | 2026-07-06 | 2026-08-31 |
| scholar-silver | 2026-07-29 | 2026-09-23 |
| scholar-silver | 2026-08-21 | 2026-10-16 |
| scholar-silver | 2026-09-13 | 2026-11-08 |
| scholar-silver | 2026-10-06 | 2026-12-01 |
| scholar-silver | 2026-10-29 | 2026-12-24 |
| scholar-silver | 2026-11-21 | 2027-01-16 |
| scholar-gold | 2026-01-03 | 2026-03-07 |
| scholar-gold | 2026-01-26 | 2026-03-30 |
| scholar-gold | 2026-02-18 | 2026-04-22 |
| scholar-gold | 2026-03-13 | 2026-05-15 |
| scholar-gold | 2026-04-05 | 2026-06-07 |
| scholar-gold | 2026-04-28 | 2026-06-30 |
| scholar-gold | 2026-05-21 | 2026-07-23 |
| scholar-gold | 2026-06-13 | 2026-08-15 |
| scholar-gold | 2026-07-06 | 2026-09-07 |
| scholar-gold | 2026-07-29 | 2026-09-30 |
| scholar-gold | 2026-08-21 | 2026-10-23 |
| scholar-gold | 2026-09-13 | 2026-11-15 |
| scholar-gold | 2026-10-06 | 2026-12-08 |
| scholar-gold | 2026-10-29 | 2026-12-31 |
| scholar-gold | 2026-11-21 | 2027-01-23 |
| scholar-platinum | 2026-01-03 | 2026-02-14 |
| scholar-platinum | 2026-01-26 | 2026-03-09 |
| scholar-platinum | 2026-02-18 | 2026-04-01 |
| scholar-platinum | 2026-03-13 | 2026-04-24 |
| scholar-platinum | 2026-04-05 | 2026-05-17 |
| scholar-platinum | 2026-04-28 | 2026-06-09 |
| scholar-platinum | 2026-05-21 | 2026-07-02 |
| scholar-platinum | 2026-06-13 | 2026-07-25 |
| scholar-platinum | 2026-07-06 | 2026-08-17 |
| scholar-platinum | 2026-07-29 | 2026-09-09 |
| scholar-platinum | 2026-08-21 | 2026-10-02 |
| scholar-platinum | 2026-09-13 | 2026-10-25 |
| scholar-platinum | 2026-10-06 | 2026-11-17 |
| scholar-platinum | 2026-10-29 | 2026-12-10 |
| scholar-platinum | 2026-11-21 | 2027-01-02 |
| scholar-branch | 2026-01-03 | 2026-02-21 |
| scholar-branch | 2026-01-26 | 2026-03-16 |
| scholar-branch | 2026-02-18 | 2026-04-08 |
| scholar-branch | 2026-03-13 | 2026-05-01 |
| scholar-branch | 2026-04-05 | 2026-05-24 |
| scholar-branch | 2026-04-28 | 2026-06-16 |
| scholar-branch | 2026-05-21 | 2026-07-09 |
| scholar-branch | 2026-06-13 | 2026-08-01 |
| scholar-branch | 2026-07-06 | 2026-08-24 |
| scholar-branch | 2026-07-29 | 2026-09-16 |
| scholar-branch | 2026-08-21 | 2026-10-09 |
| scholar-branch | 2026-09-13 | 2026-11-01 |
| scholar-branch | 2026-10-06 | 2026-11-24 |
| scholar-branch | 2026-10-29 | 2026-12-17 |
| scholar-branch | 2026-11-21 | 2027-01-09 |
| scholar-remote | 2026-01-03 | 2026-02-28 |
| scholar-remote | 2026-01-26 | 2026-03-23 |
| scholar-remote | 2026-02-18 | 2026-04-15 |
| scholar-remote | 2026-03-13 | 2026-05-08 |
| scholar-remote | 2026-04-05 | 2026-05-31 |
| scholar-remote | 2026-04-28 | 2026-06-23 |
| scholar-remote | 2026-05-21 | 2026-07-16 |
| scholar-remote | 2026-06-13 | 2026-08-08 |
| scholar-remote | 2026-07-06 | 2026-08-31 |
| scholar-remote | 2026-07-29 | 2026-09-23 |
| scholar-remote | 2026-08-21 | 2026-10-16 |
| scholar-remote | 2026-09-13 | 2026-11-08 |
| scholar-remote | 2026-10-06 | 2026-12-01 |
| scholar-remote | 2026-10-29 | 2026-12-24 |
| scholar-remote | 2026-11-21 | 2027-01-16 |
| scholar-family | 2026-01-03 | 2026-03-07 |
| scholar-family | 2026-01-26 | 2026-03-30 |
| scholar-family | 2026-02-18 | 2026-04-22 |
| scholar-family | 2026-03-13 | 2026-05-15 |
| scholar-family | 2026-04-05 | 2026-06-07 |
| scholar-family | 2026-04-28 | 2026-06-30 |
| scholar-family | 2026-05-21 | 2026-07-23 |
| scholar-family | 2026-06-13 | 2026-08-15 |
| scholar-family | 2026-07-06 | 2026-09-07 |
| scholar-family | 2026-07-29 | 2026-09-30 |
| scholar-family | 2026-08-21 | 2026-10-23 |
| scholar-family | 2026-09-13 | 2026-11-15 |
| scholar-family | 2026-10-06 | 2026-12-08 |
| scholar-family | 2026-10-29 | 2026-12-31 |
| scholar-family | 2026-11-21 | 2027-01-23 |
| scholar-trial | 2026-01-03 | 2026-02-14 |
| scholar-trial | 2026-01-26 | 2026-03-09 |
| scholar-trial | 2026-02-18 | 2026-04-01 |
| scholar-trial | 2026-03-13 | 2026-04-24 |
| scholar-trial | 2026-04-05 | 2026-05-17 |
| scholar-trial | 2026-04-28 | 2026-06-09 |
| scholar-trial | 2026-05-21 | 2026-07-02 |
| scholar-trial | 2026-06-13 | 2026-07-25 |
| scholar-trial | 2026-07-06 | 2026-08-17 |
| scholar-trial | 2026-07-29 | 2026-09-09 |
| scholar-trial | 2026-08-21 | 2026-10-02 |
| scholar-trial | 2026-09-13 | 2026-10-25 |
| scholar-trial | 2026-10-06 | 2026-11-17 |
| scholar-trial | 2026-10-29 | 2026-12-10 |
| scholar-trial | 2026-11-21 | 2027-01-02 |
| scholar-honorary | 2026-01-03 | 2026-02-21 |
| scholar-honorary | 2026-01-26 | 2026-03-16 |
| scholar-honorary | 2026-02-18 | 2026-04-08 |
| scholar-honorary | 2026-03-13 | 2026-05-01 |
| scholar-honorary | 2026-04-05 | 2026-05-24 |
| scholar-honorary | 2026-04-28 | 2026-06-16 |
| scholar-honorary | 2026-05-21 | 2026-07-09 |
| scholar-honorary | 2026-06-13 | 2026-08-01 |
| scholar-honorary | 2026-07-06 | 2026-08-24 |
| scholar-honorary | 2026-07-29 | 2026-09-16 |
| scholar-honorary | 2026-08-21 | 2026-10-09 |
| scholar-honorary | 2026-09-13 | 2026-11-01 |
| scholar-honorary | 2026-10-06 | 2026-11-24 |
| scholar-honorary | 2026-10-29 | 2026-12-17 |
| scholar-honorary | 2026-11-21 | 2027-01-09 |

## Appendix D: worked scenarios

Each scenario starts from `createState` with the data files and runs the steps in order. "->" shows the result.

### D.1

- checkout b80 by m32 (staff-honorary) on 2026-03-13 -> ok
- reserve b80 by m61 -> ok
- return b80 on 2026-04-03 -> ok
- checkout b80 by m100 (scholar-gold) on 2026-04-07 -> ok
- fines: none
- overdue on 2026-05-07: none
- notices on 2026-04-07: none

### D.2

- checkout b28 by m3 (student-honorary) on 2026-04-05 -> ok
- reserve b28 by m23 -> ok
- return b28 on 2026-04-30 -> ok
- checkout b28 by m65 (child-branch) on 2026-05-04 -> ok
- fines: none
- overdue on 2026-06-03: b28/m65/16
- notices on 2026-05-04: none

### D.3

- checkout b119 by m41 (staff-family) on 2026-01-26 -> ok
- reserve b119 by m104 -> ok
- return b119 on 2026-01-27 -> ok
- checkout b119 by m2 (staff-remote) on 2026-01-31 -> ok
- fines: none
- overdue on 2026-03-02: none
- notices on 2026-01-31: none

### D.4

- checkout b239 by m101 (child-basic) on 2026-07-29 -> ok
- reserve b239 by m66 -> ok
- return b239 on 2026-08-09 -> ok
- checkout b239 by m9 (scholar-remote) on 2026-08-14 -> ok
- fines: m101 40c
- overdue on 2026-09-13: none
- notices on 2026-08-14: none

### D.5

- checkout b81 by m78 (student-platinum) on 2026-06-13 -> ok
- reserve b81 by m17 -> ok
- return b81 on 2026-07-21 -> ok
- checkout b81 by m34 (staff-silver) on 2026-07-26 -> ok
- fines: m78 390c
- overdue on 2026-08-25: none
- notices on 2026-07-26: none

### D.6

- checkout b112 by m99 (adult-honorary) on 2026-07-29 -> ok
- reserve b112 by m116 -> ok
- return b112 on 2026-08-13 -> ok
- checkout b112 by m47 (senior-gold) on 2026-08-16 -> error "held for another member"
- fines: none
- overdue on 2026-09-15: none
- notices on 2026-08-16: hold-ready m116 b112 until 2026-08-16

### D.7

- checkout b21 by m49 (student-family) on 2026-01-03 -> ok
- reserve b21 by m58 -> ok
- return b21 on 2026-01-28 -> ok
- checkout b21 by m16 (staff-platinum) on 2026-01-30 -> error "held for another member"
- fines: none
- overdue on 2026-03-01: none
- notices on 2026-01-30: hold-ready m58 b21 until 2026-01-31

### D.8

- checkout b261 by m82 (student-family) on 2026-08-21 -> ok
- reserve b261 by m19 -> ok
- return b261 on 2026-10-01 -> ok
- checkout b261 by m17 (senior-platinum) on 2026-10-03 -> error "held for another member"
- fines: none
- overdue on 2026-11-02: none
- notices on 2026-10-03: hold-ready m19 b261 until 2026-10-04

### D.9

- checkout b211 by m31 (student-basic) on 2026-04-05 -> ok
- reserve b211 by m35 -> ok
- return b211 on 2026-05-25 -> ok
- checkout b211 by m92 (staff-trial) on 2026-05-26 -> error "held for another member"
- fines: m31 260c
- overdue on 2026-06-25: none
- notices on 2026-05-26: hold-ready m35 b211 until 2026-05-28

### D.10

- checkout b221 by m68 (student-trial) on 2026-03-13 -> ok
- reserve b221 by m47 -> ok
- return b221 on 2026-03-21 -> ok
- checkout b221 by m25 (staff-basic) on 2026-03-23 -> error "held for another member"
- fines: none
- overdue on 2026-04-22: none
- notices on 2026-03-23: hold-ready m47 b221 until 2026-03-24

### D.11

- checkout b70 by m26 (adult-branch) on 2026-10-06 -> ok
- reserve b70 by m71 -> ok
- return b70 on 2026-11-22 -> ok
- checkout b70 by m80 (staff-platinum) on 2026-11-26 -> ok
- fines: m26 1000c
- overdue on 2026-12-26: b70/m80/2
- notices on 2026-11-26: none

### D.12

- checkout b11 by m5 (child-remote) on 2026-04-28 -> ok
- reserve b11 by m76 -> ok
- return b11 on 2026-05-16 -> ok
- checkout b11 by m46 (adult-gold) on 2026-05-18 -> error "held for another member"
- fines: none
- overdue on 2026-06-17: none
- notices on 2026-05-18: hold-ready m76 b11 until 2026-05-19

### D.13

- checkout b81 by m33 (child-honorary) on 2026-04-28 -> ok
- reserve b81 by m86 -> ok
- return b81 on 2026-06-21 -> ok
- checkout b81 by m45 (scholar-family) on 2026-06-22 -> error "held for another member"
- fines: m33 1000c
- overdue on 2026-07-22: none
- notices on 2026-06-22: hold-ready m86 b81 until 2026-06-24

### D.14

- checkout b87 by m50 (scholar-trial) on 2026-04-05 -> ok
- reserve b87 by m71 -> ok
- return b87 on 2026-05-04 -> ok
- checkout b87 by m29 (child-gold) on 2026-05-06 -> error "held for another member"
- fines: none
- overdue on 2026-06-05: none
- notices on 2026-05-06: hold-ready m71 b87 until 2026-05-07

### D.15

- checkout b136 by m38 (staff-honorary) on 2026-01-26 -> ok
- reserve b136 by m100 -> ok
- return b136 on 2026-02-20 -> ok
- checkout b136 by m116 (scholar-gold) on 2026-02-24 -> ok
- fines: none
- overdue on 2026-03-26: none
- notices on 2026-02-24: none

### D.16

- checkout b184 by m86 (student-honorary) on 2026-10-29 -> ok
- reserve b184 by m38 -> ok
- return b184 on 2026-12-02 -> ok
- checkout b184 by m98 (scholar-branch) on 2026-12-06 -> ok
- fines: m86 165c
- overdue on 2027-01-05: none
- notices on 2026-12-06: none

### D.17

- checkout b256 by m90 (staff-remote) on 2026-07-29 -> ok
- reserve b256 by m64 -> ok
- return b256 on 2026-08-30 -> ok
- checkout b256 by m7 (child-platinum) on 2026-09-03 -> ok
- fines: none
- overdue on 2026-10-03: b256/m7/23
- notices on 2026-09-03: none

### D.18

- checkout b123 by m94 (staff-remote) on 2026-10-29 -> ok
- reserve b123 by m7 -> ok
- return b123 on 2026-12-26 -> ok
- checkout b123 by m98 (scholar-branch) on 2026-12-31 -> ok
- fines: none
- overdue on 2027-01-30: none
- notices on 2026-12-31: none

### D.19

- checkout b195 by m96 (student-silver) on 2026-02-18 -> ok
- reserve b195 by m53 -> ok
- return b195 on 2026-03-21 -> ok
- checkout b195 by m17 (senior-platinum) on 2026-03-24 -> error "held for another member"
- fines: none
- overdue on 2026-04-23: none
- notices on 2026-03-24: hold-ready m53 b195 until 2026-03-24

### D.20

- checkout b94 by m59 (student-branch) on 2026-05-21 -> ok
- reserve b94 by m102 -> ok
- return b94 on 2026-07-14 -> ok
- checkout b94 by m14 (scholar-branch) on 2026-07-19 -> ok
- fines: m59 735c
- overdue on 2026-08-18: none
- notices on 2026-07-19: none

### D.21

- checkout b185 by m5 (child-remote) on 2026-01-26 -> ok
- reserve b185 by m115 -> ok
- return b185 on 2026-02-02 -> ok
- checkout b185 by m75 (adult-gold) on 2026-02-05 -> error "held for another member"
- fines: none
- overdue on 2026-03-07: none
- notices on 2026-02-05: hold-ready m115 b185 until 2026-02-05

### D.22

- checkout b26 by m104 (senior-silver) on 2026-07-06 -> ok
- reserve b26 by m66 -> ok
- return b26 on 2026-09-01 -> ok
- checkout b26 by m26 (adult-branch) on 2026-09-06 -> ok
- fines: m104 240c
- overdue on 2026-10-06: b26/m26/9
- notices on 2026-09-06: none

### D.23

- checkout b239 by m105 (student-gold) on 2026-03-13 -> ok
- reserve b239 by m92 -> ok
- return b239 on 2026-04-22 -> ok
- checkout b239 by m88 (scholar-basic) on 2026-04-25 -> error "held for another member"
- fines: none
- overdue on 2026-05-25: none
- notices on 2026-04-25: hold-ready m92 b239 until 2026-04-25

### D.24

- checkout b127 by m33 (child-honorary) on 2026-05-21 -> ok
- reserve b127 by m47 -> ok
- return b127 on 2026-06-03 -> ok
- checkout b127 by m51 (child-honorary) on 2026-06-06 -> error "held for another member"
- fines: none
- overdue on 2026-07-06: none
- notices on 2026-06-06: hold-ready m47 b127 until 2026-06-06

### D.25

- checkout b95 by m75 (adult-gold) on 2026-03-13 -> ok
- reserve b95 by m8 -> ok
- return b95 on 2026-04-07 -> ok
- checkout b95 by m79 (senior-trial) on 2026-04-08 -> error "held for another member"
- fines: none
- overdue on 2026-05-08: none
- notices on 2026-04-08: hold-ready m8 b95 until 2026-04-10

### D.26

- checkout b239 by m13 (adult-platinum) on 2026-05-21 -> ok
- reserve b239 by m67 -> ok
- return b239 on 2026-06-02 -> ok
- checkout b239 by m21 (staff-honorary) on 2026-06-06 -> ok
- fines: none
- overdue on 2026-07-06: none
- notices on 2026-06-06: none

### D.27

- checkout b6 by m97 (staff-platinum) on 2026-03-13 -> ok
- reserve b6 by m41 -> ok
- return b6 on 2026-05-06 -> ok
- checkout b6 by m36 (child-silver) on 2026-05-11 -> ok
- fines: none
- overdue on 2026-06-10: b6/m36/9
- notices on 2026-05-11: none

### D.28

- checkout b18 by m74 (student-silver) on 2026-04-28 -> ok
- reserve b18 by m53 -> ok
- return b18 on 2026-06-12 -> ok
- checkout b18 by m6 (student-gold) on 2026-06-17 -> ok
- fines: m74 100c
- overdue on 2026-07-17: none
- notices on 2026-06-17: none

### D.29

- checkout b140 by m53 (staff-family) on 2026-01-03 -> ok
- reserve b140 by m108 -> ok
- return b140 on 2026-02-01 -> ok
- checkout b140 by m81 (adult-remote) on 2026-02-02 -> error "held for another member"
- fines: none
- overdue on 2026-03-04: none
- notices on 2026-02-02: hold-ready m108 b140 until 2026-02-04

### D.30

- checkout b161 by m94 (staff-remote) on 2026-05-21 -> ok
- reserve b161 by m99 -> ok
- return b161 on 2026-06-23 -> ok
- checkout b161 by m3 (student-honorary) on 2026-06-26 -> error "held for another member"
- fines: none
- overdue on 2026-07-26: none
- notices on 2026-06-26: hold-ready m99 b161 until 2026-06-26

### D.31

- checkout b237 by m34 (staff-silver) on 2026-05-21 -> ok
- reserve b237 by m83 -> ok
- return b237 on 2026-07-13 -> ok
- checkout b237 by m43 (child-plus) on 2026-07-18 -> ok
- fines: none
- overdue on 2026-08-17: b237/m43/16
- notices on 2026-07-18: none

### D.32

- checkout b160 by m10 (student-honorary) on 2026-03-13 -> ok
- reserve b160 by m55 -> ok
- return b160 on 2026-04-22 -> ok
- checkout b160 by m67 (staff-honorary) on 2026-04-27 -> ok
- fines: m10 495c
- overdue on 2026-05-27: none
- notices on 2026-04-27: none

### D.33

- checkout b46 by m65 (child-branch) on 2026-08-21 -> ok
- reserve b46 by m16 -> ok
- return b46 on 2026-08-30 -> ok
- checkout b46 by m5 (child-remote) on 2026-09-02 -> error "held for another member"
- fines: none
- overdue on 2026-10-02: none
- notices on 2026-09-02: hold-ready m16 b46 until 2026-09-02

### D.34

- checkout b106 by m40 (child-branch) on 2026-10-06 -> ok
- reserve b106 by m116 -> ok
- return b106 on 2026-10-07 -> ok
- checkout b106 by m116 (scholar-gold) on 2026-10-12 -> ok
- fines: none
- overdue on 2026-11-11: none
- notices on 2026-10-12: none

### D.35

- checkout b104 by m16 (staff-platinum) on 2026-05-21 -> ok
- reserve b104 by m112 -> ok
- return b104 on 2026-06-06 -> ok
- checkout b104 by m75 (adult-gold) on 2026-06-07 -> error "held for another member"
- fines: none
- overdue on 2026-07-07: none
- notices on 2026-06-07: hold-ready m112 b104 until 2026-06-09

### D.36

- checkout b298 by m94 (staff-remote) on 2026-10-06 -> ok
- reserve b298 by m49 -> ok
- return b298 on 2026-11-06 -> ok
- checkout b298 by m54 (adult-honorary) on 2026-11-11 -> ok
- fines: none
- overdue on 2026-12-11: b298/m54/9
- notices on 2026-11-11: none

### D.37

- checkout b277 by m50 (scholar-trial) on 2026-03-13 -> ok
- reserve b277 by m34 -> ok
- return b277 on 2026-05-10 -> ok
- checkout b277 by m7 (child-platinum) on 2026-05-13 -> error "held for another member"
- fines: m50 630c
- overdue on 2026-06-12: none
- notices on 2026-05-13: hold-ready m34 b277 until 2026-05-13

### D.38

- checkout b289 by m110 (scholar-basic) on 2026-08-21 -> ok
- reserve b289 by m93 -> ok
- return b289 on 2026-09-08 -> ok
- checkout b289 by m30 (scholar-plus) on 2026-09-12 -> ok
- fines: none
- overdue on 2026-10-12: none
- notices on 2026-09-12: none

### D.39

- checkout b257 by m56 (scholar-basic) on 2026-04-05 -> ok
- reserve b257 by m97 -> ok
- return b257 on 2026-05-26 -> ok
- checkout b257 by m71 (senior-plus) on 2026-05-28 -> error "held for another member"
- fines: m56 100c
- overdue on 2026-06-27: none
- notices on 2026-05-28: hold-ready m97 b257 until 2026-05-29

### D.40

- checkout b8 by m25 (staff-basic) on 2026-07-06 -> ok
- reserve b8 by m15 -> ok
- return b8 on 2026-08-22 -> ok
- checkout b8 by m76 (scholar-honorary) on 2026-08-25 -> error "held for another member"
- fines: none
- overdue on 2026-09-24: none
- notices on 2026-08-25: hold-ready m15 b8 until 2026-08-25

### D.41

- checkout b106 by m59 (student-branch) on 2026-10-06 -> ok
- reserve b106 by m118 -> ok
- return b106 on 2026-10-12 -> ok
- checkout b106 by m26 (adult-branch) on 2026-10-14 -> error "held for another member"
- fines: none
- overdue on 2026-11-13: none
- notices on 2026-10-14: hold-ready m118 b106 until 2026-10-15

### D.42

- checkout b68 by m30 (scholar-plus) on 2026-04-28 -> ok
- reserve b68 by m64 -> ok
- return b68 on 2026-05-23 -> ok
- checkout b68 by m9 (scholar-remote) on 2026-05-24 -> error "held for another member"
- fines: none
- overdue on 2026-06-23: none
- notices on 2026-05-24: hold-ready m64 b68 until 2026-05-26

### D.43

- checkout b282 by m43 (child-plus) on 2026-11-21 -> ok
- reserve b282 by m57 -> ok
- return b282 on 2027-01-10 -> ok
- checkout b282 by m62 (student-remote) on 2027-01-15 -> ok
- fines: m43 200c
- overdue on 2027-02-14: none
- notices on 2027-01-15: none

### D.44

- checkout b162 by m16 (staff-platinum) on 2026-11-21 -> ok
- reserve b162 by m19 -> ok
- return b162 on 2026-12-09 -> ok
- checkout b162 by m64 (scholar-branch) on 2026-12-12 -> error "held for another member"
- fines: none
- overdue on 2027-01-11: none
- notices on 2026-12-12: hold-ready m19 b162 until 2026-12-12

### D.45

- checkout b124 by m39 (child-plus) on 2026-07-06 -> ok
- reserve b124 by m59 -> ok
- return b124 on 2026-08-06 -> ok
- checkout b124 by m93 (scholar-basic) on 2026-08-07 -> error "held for another member"
- fines: m39 200c
- overdue on 2026-09-06: none
- notices on 2026-08-07: hold-ready m59 b124 until 2026-08-09

### D.46

- checkout b66 by m65 (child-branch) on 2026-04-05 -> ok
- reserve b66 by m27 -> ok
- return b66 on 2026-04-23 -> ok
- checkout b66 by m110 (scholar-basic) on 2026-04-24 -> error "held for another member"
- fines: m65 70c
- overdue on 2026-05-24: none
- notices on 2026-04-24: hold-ready m27 b66 until 2026-04-26

### D.47

- checkout b9 by m82 (student-family) on 2026-03-13 -> ok
- reserve b9 by m3 -> ok
- return b9 on 2026-03-18 -> ok
- checkout b9 by m3 (student-honorary) on 2026-03-21 -> ok
- fines: none
- overdue on 2026-04-20: b9/m3/2
- notices on 2026-03-21: none

### D.48

- checkout b118 by m66 (student-basic) on 2026-11-21 -> ok
- reserve b118 by m42 -> ok
- return b118 on 2026-12-16 -> ok
- checkout b118 by m107 (senior-silver) on 2026-12-18 -> error "held for another member"
- fines: m66 10c
- overdue on 2027-01-17: none
- notices on 2026-12-18: hold-ready m42 b118 until 2026-12-19

### D.49

- checkout b237 by m75 (adult-gold) on 2026-02-18 -> ok
- reserve b237 by m118 -> ok
- return b237 on 2026-03-07 -> ok
- checkout b237 by m52 (scholar-honorary) on 2026-03-11 -> ok
- fines: none
- overdue on 2026-04-10: none
- notices on 2026-03-11: none

### D.50

- checkout b22 by m87 (senior-basic) on 2026-06-13 -> ok
- reserve b22 by m43 -> ok
- return b22 on 2026-08-10 -> ok
- checkout b22 by m24 (child-platinum) on 2026-08-11 -> error "held for another member"
- fines: m87 165c
- overdue on 2026-09-10: none
- notices on 2026-08-11: hold-ready m43 b22 until 2026-08-13

### D.51

- checkout b78 by m91 (student-silver) on 2026-07-06 -> ok
- reserve b78 by m69 -> ok
- return b78 on 2026-08-13 -> ok
- checkout b78 by m10 (student-honorary) on 2026-08-14 -> error "held for another member"
- fines: none
- overdue on 2026-09-13: none
- notices on 2026-08-14: hold-ready m69 b78 until 2026-08-16

### D.52

- checkout b146 by m74 (student-silver) on 2026-04-28 -> ok
- reserve b146 by m20 -> ok
- return b146 on 2026-06-16 -> ok
- checkout b146 by m18 (senior-plus) on 2026-06-20 -> ok
- fines: m74 180c
- overdue on 2026-07-20: b146/m18/2
- notices on 2026-06-20: none

### D.53

- checkout b173 by m22 (senior-honorary) on 2026-11-21 -> ok
- reserve b173 by m82 -> ok
- return b173 on 2026-11-30 -> ok
- checkout b173 by m21 (staff-honorary) on 2026-12-03 -> error "held for another member"
- fines: none
- overdue on 2027-01-02: none
- notices on 2026-12-03: hold-ready m82 b173 until 2026-12-03

### D.54

- checkout b128 by m110 (scholar-basic) on 2026-03-13 -> ok
- reserve b128 by m24 -> ok
- return b128 on 2026-04-16 -> ok
- checkout b128 by m69 (student-remote) on 2026-04-18 -> error "held for another member"
- fines: none
- overdue on 2026-05-18: none
- notices on 2026-04-18: hold-ready m24 b128 until 2026-04-19

### D.55

- checkout b108 by m8 (staff-plus) on 2026-05-21 -> ok
- reserve b108 by m16 -> ok
- return b108 on 2026-05-24 -> ok
- checkout b108 by m10 (student-honorary) on 2026-05-26 -> error "held for another member"
- fines: none
- overdue on 2026-06-25: none
- notices on 2026-05-26: hold-ready m16 b108 until 2026-05-27

### D.56

- checkout b270 by m98 (scholar-branch) on 2026-08-21 -> ok
- reserve b270 by m69 -> ok
- return b270 on 2026-09-11 -> ok
- checkout b270 by m72 (adult-family) on 2026-09-15 -> ok
- fines: none
- overdue on 2026-10-15: none
- notices on 2026-09-15: none

### D.57

- checkout b210 by m103 (student-trial) on 2026-11-21 -> ok
- reserve b210 by m79 -> ok
- return b210 on 2026-11-21 -> ok
- checkout b210 by m29 (child-gold) on 2026-11-24 -> error "held for another member"
- fines: none
- overdue on 2026-12-24: none
- notices on 2026-11-24: hold-ready m79 b210 until 2026-11-24

### D.58

- checkout b259 by m61 (adult-trial) on 2026-01-03 -> ok
- reserve b259 by m107 -> ok
- return b259 on 2026-02-02 -> ok
- checkout b259 by m64 (scholar-branch) on 2026-02-04 -> error "held for another member"
- fines: m61 780c
- overdue on 2026-03-06: none
- notices on 2026-02-04: hold-ready m107 b259 until 2026-02-05

### D.59

- checkout b278 by m98 (scholar-branch) on 2026-08-21 -> ok
- reserve b278 by m39 -> ok
- return b278 on 2026-09-01 -> ok
- checkout b278 by m70 (student-platinum) on 2026-09-04 -> error "held for another member"
- fines: none
- overdue on 2026-10-04: none
- notices on 2026-09-04: hold-ready m39 b278 until 2026-09-04

### D.60

- checkout b90 by m20 (senior-plus) on 2026-09-13 -> ok
- reserve b90 by m49 -> ok
- return b90 on 2026-10-07 -> ok
- checkout b90 by m74 (student-silver) on 2026-10-10 -> error "held for another member"
- fines: none
- overdue on 2026-11-09: none
- notices on 2026-10-10: hold-ready m49 b90 until 2026-10-10

### D.61

- checkout b246 by m8 (staff-plus) on 2026-01-03 -> ok
- reserve b246 by m47 -> ok
- return b246 on 2026-02-17 -> ok
- checkout b246 by m33 (child-honorary) on 2026-02-18 -> error "held for another member"
- fines: none
- overdue on 2026-03-20: none
- notices on 2026-02-18: hold-ready m47 b246 until 2026-02-20

### D.62

- checkout b242 by m25 (staff-basic) on 2026-09-13 -> ok
- reserve b242 by m91 -> ok
- return b242 on 2026-10-18 -> ok
- checkout b242 by m84 (senior-remote) on 2026-10-20 -> error "held for another member"
- fines: none
- overdue on 2026-11-19: none
- notices on 2026-10-20: hold-ready m91 b242 until 2026-10-21

### D.63

- checkout b267 by m71 (senior-plus) on 2026-11-21 -> ok
- reserve b267 by m66 -> ok
- return b267 on 2026-12-02 -> ok
- checkout b267 by m95 (scholar-trial) on 2026-12-05 -> error "held for another member"
- fines: none
- overdue on 2027-01-04: none
- notices on 2026-12-05: hold-ready m66 b267 until 2026-12-05

### D.64

- checkout b4 by m43 (child-plus) on 2026-07-06 -> ok
- reserve b4 by m92 -> ok
- return b4 on 2026-07-23 -> ok
- checkout b4 by m114 (scholar-honorary) on 2026-07-25 -> error "held for another member"
- fines: m43 30c
- overdue on 2026-08-24: none
- notices on 2026-07-25: hold-ready m92 b4 until 2026-07-26

### D.65

- checkout b259 by m69 (student-remote) on 2026-04-05 -> ok
- reserve b259 by m107 -> ok
- return b259 on 2026-06-02 -> ok
- checkout b259 by m102 (scholar-honorary) on 2026-06-04 -> error "held for another member"
- fines: m69 800c
- overdue on 2026-07-04: none
- notices on 2026-06-04: hold-ready m107 b259 until 2026-06-05

### D.66

- checkout b246 by m79 (senior-trial) on 2026-04-05 -> ok
- reserve b246 by m93 -> ok
- return b246 on 2026-05-28 -> ok
- checkout b246 by m11 (scholar-gold) on 2026-05-31 -> error "held for another member"
- fines: m79 1000c
- overdue on 2026-06-30: none
- notices on 2026-05-31: hold-ready m93 b246 until 2026-05-31

### D.67

- checkout b99 by m51 (child-honorary) on 2026-05-21 -> ok
- reserve b99 by m18 -> ok
- return b99 on 2026-06-02 -> ok
- checkout b99 by m70 (student-platinum) on 2026-06-05 -> error "held for another member"
- fines: none
- overdue on 2026-07-05: none
- notices on 2026-06-05: hold-ready m18 b99 until 2026-06-05

### D.68

- checkout b205 by m27 (scholar-plus) on 2026-10-29 -> ok
- reserve b205 by m27 -> error "already has it"
- return b205 on 2026-12-17 -> ok
- checkout b205 by m28 (student-silver) on 2026-12-22 -> ok
- fines: none
- overdue on 2027-01-21: none
- notices on 2026-12-22: none

### D.69

- checkout b243 by m50 (scholar-trial) on 2026-03-13 -> ok
- reserve b243 by m100 -> ok
- return b243 on 2026-04-07 -> ok
- checkout b243 by m25 (staff-basic) on 2026-04-09 -> error "held for another member"
- fines: none
- overdue on 2026-05-09: none
- notices on 2026-04-09: hold-ready m100 b243 until 2026-04-10

### D.70

- checkout b273 by m110 (scholar-basic) on 2026-02-18 -> ok
- reserve b273 by m23 -> ok
- return b273 on 2026-02-24 -> ok
- checkout b273 by m103 (student-trial) on 2026-02-28 -> ok
- fines: none
- overdue on 2026-03-30: b273/m103/9
- notices on 2026-02-28: none

### D.71

- checkout b146 by m95 (scholar-trial) on 2026-07-29 -> ok
- reserve b146 by m82 -> ok
- return b146 on 2026-08-23 -> ok
- checkout b146 by m42 (scholar-remote) on 2026-08-28 -> ok
- fines: none
- overdue on 2026-09-27: none
- notices on 2026-08-28: none

### D.72

- checkout b107 by m96 (student-silver) on 2026-04-28 -> ok
- reserve b107 by m50 -> ok
- return b107 on 2026-04-29 -> ok
- checkout b107 by m43 (child-plus) on 2026-05-03 -> ok
- fines: none
- overdue on 2026-06-02: b107/m43/16
- notices on 2026-05-03: none

### D.73

- checkout b173 by m78 (student-platinum) on 2026-08-21 -> ok
- reserve b173 by m27 -> ok
- return b173 on 2026-08-28 -> ok
- checkout b173 by m54 (adult-honorary) on 2026-09-01 -> ok
- fines: none
- overdue on 2026-10-01: b173/m54/9
- notices on 2026-09-01: none

### D.74

- checkout b241 by m55 (adult-plus) on 2026-05-21 -> ok
- reserve b241 by m18 -> ok
- return b241 on 2026-05-24 -> ok
- checkout b241 by m93 (scholar-basic) on 2026-05-28 -> ok
- fines: none
- overdue on 2026-06-27: none
- notices on 2026-05-28: none

### D.75

- checkout b131 by m88 (scholar-basic) on 2026-10-06 -> ok
- reserve b131 by m112 -> ok
- return b131 on 2026-10-09 -> ok
- checkout b131 by m99 (adult-honorary) on 2026-10-11 -> error "held for another member"
- fines: none
- overdue on 2026-11-10: none
- notices on 2026-10-11: hold-ready m112 b131 until 2026-10-12

### D.76

- checkout b107 by m80 (staff-platinum) on 2026-05-21 -> ok
- reserve b107 by m78 -> ok
- return b107 on 2026-06-11 -> ok
- checkout b107 by m87 (senior-basic) on 2026-06-13 -> error "held for another member"
- fines: none
- overdue on 2026-07-13: none
- notices on 2026-06-13: hold-ready m78 b107 until 2026-06-14

### D.77

- checkout b64 by m4 (senior-plus) on 2026-11-21 -> ok
- reserve b64 by m115 -> ok
- return b64 on 2026-12-21 -> ok
- checkout b64 by m79 (senior-trial) on 2026-12-25 -> ok
- fines: none
- overdue on 2027-01-24: b64/m79/9
- notices on 2026-12-25: none

### D.78

- checkout b240 by m47 (senior-gold) on 2026-04-28 -> ok
- reserve b240 by m84 -> ok
- return b240 on 2026-05-06 -> ok
- checkout b240 by m46 (adult-gold) on 2026-05-09 -> error "held for another member"
- fines: none
- overdue on 2026-06-08: none
- notices on 2026-05-09: hold-ready m84 b240 until 2026-05-09

### D.79

- checkout b264 by m46 (adult-gold) on 2026-02-18 -> ok
- reserve b264 by m13 -> ok
- return b264 on 2026-03-20 -> ok
- checkout b264 by m39 (child-plus) on 2026-03-23 -> error "held for another member"
- fines: none
- overdue on 2026-04-22: none
- notices on 2026-03-23: hold-ready m13 b264 until 2026-03-23

### D.80

- checkout b270 by m87 (senior-basic) on 2026-07-29 -> ok
- reserve b270 by m55 -> ok
- return b270 on 2026-08-25 -> ok
- checkout b270 by m76 (scholar-honorary) on 2026-08-30 -> ok
- fines: m87 10c
- overdue on 2026-09-29: none
- notices on 2026-08-30: none

### D.81

- checkout b158 by m51 (child-honorary) on 2026-05-21 -> ok
- reserve b158 by m2 -> ok
- return b158 on 2026-06-15 -> ok
- checkout b158 by m75 (adult-gold) on 2026-06-19 -> ok
- fines: m51 605c
- overdue on 2026-07-19: none
- notices on 2026-06-19: none

### D.82

- checkout b239 by m66 (student-basic) on 2026-05-21 -> ok
- reserve b239 by m19 -> ok
- return b239 on 2026-06-19 -> ok
- checkout b239 by m21 (staff-honorary) on 2026-06-23 -> ok
- fines: m66 50c
- overdue on 2026-07-23: none
- notices on 2026-06-23: none

### D.83

- checkout b79 by m89 (child-family) on 2026-03-13 -> ok
- reserve b79 by m80 -> ok
- return b79 on 2026-03-26 -> ok
- checkout b79 by m59 (student-branch) on 2026-03-31 -> ok
- fines: none
- overdue on 2026-04-30: b79/m59/2
- notices on 2026-03-31: none

### D.84

- checkout b140 by m66 (student-basic) on 2026-05-21 -> ok
- reserve b140 by m36 -> ok
- return b140 on 2026-06-13 -> ok
- checkout b140 by m63 (senior-family) on 2026-06-18 -> ok
- fines: none
- overdue on 2026-07-18: none
- notices on 2026-06-18: none

### D.85

- checkout b236 by m5 (child-remote) on 2026-07-29 -> ok
- reserve b236 by m29 -> ok
- return b236 on 2026-09-08 -> ok
- checkout b236 by m94 (staff-remote) on 2026-09-12 -> ok
- fines: m5 700c
- overdue on 2026-10-12: none
- notices on 2026-09-12: none

### D.86

- checkout b183 by m29 (child-gold) on 2026-07-06 -> ok
- reserve b183 by m115 -> ok
- return b183 on 2026-07-17 -> ok
- checkout b183 by m69 (student-remote) on 2026-07-18 -> error "held for another member"
- fines: none
- overdue on 2026-08-17: none
- notices on 2026-07-18: hold-ready m115 b183 until 2026-07-20

### D.87

- checkout b215 by m61 (adult-trial) on 2026-11-21 -> ok
- reserve b215 by m53 -> ok
- return b215 on 2026-12-30 -> ok
- checkout b215 by m33 (child-honorary) on 2027-01-01 -> error "held for another member"
- fines: m61 1300c
- overdue on 2027-01-31: none
- notices on 2027-01-01: hold-ready m53 b215 until 2027-01-02

### D.88

- checkout b160 by m56 (scholar-basic) on 2026-04-28 -> ok
- reserve b160 by m50 -> ok
- return b160 on 2026-05-25 -> ok
- checkout b160 by m61 (adult-trial) on 2026-05-29 -> ok
- fines: none
- overdue on 2026-06-28: b160/m61/16
- notices on 2026-05-29: none

### D.89

- checkout b300 by m119 (adult-branch) on 2026-10-06 -> ok
- reserve b300 by m112 -> ok
- return b300 on 2026-10-29 -> ok
- checkout b300 by m62 (student-remote) on 2026-11-03 -> ok
- fines: none
- overdue on 2026-12-03: none
- notices on 2026-11-03: none

### D.90

- checkout b197 by m7 (child-platinum) on 2026-07-29 -> ok
- reserve b197 by m116 -> ok
- return b197 on 2026-08-02 -> ok
- checkout b197 by m65 (child-branch) on 2026-08-04 -> error "held for another member"
- fines: none
- overdue on 2026-09-03: none
- notices on 2026-08-04: hold-ready m116 b197 until 2026-08-05

### D.91

- checkout b59 by m89 (child-family) on 2026-07-06 -> ok
- reserve b59 by m15 -> ok
- return b59 on 2026-08-12 -> ok
- checkout b59 by m99 (adult-honorary) on 2026-08-16 -> ok
- fines: m89 360c
- overdue on 2026-09-15: b59/m99/9
- notices on 2026-08-16: none

### D.92

- checkout b283 by m115 (adult-branch) on 2026-04-05 -> ok
- reserve b283 by m80 -> ok
- return b283 on 2026-04-30 -> ok
- checkout b283 by m46 (adult-gold) on 2026-05-03 -> error "held for another member"
- fines: none
- overdue on 2026-06-02: none
- notices on 2026-05-03: hold-ready m80 b283 until 2026-05-03

### D.93

- checkout b244 by m74 (student-silver) on 2026-09-13 -> ok
- reserve b244 by m95 -> ok
- return b244 on 2026-11-11 -> ok
- checkout b244 by m68 (student-trial) on 2026-11-14 -> error "held for another member"
- fines: m74 380c
- overdue on 2026-12-14: none
- notices on 2026-11-14: hold-ready m95 b244 until 2026-11-14

### D.94

- checkout b93 by m87 (senior-basic) on 2026-02-18 -> ok
- reserve b93 by m86 -> ok
- return b93 on 2026-02-26 -> ok
- checkout b93 by m119 (adult-branch) on 2026-03-02 -> ok
- fines: none
- overdue on 2026-04-01: b93/m119/9
- notices on 2026-03-02: none

### D.95

- checkout b66 by m15 (adult-trial) on 2026-05-21 -> ok
- reserve b66 by m87 -> ok
- return b66 on 2026-07-18 -> ok
- checkout b66 by m101 (child-basic) on 2026-07-21 -> error "held for another member"
- fines: m15 1300c
- overdue on 2026-08-20: none
- notices on 2026-07-21: hold-ready m87 b66 until 2026-07-21

### D.96

- checkout b271 by m114 (scholar-honorary) on 2026-01-03 -> ok
- reserve b271 by m103 -> ok
- return b271 on 2026-01-24 -> ok
- checkout b271 by m87 (senior-basic) on 2026-01-25 -> error "held for another member"
- fines: none
- overdue on 2026-02-24: none
- notices on 2026-01-25: hold-ready m103 b271 until 2026-01-27

### D.97

- checkout b16 by m106 (child-plus) on 2026-01-03 -> ok
- reserve b16 by m20 -> ok
- return b16 on 2026-01-29 -> ok
- checkout b16 by m69 (student-remote) on 2026-02-02 -> ok
- fines: m106 165c
- overdue on 2026-03-04: none
- notices on 2026-02-02: none

### D.98

- checkout b70 by m63 (senior-family) on 2026-11-21 -> ok
- reserve b70 by m39 -> ok
- return b70 on 2026-12-17 -> ok
- checkout b70 by m119 (adult-branch) on 2026-12-18 -> error "held for another member"
- fines: none
- overdue on 2027-01-17: none
- notices on 2026-12-18: hold-ready m39 b70 until 2026-12-20

### D.99

- checkout b204 by m100 (scholar-gold) on 2026-02-18 -> ok
- reserve b204 by m114 -> ok
- return b204 on 2026-03-25 -> ok
- checkout b204 by m67 (staff-honorary) on 2026-03-27 -> error "held for another member"
- fines: none
- overdue on 2026-04-26: none
- notices on 2026-03-27: hold-ready m114 b204 until 2026-03-28

### D.100

- checkout b233 by m76 (scholar-honorary) on 2026-05-21 -> ok
- reserve b233 by m82 -> ok
- return b233 on 2026-06-15 -> ok
- checkout b233 by m5 (child-remote) on 2026-06-18 -> error "held for another member"
- fines: none
- overdue on 2026-07-18: none
- notices on 2026-06-18: hold-ready m82 b233 until 2026-06-18

### D.101

- checkout b280 by m28 (student-silver) on 2026-02-18 -> ok
- reserve b280 by m34 -> ok
- return b280 on 2026-02-26 -> ok
- checkout b280 by m71 (senior-plus) on 2026-03-02 -> ok
- fines: none
- overdue on 2026-04-01: b280/m71/2
- notices on 2026-03-02: none

### D.102

- checkout b159 by m110 (scholar-basic) on 2026-03-13 -> ok
- reserve b159 by m71 -> ok
- return b159 on 2026-03-18 -> ok
- checkout b159 by m29 (child-gold) on 2026-03-22 -> ok
- fines: none
- overdue on 2026-04-21: b159/m29/2
- notices on 2026-03-22: none

### D.103

- checkout b73 by m31 (student-basic) on 2026-08-21 -> ok
- reserve b73 by m33 -> ok
- return b73 on 2026-08-22 -> ok
- checkout b73 by m83 (senior-gold) on 2026-08-25 -> error "held for another member"
- fines: none
- overdue on 2026-09-24: none
- notices on 2026-08-25: hold-ready m33 b73 until 2026-08-25

### D.104

- checkout b235 by m28 (student-silver) on 2026-11-21 -> ok
- reserve b235 by m90 -> ok
- return b235 on 2026-12-10 -> ok
- checkout b235 by m80 (staff-platinum) on 2026-12-12 -> error "held for another member"
- fines: none
- overdue on 2027-01-11: none
- notices on 2026-12-12: hold-ready m90 b235 until 2026-12-13

### D.105

- checkout b256 by m59 (student-branch) on 2026-05-21 -> ok
- reserve b256 by m89 -> ok
- return b256 on 2026-06-22 -> ok
- checkout b256 by m77 (student-silver) on 2026-06-27 -> ok
- fines: none
- overdue on 2026-07-27: none
- notices on 2026-06-27: none

### D.106

- checkout b248 by m89 (child-family) on 2026-01-03 -> ok
- reserve b248 by m64 -> ok
- return b248 on 2026-01-26 -> ok
- checkout b248 by m4 (senior-plus) on 2026-01-27 -> error "held for another member"
- fines: none
- overdue on 2026-02-26: none
- notices on 2026-01-27: hold-ready m64 b248 until 2026-01-29

### D.107

- checkout b234 by m39 (child-plus) on 2026-10-06 -> ok
- reserve b234 by m11 -> ok
- return b234 on 2026-10-29 -> ok
- checkout b234 by m90 (staff-remote) on 2026-11-01 -> error "held for another member"
- fines: m39 120c
- overdue on 2026-12-01: none
- notices on 2026-11-01: hold-ready m11 b234 until 2026-11-01

### D.108

- checkout b237 by m78 (student-platinum) on 2026-09-13 -> ok
- reserve b237 by m86 -> ok
- return b237 on 2026-09-14 -> ok
- checkout b237 by m51 (child-honorary) on 2026-09-18 -> ok
- fines: none
- overdue on 2026-10-18: b237/m51/16
- notices on 2026-09-18: none

### D.109

- checkout b58 by m81 (adult-remote) on 2026-01-26 -> ok
- reserve b58 by m58 -> ok
- return b58 on 2026-03-01 -> ok
- checkout b58 by m94 (staff-remote) on 2026-03-04 -> error "held for another member"
- fines: m81 220c
- overdue on 2026-04-03: none
- notices on 2026-03-04: hold-ready m58 b58 until 2026-03-04

### D.110

- checkout b291 by m101 (child-basic) on 2026-02-18 -> ok
- reserve b291 by m119 -> ok
- return b291 on 2026-04-17 -> ok
- checkout b291 by m40 (child-branch) on 2026-04-20 -> error "held for another member"
- fines: m101 100c
- overdue on 2026-05-20: none
- notices on 2026-04-20: hold-ready m119 b291 until 2026-04-20

### D.111

- checkout b53 by m82 (student-family) on 2026-05-21 -> ok
- reserve b53 by m90 -> ok
- return b53 on 2026-07-09 -> ok
- checkout b53 by m49 (student-family) on 2026-07-14 -> ok
- fines: m82 135c
- overdue on 2026-08-13: none
- notices on 2026-07-14: none

### D.112

- checkout b283 by m86 (student-honorary) on 2026-03-13 -> ok
- reserve b283 by m63 -> ok
- return b283 on 2026-04-01 -> ok
- checkout b283 by m87 (senior-basic) on 2026-04-04 -> error "held for another member"
- fines: none
- overdue on 2026-05-04: none
- notices on 2026-04-04: hold-ready m63 b283 until 2026-04-04

### D.113

- checkout b67 by m105 (student-gold) on 2026-04-05 -> ok
- reserve b67 by m63 -> ok
- return b67 on 2026-05-10 -> ok
- checkout b67 by m78 (student-platinum) on 2026-05-11 -> error "held for another member"
- fines: none
- overdue on 2026-06-10: none
- notices on 2026-05-11: hold-ready m63 b67 until 2026-05-13

### D.114

- checkout b32 by m97 (staff-platinum) on 2026-09-13 -> ok
- reserve b32 by m95 -> ok
- return b32 on 2026-10-10 -> ok
- checkout b32 by m33 (child-honorary) on 2026-10-12 -> error "held for another member"
- fines: none
- overdue on 2026-11-11: none
- notices on 2026-10-12: hold-ready m95 b32 until 2026-10-13

### D.115

- checkout b81 by m100 (scholar-gold) on 2026-09-13 -> ok
- reserve b81 by m35 -> ok
- return b81 on 2026-11-11 -> ok
- checkout b81 by m98 (scholar-branch) on 2026-11-13 -> error "held for another member"
- fines: none
- overdue on 2026-12-13: none
- notices on 2026-11-13: hold-ready m35 b81 until 2026-11-14

### D.116

- checkout b52 by m107 (senior-silver) on 2026-02-18 -> ok
- reserve b52 by m98 -> ok
- return b52 on 2026-03-04 -> ok
- checkout b52 by m96 (student-silver) on 2026-03-06 -> error "held for another member"
- fines: none
- overdue on 2026-04-05: none
- notices on 2026-03-06: hold-ready m98 b52 until 2026-03-07

### D.117

- checkout b110 by m58 (child-basic) on 2026-01-03 -> ok
- reserve b110 by m7 -> ok
- return b110 on 2026-02-07 -> ok
- checkout b110 by m9 (scholar-remote) on 2026-02-10 -> error "held for another member"
- fines: m58 100c
- overdue on 2026-03-12: none
- notices on 2026-02-10: hold-ready m7 b110 until 2026-02-10

### D.118

- checkout b235 by m32 (staff-honorary) on 2026-11-21 -> ok
- reserve b235 by m116 -> ok
- return b235 on 2026-12-08 -> ok
- checkout b235 by m1 (student-family) on 2026-12-12 -> ok
- fines: none
- overdue on 2027-01-11: none
- notices on 2026-12-12: none

### D.119

- checkout b147 by m104 (senior-silver) on 2026-11-21 -> ok
- reserve b147 by m9 -> ok
- return b147 on 2027-01-12 -> ok
- checkout b147 by m42 (scholar-remote) on 2027-01-17 -> ok
- fines: m104 165c
- overdue on 2027-02-16: none
- notices on 2027-01-17: none

### D.120

- checkout b288 by m107 (senior-silver) on 2026-04-28 -> ok
- reserve b288 by m115 -> ok
- return b288 on 2026-05-29 -> ok
- checkout b288 by m42 (scholar-remote) on 2026-06-02 -> ok
- fines: none
- overdue on 2026-07-02: none
- notices on 2026-06-02: none

### D.121

- checkout b149 by m25 (staff-basic) on 2026-10-06 -> ok
- reserve b149 by m26 -> ok
- return b149 on 2026-11-26 -> ok
- checkout b149 by m85 (adult-remote) on 2026-12-01 -> ok
- fines: none
- overdue on 2026-12-31: b149/m85/2
- notices on 2026-12-01: none

### D.122

- checkout b123 by m77 (student-silver) on 2026-04-05 -> ok
- reserve b123 by m3 -> ok
- return b123 on 2026-04-23 -> ok
- checkout b123 by m80 (staff-platinum) on 2026-04-27 -> ok
- fines: none
- overdue on 2026-05-27: b123/m80/2
- notices on 2026-04-27: none

### D.123

- checkout b62 by m98 (scholar-branch) on 2026-10-06 -> ok
- reserve b62 by m26 -> ok
- return b62 on 2026-10-28 -> ok
- checkout b62 by m14 (scholar-branch) on 2026-10-30 -> error "held for another member"
- fines: none
- overdue on 2026-11-29: none
- notices on 2026-10-30: hold-ready m26 b62 until 2026-10-31

### D.124

- checkout b94 by m38 (staff-honorary) on 2026-03-13 -> ok
- reserve b94 by m96 -> ok
- return b94 on 2026-04-25 -> ok
- checkout b94 by m66 (student-basic) on 2026-04-30 -> ok
- fines: none
- overdue on 2026-05-30: b94/m66/9
- notices on 2026-04-30: none

### D.125

- checkout b239 by m70 (student-platinum) on 2026-04-05 -> ok
- reserve b239 by m74 -> ok
- return b239 on 2026-05-12 -> ok
- checkout b239 by m8 (staff-plus) on 2026-05-14 -> error "held for another member"
- fines: m70 360c
- overdue on 2026-06-13: none
- notices on 2026-05-14: hold-ready m74 b239 until 2026-05-15

### D.126

- checkout b87 by m87 (senior-basic) on 2026-05-21 -> ok
- reserve b87 by m19 -> ok
- return b87 on 2026-06-28 -> ok
- checkout b87 by m91 (student-silver) on 2026-07-03 -> ok
- fines: m87 65c
- overdue on 2026-08-02: none
- notices on 2026-07-03: none

### D.127

- checkout b84 by m6 (student-gold) on 2026-11-21 -> ok
- reserve b84 by m104 -> ok
- return b84 on 2026-12-28 -> ok
- checkout b84 by m120 (staff-plus) on 2027-01-01 -> ok
- fines: none
- overdue on 2027-01-31: none
- notices on 2027-01-01: none

### D.128

- checkout b222 by m30 (scholar-plus) on 2026-06-13 -> ok
- reserve b222 by m68 -> ok
- return b222 on 2026-07-14 -> ok
- checkout b222 by m110 (scholar-basic) on 2026-07-19 -> ok
- fines: none
- overdue on 2026-08-18: none
- notices on 2026-07-19: none

### D.129

- checkout b267 by m102 (scholar-honorary) on 2026-01-03 -> ok
- reserve b267 by m72 -> ok
- return b267 on 2026-01-20 -> ok
- checkout b267 by m48 (adult-honorary) on 2026-01-21 -> error "held for another member"
- fines: none
- overdue on 2026-02-20: none
- notices on 2026-01-21: hold-ready m72 b267 until 2026-01-23

### D.130

- checkout b244 by m118 (child-basic) on 2026-10-06 -> ok
- reserve b244 by m45 -> ok
- return b244 on 2026-11-21 -> ok
- checkout b244 by m119 (adult-branch) on 2026-11-23 -> error "held for another member"
- fines: m118 100c
- overdue on 2026-12-23: none
- notices on 2026-11-23: hold-ready m45 b244 until 2026-11-24

### D.131

- checkout b94 by m24 (child-platinum) on 2026-01-03 -> ok
- reserve b94 by m67 -> ok
- return b94 on 2026-01-06 -> ok
- checkout b94 by m47 (senior-gold) on 2026-01-10 -> ok
- fines: none
- overdue on 2026-02-09: none
- notices on 2026-01-10: none

### D.132

- checkout b205 by m96 (student-silver) on 2026-10-29 -> ok
- reserve b205 by m88 -> ok
- return b205 on 2026-12-20 -> ok
- checkout b205 by m58 (child-basic) on 2026-12-25 -> ok
- fines: m96 240c
- overdue on 2027-01-24: b205/m58/23
- notices on 2026-12-25: none

### D.133

- checkout b270 by m40 (child-branch) on 2026-03-13 -> ok
- reserve b270 by m68 -> ok
- return b270 on 2026-04-24 -> ok
- checkout b270 by m22 (senior-honorary) on 2026-04-26 -> error "held for another member"
- fines: m40 600c
- overdue on 2026-05-26: none
- notices on 2026-04-26: hold-ready m68 b270 until 2026-04-27

### D.134

- checkout b227 by m94 (staff-remote) on 2026-07-29 -> ok
- reserve b227 by m86 -> ok
- return b227 on 2026-09-20 -> ok
- checkout b227 by m26 (adult-branch) on 2026-09-22 -> error "held for another member"
- fines: none
- overdue on 2026-10-22: none
- notices on 2026-09-22: hold-ready m86 b227 until 2026-09-23

### D.135

- checkout b68 by m68 (student-trial) on 2026-03-13 -> ok
- reserve b68 by m111 -> ok
- return b68 on 2026-03-31 -> ok
- checkout b68 by m71 (senior-plus) on 2026-04-03 -> error "held for another member"
- fines: none
- overdue on 2026-05-03: none
- notices on 2026-04-03: hold-ready m111 b68 until 2026-04-03

### D.136

- checkout b57 by m12 (scholar-plus) on 2026-06-13 -> ok
- reserve b57 by m32 -> ok
- return b57 on 2026-06-15 -> ok
- checkout b57 by m11 (scholar-gold) on 2026-06-20 -> ok
- fines: none
- overdue on 2026-07-20: none
- notices on 2026-06-20: none

### D.137

- checkout b241 by m40 (child-branch) on 2026-10-06 -> ok
- reserve b241 by m41 -> ok
- return b241 on 2026-11-14 -> ok
- checkout b241 by m80 (staff-platinum) on 2026-11-17 -> error "held for another member"
- fines: m40 600c
- overdue on 2026-12-17: none
- notices on 2026-11-17: hold-ready m41 b241 until 2026-11-17

### D.138

- checkout b121 by m37 (student-silver) on 2026-05-21 -> ok
- reserve b121 by m57 -> ok
- return b121 on 2026-06-21 -> ok
- checkout b121 by m7 (child-platinum) on 2026-06-26 -> ok
- fines: none
- overdue on 2026-07-26: b121/m7/23
- notices on 2026-06-26: none

### D.139

- checkout b154 by m118 (child-basic) on 2026-03-13 -> ok
- reserve b154 by m84 -> ok
- return b154 on 2026-05-06 -> ok
- checkout b154 by m114 (scholar-honorary) on 2026-05-07 -> error "held for another member"
- fines: m118 100c
- overdue on 2026-06-06: none
- notices on 2026-05-07: hold-ready m84 b154 until 2026-05-09

### D.140

- checkout b264 by m99 (adult-honorary) on 2026-04-05 -> ok
- reserve b264 by m109 -> ok
- return b264 on 2026-04-05 -> ok
- checkout b264 by m87 (senior-basic) on 2026-04-07 -> error "held for another member"
- fines: none
- overdue on 2026-05-07: none
- notices on 2026-04-07: hold-ready m109 b264 until 2026-04-08

### D.141

- checkout b66 by m15 (adult-trial) on 2026-07-06 -> ok
- reserve b66 by m9 -> ok
- return b66 on 2026-08-05 -> ok
- checkout b66 by m17 (senior-platinum) on 2026-08-06 -> error "held for another member"
- fines: m15 780c
- overdue on 2026-09-05: none
- notices on 2026-08-06: hold-ready m9 b66 until 2026-08-08

### D.142

- checkout b235 by m73 (student-branch) on 2026-11-21 -> ok
- reserve b235 by m57 -> ok
- return b235 on 2027-01-02 -> ok
- checkout b235 by m5 (child-remote) on 2027-01-06 -> ok
- fines: m73 315c
- overdue on 2027-02-05: b235/m5/9
- notices on 2027-01-06: none

### D.143

- checkout b84 by m72 (adult-family) on 2026-01-26 -> ok
- reserve b84 by m22 -> ok
- return b84 on 2026-02-07 -> ok
- checkout b84 by m58 (child-basic) on 2026-02-10 -> error "held for another member"
- fines: none
- overdue on 2026-03-12: none
- notices on 2026-02-10: hold-ready m22 b84 until 2026-02-10

### D.144

- checkout b145 by m46 (adult-gold) on 2026-11-21 -> ok
- reserve b145 by m40 -> ok
- return b145 on 2026-12-10 -> ok
- checkout b145 by m24 (child-platinum) on 2026-12-15 -> ok
- fines: none
- overdue on 2027-01-14: b145/m24/23
- notices on 2026-12-15: none

### D.145

- checkout b10 by m2 (staff-remote) on 2026-07-06 -> ok
- reserve b10 by m119 -> ok
- return b10 on 2026-08-10 -> ok
- checkout b10 by m86 (student-honorary) on 2026-08-13 -> error "held for another member"
- fines: none
- overdue on 2026-09-12: none
- notices on 2026-08-13: hold-ready m119 b10 until 2026-08-13

### D.146

- checkout b63 by m59 (student-branch) on 2026-04-28 -> ok
- reserve b63 by m39 -> ok
- return b63 on 2026-06-12 -> ok
- checkout b63 by m9 (scholar-remote) on 2026-06-13 -> error "held for another member"
- fines: m59 420c
- overdue on 2026-07-13: none
- notices on 2026-06-13: hold-ready m39 b63 until 2026-06-15

### D.147

- checkout b110 by m20 (senior-plus) on 2026-07-06 -> ok
- reserve b110 by m23 -> ok
- return b110 on 2026-08-20 -> ok
- checkout b110 by m5 (child-remote) on 2026-08-21 -> error "held for another member"
- fines: m20 120c
- overdue on 2026-09-20: none
- notices on 2026-08-21: hold-ready m23 b110 until 2026-08-23

### D.148

- checkout b228 by m68 (student-trial) on 2026-04-05 -> ok
- reserve b228 by m53 -> ok
- return b228 on 2026-05-30 -> ok
- checkout b228 by m12 (scholar-plus) on 2026-06-03 -> ok
- fines: m68 1100c
- overdue on 2026-07-03: none
- notices on 2026-06-03: none

### D.149

- checkout b69 by m33 (child-honorary) on 2026-11-21 -> ok
- reserve b69 by m49 -> ok
- return b69 on 2026-12-07 -> ok
- checkout b69 by m98 (scholar-branch) on 2026-12-08 -> error "held for another member"
- fines: m33 110c
- overdue on 2027-01-07: none
- notices on 2026-12-08: hold-ready m49 b69 until 2026-12-10

### D.150

- checkout b60 by m100 (scholar-gold) on 2026-07-29 -> ok
- reserve b60 by m25 -> ok
- return b60 on 2026-09-12 -> ok
- checkout b60 by m6 (student-gold) on 2026-09-16 -> ok
- fines: none
- overdue on 2026-10-16: none
- notices on 2026-09-16: none

### D.151

- checkout b261 by m57 (student-plus) on 2026-07-06 -> ok
- reserve b261 by m109 -> ok
- return b261 on 2026-07-28 -> ok
- checkout b261 by m7 (child-platinum) on 2026-07-31 -> error "held for another member"
- fines: none
- overdue on 2026-08-30: none
- notices on 2026-07-31: hold-ready m109 b261 until 2026-07-31

### D.152

- checkout b3 by m45 (scholar-family) on 2026-09-13 -> ok
- reserve b3 by m103 -> ok
- return b3 on 2026-09-21 -> ok
- checkout b3 by m27 (scholar-plus) on 2026-09-26 -> ok
- fines: none
- overdue on 2026-10-26: none
- notices on 2026-09-26: none

### D.153

- checkout b26 by m33 (child-honorary) on 2026-11-21 -> ok
- reserve b26 by m94 -> ok
- return b26 on 2026-12-24 -> ok
- checkout b26 by m69 (student-remote) on 2026-12-26 -> error "held for another member"
- fines: m33 1000c
- overdue on 2027-01-25: none
- notices on 2026-12-26: hold-ready m94 b26 until 2026-12-27

### D.154

- checkout b193 by m2 (staff-remote) on 2026-05-21 -> ok
- reserve b193 by m65 -> ok
- return b193 on 2026-06-19 -> ok
- checkout b193 by m50 (scholar-trial) on 2026-06-24 -> ok
- fines: none
- overdue on 2026-07-24: none
- notices on 2026-06-24: none

### D.155

- checkout b293 by m108 (scholar-family) on 2026-10-06 -> ok
- reserve b293 by m120 -> ok
- return b293 on 2026-10-12 -> ok
- checkout b293 by m73 (student-branch) on 2026-10-13 -> error "held for another member"
- fines: none
- overdue on 2026-11-12: none
- notices on 2026-10-13: hold-ready m120 b293 until 2026-10-15

### D.156

- checkout b157 by m23 (child-plus) on 2026-07-29 -> ok
- reserve b157 by m57 -> ok
- return b157 on 2026-08-09 -> ok
- checkout b157 by m19 (senior-silver) on 2026-08-10 -> error "held for another member"
- fines: none
- overdue on 2026-09-09: none
- notices on 2026-08-10: hold-ready m57 b157 until 2026-08-12

### D.157

- checkout b19 by m106 (child-plus) on 2026-07-29 -> ok
- reserve b19 by m118 -> ok
- return b19 on 2026-08-05 -> ok
- checkout b19 by m70 (student-platinum) on 2026-08-09 -> ok
- fines: none
- overdue on 2026-09-08: b19/m70/9
- notices on 2026-08-09: none

### D.158

- checkout b127 by m77 (student-silver) on 2026-01-03 -> ok
- reserve b127 by m8 -> ok
- return b127 on 2026-02-15 -> ok
- checkout b127 by m62 (student-remote) on 2026-02-19 -> ok
- fines: m77 60c
- overdue on 2026-03-21: none
- notices on 2026-02-19: none

### D.159

- checkout b192 by m113 (student-plus) on 2026-09-13 -> ok
- reserve b192 by m70 -> ok
- return b192 on 2026-09-19 -> ok
- checkout b192 by m98 (scholar-branch) on 2026-09-22 -> error "held for another member"
- fines: none
- overdue on 2026-10-22: none
- notices on 2026-09-22: hold-ready m70 b192 until 2026-09-22

### D.160

- checkout b247 by m56 (scholar-basic) on 2026-08-21 -> ok
- reserve b247 by m107 -> ok
- return b247 on 2026-09-01 -> ok
- checkout b247 by m47 (senior-gold) on 2026-09-04 -> error "held for another member"
- fines: none
- overdue on 2026-10-04: none
- notices on 2026-09-04: hold-ready m107 b247 until 2026-09-04

### D.161

- checkout b126 by m108 (scholar-family) on 2026-10-06 -> ok
- reserve b126 by m6 -> ok
- return b126 on 2026-11-05 -> ok
- checkout b126 by m51 (child-honorary) on 2026-11-06 -> error "held for another member"
- fines: none
- overdue on 2026-12-06: none
- notices on 2026-11-06: hold-ready m6 b126 until 2026-11-08

### D.162

- checkout b300 by m4 (senior-plus) on 2026-02-18 -> ok
- reserve b300 by m108 -> ok
- return b300 on 2026-03-23 -> ok
- checkout b300 by m61 (adult-trial) on 2026-03-27 -> ok
- fines: none
- overdue on 2026-04-26: b300/m61/16
- notices on 2026-03-27: none

### D.163

- checkout b48 by m7 (child-platinum) on 2026-04-28 -> ok
- reserve b48 by m6 -> ok
- return b48 on 2026-05-15 -> ok
- checkout b48 by m58 (child-basic) on 2026-05-20 -> ok
- fines: m7 270c
- overdue on 2026-06-19: b48/m58/23
- notices on 2026-05-20: none

### D.164

- checkout b209 by m56 (scholar-basic) on 2026-03-13 -> ok
- reserve b209 by m79 -> ok
- return b209 on 2026-04-02 -> ok
- checkout b209 by m52 (scholar-honorary) on 2026-04-03 -> error "held for another member"
- fines: none
- overdue on 2026-05-03: none
- notices on 2026-04-03: hold-ready m79 b209 until 2026-04-05

### D.165

- checkout b73 by m45 (scholar-family) on 2026-01-26 -> ok
- reserve b73 by m94 -> ok
- return b73 on 2026-02-17 -> ok
- checkout b73 by m42 (scholar-remote) on 2026-02-22 -> ok
- fines: none
- overdue on 2026-03-24: none
- notices on 2026-02-22: none

### D.166

- checkout b241 by m105 (student-gold) on 2026-07-29 -> ok
- reserve b241 by m84 -> ok
- return b241 on 2026-09-17 -> ok
- checkout b241 by m6 (student-gold) on 2026-09-21 -> ok
- fines: m105 125c
- overdue on 2026-10-21: none
- notices on 2026-09-21: none

### D.167

- checkout b25 by m42 (scholar-remote) on 2026-05-21 -> ok
- reserve b25 by m60 -> ok
- return b25 on 2026-06-28 -> ok
- checkout b25 by m83 (senior-gold) on 2026-07-03 -> ok
- fines: none
- overdue on 2026-08-02: none
- notices on 2026-07-03: none

### D.168

- checkout b267 by m72 (adult-family) on 2026-04-28 -> ok
- reserve b267 by m52 -> ok
- return b267 on 2026-06-15 -> ok
- checkout b267 by m92 (staff-trial) on 2026-06-17 -> error "held for another member"
- fines: m72 600c
- overdue on 2026-07-17: none
- notices on 2026-06-17: hold-ready m52 b267 until 2026-06-18

### D.169

- checkout b219 by m117 (student-branch) on 2026-11-21 -> ok
- reserve b219 by m25 -> ok
- return b219 on 2026-12-22 -> ok
- checkout b219 by m82 (student-family) on 2026-12-23 -> error "held for another member"
- fines: none
- overdue on 2027-01-22: none
- notices on 2026-12-23: hold-ready m25 b219 until 2026-12-25

### D.170

- checkout b209 by m58 (child-basic) on 2026-10-06 -> ok
- reserve b209 by m71 -> ok
- return b209 on 2026-11-02 -> ok
- checkout b209 by m79 (senior-trial) on 2026-11-04 -> error "held for another member"
- fines: m58 100c
- overdue on 2026-12-04: none
- notices on 2026-11-04: hold-ready m71 b209 until 2026-11-05

### D.171

- checkout b252 by m67 (staff-honorary) on 2026-01-26 -> ok
- reserve b252 by m45 -> ok
- return b252 on 2026-03-18 -> ok
- checkout b252 by m76 (scholar-honorary) on 2026-03-20 -> error "held for another member"
- fines: none
- overdue on 2026-04-19: none
- notices on 2026-03-20: hold-ready m45 b252 until 2026-03-21

### D.172

- checkout b146 by m118 (child-basic) on 2026-10-29 -> ok
- reserve b146 by m108 -> ok
- return b146 on 2026-11-23 -> ok
- checkout b146 by m17 (senior-platinum) on 2026-11-24 -> error "held for another member"
- fines: m118 100c
- overdue on 2026-12-24: none
- notices on 2026-11-24: hold-ready m108 b146 until 2026-11-26

### D.173

- checkout b104 by m40 (child-branch) on 2026-10-06 -> ok
- reserve b104 by m92 -> ok
- return b104 on 2026-10-11 -> ok
- checkout b104 by m60 (staff-platinum) on 2026-10-13 -> error "held for another member"
- fines: none
- overdue on 2026-11-12: none
- notices on 2026-10-13: hold-ready m92 b104 until 2026-10-14

### D.174

- checkout b294 by m23 (child-plus) on 2026-05-21 -> ok
- reserve b294 by m70 -> ok
- return b294 on 2026-06-23 -> ok
- checkout b294 by m118 (child-basic) on 2026-06-27 -> ok
- fines: m23 200c
- overdue on 2026-07-27: b294/m118/23
- notices on 2026-06-27: none

### D.175

- checkout b153 by m22 (senior-honorary) on 2026-07-29 -> ok
- reserve b153 by m40 -> ok
- return b153 on 2026-09-21 -> ok
- checkout b153 by m113 (student-plus) on 2026-09-23 -> error "held for another member"
- fines: m22 1100c
- overdue on 2026-10-23: none
- notices on 2026-09-23: hold-ready m40 b153 until 2026-09-24

### D.176

- checkout b136 by m68 (student-trial) on 2026-06-13 -> ok
- reserve b136 by m92 -> ok
- return b136 on 2026-08-08 -> ok
- checkout b136 by m61 (adult-trial) on 2026-08-10 -> error "held for another member"
- fines: m68 1100c
- overdue on 2026-09-09: none
- notices on 2026-08-10: hold-ready m92 b136 until 2026-08-11

### D.177

- checkout b151 by m45 (scholar-family) on 2026-06-13 -> ok
- reserve b151 by m29 -> ok
- return b151 on 2026-06-29 -> ok
- checkout b151 by m35 (student-basic) on 2026-07-04 -> ok
- fines: none
- overdue on 2026-08-03: b151/m35/9
- notices on 2026-07-04: none

### D.178

- checkout b296 by m33 (child-honorary) on 2026-01-03 -> ok
- reserve b296 by m90 -> ok
- return b296 on 2026-01-28 -> ok
- checkout b296 by m57 (student-plus) on 2026-01-31 -> error "held for another member"
- fines: m33 605c
- overdue on 2026-03-02: none
- notices on 2026-01-31: hold-ready m90 b296 until 2026-01-31

### D.179

- checkout b161 by m113 (student-plus) on 2026-05-21 -> ok
- reserve b161 by m83 -> ok
- return b161 on 2026-06-12 -> ok
- checkout b161 by m22 (senior-honorary) on 2026-06-17 -> ok
- fines: none
- overdue on 2026-07-17: b161/m22/2
- notices on 2026-06-17: none

### D.180

- checkout b255 by m33 (child-honorary) on 2026-10-29 -> ok
- reserve b255 by m88 -> ok
- return b255 on 2026-12-11 -> ok
- checkout b255 by m1 (student-family) on 2026-12-14 -> error "held for another member"
- fines: m33 1000c
- overdue on 2027-01-13: none
- notices on 2026-12-14: hold-ready m88 b255 until 2026-12-14

### D.181

- checkout b92 by m93 (scholar-basic) on 2026-01-03 -> ok
- reserve b92 by m64 -> ok
- return b92 on 2026-02-06 -> ok
- checkout b92 by m40 (child-branch) on 2026-02-09 -> error "held for another member"
- fines: none
- overdue on 2026-03-11: none
- notices on 2026-02-09: hold-ready m64 b92 until 2026-02-09

### D.182

- checkout b72 by m110 (scholar-basic) on 2026-10-29 -> ok
- reserve b72 by m58 -> ok
- return b72 on 2026-11-11 -> ok
- checkout b72 by m90 (staff-remote) on 2026-11-14 -> error "held for another member"
- fines: none
- overdue on 2026-12-14: none
- notices on 2026-11-14: hold-ready m58 b72 until 2026-11-14

### D.183

- checkout b218 by m8 (staff-plus) on 2026-03-13 -> ok
- reserve b218 by m15 -> ok
- return b218 on 2026-03-21 -> ok
- checkout b218 by m69 (student-remote) on 2026-03-25 -> ok
- fines: none
- overdue on 2026-04-24: none
- notices on 2026-03-25: none

### D.184

- checkout b4 by m108 (scholar-family) on 2026-02-18 -> ok
- reserve b4 by m104 -> ok
- return b4 on 2026-04-18 -> ok
- checkout b4 by m72 (adult-family) on 2026-04-20 -> error "held for another member"
- fines: none
- overdue on 2026-05-20: none
- notices on 2026-04-20: hold-ready m104 b4 until 2026-04-21

### D.185

- checkout b264 by m86 (student-honorary) on 2026-07-29 -> ok
- reserve b264 by m40 -> ok
- return b264 on 2026-09-14 -> ok
- checkout b264 by m61 (adult-trial) on 2026-09-16 -> error "held for another member"
- fines: m86 880c
- overdue on 2026-10-16: none
- notices on 2026-09-16: hold-ready m40 b264 until 2026-09-17

### D.186

- checkout b53 by m118 (child-basic) on 2026-04-28 -> ok
- reserve b53 by m14 -> ok
- return b53 on 2026-06-12 -> ok
- checkout b53 by m30 (scholar-plus) on 2026-06-13 -> error "held for another member"
- fines: m118 100c
- overdue on 2026-07-13: none
- notices on 2026-06-13: hold-ready m14 b53 until 2026-06-15

### D.187

- checkout b217 by m37 (student-silver) on 2026-02-18 -> ok
- reserve b217 by m55 -> ok
- return b217 on 2026-03-06 -> ok
- checkout b217 by m118 (child-basic) on 2026-03-09 -> error "held for another member"
- fines: none
- overdue on 2026-04-08: none
- notices on 2026-03-09: hold-ready m55 b217 until 2026-03-09

### D.188

- checkout b103 by m58 (child-basic) on 2026-04-28 -> ok
- reserve b103 by m11 -> ok
- return b103 on 2026-06-25 -> ok
- checkout b103 by m80 (staff-platinum) on 2026-06-29 -> ok
- fines: m58 100c
- overdue on 2026-07-29: b103/m80/2
- notices on 2026-06-29: none

### D.189

- checkout b170 by m101 (child-basic) on 2026-02-18 -> ok
- reserve b170 by m28 -> ok
- return b170 on 2026-03-25 -> ok
- checkout b170 by m84 (senior-remote) on 2026-03-28 -> error "held for another member"
- fines: m101 100c
- overdue on 2026-04-27: none
- notices on 2026-03-28: hold-ready m28 b170 until 2026-03-28

### D.190

- checkout b71 by m108 (scholar-family) on 2026-07-29 -> ok
- reserve b71 by m64 -> ok
- return b71 on 2026-08-19 -> ok
- checkout b71 by m78 (student-platinum) on 2026-08-23 -> ok
- fines: none
- overdue on 2026-09-22: b71/m78/9
- notices on 2026-08-23: none

### D.191

- checkout b40 by m93 (scholar-basic) on 2026-09-13 -> ok
- reserve b40 by m92 -> ok
- return b40 on 2026-09-23 -> ok
- checkout b40 by m99 (adult-honorary) on 2026-09-24 -> error "held for another member"
- fines: none
- overdue on 2026-10-24: none
- notices on 2026-09-24: hold-ready m92 b40 until 2026-09-26

### D.192

- checkout b136 by m47 (senior-gold) on 2026-05-21 -> ok
- reserve b136 by m45 -> ok
- return b136 on 2026-06-14 -> ok
- checkout b136 by m8 (staff-plus) on 2026-06-19 -> ok
- fines: none
- overdue on 2026-07-19: none
- notices on 2026-06-19: none

### D.193

- checkout b206 by m92 (staff-trial) on 2026-07-06 -> ok
- reserve b206 by m22 -> ok
- return b206 on 2026-08-25 -> ok
- checkout b206 by m109 (adult-family) on 2026-08-30 -> ok
- fines: none
- overdue on 2026-09-29: none
- notices on 2026-08-30: none

### D.194

- checkout b39 by m9 (scholar-remote) on 2026-05-21 -> ok
- reserve b39 by m50 -> ok
- return b39 on 2026-06-16 -> ok
- checkout b39 by m27 (scholar-plus) on 2026-06-21 -> ok
- fines: none
- overdue on 2026-07-21: none
- notices on 2026-06-21: none

### D.195

- checkout b16 by m22 (senior-honorary) on 2026-07-06 -> ok
- reserve b16 by m77 -> ok
- return b16 on 2026-08-15 -> ok
- checkout b16 by m106 (child-plus) on 2026-08-19 -> ok
- fines: m22 400c
- overdue on 2026-09-18: b16/m106/16
- notices on 2026-08-19: none

### D.196

- checkout b186 by m81 (adult-remote) on 2026-04-28 -> ok
- reserve b186 by m18 -> ok
- return b186 on 2026-06-07 -> ok
- checkout b186 by m48 (adult-honorary) on 2026-06-11 -> ok
- fines: m81 550c
- overdue on 2026-07-11: b186/m48/9
- notices on 2026-06-11: none

### D.197

- checkout b12 by m16 (staff-platinum) on 2026-02-18 -> ok
- reserve b12 by m107 -> ok
- return b12 on 2026-02-19 -> ok
- checkout b12 by m92 (staff-trial) on 2026-02-22 -> error "held for another member"
- fines: none
- overdue on 2026-03-24: none
- notices on 2026-02-22: hold-ready m107 b12 until 2026-02-22

### D.198

- checkout b234 by m3 (student-honorary) on 2026-03-13 -> ok
- reserve b234 by m92 -> ok
- return b234 on 2026-04-05 -> ok
- checkout b234 by m78 (student-platinum) on 2026-04-09 -> ok
- fines: none
- overdue on 2026-05-09: b234/m78/9
- notices on 2026-04-09: none

### D.199

- checkout b178 by m29 (child-gold) on 2026-07-06 -> ok
- reserve b178 by m113 -> ok
- return b178 on 2026-07-07 -> ok
- checkout b178 by m4 (senior-plus) on 2026-07-11 -> ok
- fines: none
- overdue on 2026-08-10: b178/m4/2
- notices on 2026-07-11: none

### D.200

- checkout b282 by m14 (scholar-branch) on 2026-10-06 -> ok
- reserve b282 by m4 -> ok
- return b282 on 2026-11-27 -> ok
- checkout b282 by m106 (child-plus) on 2026-11-29 -> error "held for another member"
- fines: none
- overdue on 2026-12-29: none
- notices on 2026-11-29: hold-ready m4 b282 until 2026-11-30

### D.201

- checkout b252 by m97 (staff-platinum) on 2026-04-28 -> ok
- reserve b252 by m62 -> ok
- return b252 on 2026-05-31 -> ok
- checkout b252 by m16 (staff-platinum) on 2026-06-05 -> ok
- fines: none
- overdue on 2026-07-05: b252/m16/2
- notices on 2026-06-05: none

### D.202

- checkout b250 by m32 (staff-honorary) on 2026-01-26 -> ok
- reserve b250 by m119 -> ok
- return b250 on 2026-02-22 -> ok
- checkout b250 by m98 (scholar-branch) on 2026-02-24 -> error "held for another member"
- fines: none
- overdue on 2026-03-26: none
- notices on 2026-02-24: hold-ready m119 b250 until 2026-02-25

### D.203

- checkout b46 by m83 (senior-gold) on 2026-04-28 -> ok
- reserve b46 by m116 -> ok
- return b46 on 2026-06-25 -> ok
- checkout b46 by m87 (senior-basic) on 2026-06-30 -> ok
- fines: m83 240c
- overdue on 2026-07-30: b46/m87/9
- notices on 2026-06-30: none

### D.204

- checkout b215 by m28 (student-silver) on 2026-07-06 -> ok
- reserve b215 by m19 -> ok
- return b215 on 2026-08-03 -> ok
- checkout b215 by m58 (child-basic) on 2026-08-06 -> error "held for another member"
- fines: none
- overdue on 2026-09-05: none
- notices on 2026-08-06: hold-ready m19 b215 until 2026-08-06

### D.205

- checkout b300 by m83 (senior-gold) on 2026-10-29 -> ok
- reserve b300 by m45 -> ok
- return b300 on 2026-10-30 -> ok
- checkout b300 by m73 (student-branch) on 2026-10-31 -> error "held for another member"
- fines: none
- overdue on 2026-11-30: none
- notices on 2026-10-31: hold-ready m45 b300 until 2026-11-02

### D.206

- checkout b212 by m25 (staff-basic) on 2026-04-28 -> ok
- reserve b212 by m88 -> ok
- return b212 on 2026-05-01 -> ok
- checkout b212 by m119 (adult-branch) on 2026-05-06 -> ok
- fines: none
- overdue on 2026-06-05: b212/m119/9
- notices on 2026-05-06: none

### D.207

- checkout b144 by m74 (student-silver) on 2026-11-21 -> ok
- reserve b144 by m110 -> ok
- return b144 on 2026-12-29 -> ok
- checkout b144 by m32 (staff-honorary) on 2027-01-01 -> error "held for another member"
- fines: none
- overdue on 2027-01-31: none
- notices on 2027-01-01: hold-ready m110 b144 until 2027-01-01

### D.208

- checkout b8 by m21 (staff-honorary) on 2026-10-29 -> ok
- reserve b8 by m57 -> ok
- return b8 on 2026-12-24 -> ok
- checkout b8 by m87 (senior-basic) on 2026-12-29 -> ok
- fines: none
- overdue on 2027-01-28: b8/m87/9
- notices on 2026-12-29: none

### D.209

- checkout b210 by m6 (student-gold) on 2026-07-06 -> ok
- reserve b210 by m118 -> ok
- return b210 on 2026-07-14 -> ok
- checkout b210 by m27 (scholar-plus) on 2026-07-17 -> error "held for another member"
- fines: none
- overdue on 2026-08-16: none
- notices on 2026-07-17: hold-ready m118 b210 until 2026-07-17

### D.210

- checkout b4 by m69 (student-remote) on 2026-07-29 -> ok
- reserve b4 by m109 -> ok
- return b4 on 2026-07-30 -> ok
- checkout b4 by m50 (scholar-trial) on 2026-07-31 -> error "held for another member"
- fines: none
- overdue on 2026-08-30: none
- notices on 2026-07-31: hold-ready m109 b4 until 2026-08-02

### D.211

- checkout b3 by m35 (student-basic) on 2026-01-03 -> ok
- reserve b3 by m88 -> ok
- return b3 on 2026-02-22 -> ok
- checkout b3 by m32 (staff-honorary) on 2026-02-23 -> error "held for another member"
- fines: m35 260c
- overdue on 2026-03-25: none
- notices on 2026-02-23: hold-ready m88 b3 until 2026-02-25

### D.212

- checkout b216 by m118 (child-basic) on 2026-01-26 -> ok
- reserve b216 by m18 -> ok
- return b216 on 2026-03-12 -> ok
- checkout b216 by m37 (student-silver) on 2026-03-17 -> ok
- fines: m118 100c
- overdue on 2026-04-16: none
- notices on 2026-03-17: none

### D.213

- checkout b12 by m116 (scholar-gold) on 2026-08-21 -> ok
- reserve b12 by m31 -> ok
- return b12 on 2026-09-03 -> ok
- checkout b12 by m38 (staff-honorary) on 2026-09-05 -> error "held for another member"
- fines: none
- overdue on 2026-10-05: none
- notices on 2026-09-05: hold-ready m31 b12 until 2026-09-06

### D.214

- checkout b49 by m99 (adult-honorary) on 2026-10-06 -> ok
- reserve b49 by m59 -> ok
- return b49 on 2026-10-07 -> ok
- checkout b49 by m37 (student-silver) on 2026-10-11 -> ok
- fines: none
- overdue on 2026-11-10: none
- notices on 2026-10-11: none

### D.215

- checkout b99 by m47 (senior-gold) on 2026-08-21 -> ok
- reserve b99 by m20 -> ok
- return b99 on 2026-08-25 -> ok
- checkout b99 by m68 (student-trial) on 2026-08-26 -> error "held for another member"
- fines: none
- overdue on 2026-09-25: none
- notices on 2026-08-26: hold-ready m20 b99 until 2026-08-28

### D.216

- checkout b278 by m94 (staff-remote) on 2026-01-26 -> ok
- reserve b278 by m24 -> ok
- return b278 on 2026-03-18 -> ok
- checkout b278 by m9 (scholar-remote) on 2026-03-19 -> error "held for another member"
- fines: none
- overdue on 2026-04-18: none
- notices on 2026-03-19: hold-ready m24 b278 until 2026-03-21

### D.217

- checkout b148 by m43 (child-plus) on 2026-04-28 -> ok
- reserve b148 by m50 -> ok
- return b148 on 2026-05-23 -> ok
- checkout b148 by m41 (staff-family) on 2026-05-25 -> error "held for another member"
- fines: m43 150c
- overdue on 2026-06-24: none
- notices on 2026-05-25: hold-ready m50 b148 until 2026-05-26

### D.218

- checkout b149 by m39 (child-plus) on 2026-06-13 -> ok
- reserve b149 by m99 -> ok
- return b149 on 2026-08-02 -> ok
- checkout b149 by m37 (student-silver) on 2026-08-07 -> ok
- fines: m39 200c
- overdue on 2026-09-06: none
- notices on 2026-08-07: none

### D.219

- checkout b71 by m1 (student-family) on 2026-05-21 -> ok
- reserve b71 by m70 -> ok
- return b71 on 2026-06-05 -> ok
- checkout b71 by m112 (student-branch) on 2026-06-10 -> ok
- fines: none
- overdue on 2026-07-10: b71/m112/2
- notices on 2026-06-10: none

### D.220

- checkout b123 by m30 (scholar-plus) on 2026-09-13 -> ok
- reserve b123 by m5 -> ok
- return b123 on 2026-11-07 -> ok
- checkout b123 by m17 (senior-platinum) on 2026-11-12 -> ok
- fines: none
- overdue on 2026-12-12: b123/m17/9
- notices on 2026-11-12: none

### D.221

- checkout b180 by m49 (student-family) on 2026-07-06 -> ok
- reserve b180 by m62 -> ok
- return b180 on 2026-07-25 -> ok
- checkout b180 by m57 (student-plus) on 2026-07-27 -> error "held for another member"
- fines: none
- overdue on 2026-08-26: none
- notices on 2026-07-27: hold-ready m62 b180 until 2026-07-28

### D.222

- checkout b124 by m105 (student-gold) on 2026-08-21 -> ok
- reserve b124 by m99 -> ok
- return b124 on 2026-09-20 -> ok
- checkout b124 by m74 (student-silver) on 2026-09-23 -> error "held for another member"
- fines: none
- overdue on 2026-10-23: none
- notices on 2026-09-23: hold-ready m99 b124 until 2026-09-23

### D.223

- checkout b279 by m100 (scholar-gold) on 2026-07-29 -> ok
- reserve b279 by m118 -> ok
- return b279 on 2026-08-23 -> ok
- checkout b279 by m8 (staff-plus) on 2026-08-24 -> error "held for another member"
- fines: none
- overdue on 2026-09-23: none
- notices on 2026-08-24: hold-ready m118 b279 until 2026-08-26

### D.224

- checkout b78 by m96 (student-silver) on 2026-03-13 -> ok
- reserve b78 by m43 -> ok
- return b78 on 2026-05-03 -> ok
- checkout b78 by m13 (adult-platinum) on 2026-05-08 -> ok
- fines: m96 220c
- overdue on 2026-06-07: b78/m13/16
- notices on 2026-05-08: none

### D.225

- checkout b141 by m27 (scholar-plus) on 2026-08-21 -> ok
- reserve b141 by m10 -> ok
- return b141 on 2026-08-22 -> ok
- checkout b141 by m63 (senior-family) on 2026-08-24 -> error "held for another member"
- fines: none
- overdue on 2026-09-23: none
- notices on 2026-08-24: hold-ready m10 b141 until 2026-08-25

### D.226

- checkout b121 by m14 (scholar-branch) on 2026-10-06 -> ok
- reserve b121 by m2 -> ok
- return b121 on 2026-10-19 -> ok
- checkout b121 by m118 (child-basic) on 2026-10-21 -> error "held for another member"
- fines: none
- overdue on 2026-11-20: none
- notices on 2026-10-21: hold-ready m2 b121 until 2026-10-22

### D.227

- checkout b252 by m113 (student-plus) on 2026-03-13 -> ok
- reserve b252 by m37 -> ok
- return b252 on 2026-04-23 -> ok
- checkout b252 by m56 (scholar-basic) on 2026-04-24 -> error "held for another member"
- fines: m113 135c
- overdue on 2026-05-24: none
- notices on 2026-04-24: hold-ready m37 b252 until 2026-04-26

### D.228

- checkout b6 by m67 (staff-honorary) on 2026-07-06 -> ok
- reserve b6 by m6 -> ok
- return b6 on 2026-08-28 -> ok
- checkout b6 by m40 (child-branch) on 2026-09-01 -> ok
- fines: none
- overdue on 2026-10-01: b6/m40/16
- notices on 2026-09-01: none

### D.229

- checkout b283 by m96 (student-silver) on 2026-06-13 -> ok
- reserve b283 by m114 -> ok
- return b283 on 2026-06-19 -> ok
- checkout b283 by m59 (student-branch) on 2026-06-20 -> error "held for another member"
- fines: none
- overdue on 2026-07-20: none
- notices on 2026-06-20: hold-ready m114 b283 until 2026-06-22

### D.230

- checkout b210 by m42 (scholar-remote) on 2026-01-26 -> ok
- reserve b210 by m44 -> ok
- return b210 on 2026-01-31 -> ok
- checkout b210 by m25 (staff-basic) on 2026-02-02 -> error "held for another member"
- fines: none
- overdue on 2026-03-04: none
- notices on 2026-02-02: hold-ready m44 b210 until 2026-02-03

### D.231

- checkout b132 by m34 (staff-silver) on 2026-02-18 -> ok
- reserve b132 by m119 -> ok
- return b132 on 2026-03-15 -> ok
- checkout b132 by m60 (staff-platinum) on 2026-03-20 -> ok
- fines: none
- overdue on 2026-04-19: b132/m60/2
- notices on 2026-03-20: none

### D.232

- checkout b284 by m63 (senior-family) on 2026-04-28 -> ok
- reserve b284 by m70 -> ok
- return b284 on 2026-05-07 -> ok
- checkout b284 by m76 (scholar-honorary) on 2026-05-08 -> error "held for another member"
- fines: none
- overdue on 2026-06-07: none
- notices on 2026-05-08: hold-ready m70 b284 until 2026-05-10

### D.233

- checkout b19 by m72 (adult-family) on 2026-05-21 -> ok
- reserve b19 by m1 -> ok
- return b19 on 2026-06-15 -> ok
- checkout b19 by m117 (student-branch) on 2026-06-17 -> error "held for another member"
- fines: none
- overdue on 2026-07-17: none
- notices on 2026-06-17: hold-ready m1 b19 until 2026-06-18

### D.234

- checkout b204 by m95 (scholar-trial) on 2026-09-13 -> ok
- reserve b204 by m93 -> ok
- return b204 on 2026-11-04 -> ok
- checkout b204 by m21 (staff-honorary) on 2026-11-05 -> error "held for another member"
- fines: m95 90c
- overdue on 2026-12-05: none
- notices on 2026-11-05: hold-ready m93 b204 until 2026-11-07

### D.235

- checkout b13 by m87 (senior-basic) on 2026-10-29 -> ok
- reserve b13 by m22 -> ok
- return b13 on 2026-11-07 -> ok
- checkout b13 by m32 (staff-honorary) on 2026-11-12 -> ok
- fines: none
- overdue on 2026-12-12: none
- notices on 2026-11-12: none

### D.236

- checkout b44 by m109 (adult-family) on 2026-03-13 -> ok
- reserve b44 by m95 -> ok
- return b44 on 2026-03-15 -> ok
- checkout b44 by m52 (scholar-honorary) on 2026-03-16 -> error "held for another member"
- fines: none
- overdue on 2026-04-15: none
- notices on 2026-03-16: hold-ready m95 b44 until 2026-03-18

### D.237

- checkout b160 by m86 (student-honorary) on 2026-04-05 -> ok
- reserve b160 by m23 -> ok
- return b160 on 2026-04-19 -> ok
- checkout b160 by m40 (child-branch) on 2026-04-24 -> ok
- fines: none
- overdue on 2026-05-24: b160/m40/16
- notices on 2026-04-24: none

### D.238

- checkout b90 by m108 (scholar-family) on 2026-07-29 -> ok
- reserve b90 by m97 -> ok
- return b90 on 2026-08-16 -> ok
- checkout b90 by m51 (child-honorary) on 2026-08-18 -> error "held for another member"
- fines: none
- overdue on 2026-09-17: none
- notices on 2026-08-18: hold-ready m97 b90 until 2026-08-19

### D.239

- checkout b204 by m74 (student-silver) on 2026-09-13 -> ok
- reserve b204 by m34 -> ok
- return b204 on 2026-10-15 -> ok
- checkout b204 by m103 (student-trial) on 2026-10-17 -> error "held for another member"
- fines: none
- overdue on 2026-11-16: none
- notices on 2026-10-17: hold-ready m34 b204 until 2026-10-18

### D.240

- checkout b120 by m7 (child-platinum) on 2026-02-18 -> ok
- reserve b120 by m109 -> ok
- return b120 on 2026-04-04 -> ok
- checkout b120 by m6 (student-gold) on 2026-04-05 -> error "held for another member"
- fines: m7 500c
- overdue on 2026-05-05: none
- notices on 2026-04-05: hold-ready m109 b120 until 2026-04-07

### D.241

- checkout b243 by m2 (staff-remote) on 2026-05-21 -> ok
- reserve b243 by m99 -> ok
- return b243 on 2026-06-05 -> ok
- checkout b243 by m58 (child-basic) on 2026-06-08 -> error "held for another member"
- fines: none
- overdue on 2026-07-08: none
- notices on 2026-06-08: hold-ready m99 b243 until 2026-06-08

### D.242

- checkout b224 by m101 (child-basic) on 2026-01-03 -> ok
- reserve b224 by m61 -> ok
- return b224 on 2026-01-04 -> ok
- checkout b224 by m8 (staff-plus) on 2026-01-06 -> error "held for another member"
- fines: none
- overdue on 2026-02-05: none
- notices on 2026-01-06: hold-ready m61 b224 until 2026-01-07

### D.243

- checkout b36 by m98 (scholar-branch) on 2026-07-29 -> ok
- reserve b36 by m4 -> ok
- return b36 on 2026-09-26 -> ok
- checkout b36 by m74 (student-silver) on 2026-09-27 -> error "held for another member"
- fines: m98 75c
- overdue on 2026-10-27: none
- notices on 2026-09-27: hold-ready m4 b36 until 2026-09-29

### D.244

- checkout b218 by m49 (student-family) on 2026-11-21 -> ok
- reserve b218 by m90 -> ok
- return b218 on 2027-01-13 -> ok
- checkout b218 by m49 (student-family) on 2027-01-17 -> ok
- fines: m49 315c
- overdue on 2027-02-16: none
- notices on 2027-01-17: none

### D.245

- checkout b47 by m67 (staff-honorary) on 2026-09-13 -> ok
- reserve b47 by m2 -> ok
- return b47 on 2026-10-08 -> ok
- checkout b47 by m36 (child-silver) on 2026-10-10 -> error "held for another member"
- fines: none
- overdue on 2026-11-09: none
- notices on 2026-10-10: hold-ready m2 b47 until 2026-10-11

### D.246

- checkout b181 by m3 (student-honorary) on 2026-01-26 -> ok
- reserve b181 by m87 -> ok
- return b181 on 2026-03-05 -> ok
- checkout b181 by m48 (adult-honorary) on 2026-03-08 -> error "held for another member"
- fines: m3 385c
- overdue on 2026-04-07: none
- notices on 2026-03-08: hold-ready m87 b181 until 2026-03-08

### D.247

- checkout b213 by m16 (staff-platinum) on 2026-02-18 -> ok
- reserve b213 by m31 -> ok
- return b213 on 2026-03-23 -> ok
- checkout b213 by m58 (child-basic) on 2026-03-24 -> error "held for another member"
- fines: none
- overdue on 2026-04-23: none
- notices on 2026-03-24: hold-ready m31 b213 until 2026-03-26

### D.248

- checkout b108 by m22 (senior-honorary) on 2026-03-13 -> ok
- reserve b108 by m4 -> ok
- return b108 on 2026-04-21 -> ok
- checkout b108 by m54 (adult-honorary) on 2026-04-26 -> ok
- fines: m22 350c
- overdue on 2026-05-26: b108/m54/9
- notices on 2026-04-26: none

### D.249

- checkout b120 by m119 (adult-branch) on 2026-05-21 -> ok
- reserve b120 by m84 -> ok
- return b120 on 2026-06-27 -> ok
- checkout b120 by m110 (scholar-basic) on 2026-07-01 -> ok
- fines: m119 600c
- overdue on 2026-07-31: none
- notices on 2026-07-01: none

### D.250

- checkout b263 by m111 (child-platinum) on 2026-05-21 -> ok
- reserve b263 by m17 -> ok
- return b263 on 2026-07-14 -> ok
- checkout b263 by m17 (senior-platinum) on 2026-07-19 -> ok
- fines: m111 500c
- overdue on 2026-08-18: b263/m17/9
- notices on 2026-07-19: none

### D.251

- checkout b105 by m14 (scholar-branch) on 2026-04-05 -> ok
- reserve b105 by m26 -> ok
- return b105 on 2026-04-28 -> ok
- checkout b105 by m73 (student-branch) on 2026-05-01 -> error "held for another member"
- fines: none
- overdue on 2026-05-31: none
- notices on 2026-05-01: hold-ready m26 b105 until 2026-05-01

### D.252

- checkout b286 by m100 (scholar-gold) on 2026-04-28 -> ok
- reserve b286 by m93 -> ok
- return b286 on 2026-05-12 -> ok
- checkout b286 by m41 (staff-family) on 2026-05-15 -> error "held for another member"
- fines: none
- overdue on 2026-06-14: none
- notices on 2026-05-15: hold-ready m93 b286 until 2026-05-15

### D.253

- checkout b90 by m4 (senior-plus) on 2026-01-03 -> ok
- reserve b90 by m113 -> ok
- return b90 on 2026-01-03 -> ok
- checkout b90 by m73 (student-branch) on 2026-01-04 -> error "held for another member"
- fines: none
- overdue on 2026-02-03: none
- notices on 2026-01-04: hold-ready m113 b90 until 2026-01-06

### D.254

- checkout b206 by m110 (scholar-basic) on 2026-07-06 -> ok
- reserve b206 by m117 -> ok
- return b206 on 2026-08-08 -> ok
- checkout b206 by m41 (staff-family) on 2026-08-12 -> ok
- fines: none
- overdue on 2026-09-11: none
- notices on 2026-08-12: none

### D.255

- checkout b44 by m40 (child-branch) on 2026-08-21 -> ok
- reserve b44 by m33 -> ok
- return b44 on 2026-10-19 -> ok
- checkout b44 by m44 (senior-trial) on 2026-10-22 -> error "held for another member"
- fines: m40 600c
- overdue on 2026-11-21: none
- notices on 2026-10-22: hold-ready m33 b44 until 2026-10-22

### D.256

- checkout b239 by m116 (scholar-gold) on 2026-11-21 -> ok
- reserve b239 by m34 -> ok
- return b239 on 2027-01-16 -> ok
- checkout b239 by m85 (adult-remote) on 2027-01-19 -> error "held for another member"
- fines: none
- overdue on 2027-02-18: none
- notices on 2027-01-19: hold-ready m34 b239 until 2027-01-19

### D.257

- checkout b96 by m15 (adult-trial) on 2026-08-21 -> ok
- reserve b96 by m17 -> ok
- return b96 on 2026-09-22 -> ok
- checkout b96 by m22 (senior-honorary) on 2026-09-26 -> ok
- fines: m15 910c
- overdue on 2026-10-26: b96/m22/2
- notices on 2026-09-26: none

### D.258

- checkout b106 by m119 (adult-branch) on 2026-03-13 -> ok
- reserve b106 by m25 -> ok
- return b106 on 2026-04-07 -> ok
- checkout b106 by m86 (student-honorary) on 2026-04-09 -> error "held for another member"
- fines: none
- overdue on 2026-05-09: none
- notices on 2026-04-09: hold-ready m25 b106 until 2026-04-10

### D.259

- checkout b223 by m25 (staff-basic) on 2026-09-13 -> ok
- reserve b223 by m107 -> ok
- return b223 on 2026-10-11 -> ok
- checkout b223 by m11 (scholar-gold) on 2026-10-15 -> ok
- fines: none
- overdue on 2026-11-14: none
- notices on 2026-10-15: none

### D.260

- checkout b257 by m46 (adult-gold) on 2026-10-29 -> ok
- reserve b257 by m23 -> ok
- return b257 on 2026-11-19 -> ok
- checkout b257 by m10 (student-honorary) on 2026-11-22 -> error "held for another member"
- fines: none
- overdue on 2026-12-22: none
- notices on 2026-11-22: hold-ready m23 b257 until 2026-11-22

### D.261

- checkout b97 by m80 (staff-platinum) on 2026-11-21 -> ok
- reserve b97 by m54 -> ok
- return b97 on 2026-12-03 -> ok
- checkout b97 by m14 (scholar-branch) on 2026-12-04 -> error "held for another member"
- fines: none
- overdue on 2027-01-03: none
- notices on 2026-12-04: hold-ready m54 b97 until 2026-12-06

### D.262

- checkout b56 by m53 (staff-family) on 2026-05-21 -> ok
- reserve b56 by m105 -> ok
- return b56 on 2026-06-04 -> ok
- checkout b56 by m74 (student-silver) on 2026-06-06 -> error "held for another member"
- fines: none
- overdue on 2026-07-06: none
- notices on 2026-06-06: hold-ready m105 b56 until 2026-06-07

### D.263

- checkout b151 by m31 (student-basic) on 2026-10-29 -> ok
- reserve b151 by m77 -> ok
- return b151 on 2026-11-17 -> ok
- checkout b151 by m93 (scholar-basic) on 2026-11-21 -> ok
- fines: none
- overdue on 2026-12-21: none
- notices on 2026-11-21: none

### D.264

- checkout b51 by m111 (child-platinum) on 2026-10-29 -> ok
- reserve b51 by m114 -> ok
- return b51 on 2026-11-24 -> ok
- checkout b51 by m14 (scholar-branch) on 2026-11-28 -> ok
- fines: m111 500c
- overdue on 2026-12-28: none
- notices on 2026-11-28: none

### D.265

- checkout b265 by m63 (senior-family) on 2026-03-13 -> ok
- reserve b265 by m19 -> ok
- return b265 on 2026-04-20 -> ok
- checkout b265 by m44 (senior-trial) on 2026-04-22 -> error "held for another member"
- fines: none
- overdue on 2026-05-22: none
- notices on 2026-04-22: hold-ready m19 b265 until 2026-04-23

### D.266

- checkout b265 by m65 (child-branch) on 2026-08-21 -> ok
- reserve b265 by m79 -> ok
- return b265 on 2026-10-12 -> ok
- checkout b265 by m108 (scholar-family) on 2026-10-14 -> error "held for another member"
- fines: m65 600c
- overdue on 2026-11-13: none
- notices on 2026-10-14: hold-ready m79 b265 until 2026-10-15

### D.267

- checkout b166 by m99 (adult-honorary) on 2026-01-03 -> ok
- reserve b166 by m15 -> ok
- return b166 on 2026-01-23 -> ok
- checkout b166 by m35 (student-basic) on 2026-01-27 -> ok
- fines: none
- overdue on 2026-02-26: b166/m35/9
- notices on 2026-01-27: none

### D.268

- checkout b258 by m38 (staff-honorary) on 2026-10-06 -> ok
- reserve b258 by m45 -> ok
- return b258 on 2026-10-14 -> ok
- checkout b258 by m44 (senior-trial) on 2026-10-17 -> error "held for another member"
- fines: none
- overdue on 2026-11-16: none
- notices on 2026-10-17: hold-ready m45 b258 until 2026-10-17

### D.269

- checkout b121 by m38 (staff-honorary) on 2026-05-21 -> ok
- reserve b121 by m56 -> ok
- return b121 on 2026-06-13 -> ok
- checkout b121 by m11 (scholar-gold) on 2026-06-14 -> error "held for another member"
- fines: none
- overdue on 2026-07-14: none
- notices on 2026-06-14: hold-ready m56 b121 until 2026-06-16

### D.270

- checkout b54 by m59 (student-branch) on 2026-07-29 -> ok
- reserve b54 by m58 -> ok
- return b54 on 2026-08-25 -> ok
- checkout b54 by m117 (student-branch) on 2026-08-26 -> error "held for another member"
- fines: none
- overdue on 2026-09-25: none
- notices on 2026-08-26: hold-ready m58 b54 until 2026-08-28

### D.271

- checkout b127 by m87 (senior-basic) on 2026-05-21 -> ok
- reserve b127 by m55 -> ok
- return b127 on 2026-06-18 -> ok
- checkout b127 by m63 (senior-family) on 2026-06-20 -> error "held for another member"
- fines: m87 15c
- overdue on 2026-07-20: none
- notices on 2026-06-20: hold-ready m55 b127 until 2026-06-21

### D.272

- checkout b69 by m73 (student-branch) on 2026-07-29 -> ok
- reserve b69 by m94 -> ok
- return b69 on 2026-08-04 -> ok
- checkout b69 by m58 (child-basic) on 2026-08-08 -> ok
- fines: none
- overdue on 2026-09-07: b69/m58/23
- notices on 2026-08-08: none

### D.273

- checkout b242 by m55 (adult-plus) on 2026-10-29 -> ok
- reserve b242 by m112 -> ok
- return b242 on 2026-10-31 -> ok
- checkout b242 by m27 (scholar-plus) on 2026-11-05 -> ok
- fines: none
- overdue on 2026-12-05: none
- notices on 2026-11-05: none

### D.274

- checkout b171 by m62 (student-remote) on 2026-01-03 -> ok
- reserve b171 by m97 -> ok
- return b171 on 2026-01-26 -> ok
- checkout b171 by m90 (staff-remote) on 2026-01-28 -> error "held for another member"
- fines: none
- overdue on 2026-02-27: none
- notices on 2026-01-28: hold-ready m97 b171 until 2026-01-29

### D.275

- checkout b174 by m97 (staff-platinum) on 2026-10-29 -> ok
- reserve b174 by m47 -> ok
- return b174 on 2026-10-29 -> ok
- checkout b174 by m88 (scholar-basic) on 2026-11-01 -> error "held for another member"
- fines: none
- overdue on 2026-12-01: none
- notices on 2026-11-01: hold-ready m47 b174 until 2026-11-01

### D.276

- checkout b57 by m56 (scholar-basic) on 2026-01-26 -> ok
- reserve b57 by m95 -> ok
- return b57 on 2026-01-30 -> ok
- checkout b57 by m3 (student-honorary) on 2026-02-02 -> error "held for another member"
- fines: none
- overdue on 2026-03-04: none
- notices on 2026-02-02: hold-ready m95 b57 until 2026-02-02

### D.277

- checkout b131 by m93 (scholar-basic) on 2026-10-29 -> ok
- reserve b131 by m64 -> ok
- return b131 on 2026-12-07 -> ok
- checkout b131 by m38 (staff-honorary) on 2026-12-08 -> error "held for another member"
- fines: none
- overdue on 2027-01-07: none
- notices on 2026-12-08: hold-ready m64 b131 until 2026-12-10

### D.278

- checkout b292 by m73 (student-branch) on 2026-09-13 -> ok
- reserve b292 by m38 -> ok
- return b292 on 2026-11-11 -> ok
- checkout b292 by m114 (scholar-honorary) on 2026-11-16 -> ok
- fines: m73 800c
- overdue on 2026-12-16: none
- notices on 2026-11-16: none

### D.279

- checkout b122 by m24 (child-platinum) on 2026-01-03 -> ok
- reserve b122 by m116 -> ok
- return b122 on 2026-02-23 -> ok
- checkout b122 by m31 (student-basic) on 2026-02-28 -> ok
- fines: m24 500c
- overdue on 2026-03-30: b122/m31/9
- notices on 2026-02-28: none

### D.280

- checkout b75 by m88 (scholar-basic) on 2026-01-03 -> ok
- reserve b75 by m119 -> ok
- return b75 on 2026-02-26 -> ok
- checkout b75 by m15 (adult-trial) on 2026-02-28 -> error "held for another member"
- fines: m88 250c
- overdue on 2026-03-30: none
- notices on 2026-02-28: hold-ready m119 b75 until 2026-03-01

### D.281

- checkout b140 by m86 (student-honorary) on 2026-06-13 -> ok
- reserve b140 by m6 -> ok
- return b140 on 2026-06-21 -> ok
- checkout b140 by m81 (adult-remote) on 2026-06-26 -> ok
- fines: none
- overdue on 2026-07-26: b140/m81/2
- notices on 2026-06-26: none

### D.282

- checkout b257 by m76 (scholar-honorary) on 2026-02-18 -> ok
- reserve b257 by m57 -> ok
- return b257 on 2026-02-25 -> ok
- checkout b257 by m30 (scholar-plus) on 2026-02-26 -> error "held for another member"
- fines: none
- overdue on 2026-03-28: none
- notices on 2026-02-26: hold-ready m57 b257 until 2026-02-28

### D.283

- checkout b164 by m52 (scholar-honorary) on 2026-11-21 -> ok
- reserve b164 by m63 -> ok
- return b164 on 2026-12-06 -> ok
- checkout b164 by m35 (student-basic) on 2026-12-10 -> ok
- fines: none
- overdue on 2027-01-09: b164/m35/9
- notices on 2026-12-10: none

### D.284

- checkout b237 by m4 (senior-plus) on 2026-09-13 -> ok
- reserve b237 by m72 -> ok
- return b237 on 2026-09-14 -> ok
- checkout b237 by m30 (scholar-plus) on 2026-09-18 -> ok
- fines: none
- overdue on 2026-10-18: none
- notices on 2026-09-18: none

### D.285

- checkout b39 by m4 (senior-plus) on 2026-09-13 -> ok
- reserve b39 by m29 -> ok
- return b39 on 2026-10-12 -> ok
- checkout b39 by m86 (student-honorary) on 2026-10-16 -> ok
- fines: none
- overdue on 2026-11-15: b39/m86/2
- notices on 2026-10-16: none

### D.286

- checkout b140 by m110 (scholar-basic) on 2026-10-29 -> ok
- reserve b140 by m107 -> ok
- return b140 on 2026-12-05 -> ok
- checkout b140 by m23 (child-plus) on 2026-12-07 -> error "held for another member"
- fines: none
- overdue on 2027-01-06: none
- notices on 2026-12-07: hold-ready m107 b140 until 2026-12-08

### D.287

- checkout b167 by m105 (student-gold) on 2026-04-05 -> ok
- reserve b167 by m49 -> ok
- return b167 on 2026-05-07 -> ok
- checkout b167 by m21 (staff-honorary) on 2026-05-12 -> ok
- fines: none
- overdue on 2026-06-11: none
- notices on 2026-05-12: none

### D.288

- checkout b23 by m71 (senior-plus) on 2026-04-05 -> ok
- reserve b23 by m72 -> ok
- return b23 on 2026-04-20 -> ok
- checkout b23 by m90 (staff-remote) on 2026-04-23 -> error "held for another member"
- fines: none
- overdue on 2026-05-23: none
- notices on 2026-04-23: hold-ready m72 b23 until 2026-04-23

### D.289

- checkout b85 by m101 (child-basic) on 2026-11-21 -> ok
- reserve b85 by m8 -> ok
- return b85 on 2026-12-23 -> ok
- checkout b85 by m25 (staff-basic) on 2026-12-25 -> error "held for another member"
- fines: m101 100c
- overdue on 2027-01-24: none
- notices on 2026-12-25: hold-ready m8 b85 until 2026-12-26

### D.290

- checkout b242 by m51 (child-honorary) on 2026-11-21 -> ok
- reserve b242 by m108 -> ok
- return b242 on 2026-12-11 -> ok
- checkout b242 by m36 (child-silver) on 2026-12-15 -> ok
- fines: m51 330c
- overdue on 2027-01-14: b242/m36/9
- notices on 2026-12-15: none

### D.291

- checkout b291 by m20 (senior-plus) on 2026-10-29 -> ok
- reserve b291 by m45 -> ok
- return b291 on 2026-11-09 -> ok
- checkout b291 by m107 (senior-silver) on 2026-11-10 -> error "held for another member"
- fines: none
- overdue on 2026-12-10: none
- notices on 2026-11-10: hold-ready m45 b291 until 2026-11-12

### D.292

- checkout b57 by m80 (staff-platinum) on 2026-09-13 -> ok
- reserve b57 by m3 -> ok
- return b57 on 2026-11-09 -> ok
- checkout b57 by m100 (scholar-gold) on 2026-11-10 -> error "held for another member"
- fines: none
- overdue on 2026-12-10: none
- notices on 2026-11-10: hold-ready m3 b57 until 2026-11-12

### D.293

- checkout b26 by m69 (student-remote) on 2026-04-05 -> ok
- reserve b26 by m59 -> ok
- return b26 on 2026-04-17 -> ok
- checkout b26 by m46 (adult-gold) on 2026-04-18 -> error "held for another member"
- fines: none
- overdue on 2026-05-18: none
- notices on 2026-04-18: hold-ready m59 b26 until 2026-04-20

### D.294

- checkout b207 by m86 (student-honorary) on 2026-04-05 -> ok
- reserve b207 by m72 -> ok
- return b207 on 2026-04-16 -> ok
- checkout b207 by m22 (senior-honorary) on 2026-04-21 -> ok
- fines: none
- overdue on 2026-05-21: b207/m22/2
- notices on 2026-04-21: none

### D.295

- checkout b71 by m81 (adult-remote) on 2026-01-26 -> ok
- reserve b71 by m51 -> ok
- return b71 on 2026-02-05 -> ok
- checkout b71 by m45 (scholar-family) on 2026-02-07 -> error "held for another member"
- fines: none
- overdue on 2026-03-09: none
- notices on 2026-02-07: hold-ready m51 b71 until 2026-02-08

### D.296

- checkout b205 by m32 (staff-honorary) on 2026-07-29 -> ok
- reserve b205 by m115 -> ok
- return b205 on 2026-09-13 -> ok
- checkout b205 by m117 (student-branch) on 2026-09-18 -> ok
- fines: none
- overdue on 2026-10-18: b205/m117/2
- notices on 2026-09-18: none

### D.297

- checkout b42 by m41 (staff-family) on 2026-07-06 -> ok
- reserve b42 by m69 -> ok
- return b42 on 2026-08-22 -> ok
- checkout b42 by m102 (scholar-honorary) on 2026-08-23 -> error "held for another member"
- fines: none
- overdue on 2026-09-22: none
- notices on 2026-08-23: hold-ready m69 b42 until 2026-08-25

### D.298

- checkout b156 by m117 (student-branch) on 2026-09-13 -> ok
- reserve b156 by m2 -> ok
- return b156 on 2026-09-22 -> ok
- checkout b156 by m33 (child-honorary) on 2026-09-25 -> error "held for another member"
- fines: none
- overdue on 2026-10-25: none
- notices on 2026-09-25: hold-ready m2 b156 until 2026-09-25

### D.299

- checkout b279 by m7 (child-platinum) on 2026-07-29 -> ok
- reserve b279 by m102 -> ok
- return b279 on 2026-09-15 -> ok
- checkout b279 by m78 (student-platinum) on 2026-09-18 -> error "held for another member"
- fines: m7 500c
- overdue on 2026-10-18: none
- notices on 2026-09-18: hold-ready m102 b279 until 2026-09-18

### D.300

- checkout b92 by m44 (senior-trial) on 2026-11-21 -> ok
- reserve b92 by m108 -> ok
- return b92 on 2027-01-04 -> ok
- checkout b92 by m39 (child-plus) on 2027-01-05 -> error "held for another member"
- fines: m44 765c
- overdue on 2027-02-04: none
- notices on 2027-01-05: hold-ready m108 b92 until 2027-01-07

### D.301

- checkout b274 by m11 (scholar-gold) on 2026-08-21 -> ok
- reserve b274 by m105 -> ok
- return b274 on 2026-09-11 -> ok
- checkout b274 by m85 (adult-remote) on 2026-09-12 -> error "held for another member"
- fines: none
- overdue on 2026-10-12: none
- notices on 2026-09-12: hold-ready m105 b274 until 2026-09-14

### D.302

- checkout b140 by m43 (child-plus) on 2026-07-06 -> ok
- reserve b140 by m65 -> ok
- return b140 on 2026-08-23 -> ok
- checkout b140 by m87 (senior-basic) on 2026-08-27 -> ok
- fines: m43 200c
- overdue on 2026-09-26: b140/m87/9
- notices on 2026-08-27: none

### D.303

- checkout b64 by m94 (staff-remote) on 2026-11-21 -> ok
- reserve b64 by m36 -> ok
- return b64 on 2026-12-21 -> ok
- checkout b64 by m85 (adult-remote) on 2026-12-22 -> error "held for another member"
- fines: none
- overdue on 2027-01-21: none
- notices on 2026-12-22: hold-ready m36 b64 until 2026-12-24

### D.304

- checkout b298 by m59 (student-branch) on 2026-10-06 -> ok
- reserve b298 by m62 -> ok
- return b298 on 2026-11-26 -> ok
- checkout b298 by m82 (student-family) on 2026-11-27 -> error "held for another member"
- fines: m59 630c
- overdue on 2026-12-27: none
- notices on 2026-11-27: hold-ready m62 b298 until 2026-11-29

### D.305

- checkout b235 by m81 (adult-remote) on 2026-08-21 -> ok
- reserve b235 by m9 -> ok
- return b235 on 2026-09-23 -> ok
- checkout b235 by m59 (student-branch) on 2026-09-25 -> error "held for another member"
- fines: m81 165c
- overdue on 2026-10-25: none
- notices on 2026-09-25: hold-ready m9 b235 until 2026-09-26

### D.306

- checkout b243 by m69 (student-remote) on 2026-08-21 -> ok
- reserve b243 by m4 -> ok
- return b243 on 2026-08-21 -> ok
- checkout b243 by m98 (scholar-branch) on 2026-08-25 -> ok
- fines: none
- overdue on 2026-09-24: none
- notices on 2026-08-25: none

### D.307

- checkout b19 by m79 (senior-trial) on 2026-11-21 -> ok
- reserve b19 by m47 -> ok
- return b19 on 2026-12-31 -> ok
- checkout b19 by m9 (scholar-remote) on 2027-01-01 -> error "held for another member"
- fines: m79 585c
- overdue on 2027-01-31: none
- notices on 2027-01-01: hold-ready m47 b19 until 2027-01-03

### D.308

- checkout b284 by m2 (staff-remote) on 2026-04-28 -> ok
- reserve b284 by m39 -> ok
- return b284 on 2026-06-02 -> ok
- checkout b284 by m27 (scholar-plus) on 2026-06-07 -> ok
- fines: none
- overdue on 2026-07-07: none
- notices on 2026-06-07: none

### D.309

- checkout b109 by m60 (staff-platinum) on 2026-10-29 -> ok
- reserve b109 by m100 -> ok
- return b109 on 2026-12-27 -> ok
- checkout b109 by m65 (child-branch) on 2026-12-31 -> ok
- fines: none
- overdue on 2027-01-30: b109/m65/16
- notices on 2026-12-31: none

### D.310

- checkout b87 by m116 (scholar-gold) on 2026-01-26 -> ok
- reserve b87 by m110 -> ok
- return b87 on 2026-02-06 -> ok
- checkout b87 by m6 (student-gold) on 2026-02-10 -> ok
- fines: none
- overdue on 2026-03-12: none
- notices on 2026-02-10: none

### D.311

- checkout b6 by m107 (senior-silver) on 2026-06-13 -> ok
- reserve b6 by m75 -> ok
- return b6 on 2026-07-02 -> ok
- checkout b6 by m27 (scholar-plus) on 2026-07-07 -> ok
- fines: none
- overdue on 2026-08-06: none
- notices on 2026-07-07: none

### D.312

- checkout b92 by m49 (student-family) on 2026-04-05 -> ok
- reserve b92 by m32 -> ok
- return b92 on 2026-05-06 -> ok
- checkout b92 by m9 (scholar-remote) on 2026-05-11 -> ok
- fines: none
- overdue on 2026-06-10: none
- notices on 2026-05-11: none

### D.313

- checkout b177 by m101 (child-basic) on 2026-07-29 -> ok
- reserve b177 by m36 -> ok
- return b177 on 2026-08-09 -> ok
- checkout b177 by m76 (scholar-honorary) on 2026-08-10 -> error "held for another member"
- fines: m101 40c
- overdue on 2026-09-09: none
- notices on 2026-08-10: hold-ready m36 b177 until 2026-08-12

### D.314

- checkout b192 by m81 (adult-remote) on 2026-10-29 -> ok
- reserve b192 by m52 -> ok
- return b192 on 2026-11-21 -> ok
- checkout b192 by m3 (student-honorary) on 2026-11-23 -> error "held for another member"
- fines: none
- overdue on 2026-12-23: none
- notices on 2026-11-23: hold-ready m52 b192 until 2026-11-24

### D.315

- checkout b105 by m7 (child-platinum) on 2026-06-13 -> ok
- reserve b105 by m49 -> ok
- return b105 on 2026-07-30 -> ok
- checkout b105 by m30 (scholar-plus) on 2026-08-03 -> ok
- fines: m7 500c
- overdue on 2026-09-02: none
- notices on 2026-08-03: none

### D.316

- checkout b109 by m73 (student-branch) on 2026-07-29 -> ok
- reserve b109 by m65 -> ok
- return b109 on 2026-08-10 -> ok
- checkout b109 by m16 (staff-platinum) on 2026-08-15 -> ok
- fines: none
- overdue on 2026-09-14: b109/m16/2
- notices on 2026-08-15: none

### D.317

- checkout b275 by m86 (student-honorary) on 2026-07-29 -> ok
- reserve b275 by m31 -> ok
- return b275 on 2026-08-27 -> ok
- checkout b275 by m20 (senior-plus) on 2026-08-29 -> error "held for another member"
- fines: none
- overdue on 2026-09-28: none
- notices on 2026-08-29: hold-ready m31 b275 until 2026-08-30

### D.318

- checkout b278 by m58 (child-basic) on 2026-07-06 -> ok
- reserve b278 by m103 -> ok
- return b278 on 2026-08-09 -> ok
- checkout b278 by m91 (student-silver) on 2026-08-13 -> ok
- fines: m58 100c
- overdue on 2026-09-12: none
- notices on 2026-08-13: none

### D.319

- checkout b221 by m62 (student-remote) on 2026-07-06 -> ok
- reserve b221 by m45 -> ok
- return b221 on 2026-08-04 -> ok
- checkout b221 by m19 (senior-silver) on 2026-08-09 -> ok
- fines: none
- overdue on 2026-09-08: none
- notices on 2026-08-09: none

### D.320

- checkout b238 by m56 (scholar-basic) on 2026-08-21 -> ok
- reserve b238 by m76 -> ok
- return b238 on 2026-08-22 -> ok
- checkout b238 by m95 (scholar-trial) on 2026-08-26 -> ok
- fines: none
- overdue on 2026-09-25: none
- notices on 2026-08-26: none

### D.321

- checkout b42 by m97 (staff-platinum) on 2026-04-28 -> ok
- reserve b42 by m54 -> ok
- return b42 on 2026-06-03 -> ok
- checkout b42 by m12 (scholar-plus) on 2026-06-07 -> ok
- fines: none
- overdue on 2026-07-07: none
- notices on 2026-06-07: none

### D.322

- checkout b259 by m4 (senior-plus) on 2026-07-06 -> ok
- reserve b259 by m27 -> ok
- return b259 on 2026-08-23 -> ok
- checkout b259 by m35 (student-basic) on 2026-08-27 -> ok
- fines: m4 150c
- overdue on 2026-09-26: b259/m35/9
- notices on 2026-08-27: none

### D.323

- checkout b131 by m22 (senior-honorary) on 2026-01-03 -> ok
- reserve b131 by m85 -> ok
- return b131 on 2026-03-02 -> ok
- checkout b131 by m71 (senior-plus) on 2026-03-03 -> error "held for another member"
- fines: m22 1100c
- overdue on 2026-04-02: none
- notices on 2026-03-03: hold-ready m85 b131 until 2026-03-05

### D.324

- checkout b181 by m57 (student-plus) on 2026-11-21 -> ok
- reserve b181 by m34 -> ok
- return b181 on 2027-01-08 -> ok
- checkout b181 by m105 (student-gold) on 2027-01-11 -> error "held for another member"
- fines: m57 240c
- overdue on 2027-02-10: none
- notices on 2027-01-11: hold-ready m34 b181 until 2027-01-11

### D.325

- checkout b108 by m103 (student-trial) on 2026-08-21 -> ok
- reserve b108 by m17 -> ok
- return b108 on 2026-09-06 -> ok
- checkout b108 by m34 (staff-silver) on 2026-09-10 -> ok
- fines: none
- overdue on 2026-10-10: none
- notices on 2026-09-10: none

### D.326

- checkout b290 by m23 (child-plus) on 2026-10-06 -> ok
- reserve b290 by m95 -> ok
- return b290 on 2026-10-11 -> ok
- checkout b290 by m10 (student-honorary) on 2026-10-12 -> error "held for another member"
- fines: none
- overdue on 2026-11-11: none
- notices on 2026-10-12: hold-ready m95 b290 until 2026-10-14

### D.327

- checkout b3 by m23 (child-plus) on 2026-10-06 -> ok
- reserve b3 by m12 -> ok
- return b3 on 2026-11-01 -> ok
- checkout b3 by m23 (child-plus) on 2026-11-06 -> ok
- fines: m23 165c
- overdue on 2026-12-06: b3/m23/16
- notices on 2026-11-06: none

### D.328

- checkout b109 by m46 (adult-gold) on 2026-01-03 -> ok
- reserve b109 by m35 -> ok
- return b109 on 2026-02-22 -> ok
- checkout b109 by m44 (senior-trial) on 2026-02-26 -> ok
- fines: m46 520c
- overdue on 2026-03-28: b109/m44/9
- notices on 2026-02-26: none

### D.329

- checkout b205 by m16 (staff-platinum) on 2026-04-28 -> ok
- reserve b205 by m58 -> ok
- return b205 on 2026-06-06 -> ok
- checkout b205 by m68 (student-trial) on 2026-06-07 -> error "held for another member"
- fines: none
- overdue on 2026-07-07: none
- notices on 2026-06-07: hold-ready m58 b205 until 2026-06-09

### D.330

- checkout b9 by m88 (scholar-basic) on 2026-01-03 -> ok
- reserve b9 by m93 -> ok
- return b9 on 2026-02-21 -> ok
- checkout b9 by m100 (scholar-gold) on 2026-02-22 -> error "held for another member"
- fines: none
- overdue on 2026-03-24: none
- notices on 2026-02-22: hold-ready m93 b9 until 2026-02-24

### D.331

- checkout b211 by m89 (child-family) on 2026-08-21 -> ok
- reserve b211 by m83 -> ok
- return b211 on 2026-09-15 -> ok
- checkout b211 by m105 (student-gold) on 2026-09-18 -> error "held for another member"
- fines: none
- overdue on 2026-10-18: none
- notices on 2026-09-18: hold-ready m83 b211 until 2026-09-18

### D.332

- checkout b114 by m31 (student-basic) on 2026-04-05 -> ok
- reserve b114 by m41 -> ok
- return b114 on 2026-05-27 -> ok
- checkout b114 by m74 (student-silver) on 2026-05-28 -> error "held for another member"
- fines: m31 280c
- overdue on 2026-06-27: none
- notices on 2026-05-28: hold-ready m41 b114 until 2026-05-30

### D.333

- checkout b179 by m1 (student-family) on 2026-07-06 -> ok
- reserve b179 by m14 -> ok
- return b179 on 2026-07-07 -> ok
- checkout b179 by m81 (adult-remote) on 2026-07-08 -> error "held for another member"
- fines: none
- overdue on 2026-08-07: none
- notices on 2026-07-08: hold-ready m14 b179 until 2026-07-10

### D.334

- checkout b247 by m120 (staff-plus) on 2026-06-13 -> ok
- reserve b247 by m99 -> ok
- return b247 on 2026-06-18 -> ok
- checkout b247 by m80 (staff-platinum) on 2026-06-20 -> error "held for another member"
- fines: none
- overdue on 2026-07-20: none
- notices on 2026-06-20: hold-ready m99 b247 until 2026-06-21

### D.335

- checkout b10 by m94 (staff-remote) on 2026-11-21 -> ok
- reserve b10 by m100 -> ok
- return b10 on 2027-01-12 -> ok
- checkout b10 by m89 (child-family) on 2027-01-13 -> error "held for another member"
- fines: none
- overdue on 2027-02-12: none
- notices on 2027-01-13: hold-ready m100 b10 until 2027-01-15

### D.336

- checkout b52 by m61 (adult-trial) on 2026-03-13 -> ok
- reserve b52 by m57 -> ok
- return b52 on 2026-03-14 -> ok
- checkout b52 by m114 (scholar-honorary) on 2026-03-18 -> ok
- fines: none
- overdue on 2026-04-17: none
- notices on 2026-03-18: none

### D.337

- checkout b4 by m21 (staff-honorary) on 2026-05-21 -> ok
- reserve b4 by m3 -> ok
- return b4 on 2026-05-28 -> ok
- checkout b4 by m84 (senior-remote) on 2026-05-30 -> error "held for another member"
- fines: none
- overdue on 2026-06-29: none
- notices on 2026-05-30: hold-ready m3 b4 until 2026-05-31

### D.338

- checkout b182 by m73 (student-branch) on 2026-06-13 -> ok
- reserve b182 by m7 -> ok
- return b182 on 2026-07-28 -> ok
- checkout b182 by m60 (staff-platinum) on 2026-07-29 -> error "held for another member"
- fines: m73 420c
- overdue on 2026-08-28: none
- notices on 2026-07-29: hold-ready m7 b182 until 2026-07-31

### D.339

- checkout b142 by m72 (adult-family) on 2026-10-29 -> ok
- reserve b142 by m67 -> ok
- return b142 on 2026-12-08 -> ok
- checkout b142 by m88 (scholar-basic) on 2026-12-09 -> error "held for another member"
- fines: m72 120c
- overdue on 2027-01-08: none
- notices on 2026-12-09: hold-ready m67 b142 until 2026-12-11

### D.340

- checkout b39 by m27 (scholar-plus) on 2026-01-26 -> ok
- reserve b39 by m54 -> ok
- return b39 on 2026-02-20 -> ok
- checkout b39 by m16 (staff-platinum) on 2026-02-24 -> ok
- fines: none
- overdue on 2026-03-26: b39/m16/2
- notices on 2026-02-24: none

### D.341

- checkout b166 by m41 (staff-family) on 2026-10-29 -> ok
- reserve b166 by m64 -> ok
- return b166 on 2026-11-23 -> ok
- checkout b166 by m67 (staff-honorary) on 2026-11-26 -> error "held for another member"
- fines: none
- overdue on 2026-12-26: none
- notices on 2026-11-26: hold-ready m64 b166 until 2026-11-26

### D.342

- checkout b295 by m79 (senior-trial) on 2026-03-13 -> ok
- reserve b295 by m11 -> ok
- return b295 on 2026-03-22 -> ok
- checkout b295 by m10 (student-honorary) on 2026-03-27 -> ok
- fines: none
- overdue on 2026-04-26: b295/m10/2
- notices on 2026-03-27: none

### D.343

- checkout b107 by m1 (student-family) on 2026-02-18 -> ok
- reserve b107 by m68 -> ok
- return b107 on 2026-03-19 -> ok
- checkout b107 by m29 (child-gold) on 2026-03-20 -> error "held for another member"
- fines: none
- overdue on 2026-04-19: none
- notices on 2026-03-20: hold-ready m68 b107 until 2026-03-22

### D.344

- checkout b8 by m54 (adult-honorary) on 2026-04-05 -> ok
- reserve b8 by m119 -> ok
- return b8 on 2026-05-05 -> ok
- checkout b8 by m104 (senior-silver) on 2026-05-06 -> error "held for another member"
- fines: m54 490c
- overdue on 2026-06-05: none
- notices on 2026-05-06: hold-ready m119 b8 until 2026-05-08

### D.345

- checkout b294 by m77 (student-silver) on 2026-10-06 -> ok
- reserve b294 by m44 -> ok
- return b294 on 2026-11-07 -> ok
- checkout b294 by m34 (staff-silver) on 2026-11-12 -> ok
- fines: none
- overdue on 2026-12-12: none
- notices on 2026-11-12: none

### D.346

- checkout b261 by m116 (scholar-gold) on 2026-01-03 -> ok
- reserve b261 by m58 -> ok
- return b261 on 2026-02-24 -> ok
- checkout b261 by m25 (staff-basic) on 2026-02-28 -> ok
- fines: none
- overdue on 2026-03-30: b261/m25/2
- notices on 2026-02-28: none

### D.347

- checkout b14 by m26 (adult-branch) on 2026-11-21 -> ok
- reserve b14 by m96 -> ok
- return b14 on 2026-12-21 -> ok
- checkout b14 by m83 (senior-gold) on 2026-12-22 -> error "held for another member"
- fines: m26 250c
- overdue on 2027-01-21: none
- notices on 2026-12-22: hold-ready m96 b14 until 2026-12-24

### D.348

- checkout b166 by m19 (senior-silver) on 2026-10-29 -> ok
- reserve b166 by m114 -> ok
- return b166 on 2026-11-07 -> ok
- checkout b166 by m90 (staff-remote) on 2026-11-12 -> ok
- fines: none
- overdue on 2026-12-12: none
- notices on 2026-11-12: none

### D.349

- checkout b111 by m110 (scholar-basic) on 2026-09-13 -> ok
- reserve b111 by m32 -> ok
- return b111 on 2026-10-21 -> ok
- checkout b111 by m17 (senior-platinum) on 2026-10-25 -> ok
- fines: none
- overdue on 2026-11-24: b111/m17/9
- notices on 2026-10-25: none

### D.350

- checkout b191 by m70 (student-platinum) on 2026-07-29 -> ok
- reserve b191 by m92 -> ok
- return b191 on 2026-08-24 -> ok
- checkout b191 by m69 (student-remote) on 2026-08-29 -> ok
- fines: m70 30c
- overdue on 2026-09-28: none
- notices on 2026-08-29: none

### D.351

- checkout b186 by m18 (senior-plus) on 2026-08-21 -> ok
- reserve b186 by m31 -> ok
- return b186 on 2026-10-11 -> ok
- checkout b186 by m60 (staff-platinum) on 2026-10-15 -> ok
- fines: m18 180c
- overdue on 2026-11-14: b186/m60/2
- notices on 2026-10-15: none

### D.352

- checkout b88 by m76 (scholar-honorary) on 2026-07-29 -> ok
- reserve b88 by m22 -> ok
- return b88 on 2026-08-24 -> ok
- checkout b88 by m42 (scholar-remote) on 2026-08-29 -> ok
- fines: none
- overdue on 2026-09-28: none
- notices on 2026-08-29: none

### D.353

- checkout b204 by m52 (scholar-honorary) on 2026-09-13 -> ok
- reserve b204 by m55 -> ok
- return b204 on 2026-11-06 -> ok
- checkout b204 by m27 (scholar-plus) on 2026-11-11 -> ok
- fines: none
- overdue on 2026-12-11: none
- notices on 2026-11-11: none

### D.354

- checkout b170 by m7 (child-platinum) on 2026-08-21 -> ok
- reserve b170 by m119 -> ok
- return b170 on 2026-09-11 -> ok
- checkout b170 by m48 (adult-honorary) on 2026-09-13 -> error "held for another member"
- fines: m7 390c
- overdue on 2026-10-13: none
- notices on 2026-09-13: hold-ready m119 b170 until 2026-09-14

### D.355

- checkout b263 by m26 (adult-branch) on 2026-06-13 -> ok
- reserve b263 by m76 -> ok
- return b263 on 2026-07-13 -> ok
- checkout b263 by m6 (student-gold) on 2026-07-15 -> error "held for another member"
- fines: m26 250c
- overdue on 2026-08-14: none
- notices on 2026-07-15: hold-ready m76 b263 until 2026-07-16

### D.356

- checkout b221 by m40 (child-branch) on 2026-07-06 -> ok
- reserve b221 by m83 -> ok
- return b221 on 2026-07-25 -> ok
- checkout b221 by m41 (staff-family) on 2026-07-27 -> error "held for another member"
- fines: m40 105c
- overdue on 2026-08-26: none
- notices on 2026-07-27: hold-ready m83 b221 until 2026-07-28

### D.357

- checkout b52 by m61 (adult-trial) on 2026-04-28 -> ok
- reserve b52 by m112 -> ok
- return b52 on 2026-06-09 -> ok
- checkout b52 by m15 (adult-trial) on 2026-06-10 -> error "held for another member"
- fines: m61 1300c
- overdue on 2026-07-10: none
- notices on 2026-06-10: hold-ready m112 b52 until 2026-06-12

### D.358

- checkout b294 by m83 (senior-gold) on 2026-07-29 -> ok
- reserve b294 by m110 -> ok
- return b294 on 2026-08-28 -> ok
- checkout b294 by m78 (student-platinum) on 2026-08-29 -> error "held for another member"
- fines: none
- overdue on 2026-09-28: none
- notices on 2026-08-29: hold-ready m110 b294 until 2026-08-31

### D.359

- checkout b184 by m12 (scholar-plus) on 2026-10-06 -> ok
- reserve b184 by m66 -> ok
- return b184 on 2026-10-06 -> ok
- checkout b184 by m19 (senior-silver) on 2026-10-11 -> ok
- fines: none
- overdue on 2026-11-10: none
- notices on 2026-10-11: none

### D.360

- checkout b154 by m7 (child-platinum) on 2026-01-26 -> ok
- reserve b154 by m111 -> ok
- return b154 on 2026-03-04 -> ok
- checkout b154 by m73 (student-branch) on 2026-03-09 -> ok
- fines: m7 500c
- overdue on 2026-04-08: b154/m73/2
- notices on 2026-03-09: none

### D.361

- checkout b96 by m71 (senior-plus) on 2026-08-21 -> ok
- reserve b96 by m103 -> ok
- return b96 on 2026-09-18 -> ok
- checkout b96 by m46 (adult-gold) on 2026-09-23 -> ok
- fines: none
- overdue on 2026-10-23: none
- notices on 2026-09-23: none

### D.362

- checkout b230 by m117 (student-branch) on 2026-08-21 -> ok
- reserve b230 by m73 -> ok
- return b230 on 2026-09-15 -> ok
- checkout b230 by m89 (child-family) on 2026-09-18 -> error "held for another member"
- fines: none
- overdue on 2026-10-18: none
- notices on 2026-09-18: hold-ready m73 b230 until 2026-09-18

### D.363

- checkout b276 by m47 (senior-gold) on 2026-01-26 -> ok
- reserve b276 by m111 -> ok
- return b276 on 2026-02-24 -> ok
- checkout b276 by m48 (adult-honorary) on 2026-02-28 -> ok
- fines: none
- overdue on 2026-03-30: b276/m48/9
- notices on 2026-02-28: none

### D.364

- checkout b167 by m94 (staff-remote) on 2026-03-13 -> ok
- reserve b167 by m33 -> ok
- return b167 on 2026-03-27 -> ok
- checkout b167 by m24 (child-platinum) on 2026-03-29 -> error "held for another member"
- fines: none
- overdue on 2026-04-28: none
- notices on 2026-03-29: hold-ready m33 b167 until 2026-03-30

### D.365

- checkout b160 by m27 (scholar-plus) on 2026-04-05 -> ok
- reserve b160 by m61 -> ok
- return b160 on 2026-04-26 -> ok
- checkout b160 by m73 (student-branch) on 2026-04-27 -> error "held for another member"
- fines: none
- overdue on 2026-05-27: none
- notices on 2026-04-27: hold-ready m61 b160 until 2026-04-29

### D.366

- checkout b185 by m101 (child-basic) on 2026-10-06 -> ok
- reserve b185 by m10 -> ok
- return b185 on 2026-10-21 -> ok
- checkout b185 by m70 (student-platinum) on 2026-10-23 -> error "held for another member"
- fines: m101 80c
- overdue on 2026-11-22: none
- notices on 2026-10-23: hold-ready m10 b185 until 2026-10-24

### D.367

- checkout b127 by m104 (senior-silver) on 2026-10-29 -> ok
- reserve b127 by m105 -> ok
- return b127 on 2026-12-01 -> ok
- checkout b127 by m79 (senior-trial) on 2026-12-06 -> ok
- fines: none
- overdue on 2027-01-05: b127/m79/9
- notices on 2026-12-06: none

### D.368

- checkout b141 by m2 (staff-remote) on 2026-10-29 -> ok
- reserve b141 by m47 -> ok
- return b141 on 2026-11-03 -> ok
- checkout b141 by m23 (child-plus) on 2026-11-08 -> ok
- fines: none
- overdue on 2026-12-08: b141/m23/16
- notices on 2026-11-08: none

### D.369

- checkout b18 by m49 (student-family) on 2026-04-28 -> ok
- reserve b18 by m119 -> ok
- return b18 on 2026-05-13 -> ok
- checkout b18 by m66 (student-basic) on 2026-05-18 -> ok
- fines: none
- overdue on 2026-06-17: b18/m66/9
- notices on 2026-05-18: none

### D.370

- checkout b31 by m3 (student-honorary) on 2026-10-29 -> ok
- reserve b31 by m110 -> ok
- return b31 on 2026-11-09 -> ok
- checkout b31 by m118 (child-basic) on 2026-11-10 -> error "held for another member"
- fines: none
- overdue on 2026-12-10: none
- notices on 2026-11-10: hold-ready m110 b31 until 2026-11-12

### D.371

- checkout b53 by m52 (scholar-honorary) on 2026-10-29 -> ok
- reserve b53 by m102 -> ok
- return b53 on 2026-12-01 -> ok
- checkout b53 by m113 (student-plus) on 2026-12-06 -> ok
- fines: none
- overdue on 2027-01-05: b53/m113/2
- notices on 2026-12-06: none

### D.372

- checkout b198 by m69 (student-remote) on 2026-07-29 -> ok
- reserve b198 by m43 -> ok
- return b198 on 2026-08-19 -> ok
- checkout b198 by m1 (student-family) on 2026-08-20 -> error "held for another member"
- fines: none
- overdue on 2026-09-19: none
- notices on 2026-08-20: hold-ready m43 b198 until 2026-08-22

### D.373

- checkout b104 by m62 (student-remote) on 2026-01-26 -> ok
- reserve b104 by m98 -> ok
- return b104 on 2026-02-21 -> ok
- checkout b104 by m18 (senior-plus) on 2026-02-22 -> error "held for another member"
- fines: none
- overdue on 2026-03-24: none
- notices on 2026-02-22: hold-ready m98 b104 until 2026-02-24

### D.374

- checkout b204 by m16 (staff-platinum) on 2026-01-03 -> ok
- reserve b204 by m110 -> ok
- return b204 on 2026-02-08 -> ok
- checkout b204 by m79 (senior-trial) on 2026-02-11 -> error "held for another member"
- fines: none
- overdue on 2026-03-13: none
- notices on 2026-02-11: hold-ready m110 b204 until 2026-02-11

### D.375

- checkout b154 by m71 (senior-plus) on 2026-06-13 -> ok
- reserve b154 by m81 -> ok
- return b154 on 2026-08-05 -> ok
- checkout b154 by m3 (student-honorary) on 2026-08-09 -> ok
- fines: m71 200c
- overdue on 2026-09-08: b154/m3/2
- notices on 2026-08-09: none

### D.376

- checkout b129 by m29 (child-gold) on 2026-03-13 -> ok
- reserve b129 by m17 -> ok
- return b129 on 2026-04-01 -> ok
- checkout b129 by m3 (student-honorary) on 2026-04-04 -> error "held for another member"
- fines: none
- overdue on 2026-05-04: none
- notices on 2026-04-04: hold-ready m17 b129 until 2026-04-04

### D.377

- checkout b296 by m109 (adult-family) on 2026-01-26 -> ok
- reserve b296 by m68 -> ok
- return b296 on 2026-03-25 -> ok
- checkout b296 by m59 (student-branch) on 2026-03-30 -> ok
- fines: m109 1200c
- overdue on 2026-04-29: b296/m59/2
- notices on 2026-03-30: none

### D.378

- checkout b4 by m25 (staff-basic) on 2026-04-05 -> ok
- reserve b4 by m89 -> ok
- return b4 on 2026-05-14 -> ok
- checkout b4 by m57 (student-plus) on 2026-05-17 -> error "held for another member"
- fines: none
- overdue on 2026-06-16: none
- notices on 2026-05-17: hold-ready m89 b4 until 2026-05-17

### D.379

- checkout b119 by m7 (child-platinum) on 2026-03-13 -> ok
- reserve b119 by m5 -> ok
- return b119 on 2026-05-09 -> ok
- checkout b119 by m42 (scholar-remote) on 2026-05-10 -> error "held for another member"
- fines: m7 500c
- overdue on 2026-06-09: none
- notices on 2026-05-10: hold-ready m5 b119 until 2026-05-12

### D.380

- checkout b249 by m68 (student-trial) on 2026-11-21 -> ok
- reserve b249 by m46 -> ok
- return b249 on 2027-01-05 -> ok
- checkout b249 by m37 (student-silver) on 2027-01-06 -> error "held for another member"
- fines: m68 950c
- overdue on 2027-02-05: none
- notices on 2027-01-06: hold-ready m46 b249 until 2027-01-08

### D.381

- checkout b86 by m54 (adult-honorary) on 2026-04-05 -> ok
- reserve b86 by m105 -> ok
- return b86 on 2026-04-06 -> ok
- checkout b86 by m70 (student-platinum) on 2026-04-11 -> ok
- fines: none
- overdue on 2026-05-11: b86/m70/9
- notices on 2026-04-11: none

### D.382

- checkout b139 by m45 (scholar-family) on 2026-10-29 -> ok
- reserve b139 by m15 -> ok
- return b139 on 2026-11-10 -> ok
- checkout b139 by m46 (adult-gold) on 2026-11-15 -> ok
- fines: none
- overdue on 2026-12-15: none
- notices on 2026-11-15: none

### D.383

- checkout b136 by m93 (scholar-basic) on 2026-10-06 -> ok
- reserve b136 by m113 -> ok
- return b136 on 2026-11-04 -> ok
- checkout b136 by m71 (senior-plus) on 2026-11-08 -> ok
- fines: none
- overdue on 2026-12-08: b136/m71/2
- notices on 2026-11-08: none

### D.384

- checkout b271 by m35 (student-basic) on 2026-07-29 -> ok
- reserve b271 by m35 -> error "already has it"
- return b271 on 2026-09-02 -> ok
- checkout b271 by m29 (child-gold) on 2026-09-05 -> ok
- fines: m35 110c
- overdue on 2026-10-05: b271/m29/2
- notices on 2026-09-05: none

### D.385

- checkout b96 by m59 (student-branch) on 2026-05-21 -> ok
- reserve b96 by m118 -> ok
- return b96 on 2026-07-11 -> ok
- checkout b96 by m72 (adult-family) on 2026-07-16 -> ok
- fines: m59 630c
- overdue on 2026-08-15: none
- notices on 2026-07-16: none

### D.386

- checkout b254 by m105 (student-gold) on 2026-11-21 -> ok
- reserve b254 by m28 -> ok
- return b254 on 2026-12-25 -> ok
- checkout b254 by m41 (staff-family) on 2026-12-27 -> error "held for another member"
- fines: none
- overdue on 2027-01-26: none
- notices on 2026-12-27: hold-ready m28 b254 until 2026-12-28

### D.387

- checkout b51 by m83 (senior-gold) on 2026-01-03 -> ok
- reserve b51 by m93 -> ok
- return b51 on 2026-02-12 -> ok
- checkout b51 by m33 (child-honorary) on 2026-02-16 -> ok
- fines: none
- overdue on 2026-03-18: b51/m33/16
- notices on 2026-02-16: none

### D.388

- checkout b15 by m114 (scholar-honorary) on 2026-05-21 -> ok
- reserve b15 by m45 -> ok
- return b15 on 2026-06-16 -> ok
- checkout b15 by m112 (student-branch) on 2026-06-18 -> error "held for another member"
- fines: none
- overdue on 2026-07-18: none
- notices on 2026-06-18: hold-ready m45 b15 until 2026-06-19

### D.389

- checkout b120 by m56 (scholar-basic) on 2026-04-05 -> ok
- reserve b120 by m86 -> ok
- return b120 on 2026-05-26 -> ok
- checkout b120 by m36 (child-silver) on 2026-05-30 -> ok
- fines: m56 100c
- overdue on 2026-06-29: b120/m36/9
- notices on 2026-05-30: none

### D.390

- checkout b138 by m63 (senior-family) on 2026-10-29 -> ok
- reserve b138 by m32 -> ok
- return b138 on 2026-12-19 -> ok
- checkout b138 by m120 (staff-plus) on 2026-12-24 -> ok
- fines: m63 160c
- overdue on 2027-01-23: none
- notices on 2026-12-24: none

### D.391

- checkout b49 by m38 (staff-honorary) on 2026-01-26 -> ok
- reserve b49 by m111 -> ok
- return b49 on 2026-03-06 -> ok
- checkout b49 by m2 (staff-remote) on 2026-03-10 -> ok
- fines: none
- overdue on 2026-04-09: none
- notices on 2026-03-10: none

### D.392

- checkout b90 by m99 (adult-honorary) on 2026-07-06 -> ok
- reserve b90 by m42 -> ok
- return b90 on 2026-07-14 -> ok
- checkout b90 by m7 (child-platinum) on 2026-07-18 -> ok
- fines: none
- overdue on 2026-08-17: b90/m7/23
- notices on 2026-07-18: none

### D.393

- checkout b35 by m91 (student-silver) on 2026-07-29 -> ok
- reserve b35 by m76 -> ok
- return b35 on 2026-09-08 -> ok
- checkout b35 by m64 (scholar-branch) on 2026-09-10 -> error "held for another member"
- fines: m91 20c
- overdue on 2026-10-10: none
- notices on 2026-09-10: hold-ready m76 b35 until 2026-09-11

### D.394

- checkout b261 by m18 (senior-plus) on 2026-01-26 -> ok
- reserve b261 by m108 -> ok
- return b261 on 2026-02-07 -> ok
- checkout b261 by m40 (child-branch) on 2026-02-08 -> error "held for another member"
- fines: none
- overdue on 2026-03-10: none
- notices on 2026-02-08: hold-ready m108 b261 until 2026-02-10

### D.395

- checkout b284 by m55 (adult-plus) on 2026-04-05 -> ok
- reserve b284 by m118 -> ok
- return b284 on 2026-04-10 -> ok
- checkout b284 by m71 (senior-plus) on 2026-04-11 -> error "held for another member"
- fines: none
- overdue on 2026-05-11: none
- notices on 2026-04-11: hold-ready m118 b284 until 2026-04-13

### D.396

- checkout b179 by m38 (staff-honorary) on 2026-09-13 -> ok
- reserve b179 by m18 -> ok
- return b179 on 2026-10-17 -> ok
- checkout b179 by m72 (adult-family) on 2026-10-20 -> error "held for another member"
- fines: none
- overdue on 2026-11-19: none
- notices on 2026-10-20: hold-ready m18 b179 until 2026-10-20

### D.397

- checkout b190 by m15 (adult-trial) on 2026-01-26 -> ok
- reserve b190 by m38 -> ok
- return b190 on 2026-01-29 -> ok
- checkout b190 by m61 (adult-trial) on 2026-02-03 -> ok
- fines: none
- overdue on 2026-03-05: b190/m61/16
- notices on 2026-02-03: none

### D.398

- checkout b289 by m47 (senior-gold) on 2026-04-05 -> ok
- reserve b289 by m78 -> ok
- return b289 on 2026-04-18 -> ok
- checkout b289 by m29 (child-gold) on 2026-04-19 -> error "held for another member"
- fines: none
- overdue on 2026-05-19: none
- notices on 2026-04-19: hold-ready m78 b289 until 2026-04-21

### D.399

- checkout b66 by m54 (adult-honorary) on 2026-10-06 -> ok
- reserve b66 by m71 -> ok
- return b66 on 2026-11-19 -> ok
- checkout b66 by m10 (student-honorary) on 2026-11-20 -> error "held for another member"
- fines: m54 1400c
- overdue on 2026-12-20: none
- notices on 2026-11-20: hold-ready m71 b66 until 2026-11-22

### D.400

- checkout b237 by m5 (child-remote) on 2026-07-06 -> ok
- reserve b237 by m13 -> ok
- return b237 on 2026-08-28 -> ok
- checkout b237 by m111 (child-platinum) on 2026-08-31 -> error "held for another member"
- fines: m5 700c
- overdue on 2026-09-30: none
- notices on 2026-08-31: hold-ready m13 b237 until 2026-08-31

### D.401

- checkout b30 by m101 (child-basic) on 2026-04-28 -> ok
- reserve b30 by m5 -> ok
- return b30 on 2026-06-11 -> ok
- checkout b30 by m89 (child-family) on 2026-06-15 -> ok
- fines: m101 100c
- overdue on 2026-07-15: b30/m89/2
- notices on 2026-06-15: none

### D.402

- checkout b258 by m3 (student-honorary) on 2026-01-26 -> ok
- reserve b258 by m44 -> ok
- return b258 on 2026-02-06 -> ok
- checkout b258 by m111 (child-platinum) on 2026-02-07 -> error "held for another member"
- fines: none
- overdue on 2026-03-09: none
- notices on 2026-02-07: hold-ready m44 b258 until 2026-02-09

### D.403

- checkout b149 by m82 (student-family) on 2026-04-28 -> ok
- reserve b149 by m103 -> ok
- return b149 on 2026-05-02 -> ok
- checkout b149 by m14 (scholar-branch) on 2026-05-04 -> error "held for another member"
- fines: none
- overdue on 2026-06-03: none
- notices on 2026-05-04: hold-ready m103 b149 until 2026-05-05

### D.404

- checkout b142 by m14 (scholar-branch) on 2026-09-13 -> ok
- reserve b142 by m22 -> ok
- return b142 on 2026-10-08 -> ok
- checkout b142 by m113 (student-plus) on 2026-10-10 -> error "held for another member"
- fines: none
- overdue on 2026-11-09: none
- notices on 2026-10-10: hold-ready m22 b142 until 2026-10-11

### D.405

- checkout b279 by m56 (scholar-basic) on 2026-07-29 -> ok
- reserve b279 by m91 -> ok
- return b279 on 2026-09-02 -> ok
- checkout b279 by m88 (scholar-basic) on 2026-09-04 -> error "held for another member"
- fines: none
- overdue on 2026-10-04: none
- notices on 2026-09-04: hold-ready m91 b279 until 2026-09-05

### D.406

- checkout b176 by m31 (student-basic) on 2026-01-26 -> ok
- reserve b176 by m97 -> ok
- return b176 on 2026-03-18 -> ok
- checkout b176 by m94 (staff-remote) on 2026-03-21 -> error "held for another member"
- fines: m31 270c
- overdue on 2026-04-20: none
- notices on 2026-03-21: hold-ready m97 b176 until 2026-03-21

### D.407

- checkout b248 by m73 (student-branch) on 2026-07-06 -> ok
- reserve b248 by m22 -> ok
- return b248 on 2026-08-22 -> ok
- checkout b248 by m82 (student-family) on 2026-08-27 -> ok
- fines: m73 490c
- overdue on 2026-09-26: none
- notices on 2026-08-27: none

### D.408

- checkout b280 by m15 (adult-trial) on 2026-07-29 -> ok
- reserve b280 by m28 -> ok
- return b280 on 2026-09-18 -> ok
- checkout b280 by m94 (staff-remote) on 2026-09-20 -> error "held for another member"
- fines: m15 1300c
- overdue on 2026-10-20: none
- notices on 2026-09-20: hold-ready m28 b280 until 2026-09-21

### D.409

- checkout b1 by m79 (senior-trial) on 2026-04-05 -> ok
- reserve b1 by m28 -> ok
- return b1 on 2026-05-21 -> ok
- checkout b1 by m99 (adult-honorary) on 2026-05-24 -> error "held for another member"
- fines: m79 855c
- overdue on 2026-06-23: none
- notices on 2026-05-24: hold-ready m28 b1 until 2026-05-24

### D.410

- checkout b191 by m26 (adult-branch) on 2026-04-28 -> ok
- reserve b191 by m55 -> ok
- return b191 on 2026-06-09 -> ok
- checkout b191 by m25 (staff-basic) on 2026-06-12 -> error "held for another member"
- fines: m26 850c
- overdue on 2026-07-12: none
- notices on 2026-06-12: hold-ready m55 b191 until 2026-06-12

### D.411

- checkout b45 by m101 (child-basic) on 2026-07-06 -> ok
- reserve b45 by m18 -> ok
- return b45 on 2026-07-09 -> ok
- checkout b45 by m97 (staff-platinum) on 2026-07-14 -> ok
- fines: none
- overdue on 2026-08-13: b45/m97/2
- notices on 2026-07-14: none

### D.412

- checkout b216 by m15 (adult-trial) on 2026-03-13 -> ok
- reserve b216 by m61 -> ok
- return b216 on 2026-04-29 -> ok
- checkout b216 by m58 (child-basic) on 2026-05-02 -> error "held for another member"
- fines: m15 1300c
- overdue on 2026-06-01: none
- notices on 2026-05-02: hold-ready m61 b216 until 2026-05-02

### D.413

- checkout b162 by m110 (scholar-basic) on 2026-07-06 -> ok
- reserve b162 by m55 -> ok
- return b162 on 2026-08-05 -> ok
- checkout b162 by m36 (child-silver) on 2026-08-09 -> ok
- fines: none
- overdue on 2026-09-08: b162/m36/9
- notices on 2026-08-09: none

### D.414

- checkout b175 by m71 (senior-plus) on 2026-05-21 -> ok
- reserve b175 by m72 -> ok
- return b175 on 2026-07-09 -> ok
- checkout b175 by m90 (staff-remote) on 2026-07-13 -> ok
- fines: m71 160c
- overdue on 2026-08-12: none
- notices on 2026-07-13: none

### D.415

- checkout b245 by m48 (adult-honorary) on 2026-08-21 -> ok
- reserve b245 by m50 -> ok
- return b245 on 2026-10-19 -> ok
- checkout b245 by m15 (adult-trial) on 2026-10-20 -> error "held for another member"
- fines: m48 1400c
- overdue on 2026-11-19: none
- notices on 2026-10-20: hold-ready m50 b245 until 2026-10-22

### D.416

- checkout b180 by m24 (child-platinum) on 2026-03-13 -> ok
- reserve b180 by m12 -> ok
- return b180 on 2026-04-25 -> ok
- checkout b180 by m12 (scholar-plus) on 2026-04-30 -> ok
- fines: m24 500c
- overdue on 2026-05-30: none
- notices on 2026-04-30: none

### D.417

- checkout b49 by m21 (staff-honorary) on 2026-04-05 -> ok
- reserve b49 by m30 -> ok
- return b49 on 2026-04-09 -> ok
- checkout b49 by m24 (child-platinum) on 2026-04-14 -> ok
- fines: none
- overdue on 2026-05-14: b49/m24/23
- notices on 2026-04-14: none

### D.418

- checkout b205 by m73 (student-branch) on 2026-11-21 -> ok
- reserve b205 by m43 -> ok
- return b205 on 2026-11-30 -> ok
- checkout b205 by m81 (adult-remote) on 2026-12-04 -> ok
- fines: none
- overdue on 2027-01-03: b205/m81/2
- notices on 2026-12-04: none

### D.419

- checkout b238 by m88 (scholar-basic) on 2026-06-13 -> ok
- reserve b238 by m35 -> ok
- return b238 on 2026-07-13 -> ok
- checkout b238 by m118 (child-basic) on 2026-07-18 -> ok
- fines: none
- overdue on 2026-08-17: b238/m118/23
- notices on 2026-07-18: none

### D.420

- checkout b246 by m113 (student-plus) on 2026-06-13 -> ok
- reserve b246 by m52 -> ok
- return b246 on 2026-07-24 -> ok
- checkout b246 by m67 (staff-honorary) on 2026-07-29 -> ok
- fines: m113 135c
- overdue on 2026-08-28: none
- notices on 2026-07-29: none

