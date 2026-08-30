import type { OpenAlexWork, OpenAlexLookupResult } from '../types.js';
import { fetchWithTimeout } from '../utils/fetch.js';

const OPENALEX_BASE_URL = 'https://api.openalex.org';

interface OpenAlexApiWork {
  doi?: string;
  title?: string;
  authorships?: Array<{
    author?: { display_name?: string; orcid?: string };
  }>;
  publication_year?: number;
  primary_location?: { source?: { display_name?: string } };
  id: string;
  cited_by_count?: number;
  is_retracted?: boolean;
}

export class OpenAlexService {
  private email: string;

  constructor() {
    this.email = process.env.OPENALEX_EMAIL || 'citicious@example.com';
  }

  private get headers(): HeadersInit {
    return {
      Accept: 'application/json',
      'User-Agent': `Citicious/0.2.0 (mailto:${this.email})`,
    };
  }

  /**
   * Normalize DOI for API lookup
   */
  private normalizeDoi(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//i, '');
  }

  /**
   * Get work metadata by DOI
   * Returns a result object that distinguishes found/not_found/error
   */
  async getWork(doi: string): Promise<OpenAlexLookupResult> {
    const normalizedDoi = this.normalizeDoi(doi);
    return this.getWorkByIdentifier(`doi:${encodeURIComponent(normalizedDoi)}`, doi);
  }

  async getWorkByPmid(pmid: string): Promise<OpenAlexLookupResult> {
    const normalizedPmid = pmid.trim().replace(/^pmid:\s*/i, '');
    return this.getWorkByIdentifier(`pmid:${encodeURIComponent(normalizedPmid)}`, pmid);
  }

  private async getWorkByIdentifier(
    identifier: string,
    displayId: string
  ): Promise<OpenAlexLookupResult> {
    try {
      const response = await fetchWithTimeout(
        `${OPENALEX_BASE_URL}/works/${identifier}?mailto=${this.email}`,
        { headers: this.headers }
      );

      // DOI doesn't exist - this is a definitive "not found"
      if (response.status === 404) {
        return { status: 'not_found' };
      }

      // Other HTTP errors - this is an API error, not "not found"
      if (!response.ok) {
        return { status: 'error', message: `OpenAlex API error: ${response.status}` };
      }

      const data = await response.json() as OpenAlexApiWork;
      return { status: 'found', work: this.transformResponse(data) };
    } catch (error) {
      // Network/timeout errors - can't determine if DOI exists
      console.error(`OpenAlex lookup failed for ${displayId}:`, error);
      return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Search for works with filters
   */
  async search(query: {
    title?: string;
    author?: string;
    year?: number;
  }): Promise<OpenAlexWork[]> {
    const filters: string[] = [];

    if (query.title) {
      filters.push(`title.search:${encodeURIComponent(query.title)}`);
    }
    if (query.author) {
      filters.push(
        `authorships.author.display_name.search:${encodeURIComponent(query.author)}`
      );
    }
    if (query.year) {
      filters.push(`publication_year:${query.year}`);
    }

    if (filters.length === 0) {
      return [];
    }

    try {
      const filterString = filters.join(',');
      const response = await fetchWithTimeout(
        `${OPENALEX_BASE_URL}/works?filter=${filterString}&per_page=10&mailto=${this.email}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json() as { results?: OpenAlexApiWork[] };
      return (data.results || []).map((work) => this.transformResponse(work));
    } catch (error) {
      console.error(`OpenAlex search failed:`, error);
      return [];
    }
  }

  /**
   * Search by title only
   */
  async searchByTitle(title: string, limit = 5): Promise<OpenAlexWork[]> {
    try {
      const response = await fetchWithTimeout(
        `${OPENALEX_BASE_URL}/works?search=${encodeURIComponent(title)}&per_page=${limit}&mailto=${this.email}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json() as { results?: OpenAlexApiWork[] };
      return (data.results || []).map((work) => this.transformResponse(work));
    } catch (error) {
      console.error(`OpenAlex search failed for "${title}":`, error);
      return [];
    }
  }

  /**
   * Transform OpenAlex API response to our format
   */
  private transformResponse(work: OpenAlexApiWork): OpenAlexWork {
    const authors =
      work.authorships?.map((a) => ({
        name: a.author?.display_name || 'Unknown',
        orcid: a.author?.orcid,
      })) || [];

    return {
      doi: work.doi?.replace('https://doi.org/', '') || '',
      title: work.title || '',
      authors,
      year: work.publication_year || 0,
      journal: work.primary_location?.source?.display_name || '',
      openAlexId: work.id,
      citedByCount: work.cited_by_count,
      isRetracted: work.is_retracted,
    };
  }
}

// Export singleton instance
export const openalexService = new OpenAlexService();
