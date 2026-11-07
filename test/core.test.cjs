const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createEmptyAppData,
  createTopDecision,
  createResult,
  createNode,
  createGroup,
  createTag,
  createPreset,
} = require('../.test-build/core/defaults.js')
const {
  createSession,
  draw,
  manualSelect,
  undo,
  restart,
  continueToChild,
  canContinue,
  setAllowRepeat,
  resetCurrentLevelState,
  buildSummary,
} = require('../.test-build/core/session.js')
const { effectiveWeight } = require('../.test-build/core/weights.js')
const {
  addPenaltyLayer,
  pruneExpiredLayers,
} = require('../.test-build/core/penalty.js')
const { commitSession } = require('../.test-build/core/commit.js')
const { filterResults, applyPreset, tagsToPreset, removeTagFromNode } = require('../.test-build/core/tags.js')
const { topDepth, canAddChild, validateTree, referenceCandidates, findReferences } = require('../.test-build/core/tree.js')
const { historyToJson, historyFromJson } = require('../.test-build/core/history.js')
const { pickWeighted } = require('../.test-build/core/rng.js')

function addResult(node, name, weight = 1000) {
  const result = createResult(name, weight, node.results.length)
  node.results.push(result)
  return result
}

function addChild(result, name) {
  const child = createNode(name)
  result.child = { kind: 'owned', node: child }
  return child
}

function makeTree() {
  const app = createEmptyAppData()
  const root = createTopDecision('Root')
  app.decisions.push(root)
  const a = addResult(root, 'A')
  const c = addResult(root, 'C')
  const b = addChild(a, 'B')
  const b1 = addResult(b, 'B1')
  const b2 = addResult(b, 'B2')
  return { app, root, a, c, b, b1, b2 }
}

function seq(values) {
  let index = 0
  return () => values[index++ % values.length]
}

test('随机：权重比例与边界', () => {
  const entries = [
    { item: 'a', weight: 1 },
    { item: 'b', weight: 3 },
  ]
  assert.equal(pickWeighted(entries, () => 0), 'a')
  assert.equal(pickWeighted(entries, () => 0.24), 'a')
  assert.equal(pickWeighted(entries, () => 0.26), 'b')
  assert.equal(pickWeighted(entries, () => 0.99), 'b')
})

test('降温：A18 的 3 轮示例', () => {
  const node = {
    roundNo: 0,
    avoidRepeat: { enabled: true, reducePercent: 50, rounds: 3 },
    penalties: [],
  }
  const result = { id: 'a', weight: 1000 }
  assert.equal(effectiveWeight(node, result, 1), 1000)
  addPenaltyLayer(node, 'a', 1)
  node.roundNo = 1
  assert.equal(effectiveWeight(node, result, 2), 500)
  addPenaltyLayer(node, 'a', 2)
  node.roundNo = 2
  assert.equal(effectiveWeight(node, result, 3), 250)
  assert.equal(effectiveWeight(node, result, 4), 250)
  assert.equal(effectiveWeight(node, result, 5), 500)
  assert.equal(effectiveWeight(node, result, 6), 1000)
  pruneExpiredLayers(node, 6)
  assert.equal(node.penalties.length, 0)
})

test('抽取：不重复 + 全部抽过后自动重置', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  app.decisions.push(root)
  addResult(root, 'r1')
  addResult(root, 'r2')
  addResult(root, 'r3')
  const session = createSession(app, root.id)
  const first = draw(session, app, () => 0)
  assert.equal(first.result.name, 'r1')
  const second = draw(session, app, () => 0)
  assert.equal(second.result.name, 'r2')
  const third = draw(session, app, () => 0)
  assert.equal(third.result.name, 'r3')
  const fourth = draw(session, app, () => 0)
  assert.equal(fourth.result.name, 'r1')
  assert.equal(fourth.autoReset, true)
  assert.deepEqual(session.levels[0].replaced, ['r1', 'r2', 'r3'])
})

test('抽取：允许重复时可以不换结果，且同轮不叠加降温', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  root.avoidRepeat = { enabled: true, reducePercent: 50, rounds: 3 }
  root.allowRepeat = true
  app.decisions.push(root)
  const only = addResult(root, 'only')
  const session = createSession(app, root.id)
  assert.equal(draw(session, app, () => 0).result.name, 'only')
  assert.equal(draw(session, app, () => 0).result.name, 'only')
  assert.equal(session.levels[0].provisionalLayers.length, 1)
  assert.equal(session.levels[0].replaced.length, 0)
  assert.equal(session.levels[0].systemDrawIds.length, 2)
  assert.equal(only.id, session.levels[0].currentResultId)
})

