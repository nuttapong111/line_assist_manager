import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import path from 'path'

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  })
  const migrationsFolder = path.join(__dirname, '../../drizzle')
  await migrate(drizzle(pool), { migrationsFolder })
  console.log('✅ Migration complete')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
