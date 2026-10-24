import { test } from 'node:test'
import assert from 'node:assert/strict'

import { run } from '../src/cli.mjs'
import { createStore } from '../src/store.mjs'

const store = createStore([
  { title: 'Persuasion', author: 'Jane Austen', year: 1817, tags: [] },
  { title: 'Emma', author: 'Jane Austen', year: 1815, tags: [] },
  { title: 'Dune', author: 'Frank Herbert', year: 1965, tags: [] },
  { title: 'Beloved', author: 'Toni Morrison', year: 1987, tags: [] },
  { title: 'Jazz', author: 'Toni Morrison', year: 1992, tags: [] },
  { title: 'Aardvark', author: 'Zed Zee', year: 1815, tags: [] },
])

test('stats prints the five lines', () => {
  assert.equal(run(['stats'], store).text, ['books: 6', 'authors: 4', 'oldest: Aardvark (1815)', 'newest: Jazz (1992)', 'top author: Jane Austen (2)'].join('\n'))
})

test('stats on an empty store is one line', () => {
  assert.equal(run(['stats'], createStore()).text, 'books: 0')
})

test('stats leaves the store alone and other commands work', () => {
  assert.equal(run(['stats'], store).store, store)
  assert.equal(run(['nope'], store).text, 'unknown command: nope')
})