test('手动选择：影响池/降温/历史/统计，并替换当前结果', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  root.avoidRepeat = { enabled: true, reducePercent: 50, rounds: 3 }
  app.decisions.push(root)
  const r1 = addResult(root, 'r1')
  const r2 = addResult(root, 'r2')
  const session = createSession(app, root.id)
  draw(session, app, () => 0)
  manualSelect(session, app, r2.id)
  const level = session.levels[0]
  assert.equal(level.status, 'manual')
  assert.deepEqual(level.pool, [r1.id, r2.id])
  assert.deepEqual(level.replaced, ['r1'])
  assert.deepEqual(level.systemDrawIds, [r1.id])
  assert.deepEqual(level.provisionalLayers, [r1.id, r2.id])

  const committed = commitSession(session, app, '2026-01-01T00:00:00.000Z')
  assert.equal(committed.record.levels[0].status, 'manual')
  assert.deepEqual(committed.record.levels[0].replaced, ['r1'])
  const statA = app.stats.find((s) => s.resultId === r1.id)
  const statB = app.stats.find((s) => s.resultId === r2.id)
  assert.equal(statA.appear, 1)
  assert.equal(statA.final, 0)
  assert.equal(statB.appear, 0)
  assert.equal(statB.manual, 1)
  assert.equal(statB.final, 1)
})

test('标签筛选：只看/排除/跨组 AND/组内 OR/无标签', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  app.decisions.push(root)
  const g1 = createGroup('口味', '#D9534F', 0)
  const g2 = createGroup('场景', '#1377DB', 1)
  root.tagGroups = [g1, g2]
  const a = createTag('辣', g1.id, 0)
  const b = createTag('清淡', g1.id, 1)
  const c = createTag('室内', g2.id, 0)
  root.tags = [a, b, c]
  const r1 = addResult(root, 'r1')
  const r2 = addResult(root, 'r2')
  const r3 = addResult(root, 'r3')
  r1.tagIds = [a.id, c.id]
  r2.tagIds = [b.id]
  r3.tagIds = []

  const includeA = { [g1.id]: { mode: 'include', tagIds: [a.id] } }
  assert.deepEqual(filterResults(root, includeA).matched.map((r) => r.name), ['r1'])

  const excludeA = { [g1.id]: { mode: 'exclude', tagIds: [a.id] } }
  assert.deepEqual(filterResults(root, excludeA).matched.map((r) => r.name), ['r2', 'r3'])

  const both = {
    [g1.id]: { mode: 'include', tagIds: [a.id, b.id] },
    [g2.id]: { mode: 'include', tagIds: [c.id] },
  }
  assert.deepEqual(filterResults(root, both).matched.map((r) => r.name), ['r1'])

  const empty = { [g1.id]: { mode: 'include', tagIds: [] } }
  assert.deepEqual(filterResults(root, empty).matched.map((r) => r.name), ['r1', 'r2', 'r3'])
})

test('多级：继续、汇总、提交、统计', () => {
  const { app, root, a, b1 } = makeTree()
  const session = createSession(app, root.id)
  assert.equal(draw(session, app, () => 0).result.name, 'A')
  assert.equal(canContinue(session, app), true)
  assert.equal(continueToChild(session, app), true)
  assert.equal(draw(session, app, () => 0).result.name, 'B1')
  const summary = buildSummary(session, app)
  assert.deepEqual(summary.finalChain, ['A', 'B1'])
  assert.deepEqual(summary.manualParts, [])

  const committed = commitSession(session, app, '2026-01-02T00:00:00.000Z')
  assert.equal(app.history.length, 1)
  assert.equal(committed.record.levels.length, 2)
  assert.equal(committed.record.levels[1].nodeName, 'B')
  assert.equal(committed.record.levels[1].isReference, false)
  assert.equal(app.stats.find((s) => s.resultId === a.id).final, 1)
  assert.equal(app.stats.find((s) => s.resultId === b1.id).final, 1)
  assert.equal(root.roundNo, 1)
  assert.equal(root.results[0].child.node.roundNo, 1)
  assert.ok(root.lastUsedAt)
})

