// The bench result as markdown: header, one row per task and setup, the verdict.
const money = x => (Number.isFinite(x) ? x.toFixed(2) : '-')

export function markdown(rows, v, meta) {
  const lines = [
    `# Cost bench ${meta.date}`,
    '',
    `${meta.date} · ${meta.mode} · lead model ${meta.model} · stool ${meta.stoolVersion} · Claude Code ${meta.claudeVersion} · $ at API list price · w% at ${meta.rate} per $`,
    '',
    '| Task | Setup | Runs | Passes | $ | $/pass | w%/pass |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.task} | ${r.setup} | ${r.runs} | ${r.passes} | ${money(r.usd)} | ${money(r.usdPerPass)} | ${money(r.usdPerPass * meta.rate)} |`),
    '',
    `Per passed task: off $${money(v.totalOff)}, on $${money(v.totalOn)}.`,
    `Saving per passed task: ${Number.isFinite(v.saving) ? Math.round(v.saving * 100) : '-'}% (${v.real ? 'real' : 'within noise'})`,
  ]
  if (meta.stoppedAtBudget) lines.push('', `Stopped at budget: $${money(meta.spentUsd)} of $${money(meta.budgetUsd)} spent; later runs were skipped.`)
  return lines.join('\n') + '\n'
}
