import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from 'dotenv';

import { retractionRoutes } from './routes/retraction.routes.js';
import { citationRoutes } from './routes/citation.routes.js';
import { healthRoutes } from './routes/health.routes.js';

// Load environment variables
config();

const app = Fastify({
  logger: {
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
await app.register(cors, {
  origin: true, // Allow all origins for extension
  methods: ['GET', 'POST', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
});

// Register routes
await app.register(healthRoutes, { prefix: '/api/v1' });
await app.register(retractionRoutes, { prefix: '/api/v1' });
await app.register(citationRoutes, { prefix: '/api/v1' });

// Error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  reply.status(error.statusCode || 500).send({
    error: error.message || 'Internal Server Error',
    statusCode: error.statusCode || 500,
  });
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`Citicious API running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