test('撤销与重新开始：层级回退、池清空、惩罚回滚', () => {
  const { app, root, b1 } = makeTree()
  root.avoidRepeat = { enabled: true, reducePercent: 50, rounds: 3 }
  const session = createSession(app, root.id)
  draw(session, app, () => 0)
  continueToChild(session, app)
  draw(session, app, () => 0)
  undo(session, app)
  assert.equal(session.levels.length, 1)
  assert.equal(session.levels[0].currentResultId, root.results[0].id)
  assert.equal(session.levels[0].provisionalLayers.length, 1)

  undo(session, app)
  assert.equal(session.levels[0].currentResultId, null)
  assert.deepEqual(session.levels[0].pool, [])

  draw(session, app, () => 0)
  continueToChild(session, app)
  draw(session, app, () => 0)
  restart(session, app)
  assert.equal(session.levels.length, 1)
  assert.equal(session.levels[0].currentResultId, null)
  assert.equal(session.levels[0].provisionalLayers.length, 0)

  // 重新抽并提交，确认只提交重新开始后的那一轮
  draw(session, app, () => 0)
  commitSession(session, app, '2026-01-03T00:00:00.000Z')
  assert.equal(app.history.length, 1)
  assert.equal(app.history[0].levels.length, 1)
})

test('引用：共享目标、层级标记、统计归属', () => {
  const app = createEmptyAppData()
  const t1 = createTopDecision('T1')
  const t2 = createTopDecision('T2')
  app.decisions.push(t1, t2)
  const a = addResult(t1, 'A')
  a.child = { kind: 'reference', targetId: t2.id }
  addResult(t2, 'B1')
  const session = createSession(app, t1.id)
  draw(session, app, () => 0)
  assert.equal(continueToChild(session, app), true)
  draw(session, app, () => 0)
  const committed = commitSession(session, app, '2026-01-04T00:00:00.000Z')
  assert.equal(committed.record.levels[1].isReference, true)
  assert.equal(committed.record.levels[1].decisionId, t2.id)
  assert.equal(committed.record.levels[1].nodeName, 'T2')
  assert.equal(app.stats.find((s) => s.decisionId === t2.id).final, 1)
  assert.equal(t2.roundNo, 1)
  assert.equal(t1.roundNo, 1)
})

test('深度：10 级、引用 8+3 被阻止、引用候选', () => {
  let node = createNode('L1')
  const root = node
  for (let i = 2; i <= 10; i += 1) {
    const result = addResult(node, `r${i}`)
    node = addChild(result, `L${i}`)
  }
  const app = createEmptyAppData()
  app.decisions.push(root)
  assert.equal(topDepth(root.id, app), 10)
  assert.equal(canAddChild(10, 1), false)
  assert.equal(canAddChild(7, 3), true)
  assert.equal(canAddChild(8, 3), false)
  assert.deepEqual(validateTree(root, app), [])

  // 引用深度检查
  const app2 = createEmptyAppData()
  const target = createTopDecision('Target')
  app2.decisions.push(target)
  const t1 = addResult(target, 'a')
  const t2 = addChild(t1, 'b')
  const t3 = addResult(t2, 'c')
  const t4 = addChild(t3, 'd')
  addResult(t4, 'e')
  const current = createTopDecision('Current')
  app2.decisions.push(current)
  const options = referenceCandidates(app2, new Set([current.id]), 7)
  assert.ok(options.some((option) => option.decision.id === target.id))
  const options8 = referenceCandidates(app2, new Set([current.id]), 8)
  assert.equal(options8.some((option) => option.decision.id === target.id), false)
})

test('预设：复制后独立、每节点一个、保存为预设', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  app.decisions.push(root)
  const preset = createPreset('P')
  const g = createGroup('口味', '#D9534F', 0)
  preset.groups = [g]
  preset.tags = [createTag('辣', g.id, 0)]
  const copied = applyPreset(root, preset)
  root.tagGroups = copied.tagGroups
  root.tags = copied.tags
  root.appliedPresetId = copied.appliedPresetId
  assert.equal(root.appliedPresetId, preset.id)
  assert.equal(root.tags[0].name, '辣')
  preset.tags[0].name = '重辣'
  assert.equal(root.tags[0].name, '辣')
  assert.throws(() => applyPreset(root, preset))

  const saved = tagsToPreset(root, [root.tags[0].id], '新预设')
  assert.equal(saved.tags[0].name, '辣')
  assert.equal(saved.groups[0].name, '口味')

  const result = addResult(root, 'r')
  result.tagIds = [root.tags[0].id]
  const removed = removeTagFromNode(root, root.tags[0].id)
  assert.equal(removed.tags.length, 0)
  assert.equal(removed.results[0].tagIds.length, 0)
})

