import test from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './engine.mjs'
const find = (n, key) => Array.isArray(n) ? n.map(c => find(c, key)).find(Boolean) : n && typeof n === 'object' ? (n.props?.key === key ? n : find(n.children ?? [], key)) : undefined
const text = n => Array.isArray(n) ? n.map(text).join(' ') : n && typeof n === 'object' ? text(n.children ?? []) : String(n ?? '')
const pane = E => E.render('Pane', { requestId: 'settings' })
const input = async (E, key) => find(await pane(E), 'restart-input-' + key)
test('token entry parses units, saves only on submit or blur and shows current window percent', async () => {
  const E = await boot('./register.mjs')
  assert.equal((await input(E, 'restartContextTokens'))?.type, 'Input')
  for (const [raw, want] of [['275000',275000],['275k',275000],['1.2m',1200000],['0',0],['off',0]]) {
    const f = await input(E, 'restartContextTokens')
    const before = E.configSet.length
    await f.props.onInput(raw)
    assert.equal(E.configSet.length, before)
    assert.equal((await input(E, 'restartContextTokens')).props.value, raw)
    if (raw === '275k') assert.match(text(await pane(E)), /275k \(27% of 1M\)/)
    await f.props.onSubmit(raw)
    assert.deepEqual(E.configSet.at(-1), { key:'stool.restartContextTokens',value:want })
    await E.focus(undefined)
    assert.equal(E.configSet.length, before + 1)
  }
  assert.equal(find(await pane(E), 'row-restartContextAt'), undefined)
  E.$.session.usage = async () => ({context:{window:200000}})
  await (await input(E,'restartContextTokens')).props.onInput('100k')
  assert.match(text(await pane(E)), /100k \(50% of 200k\)/)
  await E.focus('restart-input-resumeFile')
  assert.deepEqual(E.configSet.at(-1), {key:'stool.restartContextTokens',value:100000})
})
test('invalid values remain inline across redraws without saving', async () => {
  const E = await boot('./register.mjs')
  for (const key of ['restartContextTokens','restartPublishesAt','tier-0','tier-1','resumeFile']) {
    for (const raw of key === 'resumeFile' ? ['', 'bad\npath'] : ['-1','abc','1.5','Infinity','9007199254740992']) {
      const f = await input(E,key)
      await f.props.onInput(raw)
      await f.props.onSubmit(raw)
      await E.focus(undefined)
      const tree = await pane(E)
      assert.equal((await input(E,key)).props.value,raw)
      assert.match(text(find(tree,'row-'+(key === 'tier-0' || key === 'tier-1' ? key : key))), /Invalid value/)
    }
  }
  assert.deepEqual(E.configSet,[])
})
test('path and interval edits save on blur, preserve tier names and provide full-width descriptions', async () => {
  const E = await boot('./register.mjs',new Map(),new Map(),{reviewTiers:['goal: why-behind every 7','deep every 10']})
  for(const [key,raw,want] of [['resumeFile','notes/my handoff.md','notes/my handoff.md'],['resumeFile','C:/notes/handoff.md','C:/notes/handoff.md'],['restartPublishesAt','12',12],['tier-0','0',['goal: why-behind every 0','deep every 10']],['tier-1','23',['goal: why-behind every 0','deep every 23']]]) {
    const f=await input(E,key)
    await E.focus(f.props.key)
    await f.props.onInput(raw)
    await E.focus(undefined)
    assert.deepEqual(E.configSet.at(-1),{key:'stool.'+(key.startsWith('tier-')?'reviewTiers':key),value:want})
  }
  assert.equal(find(await pane(E),'row-resumeFile').props.flexDirection,'column')
  await (await input(E,'restartPublishesAt')).props.onSubmit('0')
  assert.equal(E.configSet.findLast(x => x.key === 'stool.restartPublishesAt').value,12)
})

test('overlapping field saves both persist and a denied save can be retried', async () => {
  const E = await boot('./register.mjs')
  const original = E.$.config.set
  let release
  const held = new Promise(r => { release = r })
  let first = true
  E.$.config.set = async arg => { if(first) { first=false; await held } return original(arg) }
  const tokens = await input(E,'restartContextTokens')
  const path = await input(E,'resumeFile')
  const one = tokens.props.onSubmit('250k')
  const two = path.props.onSubmit('notes/resume.md')
  release()
  await Promise.all([one,two])
  assert.deepEqual(E.configSet,[{key:'stool.restartContextTokens',value:250000},{key:'stool.resumeFile',value:'notes/resume.md'}])
  E.$.config.set = async () => ({deny:'read only'})
  await (await input(E,'resumeFile')).props.onSubmit('retry.md')
  E.$.config.set = original
  await (await input(E,'resumeFile')).props.onSubmit('retry.md')
  assert.deepEqual(E.configSet.at(-1),{key:'stool.resumeFile',value:'retry.md'})
})
