import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Migrations need a DIRECT connection (db.prisma.io); the app uses the
// POOLED one (pooled.db.prisma.io) from DATABASE_URL. Falls back to
// DATABASE_URL if DIRECT_URL isn't set.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.js',
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
})
