import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCsv, parseLine } from '../src/parse.mjs'

test('a quoted title may hold commas', () => {
  assert.deepEqual(parseLine('"Dune, Messiah",Frank Herbert,1969,scifi;classic'), { title: 'Dune, Messiah', author: 'Frank Herbert', year: 1969, tags: ['scifi', 'classic'] })
})

test('a quoted author may hold commas', () => {
  const b = parseLine('Collected Poems,"Smith, John",1990')
  assert.equal(b.author, 'Smith, John')
  assert.equal(b.year, 1990)
})

test('doubled quotes inside a quoted field are one quote', () => {
  assert.equal(parseLine('"The ""Real"" Story",Ann Lee,2001').title, 'The "Real" Story')
})

test('plain lines still work and whole files parse', () => {
  assert.deepEqual(parseLine('Emma,Jane Austen,1815'), { title: 'Emma', author: 'Jane Austen', year: 1815, tags: [] })
  const all = parseCsv('title,author,year,tags\n"A, B",C,2000,x\nD,"E, F",2001\n')
  assert.deepEqual(all.map(b => [b.title, b.author]), [['A, B', 'C'], ['D', 'E, F']])
})
