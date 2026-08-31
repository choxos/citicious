import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from 'dotenv';

import { retractionRoutes } from './routes/retraction.routes.js';
import { citationRoutes } from './routes/citation.routes.js';
import { healthRoutes } from './routes/health.routes.js';

// Load environment variables
config({ quiet: true });

const app = Fastify({
  logger: process.env.NODE_ENV === 'production'
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        level: process.env.LOG_LEVEL || 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      },
});

// Register plugins
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: corsOrigins.length > 0 ? corsOrigins : false,
  methods: ['GET', 'POST', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
});

// Register routes
await app.register(healthRoutes, { prefix: '/api/v1' });
await app.register(retractionRoutes, { prefix: '/api/v1' });
await app.register(citationRoutes, { prefix: '/api/v1' });

// Error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  const message = error instanceof Error ? error.message : 'Bad Request';
  reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    statusCode,
  });
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`Citicious API running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exitCode = 1;
  }
};

start();

export default app;
