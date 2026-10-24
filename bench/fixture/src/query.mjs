export function byAuthor(books, author) {
  const a = author.toLowerCase()
  return books.filter(b => b.author.toLowerCase() === a)
}

export function search(books, term) {
  const t = term.toLowerCase()
  return books.filter(b => b.title.toLowerCase().includes(t))
}

// a copy sorted by one field, ascending; ties keep their order
export function sortBy(books, field) {
  return [...books].sort((x, y) => (x[field] < y[field] ? -1 : x[field] > y[field] ? 1 : 0))
}

export function oldestFirst(books) {
  return sortBy(books, 'year')
}
