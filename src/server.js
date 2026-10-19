import app from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'

// 0.0.0.0 so your phone on the same Wi-Fi can reach it via your laptop's IP
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Kust API running on http://localhost:${env.PORT}`)
})

async function shutdown() {
  console.log('Shutting down...')
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
