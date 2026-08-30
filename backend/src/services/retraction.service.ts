import { PrismaClient, Retraction } from '@prisma/client';
import type {
  RetractionDetails,
  RetractionCheckResponse,
  RetractionStatus,
} from '../types.js';
import { fetchWithTimeout } from '../utils/fetch.js';

const prisma = new PrismaClient();
const CROSSREF_BASE_URL = 'https://api.crossref.org';

interface CrossRefUpdate {
  type?: string;
  DOI?: string;
  source?: string;
  updated?: {
    timestamp?: number;
    'date-time'?: string;
  };
}

interface CrossRefWork {
  title?: string[];
  'container-title'?: string[];
  publisher?: string;
  author?: { given?: string; family?: string }[];
  created?: { 'date-time'?: string };
  published?: { 'date-time'?: string };
  'updated-by'?: unknown;
}

function normalizedUpdateType(update: CrossRefUpdate): string {
  return String(update.type || '').toLowerCase().replace(/_/g, '-');
}

function updateTimestamp(update: CrossRefUpdate): number {
  if (typeof update.updated?.timestamp === 'number') return update.updated.timestamp;
  const parsed = Date.parse(update.updated?.['date-time'] || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export class RetractionService {
  private email: string;

  constructor() {
    this.email = process.env.CROSSREF_EMAIL || 'citicious@example.com';
  }

  private get headers(): HeadersInit {
    return {
      'User-Agent': `Citicious/0.2.0 (mailto:${this.email})`,
      Accept: 'application/json',
    };
  }

  /**
   * Normalize DOI for consistent lookup
   */
  private normalizeDoi(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//i, '');
  }

  async checkViaCrossRefApi(doi: string): Promise<RetractionCheckResponse> {
    const normalizedDoi = this.normalizeDoi(doi);

    try {
      const response = await fetchWithTimeout(
        `${CROSSREF_BASE_URL}/works/${encodeURIComponent(normalizedDoi)}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return { isRetracted: false };
        }
        throw new Error(`CrossRef API error: ${response.status}`);
      }

      const data = await response.json() as { message?: CrossRefWork };
      const work = data.message || {};
      const rawUpdates: unknown[] = Array.isArray(work['updated-by'])
        ? work['updated-by']
        : [];
      const updates = rawUpdates.filter(
        (candidate): candidate is CrossRefUpdate =>
          candidate !== null && typeof candidate === 'object'
      );

      let reinstatedAt = 0;
      for (const update of updates) {
        if (normalizedUpdateType(update).includes('reinstat')) {
          reinstatedAt = Math.max(reinstatedAt, updateTimestamp(update));
        }
      }

      const candidates: {
        update: CrossRefUpdate;
        type: string;
        status: RetractionStatus;
        nature: string;
        rank: number;
        timestamp: number;
      }[] = [];

      for (const update of updates) {
        const type = normalizedUpdateType(update);
        let status: RetractionStatus | undefined;
        let nature = '';
        let rank = 0;

        if (type.includes('retract')) {
          status = 'retracted';
          nature = 'Retraction';
          rank = 4;
        } else if (type.includes('withdraw')) {
          status = 'retracted';
          nature = 'Withdrawal';
          rank = 3;
        } else if (type.includes('concern')) {
          status = 'concern';
          nature = 'Expression of Concern';
          rank = 2;
        } else if (type.includes('correct')) {
          status = 'correction';
          nature = 'Correction';
          rank = 1;
        }

        if (!status) continue;
        const timestamp = updateTimestamp(update);
        if (
          status === 'retracted' &&
          reinstatedAt > 0 &&
          reinstatedAt >= timestamp
        ) {
          continue;
        }
        candidates.push({ update, type, status, nature, rank, timestamp });
      }

      candidates.sort(
        (a, b) =>
          b.rank - a.rank ||
          b.timestamp - a.timestamp ||
          a.type.localeCompare(b.type) ||
          String(a.update.DOI || '').localeCompare(String(b.update.DOI || ''))
      );
      const selected = candidates[0];

      if (selected) {
        return {
          isRetracted: selected.status === 'retracted',
          status: selected.status,
          details: {
            recordId: 0,
            title: work.title?.[0] || null,
            journal: work['container-title']?.[0] || null,
            publisher: work.publisher || null,
            authors:
              work.author?.map(
                (author: { given?: string; family?: string }) =>
                  `${author.given || ''} ${author.family || ''}`.trim()
              ) || [],
            retractionDate: selected.update.updated?.['date-time'] || null,
            retractionNature: selected.nature,
            reason: [],
            retractionNoticeUrl: selected.update.DOI
              ? `https://doi.org/${selected.update.DOI}`
              : null,
            originalPaperDate:
              work.created?.['date-time'] ||
              work.published?.['date-time'] ||
              null,
            source:
              selected.update.source === 'retraction-watch'
                ? 'retraction-watch'
                : 'publisher',
          },
        };
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
        status: 'retracted',
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
    if (apiResult.status) {
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
        status: 'retracted',
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
      if (result.status) return result;
    }

    if (pmid) {
      const result = await this.checkByPmid(pmid);
      if (result.status) return result;
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
