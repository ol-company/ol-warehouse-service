// Runtime config của Warehouse service.
import { envBoolean, loadConfig } from '@ol/node-kit';
import { z } from 'zod';

const DbSchema = z.object({
  APP_ENV: z.enum(['local', 'dev', 'staging', 'prod']).default('local'),
  LOG_LEVEL: z.string().default('info'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('warehouse'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL: z.string().optional(),
  DB_SSL_CA_FILE: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
});

const AppSchema = DbSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  OIDC_ISSUER: z.url(),
  OIDC_AUDIENCE: z.string().default('ol-api'),
  OIDC_INTERNAL_ISSUER: z.url().optional(), // http://keycloak:8080/realms/ol — chấp nhận thêm nếu token mang iss nội bộ
  KEYCLOAK_INTERNAL_URL: z.url(),
  KEYCLOAK_REALM: z.string().default('ol'),
  WAREHOUSE_CLIENT_ID: z.string().default('ol-warehouse-service'),
  WAREHOUSE_CLIENT_SECRET: z.string().min(16),
  IAM_INTERNAL_URL: z.url(), // http://iam-service:3000
  AUTHZ_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  DRAIN_DELAY_MS: z.coerce.number().int().nonnegative().default(5_000),
});

export type DbEnv = z.infer<typeof DbSchema>;
export type AppConfig = z.infer<typeof AppSchema>;

export const loadDbConfig = (): DbEnv => loadConfig(DbSchema);
export const loadAppConfig = (): AppConfig => loadConfig(AppSchema);

export function dbOptions(cfg: DbEnv) {
  return {
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    ssl: envBoolean(cfg.DB_SSL),
    sslCaFile: cfg.DB_SSL_CA_FILE,
    maxConnections: cfg.DB_POOL_MAX,
  };
}
