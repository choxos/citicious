import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (request, reply) => {
    try {
      // Check database connection
      const count = await prisma.retraction.count();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          retractionCount: count,
        },
        version: '0.1.0',
      };
    } catch (error) {
      return reply.status(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        version: '0.1.0',
      });
    }
  });

  app.get('/stats', async (request, reply) => {
    try {
      const totalRetractions = await prisma.retraction.count();

      const withDoi = await prisma.retraction.count({
        where: {
          originalPaperDoi: { not: null },
        },
      });

      const withPmid = await prisma.retraction.count({
        where: {
          originalPaperPubmedId: { not: null },
        },
      });

      // Get retraction counts by year
      const retractionsByYear = await prisma.$queryRaw<{ year: number; count: bigint }[]>`
        SELECT EXTRACT(YEAR FROM retraction_date)::int as year, COUNT(*)::bigint as count
        FROM retractions
        WHERE retraction_date IS NOT NULL
        GROUP BY EXTRACT(YEAR FROM retraction_date)
        ORDER BY year DESC
        LIMIT 10
      `;

      return {
        totalRetractions,
        coverage: {
          withDoi,
          withPmid,
          doiPercentage: ((withDoi / totalRetractions) * 100).toFixed(1),
          pmidPercentage: ((withPmid / totalRetractions) * 100).toFixed(1),
        },
        retractionsByYear: retractionsByYear.map((r) => ({
          year: r.year,
          count: Number(r.count),
        })),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to fetch stats',
      });
    }
  });
}
