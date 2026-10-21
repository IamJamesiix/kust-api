import { prisma } from '../src/lib/prisma.js'

// Built-in formulas. Each bucket: [label, percent in basis points (5000 = 50%), colorKey]
// Running the seed again updates names, descriptions and buckets to match this list.
// Old budgets are never changed: their splits were copied when they were made.
const formulas = [
  {
    id: 'sys-50-30-20',
    name: '50/30/20',
    description: 'The Standard. A balanced approach, best for absolute beginners.',
    buckets: [
      ['Needs', 5000, 'needs'],
      ['Wants', 3000, 'wants'],
      ['Savings', 2000, 'savings'],
    ],
  },
  {
    id: 'sys-50-25-15-10',
    name: '50/25/15/10',
    description: 'The Grower. Needs first, then a big share for growth and investing, a cushion for stability, and some kept for reward and joy.',
    buckets: [
      ['Needs', 5000, 'needs'],
      ['Growth & investment', 2500, 'invest'],
      ['Stability & savings', 1500, 'savings'],
      ['Reward & joy', 1000, 'wants'],
    ],
  },
  {
    id: 'sys-70-20-10',
    name: '70/20/10',
    description: 'The Wealth Builder. Living expenses (needs + wants together), savings & investing, then debt payoff or giving.',
    buckets: [
      ['Living expenses', 7000, 'needs'],
      ['Savings & investing', 2000, 'savings'],
      ['Debt / giving', 1000, 'wants'],
    ],
  },
  {
    id: 'sys-80-20',
    name: '80/20',
    description: 'The Simplified Minimalist. 20% goes straight to savings; spend the other 80% without tracking categories.',
    buckets: [
      ['Spending', 8000, 'needs'],
      ['Savings', 2000, 'savings'],
    ],
  },
  {
    id: 'sys-60-solution',
    name: '60% Solution',
    description: '60% to committed expenses (bills, food, clothing). The other 40% split evenly: retirement, long-term savings, short-term savings and fun money.',
    buckets: [
      ['Committed', 6000, 'needs'],
      ['Retirement', 1000, 'invest'],
      ['Long-term savings', 1000, 'savings'],
      ['Short-term savings', 1000, 'savings'],
      ['Fun money', 1000, 'wants'],
    ],
  },
]

// Built-ins we no longer offer (none right now). Budgets already made keep their own copy.
const retired = []

for (const f of formulas) {
  const total = f.buckets.reduce((sum, b) => sum + b[1], 0)
  if (total !== 10000) throw new Error(`${f.name} adds up to ${total}, not 10000`)

  const buckets = f.buckets.map(([label, percent, colorKey], position) => ({ label, percent, colorKey, position }))

  await prisma.formula.upsert({
    where: { id: f.id },
    update: {
      name: f.name,
      description: f.description,
      isSystem: true,
      buckets: { deleteMany: {}, create: buckets }, // replace the buckets
    },
    create: {
      id: f.id,
      name: f.name,
      description: f.description,
      isSystem: true,
      buckets: { create: buckets },
    },
  })
  console.log('seeded', f.name)
}

for (const id of retired) {
  const used = await prisma.budget.count({ where: { formulaId: id } })
  if (used > 0) {
    console.log(`kept ${id}: ${used} budget(s) still use it. Delete those budgets in the app, then run the seed again.`)
    continue
  }
  const removed = await prisma.formula.deleteMany({ where: { id } })
  if (removed.count) console.log('removed', id)
}

await prisma.$disconnect()
