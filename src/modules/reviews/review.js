// The monthly review ("September review: B+"). Pure functions, so they're easy to test.
//
// How the numbers work, in plain words:
// - Spending buckets (Needs, Wants...): actual = what you spent from it, as a % of income.
// - Keep buckets (Savings, Investments): actual = the savings plan, minus anything spent
//   from it, minus overspending in the other buckets (shared by plan). Money you didn't
//   spend from Wants doesn't count as saved; overspending does eat your savings.
// - Grade: how far you drifted from the plan, in percentage points (over on spending,
//   short on saving). 0 drift = A.

const KEEP = new Set(['savings', 'invest'])
const round1 = (n) => Math.round(n * 10) / 10

// Month boundaries in the user's time zone (Nigeria is UTC+1 = 60 minutes).
export function monthRange(month, tzOffsetMin = 60) {
  const [y, m] = month.split('-').map(Number)
  const shift = tzOffsetMin * 60 * 1000
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - shift),
    end: new Date(Date.UTC(y, m, 1) - shift),
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  }
}

export function gradeFor(drift) {
  const scale = [
    [2, 'A'], [5, 'A-'], [8, 'B+'], [12, 'B'], [16, 'B-'], [22, 'C+'], [30, 'C'],
  ]
  for (const [max, g] of scale) if (drift <= max) return g
  return 'D'
}

// ₦500 steps, at least ₦500. In kobo.
const roundCap = (kobo) => Math.max(50000, Math.round(kobo / 50000) * 50000)

// budgets: [{ id, incomeKobo, allocations: [{ id, label, colorKey, amountKobo }] }]  (BigInt or number)
// expenses: [{ allocationId, amountKobo, category, spentAt }]
export function buildReview({ month, budgets, expenses, tzOffsetMin = 60, now = new Date() }) {
  if (!budgets.length) return null
  const { start, end, days } = monthRange(month, tzOffsetMin)
  const num = (v) => Number(v ?? 0)

  // Group buckets by name across the month's budgets ("Needs" in two budgets = one row).
  const groups = new Map()
  const groupOfAlloc = new Map()
  let income = 0
  for (const b of budgets) {
    income += num(b.incomeKobo)
    for (const a of b.allocations) {
      const key = a.label.trim().toLowerCase()
      if (!groups.has(key)) {
        groups.set(key, { label: a.label, colorKey: a.colorKey, keep: KEEP.has(a.colorKey), amountKobo: 0, spentKobo: 0, categories: new Map() })
      }
      const g = groups.get(key)
      g.amountKobo += num(a.amountKobo)
      groupOfAlloc.set(a.id, g)
    }
  }

  // Spending per bucket, per category, and per week of the month
  const weekSpend = [0, 0, 0, 0, 0]
  let spent = 0
  for (const e of expenses) {
    const g = groupOfAlloc.get(e.allocationId)
    if (!g) continue
    const amt = num(e.amountKobo)
    g.spentKobo += amt
    spent += amt
    const cat = e.category || 'other'
    g.categories.set(cat, (g.categories.get(cat) ?? 0) + amt)
    const at = new Date(e.spentAt)
    if (!g.keep && at >= start && at < end) {
      const day = Math.floor((at - start) / 86400000) // 0-based day of month
      weekSpend[Math.min(4, Math.floor(day / 7))] += amt
    }
  }

  const list = [...groups.values()]
  const keepPlan = list.filter((g) => g.keep).reduce((s, g) => s + g.amountKobo, 0)
  const overspend = list.filter((g) => !g.keep).reduce((s, g) => s + Math.max(0, g.spentKobo - g.amountKobo), 0)
  const pct = (kobo) => (income > 0 ? (kobo / income) * 100 : 0)

  let drift = 0
  const buckets = list.map((g) => {
    const planPercent = pct(g.amountKobo)
    const actualKobo = g.keep
      ? Math.max(0, g.amountKobo - g.spentKobo - (keepPlan > 0 ? overspend * (g.amountKobo / keepPlan) : 0))
      : g.spentKobo
    const actualPercent = pct(actualKobo)
    drift += g.keep ? Math.max(0, planPercent - actualPercent) : Math.max(0, actualPercent - planPercent)
    return {
      label: g.label,
      colorKey: g.colorKey,
      keep: g.keep,
      amountKobo: g.amountKobo,
      spentKobo: g.spentKobo,
      planPercent: round1(planPercent),
      actualPercent: round1(actualPercent),
    }
  })

  // Weeks you stayed within the plan's spending pace (only weeks that have started)
  const spendPlan = list.filter((g) => !g.keep).reduce((s, g) => s + g.amountKobo, 0)
  let kept = 0
  let total = 0
  for (let w = 0; w < 5; w++) {
    const wStart = new Date(start.getTime() + w * 7 * 86400000)
    if (w * 7 >= days || wStart > now) break
    const daysInWeek = Math.min(7, days - w * 7)
    total += 1
    if (weekSpend[w] <= (spendPlan * daysInWeek) / days) kept += 1
  }

  // One idea for next month
  let idea = { kind: 'steady' }
  const over = list
    .filter((g) => !g.keep && g.spentKobo > g.amountKobo)
    .sort((a, b) => b.spentKobo - b.amountKobo - (a.spentKobo - a.amountKobo))[0]
  if (over) {
    const overByKobo = over.spentKobo - over.amountKobo
    const top = [...over.categories.entries()].sort((a, b) => b[1] - a[1])[0]
    idea = { kind: 'cap', label: over.label, overByKobo, category: top?.[0] ?? null, capKobo: roundCap(overByKobo / 2) }
  } else {
    const short = buckets.find((b) => b.keep && b.planPercent - b.actualPercent > 2)
    if (short) idea = { kind: 'save-first', label: short.label }
  }

  return {
    month,
    partial: now < end, // this month isn't over yet
    budgets: budgets.length,
    incomeKobo: income,
    spentKobo: spent,
    drift: round1(drift),
    grade: gradeFor(drift),
    weeks: { kept, total },
    buckets,
    idea,
  }
}
