// Deletes EVERY user and all their data. Built-in formulas stay.
// Usage: CONFIRM=delete-everyone npm run reset-users
import { prisma } from '../src/lib/prisma.js'

if (process.env.CONFIRM !== 'delete-everyone') {
  console.log('Not deleting. Run: CONFIRM=delete-everyone npm run reset-users')
  process.exit(1)
}

const before = await prisma.user.count()
// Budgets first (they point at formulas), then users. Everything else cascades.
await prisma.budget.deleteMany({})
await prisma.formula.deleteMany({ where: { isSystem: false } })
const { count } = await prisma.user.deleteMany({})
console.log(`Deleted ${count} of ${before} users and all their data.`)
await prisma.$disconnect()
