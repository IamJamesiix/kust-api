// Usage: npm run make-admin -- you@example.com
// The user must log in again afterwards — the role lives inside the access token.
import { prisma } from '../src/lib/prisma.js'

const email = process.argv[2]?.toLowerCase()
if (!email) {
  console.error('Usage: npm run make-admin -- you@example.com')
  process.exit(1)
}

const user = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } }).catch(() => null)
console.log(user ? `${user.email} is now an ADMIN. Log in again to get a new token.` : `No user with email ${email}`)
await prisma.$disconnect()
