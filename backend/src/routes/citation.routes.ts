import { FastifyInstance } from 'fastify';
import { citationValidatorService } from '../services/citation-validator.service.js';
import { retractionService } from '../services/retraction.service.js';
import type { CitationInput } from '../types.js';

export async function citationRoutes(app: FastifyInstance) {
  // Validate a citation (check if real or fake/hallucinated)
  app.post<{ Body: CitationInput }>(
    '/check/citation',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            doi: { type: 'string' },
            title: { type: 'string' },
            authors: { type: 'array', items: { type: 'string' } },
            year: { type: 'number' },
            journal: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              exists: { type: 'boolean' },
              confidence: { type: 'number' },
              source: { type: 'string' },
              status: { type: 'string' },
              matchedData: { type: 'object' },
              discrepancies: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    provided: { type: 'string' },
                    actual: { type: 'string' },
                    severity: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const citation = request.body;

      if (!citation.doi && !citation.title) {
        return reply.status(400).send({
          error: 'Either doi or title must be provided',
        });
      }

      const result = await citationValidatorService.validate(citation);
      return result;
    }
  );

  // Full check: retraction + validation
  app.post<{ Body: CitationInput }>(
    '/check/full',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            doi: { type: 'string' },
            pmid: { type: 'string' },
            title: { type: 'string' },
            authors: { type: 'array', items: { type: 'string' } },
            year: { type: 'number' },
            journal: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const citation = request.body;

      if (!citation.doi && !citation.title) {
        return reply.status(400).send({
          error: 'Either doi or title must be provided',
        });
      }

      // Check for retraction first
      const retractionResult = await retractionService.check(
        citation.doi,
        (citation as any).pmid
      );

      if (retractionResult.isRetracted) {
        return {
          status: 'retracted',
          isRetracted: true,
          retractionDetails: retractionResult.details,
          validation: null,
        };
      }

      // Then validate citation
      const validationResult = await citationValidatorService.validate(citation);

      return {
        status: validationResult.status,
        isRetracted: false,
        retractionDetails: null,
        validation: validationResult,
      };
    }
  );

  // Batch check: multiple citations
  app.post<{ Body: { items: CitationInput[] } }>(
    '/check/batch',
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
                  title: { type: 'string' },
                  authors: { type: 'array', items: { type: 'string' } },
                  year: { type: 'number' },
                  journal: { type: 'string' },
                },
              },
              maxItems: 50,
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

      if (items.length > 50) {
        return reply.status(400).send({
          error: 'Maximum 50 items per batch request',
        });
      }

      const results = await Promise.all(
        items.map(async (citation) => {
          // Check retraction first
          const retractionResult = await retractionService.check(
            citation.doi,
            (citation as any).pmid
          );

          if (retractionResult.isRetracted) {
            return {
              input: { doi: citation.doi, title: citation.title },
              status: 'retracted' as const,
              isRetracted: true,
              retractionDetails: retractionResult.details,
              validation: null,
            };
          }

          // Then validate
          if (citation.doi || citation.title) {
            const validationResult =
              await citationValidatorService.validate(citation);
            return {
              input: { doi: citation.doi, title: citation.title },
              status: validationResult.status,
              isRetracted: false,
              retractionDetails: null,
              validation: validationResult,
            };
          }

          return {
            input: { doi: citation.doi, title: citation.title },
            status: 'unknown' as const,
            isRetracted: false,
            retractionDetails: null,
            validation: null,
          };
        })
      );

      return { results };
    }
  );
}
