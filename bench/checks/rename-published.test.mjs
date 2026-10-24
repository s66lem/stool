import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

import { parseLine } from '../src/parse.mjs'
import { addBook, createStore, loadJson, toJson } from '../src/store.mjs'
import { oldestFirst, sortBy } from '../src/query.mjs'
import { line } from '../src/format.mjs'
import { run } from '../src/cli.mjs'

test('parsed books carry published, not year', () => {
  const b = parseLine('Emma,Jane Austen,1815')
  assert.equal(b.published, 1815)
  assert.equal('year' in b, false)
})

test('old JSON with year loads as published', () => {
  const s = loadJson(JSON.stringify({ books: [{ id: 'b1', title: 'Emma', author: 'Jane Austen', year: 1815, tags: [] }] }))
  assert.equal(s.books[0].published, 1815)
  assert.equal('year' in s.books[0], false)
  assert.equal(JSON.parse(toJson(s)).books[0].published, 1815)
})

test('queries, format and cli use published', () => {
  const s = addBook(createStore([{ title: 'Dune', author: 'Frank Herbert', published: 1965, tags: [] }]), { title: 'Emma', author: 'Jane Austen', published: 1815, tags: [] })
  assert.equal(sortBy(s.books, 'published')[0].title, 'Emma')
  assert.equal(oldestFirst(s.books)[0].title, 'Emma')
  assert.equal(line(s.books[0]), 'b1 | Dune | Frank Herbert | 1965')
  assert.match(run(['list'], s).text.split('\n')[0], /Emma \| Jane Austen \| 1815$/)
})

// store.mjs may still read `year` to load old JSON
test('no other code under src reads a year field any more', () => {
  for (const f of readdirSync(new URL('../src/', import.meta.url)).filter(f => f !== 'store.mjs')) {
    const text = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(text, /\.year\b|\byear\s*:|'year'/, f)
  }
})
