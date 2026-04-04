/**
 * Migration Script: Add soft delete (deleted_at) to properties table
 *
 * Usage: node scripts/migrate-soft-delete.js
 *
 * This script:
 * 1. Adds `deleted_at` column to properties table
 * 2. Creates an index on deleted_at for query performance
 * 3. Records the migration in Prisma's _prisma_migrations table
 */

require('dotenv').config();

async function migrate() {
  const mysql = require('mysql2/promise');

  // Parse DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL not found in .env');
    process.exit(1);
  }

  const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!match) {
    console.error('ERROR: Cannot parse DATABASE_URL');
    process.exit(1);
  }

  const [, user, password, host, port, database] = match;

  console.log(`Connecting to ${host}:${port}/${database}...`);

  const conn = await mysql.createConnection({
    host,
    port: parseInt(port),
    user,
    password,
    database,
  });

  try {
    // 1. Check if column already exists
    const [cols] = await conn.execute("SHOW COLUMNS FROM properties LIKE 'deleted_at'");

    if (cols.length > 0) {
      console.log('✓ Column `deleted_at` already exists — skipping ALTER TABLE');
    } else {
      await conn.execute('ALTER TABLE `properties` ADD COLUMN `deleted_at` DATETIME(3) NULL');
      console.log('✓ Added `deleted_at` column to properties table');
    }

    // 2. Add index (ignore if exists)
    try {
      await conn.execute('CREATE INDEX `properties_deleted_at_idx` ON `properties`(`deleted_at`)');
      console.log('✓ Created index on deleted_at');
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') {
        console.log('✓ Index already exists — skipping');
      } else {
        throw e;
      }
    }

    // 3. Record migration in Prisma
    try {
      await conn.execute(
        `INSERT INTO _prisma_migrations (id, checksum, migration_name, applied_steps_count, finished_at)
         VALUES (UUID(), 'soft_delete_property', '20260404000000_add_property_soft_delete', 1, NOW())`
      );
      console.log('✓ Recorded migration in _prisma_migrations');
    } catch (e) {
      console.log('⚠ Migration record note:', e.message);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('   Restart your backend server to apply changes.');

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

migrate();
