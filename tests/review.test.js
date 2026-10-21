// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReview, gradeFor, monthRange } from '../src/modules/reviews/review.js'

const N = (naira) => naira * 100 // naira -> kobo

// ₦100,000 on 50/30/20 in September
const budget = {
  id: 'b1',
  incomeKobo: BigInt(N(100000)),
  allocations: [
    { id: 'n', label: 'Needs', colorKey: 'needs', amountKobo: BigInt(N(50000)) },
    { id: 'w', label: 'Wants', colorKey: 'wants', amountKobo: BigInt(N(30000)) },
    { id: 's', label: 'Savings', colorKey: 'savings', amountKobo: BigInt(N(20000)) },
  ],
}
const at = (day) => new Date(Date.UTC(2026, 8, day, 12)) // September, midday UTC
const endOfSeptember = new Date(Date.UTC(2026, 9, 5))

test('month range respects the time zone (Lagos = UTC+1)', () => {
  const r = monthRange('2026-09', 60)
  assert.equal(r.start.toISOString(), '2026-08-31T23:00:00.000Z')
  assert.equal(r.end.toISOString(), '2026-09-30T23:00:00.000Z')
  assert.equal(r.days, 30)
})

test('review: on plan exactly -> A, savings stays at plan', () => {
  const r = buildReview({
    month: '2026-09',
    budgets: [budget],
    expenses: [
      { allocationId: 'n', amountKobo: BigInt(N(50000)), category: 'food', spentAt: at(3) },
      { allocationId: 'w', amountKobo: BigInt(N(30000)), category: 'eating_out', spentAt: at(10) },
    ],
    now: endOfSeptember,
  })
  assert.equal(r.grade, 'A')
  assert.deepEqual(r.buckets.map((b) => [b.label, b.planPercent, b.actualPercent]), [
    ['Needs', 50, 50],
    ['Wants', 30, 30],
    ['Savings', 20, 20],
  ])
  assert.equal(r.idea.kind, 'steady')
  assert.equal(r.partial, false)
})

test('review: like the design (Needs 52, Wants 34, Savings 14) -> drift 12, idea caps Wants', () => {
  const r = buildReview({
    month: '2026-09',
    budgets: [budget],
    expenses: [
      { allocationId: 'n', amountKobo: BigInt(N(52000)), category: 'food', spentAt: at(2) },
      { allocationId: 'w', amountKobo: BigInt(N(25000)), category: 'eating_out', spentAt: at(12) },
      { allocationId: 'w', amountKobo: BigInt(N(9000)), category: 'transport', spentAt: at(20) },
    ],
    now: endOfSeptember,
  })
  const pct = Object.fromEntries(r.buckets.map((b) => [b.label, b.actualPercent]))
  assert.deepEqual(pct, { Needs: 52, Wants: 34, Savings: 14 })
  assert.equal(r.drift, 12) // 2 over + 4 over + 6 short
  assert.equal(r.grade, 'B')
  assert.equal(r.idea.kind, 'cap')
  assert.equal(r.idea.label, 'Wants')
  assert.equal(r.idea.overByKobo, N(4000))
  assert.equal(r.idea.category, 'eating_out')
  assert.equal(r.idea.capKobo, N(2000))
})

test('review: weeks kept counts weeks under the spending pace', () => {
  // Spending plan = ₦80,000 over 30 days. Week 1 (7 days) pace = ₦18,667.
  const r = buildReview({
    month: '2026-09',
    budgets: [budget],
    expenses: [{ allocationId: 'w', amountKobo: BigInt(N(30000)), spentAt: at(2) }], // blows week 1
    now: endOfSeptember,
  })
  assert.deepEqual(r.weeks, { kept: 4, total: 5 })
})

test('review: no budgets -> null; grades scale', () => {
  assert.equal(buildReview({ month: '2026-09', budgets: [], expenses: [] }), null)
  assert.deepEqual([0, 3, 7, 12, 40].map(gradeFor), ['A', 'A-', 'B+', 'B', 'D'])
})

test('review: mid-month, nothing overspent -> savings at plan, not inflated', () => {
  const r = buildReview({
    month: '2026-09',
    budgets: [budget],
    expenses: [{ allocationId: 'w', amountKobo: BigInt(N(4200)), category: 'eating_out', spentAt: at(3) }],
    now: new Date(Date.UTC(2026, 8, 10)),
  })
  const savings = r.buckets.find((b) => b.label === 'Savings')
  assert.equal(savings.actualPercent, 20)
  assert.equal(r.partial, true)
  assert.equal(r.grade, 'A')
})
