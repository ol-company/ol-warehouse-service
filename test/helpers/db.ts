// PostgreSQL thật trong Docker với role giống môi trường deploy (warehouse_migrator / warehouse_app)
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../src/infrastructure/db/database.js';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  appPool: pg.Pool;
  stop(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('warehouse')
    .start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query(`
    CREATE ROLE warehouse_migrator LOGIN PASSWORD 'migrator';
    CREATE ROLE warehouse_app LOGIN PASSWORD 'app';
    GRANT CREATE, CONNECT ON DATABASE warehouse TO warehouse_migrator;
    GRANT CONNECT ON DATABASE warehouse TO warehouse_app;
    CREATE SCHEMA warehouse AUTHORIZATION warehouse_migrator;
    GRANT USAGE ON SCHEMA warehouse TO warehouse_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE warehouse_migrator IN SCHEMA warehouse GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO warehouse_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE warehouse_migrator IN SCHEMA warehouse GRANT USAGE, SELECT ON SEQUENCES TO warehouse_app;
  `);
  await admin.end();

  const base = { host: container.getHost(), port: container.getPort(), database: 'warehouse' };
  const migrator = new pg.Pool({
    ...base,
    user: 'warehouse_migrator',
    password: 'migrator',
    max: 1,
  });
  await runMigrations(migrator, fileURLToPath(new URL('../../migrations', import.meta.url)));
  await migrator.end();

  const appPool = new pg.Pool({ ...base, user: 'warehouse_app', password: 'app', max: 5 });
  return {
    container,
    appPool,
    async stop() {
      await appPool.end();
      await container.stop();
    },
  };
}
