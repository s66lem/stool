// CSV import: one book per line, `title,author,year[,tags]`, tags separated by `;`.

// fields split on commas outside quotes; `""` inside quotes is one quote
function fields(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted && c === '"' && line[i + 1] === '"') {
      cur += '"'
      i++
    } else if (c === '"') quoted = !quoted
    else if (c === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

export function parseLine(line) {
  const [title, author, year, tags = ''] = fields(line)
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
