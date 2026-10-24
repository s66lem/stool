import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCsv, parseLine } from '../src/parse.mjs'
import { addBook, createStore, loadJson, toJson } from '../src/store.mjs'
import { byAuthor, search, sortBy } from '../src/query.mjs'
import { table } from '../src/format.mjs'
import { run } from '../src/cli.mjs'

const books = [
  { title: 'Dune', author: 'Frank Herbert', year: 1965, tags: ['scifi'] },
  { title: 'Emma', author: 'Jane Austen', year: 1815, tags: [] },
]

test('parseLine reads a plain line', () => {
  assert.deepEqual(parseLine('Dune,Frank Herbert,1965,scifi;classic'), { title: 'Dune', author: 'Frank Herbert', year: 1965, tags: ['scifi', 'classic'] })
  assert.deepEqual(parseLine('Emma,Jane Austen,1815').tags, [])
})

test('parseCsv skips the header and blank lines', () => {
  assert.equal(parseCsv('title,author,year\nDune,Frank Herbert,1965\n\nEmma,Jane Austen,1815\n').length, 2)
})

test('store adds ids and round-trips through JSON', () => {
  const s = addBook(createStore(books), { title: 'Beloved', author: 'Toni Morrison', year: 1987, tags: [] })
  assert.equal(s.books.at(-1).id, 'b3')
  assert.deepEqual(loadJson(toJson(s)), s)
})

test('queries', () => {
  const s = createStore(books)
  assert.equal(byAuthor(s.books, 'jane austen').length, 1)
  assert.equal(search(s.books, 'du')[0].title, 'Dune')
  assert.equal(sortBy(s.books, 'year')[0].title, 'Emma')
})

test('cli list, find, add, unknown', () => {
  const s = createStore(books)
  assert.equal(run(['list'], s).text, table([s.books[1], s.books[0]]))
  assert.match(run(['find', 'emma'], s).text, /Emma/)
  assert.equal(run(['add', 'Beloved,Toni Morrison,1987'], s).text, 'added b3')
  assert.equal(run(['nope'], s).text, 'unknown command: nope')
})
