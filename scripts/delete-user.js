// Deletes ONE user and everything they own. Nobody else is touched.
// Usage: CONFIRM=yes npm run delete-user -- someone@example.com
import { prisma } from '../src/lib/prisma.js'

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.log('Usage: CONFIRM=yes npm run delete-user -- someone@example.com')
  process.exit(1)
}

const user = await prisma.user.findUnique({ where: { email } })
if (!user) {
  console.log(`No user with email ${email}`)
  await prisma.$disconnect()
  process.exit(1)
}

const [budgets, expenses, formulas] = await Promise.all([
  prisma.budget.count({ where: { userId: user.id } }),
  prisma.expense.count({ where: { userId: user.id } }),
  prisma.formula.count({ where: { ownerId: user.id } }),
])
console.log(`${email}: ${budgets} budget(s), ${expenses} expense(s), ${formulas} custom formula(s)`)

if (process.env.CONFIRM !== 'yes') {
  console.log('Nothing deleted. To delete, run again with CONFIRM=yes in front.')
  await prisma.$disconnect()
  process.exit(0)
}

// Budgets first (they point at formulas), then the user. Everything else cascades.
await prisma.$transaction([
  prisma.budget.deleteMany({ where: { userId: user.id } }),
  prisma.user.delete({ where: { id: user.id } }),
])
console.log(`Deleted ${email} and all their data.`)
await prisma.$disconnect()
