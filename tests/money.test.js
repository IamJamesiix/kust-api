// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitIncome } from '../src/modules/budgets/split.js'
import { summarize } from '../src/modules/budgets/summary.js'

const buckets = [
  { label: 'Needs', percent: 5000, colorKey: 'needs' },
  { label: 'Wants', percent: 3000, colorKey: 'wants' },
  { label: 'Savings', percent: 2000, colorKey: 'savings' },
]

test('50/30/20 of ₦150,000', () => {
  const parts = splitIncome(15000000n, buckets)
  assert.deepEqual(parts.map((p) => p.amountKobo), [7500000n, 4500000n, 3000000n])
})

test('odd amounts never lose a kobo', () => {
  for (const income of [1n, 7n, 99n, 15000001n, 1234567891n]) {
    const total = splitIncome(income, buckets).reduce((s, p) => s + p.amountKobo, 0n)
    assert.equal(total, income)
  }
})

test('summary: spent, remaining, overspent', () => {
  const budget = {
    id: 'b1',
    incomeKobo: 10000n,
    allocations: [
      { id: 'a1', amountKobo: 5000n },
      { id: 'a2', amountKobo: 5000n },
    ],
  }
  const s = summarize(budget, new Map([['a1', 2500n], ['a2', 6000n]]))
  assert.equal(s.allocations[0].usedPercent, 50)
  assert.equal(s.allocations[0].overspent, false)
  assert.equal(s.allocations[1].remainingKobo, -1000n)
  assert.equal(s.allocations[1].overspent, true)
  assert.equal(s.totals.spentKobo, 8500n)
  assert.equal(s.totals.remainingKobo, 1500n)
})
