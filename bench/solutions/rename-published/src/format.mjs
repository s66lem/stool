export function line(book) {
  return `${book.id} | ${book.title} | ${book.author} | ${book.published}`
}

export function table(books) {
  return books.length ? books.map(line).join('\n') : '(no books)'
}
