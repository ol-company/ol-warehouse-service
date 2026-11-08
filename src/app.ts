import express, { type Express } from 'express';
import helmet from 'helmet';
import {
  accessLogMiddleware,
  errorHandler,
  healthRouter,
  notFoundHandler,
  requestContextMiddleware,
} from '@ol/node-kit';
import type { Cradle } from './container.js';
import { buildRoutes } from './interfaces/http/routes.js';

export function buildApp(c: Cradle): { app: Express; routes: ReturnType<typeof buildRoutes> } {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'uniquelocal');
  app.use(helmet());
  app.use(requestContextMiddleware());
  app.use(accessLogMiddleware(c.logger));
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter(c.health, { db: () => c.pool.query('SELECT 1') }));
  const routes = buildRoutes(c);
  app.use(routes.router);
  app.use(notFoundHandler());
  app.use(errorHandler(c.logger));
  return { app, routes };
}
