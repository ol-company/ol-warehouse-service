import { startServer } from '@ol/node-kit';
import { buildApp } from './app.js';
import { loadAppConfig } from './config.js';
import { buildContainer } from './container.js';

const config = loadAppConfig();
const c = buildContainer(config).cradle;
const { app } = buildApp(c);

startServer({
  app,
  port: config.PORT,
  logger: c.logger,
  health: c.health,
  drainDelayMs: config.DRAIN_DELAY_MS,
  onShutdown: [() => c.pool.end()],
});
