// Chạy migration bằng warehouse_migrator trước khi deploy phiên bản mới.
import { fileURLToPath } from 'node:url';
import { createLogger } from '@ol/node-kit';
import { dbOptions, loadDbConfig } from './config.js';
import { createPool, runMigrations } from './infrastructure/db/database.js';

const cfg = loadDbConfig();
const logger = createLogger({ service: 'ol-warehouse-service-migrate', level: cfg.LOG_LEVEL });
const pool = createPool({ ...dbOptions(cfg), maxConnections: 1 });

try {
  await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)));
  logger.info('migrate_done');
} catch (err) {
  logger.error({ err }, 'migrate_failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