test('历史 JSON：导出字段与往返', () => {
  const { app, root } = makeTree()
  const session = createSession(app, root.id)
  draw(session, app, () => 0)
  commitSession(session, app, '2026-01-05T00:00:00.000Z')
  const json = historyToJson(app.history, '2026-01-05T01:00:00.000Z')
  assert.equal(json.类型, '历史导出')
  assert.equal(json.历史数据.length, 1)
  assert.equal(json.历史数据[0].决策明细[0].层级, 1)
  assert.equal(json.历史数据[0].决策明细[0].状态, '系统抽取')
  assert.ok(json.历史数据[0].决策明细[0].候选结果.length >= 2)
  const back = historyFromJson(json)
  assert.equal(back[0].decisionName, 'Root')
  assert.equal(back[0].levels[0].nodeName, 'Root')
  assert.equal(back[0].levels[0].status, 'system')
})

test('提交幂等：重复提交不会翻倍', () => {
  const { app, root } = makeTree()
  const session = createSession(app, root.id)
  draw(session, app, () => 0)
  commitSession(session, app, '2026-01-06T00:00:00.000Z')
  commitSession(session, app, '2026-01-06T00:00:00.000Z')
  assert.equal(app.history.length, 1)
  assert.equal(app.stats.find((s) => s.resultId === root.results[0].id).final, 1)
  assert.equal(root.roundNo, 1)
})

test('单候选：直接给出并可重复重置；0 权重永不随机出现', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  app.decisions.push(root)
  const only = addResult(root, 'only')
  const zero = addResult(root, 'zero', 0)
  const session = createSession(app, root.id)
  assert.equal(draw(session, app, () => 0).result.name, 'only')
  assert.equal(draw(session, app, () => 0).autoReset, true)
  assert.equal(session.levels[0].currentResultId, only.id)
  assert.equal(session.levels[0].pool.includes(zero.id), false)
  manualSelect(session, app, zero.id)
  assert.equal(session.levels[0].currentResultId, zero.id)
  assert.equal(session.levels[0].status, 'manual')
})

test('筛选后候选为空与全部抽完的区分', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  app.decisions.push(root)
  const g = createGroup('g', '#D9534F', 0)
  root.tagGroups = [g]
  const tag = createTag('t', g.id, 0)
  root.tags = [tag]
  const r = addResult(root, 'r')
  r.tagIds = [tag.id]
  const session = createSession(app, root.id)
  const { setFilterRule } = require('../.test-build/core/session.js')
  setFilterRule(session, g.id, { mode: 'include', tagIds: [] })
  // 空选择视为不筛选，仍可抽
  assert.equal(draw(session, app, () => 0).ok, true)
})

test('引用查找与合并导入：同名跳过、引用重指向、可重复', () => {
  const { mergeAppData } = require('../.test-build/core/merge.js')

  const current = createEmptyAppData()
  const a = createTopDecision('A')
  current.decisions.push(a)
  addResult(a, 'x')

  const incoming = createEmptyAppData()
  const a2 = createTopDecision('A')
  incoming.decisions.push(a2)
  addResult(a2, 'y')
  const b = createTopDecision('B')
  incoming.decisions.push(b)
  const bResult = addResult(b, 'go')
  bResult.child = { kind: 'reference', targetId: a2.id }
  incoming.stats.push({
    decisionId: b.id,
    decisionName: 'B',
    nodeId: b.id,
    nodeName: 'B',
    resultId: bResult.id,
    resultName: 'go',
    appear: 1,
    final: 1,
    manual: 0,
    lastAppear: '2026-01-01T00:00:00.000Z',
    lastFinal: '2026-01-01T00:00:00.000Z',
  })
  incoming.history.push({
    id: 'h-1',
    decisionId: b.id,
    decisionName: 'B',
    time: '2026-01-01T00:00:00.000Z',
    levels: [],
  })

  const report = mergeAppData(current, incoming)
  assert.equal(report.addedDecisions, 1)
  assert.equal(report.skippedDecisions, 1)
  assert.equal(report.addedStats, 1)
  assert.equal(report.addedHistory, 1)

  const addedB = current.decisions.find((decision) => decision.name === 'B')
  assert.ok(addedB)
  assert.equal(addedB.results[0].child.kind, 'reference')
  assert.equal(addedB.results[0].child.targetId, a.id)
  assert.equal(findReferences(current, a.id).length, 1)

  // 嵌套一层的引用：路径应记录到“引用所在节点”
  const c = createTopDecision('C')
  current.decisions.push(c)
  const c1 = addResult(c, 'c1')
  const child = addChild(c1, 'child')
  const c2 = addResult(child, 'c2')
  c2.child = { kind: 'reference', targetId: a.id }
  const refs = findReferences(current, a.id)
  assert.equal(refs.length, 2)
  const nested = refs.find((reference) => reference.top.id === c.id)
  assert.ok(nested)
  assert.equal(nested.path.length, 1)
  assert.equal(nested.node.id, child.id)

  const report2 = mergeAppData(current, incoming)
  assert.equal(report2.addedDecisions, 0)
  assert.equal(report2.addedStats, 0)
  assert.equal(report2.addedHistory, 0)
  assert.equal(current.decisions.filter((decision) => decision.name === 'B').length, 1)
})

