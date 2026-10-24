// The inventory: a plain object `{ books }`. Functions return new stores and never mutate.

export function createStore(books = []) {
  return { books: books.map((b, i) => ({ id: b.id ?? `b${i + 1}`, ...b })) }
}

export function addBook(store, book) {
  return { books: [...store.books, { id: `b${store.books.length + 1}`, ...book }] }
}

// files written before the rename carry `year`
const legacy = ({ year, ...b }) => (year !== undefined && b.published === undefined ? { ...b, published: year } : b)

export function loadJson(text) {
  return createStore((JSON.parse(text).books ?? []).map(legacy))
}

export function toJson(store) {
  return JSON.stringify({ books: store.books }, null, 2)
}
