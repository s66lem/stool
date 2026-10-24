// CSV import: one book per line, `title,author,year[,tags]`, tags separated by `;`.

export function parseLine(line) {
  const [title, author, year, tags = ''] = line.split(',')
  return {
    title: title.trim(),
    author: author.trim(),
    year: Number(year),
    tags: tags.trim() ? tags.split(';').map(t => t.trim()) : [],
  }
}

// skips the header line and blank lines
export function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter(l => l.trim())
    .map(parseLine)
}
