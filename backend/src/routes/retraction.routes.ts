import { FastifyInstance } from 'fastify';
import { retractionService } from '../services/retraction.service.js';
import type { RetractionCheckRequest } from '../types.js';

export async function retractionRoutes(app: FastifyInstance) {
  // Check if a single DOI/PMID is retracted
  app.post<{ Body: RetractionCheckRequest }>(
    '/check/retraction',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            doi: { type: 'string' },
            pmid: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              isRetracted: { type: 'boolean' },
              details: {
                type: 'object',
                properties: {
                  recordId: { type: 'number' },
                  title: { type: 'string', nullable: true },
                  journal: { type: 'string', nullable: true },
                  publisher: { type: 'string', nullable: true },
                  authors: { type: 'array', items: { type: 'string' } },
                  retractionDate: { type: 'string', nullable: true },
                  retractionNature: { type: 'string', nullable: true },
                  reason: { type: 'array', items: { type: 'string' } },
                  retractionNoticeUrl: { type: 'string', nullable: true },
                  originalPaperDate: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { doi, pmid } = request.body;

      if (!doi && !pmid) {
        return reply.status(400).send({
          error: 'Either doi or pmid must be provided',
        });
      }

      const result = await retractionService.check(doi, pmid);
      return result;
    }
  );

  // Batch check multiple DOIs/PMIDs
  app.post<{ Body: { items: RetractionCheckRequest[] } }>(
    '/check/retraction/batch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  doi: { type: 'string' },
                  pmid: { type: 'string' },
                },
              },
              maxItems: 100,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { items } = request.body;

      if (!items || items.length === 0) {
        return reply.status(400).send({
          error: 'Items array is required and must not be empty',
        });
      }

      if (items.length > 100) {
        return reply.status(400).send({
          error: 'Maximum 100 items per batch request',
        });
      }

      const results = await retractionService.batchCheck(items);
      return { results };
    }
  );

  // Search by title (for cases without DOI)
  app.get<{ Querystring: { q: string; limit?: number } }>(
    '/search/retraction',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 3 },
            limit: { type: 'number', minimum: 1, maximum: 20, default: 5 },
          },
        },
      },
    },
    async (request, reply) => {
      const { q, limit } = request.query;

      const results = await retractionService.searchByTitle(q, limit || 5);
      return { results };
    }
  );
}
