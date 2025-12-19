import { PrismaClient, Retraction } from '@prisma/client';
import type { RetractionDetails, RetractionCheckResponse } from '../types.js';

const prisma = new PrismaClient();
const CROSSREF_BASE_URL = 'https://api.crossref.org';

export class RetractionService {
  private email: string;

  constructor() {
    this.email = process.env.CROSSREF_EMAIL || 'citicious@example.com';
  }

  private get headers(): HeadersInit {
    return {
      'User-Agent': `Citicious/0.1.0 (mailto:${this.email})`,
      Accept: 'application/json',
    };
  }

  /**
   * Normalize DOI for consistent lookup
   */
  private normalizeDoi(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//i, '');
  }

  /**
   * Check if a DOI is retracted using CrossRef API (primary method)
   * CrossRef includes Retraction Watch data in the update-to field
   */
  async checkViaCrossRefApi(doi: string): Promise<RetractionCheckResponse> {
    const normalizedDoi = this.normalizeDoi(doi);

    try {
      const response = await fetch(
        `${CROSSREF_BASE_URL}/works/${encodeURIComponent(normalizedDoi)}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return { isRetracted: false };
        }
        throw new Error(`CrossRef API error: ${response.status}`);
      }

      const data = await response.json() as { message: any };
      const work = data.message;

      // Check if the work has been retracted
      // CrossRef uses 'update-to' field for retractions from both publishers and Retraction Watch
      if (work['update-to']) {
        for (const update of work['update-to']) {
          if (
            update.type === 'retraction' ||
            update.type === 'expression-of-concern'
          ) {
            return {
              isRetracted: true,
              details: {
                recordId: 0, // CrossRef doesn't have Retraction Watch record ID
                title: work.title?.[0] || null,
                journal: work['container-title']?.[0] || null,
                publisher: work.publisher || null,
                authors:
                  work.author?.map(
                    (a: any) => `${a.given || ''} ${a.family || ''}`.trim()
                  ) || [],
                retractionDate: update.updated?.['date-time'] || null,
                retractionNature:
                  update.type === 'retraction'
                    ? 'Retraction'
                    : 'Expression of Concern',
                reason: [], // CrossRef API doesn't include detailed reasons
                retractionNoticeUrl: update.DOI
                  ? `https://doi.org/${update.DOI}`
                  : null,
                originalPaperDate:
                  work.created?.['date-time'] ||
                  work.published?.['date-time'] ||
                  null,
                source: update.source || 'publisher', // 'publisher' or 'retraction-watch'
              },
            };
          }
        }
      }

      return { isRetracted: false };
    } catch (error) {
      console.error(`CrossRef API check failed for ${doi}:`, error);
      // Fall back to local database if API fails
      return this.checkByDoiLocal(doi);
    }
  }

  /**
   * Check if a DOI is retracted using local Retraction Watch database (fallback)
   */
  async checkByDoiLocal(doi: string): Promise<RetractionCheckResponse> {
    const normalizedDoi = this.normalizeDoi(doi);

    const retraction = await prisma.retraction.findFirst({
      where: {
        originalPaperDoi: {
          equals: normalizedDoi,
          mode: 'insensitive',
        },
      },
    });

    if (retraction) {
      return {
        isRetracted: true,
        details: this.formatDetails(retraction),
      };
    }

    return { isRetracted: false };
  }

  /**
   * Check if a DOI corresponds to a retracted article
   * Uses CrossRef API first (includes Retraction Watch data), falls back to local DB
   */
  async checkByDoi(doi: string): Promise<RetractionCheckResponse> {
    // Primary: CrossRef API (includes Retraction Watch data)
    const apiResult = await this.checkViaCrossRefApi(doi);
    if (apiResult.isRetracted) {
      return apiResult;
    }

    // Fallback: Local Retraction Watch database
    // (in case CrossRef doesn't have the retraction yet or API failed)
    return this.checkByDoiLocal(doi);
  }

  /**
   * Check if a PubMed ID corresponds to a retracted article
   */
  async checkByPmid(pmid: string): Promise<RetractionCheckResponse> {
    const normalizedPmid = pmid.trim();

    const retraction = await prisma.retraction.findFirst({
      where: {
        originalPaperPubmedId: normalizedPmid,
      },
    });

    if (retraction) {
      return {
        isRetracted: true,
        details: this.formatDetails(retraction),
      };
    }

    return { isRetracted: false };
  }

  /**
   * Check by either DOI or PMID
   */
  async check(doi?: string, pmid?: string): Promise<RetractionCheckResponse> {
    if (doi) {
      const result = await this.checkByDoi(doi);
      if (result.isRetracted) return result;
    }

    if (pmid) {
      const result = await this.checkByPmid(pmid);
      if (result.isRetracted) return result;
    }

    return { isRetracted: false };
  }

  /**
   * Batch check multiple DOIs/PMIDs
   */
  async batchCheck(
    items: { doi?: string; pmid?: string }[]
  ): Promise<RetractionCheckResponse[]> {
    const results: RetractionCheckResponse[] = [];

    // Process in parallel with concurrency limit
    const BATCH_SIZE = 10;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((item) => this.check(item.doi, item.pmid))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Search retractions by title (fuzzy match) in local database
   */
  async searchByTitle(title: string, limit = 5): Promise<Retraction[]> {
    // Use PostgreSQL full-text search
    const results = await prisma.$queryRaw<Retraction[]>`
      SELECT *
      FROM retractions
      WHERE to_tsvector('english', title) @@ plainto_tsquery('english', ${title})
      ORDER BY ts_rank(to_tsvector('english', title), plainto_tsquery('english', ${title})) DESC
      LIMIT ${limit}
    `;

    return results;
  }

  /**
   * Format retraction record to response details
   */
  private formatDetails(retraction: Retraction): RetractionDetails {
    return {
      recordId: retraction.recordId,
      title: retraction.title,
      journal: retraction.journal,
      publisher: retraction.publisher,
      authors: retraction.authors,
      retractionDate: retraction.retractionDate?.toISOString() ?? null,
      retractionNature: retraction.retractionNature,
      reason: retraction.reason,
      retractionNoticeUrl: retraction.urls?.[0] ?? null,
      originalPaperDate: retraction.originalPaperDate?.toISOString() ?? null,
    };
  }
}

// Export singleton instance
export const retractionService = new RetractionService();
