// The fine in cents for a book returned `daysLate` days after its due date, for one member type's row.
export function fineFor(daysLate, type) {
  const charged = Math.max(0, daysLate - type.graceDays)
  return Math.min(charged * type.finePerDay, type.fineCap)
}
