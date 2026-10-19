import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'

const adapter = new PrismaPg({
  // Server uses verify-full (no SSL warning); .env keeps require for the migrate tool
  connectionString: env.DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full'),
  max: 5, // a few connections is plenty, especially on a free plan
  idleTimeoutMillis: 10_000, // close idle connections before the database does
  connectionTimeoutMillis: 30_000, // slow networks get time to connect
  keepAlive: true, // stops networks from silently dropping quiet connections
})

export const prisma = new PrismaClient({ adapter })
