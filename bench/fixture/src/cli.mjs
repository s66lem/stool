// `run(args, store)` answers one command as text; `add` also returns the new store.
import { parseLine } from './parse.mjs'
import { addBook } from './store.mjs'
import { oldestFirst, search } from './query.mjs'
import { table } from './format.mjs'

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
    default:
      return { text: `unknown command: ${cmd ?? ''}`.trim(), store }
  }
}
