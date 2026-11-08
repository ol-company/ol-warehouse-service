// Pool PostgreSQL, Drizzle, migration và Unit of Work theo tenant (RLS).
import { readFileSync } from 'node:fs';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { ConflictError, withTenant } from '@ol/node-kit';
import type { TenantRepositories, TenantUnitOfWork } from '../../application/ports.js';
import { items, schema, stockMovements, warehouses } from './schema.js';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  sslCaFile?: string;
  maxConnections: number;
}

export function createPool(cfg: DbConfig): pg.Pool {
  return new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: cfg.maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 10_000,
    application_name: 'ol-warehouse-service',
    ssl: cfg.ssl
      ? {
          rejectUnauthorized: true,
          ...(cfg.sslCaFile ? { ca: readFileSync(cfg.sslCaFile, 'utf8') } : {}),
        }
      : undefined,
  });
}

export async function runMigrations(pool: pg.Pool, migrationsFolder: string): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder });
}

type Db = NodePgDatabase<typeof schema>;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === '23505';
}

function createRepos(db: Db, tenantId: string): TenantRepositories {
  return {
    warehouses: {
      // Không cần WHERE tenant_id: RLS tự lọc. Vẫn ghi tenant_id khi INSERT (WITH CHECK của RLS kiểm tra)
      list: () => db.select().from(warehouses).orderBy(warehouses.code),
      get: async (id) =>
        (await db.select().from(warehouses).where(eq(warehouses.id, id)))[0] ?? null,
      create: async (input) => {
        try {
          const [row] = await db
            .insert(warehouses)
            .values({ ...input, tenantId })
            .returning();
          return row!;
        } catch (err) {
          if (isUniqueViolation(err)) throw new ConflictError('Mã kho đã tồn tại');
          throw err;
        }
      },
    },
    items: {
      list: (warehouseId) =>
        db.select().from(items).where(eq(items.warehouseId, warehouseId)).orderBy(items.sku),
      get: async (warehouseId, itemId) =>
        (
          await db
            .select()
            .from(items)
            .where(and(eq(items.warehouseId, warehouseId), eq(items.id, itemId)))
        )[0] ?? null,
      create: async (input) => {
        try {
          const [row] = await db
            .insert(items)
            .values({ ...input, tenantId })
            .returning();
          return row!;
        } catch (err) {
          if (isUniqueViolation(err)) throw new ConflictError('SKU đã tồn tại trong kho');
          throw err;
        }
      },
      applyDelta: async (warehouseId, itemId, delta) => {
        // Một câu UPDATE nguyên tử: không có khoảng hở giữa "đọc tồn kho" và "ghi tồn kho"
        const [row] = await db
          .update(items)
          .set({ quantity: sql`${items.quantity} + ${delta}::numeric`, updatedAt: new Date() })
          .where(
            and(
              eq(items.id, itemId),
              eq(items.warehouseId, warehouseId),
              sql`${items.quantity} + ${delta}::numeric >= 0`,
            ),
          )
          .returning();
        return row ?? null;
      },
    },
    movements: {
      insert: async (input) => {
        const [row] = await db
          .insert(stockMovements)
          .values({ ...input, tenantId })
          .onConflictDoNothing({ target: [stockMovements.tenantId, stockMovements.idempotencyKey] })
          .returning();
        return row ?? null;
      },
      findByKey: async (key) =>
        (await db.select().from(stockMovements).where(eq(stockMovements.idempotencyKey, key)))[0] ??
        null,
      list: (itemId, limit) =>
        db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.itemId, itemId))
          .orderBy(desc(stockMovements.id))
          .limit(limit),
    },
  };
}

export class RlsUnitOfWork implements TenantUnitOfWork {
  constructor(private readonly pool: pg.Pool) {}
  run<T>(tenantId: string, fn: (repos: TenantRepositories) => Promise<T>): Promise<T> {
    // withTenant: BEGIN → set_config('app.tenant_id') → fn → COMMIT/ROLLBACK
    return withTenant(this.pool, tenantId, (client) =>
      fn(createRepos(drizzle(client as pg.PoolClient, { schema }), tenantId)),
    );
  }
}
