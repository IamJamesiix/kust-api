import { prisma } from '../src/lib/prisma.js'

// Built-in formulas. Rename buckets to match what your questionnaire people expect.
const formulas = [
  {
    id: 'sys-50-30-20',
    name: '50/30/20',
    description: 'Needs, wants, savings. The classic.',
    buckets: [
      ['Needs', 5000, 'needs'],
      ['Wants', 3000, 'wants'],
      ['Savings', 2000, 'savings'],
    ],
  },
  {
    id: 'sys-50-25-15-10',
    name: '50/25/15/10',
    description: 'Needs, wants, savings, investments.',
    buckets: [
      ['Needs', 5000, 'needs'],
      ['Wants', 2500, 'wants'],
      ['Savings', 1500, 'savings'],
      ['Investments', 1000, 'invest'],
    ],
  },
  {
    id: 'sys-70-20-10',
    name: '70/20/10',
    description: 'Living costs, savings, debt or giving.',
    buckets: [
      ['Living', 7000, 'needs'],
      ['Savings', 2000, 'savings'],
      ['Debt / Giving', 1000, 'wants'],
    ],
  },
  {
    id: 'sys-80-20',
    name: '80/20',
    description: 'Spend 80, save 20. Simple.',
    buckets: [
      ['Spending', 8000, 'needs'],
      ['Savings', 2000, 'savings'],
    ],
  },
]

for (const f of formulas) {
  const total = f.buckets.reduce((sum, b) => sum + b[1], 0)
  if (total !== 10000) throw new Error(`${f.name} adds up to ${total}, not 10000`)

  await prisma.formula.upsert({
    where: { id: f.id },
    update: { name: f.name, description: f.description },
    create: {
      id: f.id,
      name: f.name,
      description: f.description,
      isSystem: true,
      buckets: {
        create: f.buckets.map(([label, percent, colorKey], position) => ({
          label, percent, colorKey, position,
        })),
      },
    },
  })
  console.log('seeded', f.name)
}

await prisma.$disconnect()
