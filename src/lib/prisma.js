import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from '../config/env.js'

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full') })

export const prisma = new PrismaClient({ adapter })
