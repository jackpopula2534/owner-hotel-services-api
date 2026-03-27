/**
 * Standalone TypeORM DataSource for the TypeORM CLI.
 *
 * This file is intentionally separate from the NestJS DI config in
 * database.module.ts.  The CLI resolves the file via ts-node at runtime,
 * reads environment variables from .env automatically (dotenv/config),
 * and uses __dirname-relative globs so it works whether you run the CLI
 * from the repo root with ts-node or from inside a Docker container
 * against compiled JS in dist/.
 *
 * Usage (npm scripts in package.json):
 *   npm run migration:generate -- src/database/migrations/CreateFoo
 *   npm run migration:run
 *   npm run migration:revert
 *   npm run migration:show
 */
import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'path';

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_DATABASE || 'hotel_services_db',

  // Resolve entities and migrations relative to this file so the paths
  // remain correct regardless of the working directory.
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, '..', 'database', 'migrations', '*.{ts,js}')],

  charset: 'utf8mb4',
  timezone: '+07:00',
  synchronize: false, // NEVER true — always use migrations in all envs

  logging:
    process.env.NODE_ENV === 'development'
      ? ['error', 'warn', 'migration']
      : ['error', 'migration'],
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
