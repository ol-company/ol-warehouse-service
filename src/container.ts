// Composition root của Warehouse service.
import {
  asClass,
  asFunction,
  asValue,
  createContainer,
  InjectionMode,
  type AwilixContainer,
  type Resolver,
} from 'awilix';
import {
  CachingAuthorizer,
  ClientCredentialsTokenProvider,
  createLogger,
  HealthState,
  HttpAuthorizer,
  JoseTokenVerifier,
  type Authorizer,
  type Logger,
  type TokenVerifier,
} from '@ol/node-kit';
import type pg from 'pg';
import type { TenantUnitOfWork } from './application/ports.js';
import { WarehouseService } from './application/warehouse-service.js';
import { dbOptions, type AppConfig } from './config.js';
import { createPool, RlsUnitOfWork } from './infrastructure/db/database.js';

export interface Cradle {
  config: AppConfig;
  logger: Logger;
  health: HealthState;
  pool: pg.Pool;
  uow: TenantUnitOfWork;
  tokenVerifier: TokenVerifier;
  authorizer: Authorizer;
  warehouseService: WarehouseService;
}

export function buildContainer(
  config: AppConfig,
  options: { pool?: pg.Pool; overrides?: Partial<Record<keyof Cradle, Resolver<unknown>>> } = {},
): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });
  const pool = options.pool ?? createPool(dbOptions(config));
  const realmUrl = `${config.KEYCLOAK_INTERNAL_URL}/realms/${config.KEYCLOAK_REALM}`;

  container.register({
    config: asValue(config),
    logger: asValue(createLogger({ service: 'ol-warehouse-service', level: config.LOG_LEVEL })),
    health: asValue(new HealthState()),
    pool: asValue(pool),
    uow: asValue(new RlsUnitOfWork(pool)),
    tokenVerifier: asValue(
      new JoseTokenVerifier({
        issuer: [
          config.OIDC_ISSUER,
          ...(config.OIDC_INTERNAL_ISSUER ? [config.OIDC_INTERNAL_ISSUER] : []),
        ],
        audience: config.OIDC_AUDIENCE,
        jwksUri: `${realmUrl}/protocol/openid-connect/certs`,
      }),
    ),
    // Hỏi IAM qua HTTP (danh tính service = client credentials) + cache; IAM lỗi → fail closed
    authorizer: asFunction(
      ({ logger }: Cradle) =>
        new CachingAuthorizer(
          new HttpAuthorizer({
            baseUrl: config.IAM_INTERNAL_URL,
            tokenProvider: new ClientCredentialsTokenProvider({
              tokenEndpoint: `${realmUrl}/protocol/openid-connect/token`,
              clientId: config.WAREHOUSE_CLIENT_ID,
              clientSecret: config.WAREHOUSE_CLIENT_SECRET,
            }),
          }),
          { allowTtlMs: config.AUTHZ_CACHE_TTL_SECONDS * 1000, logger },
        ),
    ).singleton(),
    warehouseService: asClass(WarehouseService).singleton(),
  });

  if (options.overrides) container.register(options.overrides as Record<string, Resolver<unknown>>);
  return container;
}
