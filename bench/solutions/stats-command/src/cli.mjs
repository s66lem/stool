// `run(args, store)` answers one command as text; `add` also returns the new store.
import { parseLine } from './parse.mjs'
import { addBook } from './store.mjs'
import { oldestFirst, search } from './query.mjs'
import { table } from './format.mjs'

function stats(books) {
  if (!books.length) return 'books: 0'
  const byAge = [...books].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title))
  const newest = [...books].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))[0]
  const counts = new Map()
  for (const b of books) counts.set(b.author, (counts.get(b.author) ?? 0) + 1)
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return [`books: ${books.length}`, `authors: ${counts.size}`, `oldest: ${byAge[0].title} (${byAge[0].year})`, `newest: ${newest.title} (${newest.year})`, `top author: ${top} (${n})`].join('\n')
}

export function run(args, store) {
  const [cmd, ...rest] = args
  switch (cmd) {
    case 'list':
      return { text: table(oldestFirst(store.books)), store }
    case 'find':
      return { text: table(search(store.books, rest.join(' '))), store }
    case 'add': {
      const next = addBook(store, parseLine(rest.join(' ')))
      return { text: `added ${next.books.at(-1).id}`, store: next }
    }
    case 'stats':
      return { text: stats(store.books), store }
    default:
      return { text: `unknown command: ${cmd ?? ''}`.trim(), store }
  }
}