test('导入冲突：覆盖与重命名', () => {
  const {
    mergeAppData,
    detectDecisionConflicts,
  } = require('../.test-build/core/merge.js')

  const current = createEmptyAppData()
  const existing = createTopDecision('A')
  current.decisions.push(existing)
  addResult(existing, 'old')

  const incoming = createEmptyAppData()
  const incomingA = createTopDecision('A')
  incoming.decisions.push(incomingA)
  addResult(incomingA, 'new')

  const conflicts = detectDecisionConflicts(current, incoming)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].incomingId, incomingA.id)
  assert.equal(conflicts[0].existingId, existing.id)

  const overwrite = new Map([[incomingA.id, { action: 'overwrite' }]])
  const report = mergeAppData(current, incoming, { decisionResolutions: overwrite })
  assert.equal(report.overwrittenDecisions, 1)
  assert.equal(current.decisions.length, 1)
  assert.equal(current.decisions[0].id, existing.id)
  assert.equal(current.decisions[0].results[0].name, 'new')

  const current2 = createEmptyAppData()
  const existing2 = createTopDecision('A')
  current2.decisions.push(existing2)
  addResult(existing2, 'old')
  const rename = new Map([
    [incomingA.id, { action: 'rename', name: 'A 副本' }],
  ])
  const report2 = mergeAppData(current2, incoming, {
    decisionResolutions: rename,
  })
  assert.equal(report2.addedDecisions, 1)
  assert.equal(current2.decisions.length, 2)
  assert.ok(current2.decisions.some((decision) => decision.name === 'A 副本'))
})

test('应用预设：可只选择部分标签', () => {
  const app = createEmptyAppData()
  const root = createTopDecision('D')
  app.decisions.push(root)
  const preset = createPreset('P')
  const g1 = createGroup('g1', '#D9534F', 0)
  const g2 = createGroup('g2', '#1377DB', 1)
  const t1 = createTag('t1', g1.id, 0)
  const t2 = createTag('t2', g2.id, 1)
  preset.groups = [g1, g2]
  preset.tags = [t1, t2]

  const next = applyPreset(root, preset, [t1.id])
  assert.equal(next.tags.length, 1)
  assert.equal(next.tags[0].name, 't1')
  assert.equal(next.tagGroups.length, 1)
  assert.equal(next.tagGroups[0].name, 'g1')

  const emptyRoot = createTopDecision('D2')
  app.decisions.push(emptyRoot)
  assert.throws(() => applyPreset(emptyRoot, preset, []))
})

test('系统随机数在 [0,1) 且加权抽样不偏向最后一项', () => {
  const { systemRng, pickWeighted } = require('../.test-build/core/rng.js')
  for (let index = 0; index < 5000; index += 1) {
    const value = systemRng()
    assert.equal(Number.isFinite(value), true)
    assert.equal(value >= 0 && value < 1, true, `out of range: ${value}`)
  }

  const counts = { a: 0, b: 0, c: 0 }
  const entries = [
    { item: 'a', weight: 1_000_000 },
    { item: 'b', weight: 1_000_000 },
    { item: 'c', weight: 1 },
  ]
  for (let index = 0; index < 30000; index += 1) {
    const item = pickWeighted(entries)
    counts[item] += 1
  }
  assert.equal(counts.a > 10000, true, JSON.stringify(counts))
  assert.equal(counts.b > 10000, true, JSON.stringify(counts))
  assert.equal(counts.c < 10, true, JSON.stringify(counts))
})
