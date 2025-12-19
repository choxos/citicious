import type { OpenAlexWork, OpenAlexLookupResult } from '../types.js';

const OPENALEX_BASE_URL = 'https://api.openalex.org';

export class OpenAlexService {
  private email: string;

  constructor() {
    this.email = process.env.OPENALEX_EMAIL || 'citicious@example.com';
  }

  private get headers(): HeadersInit {
    return {
      Accept: 'application/json',
      'User-Agent': `Citicious/0.1.0 (mailto:${this.email})`,
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

    try {
      const response = await fetch(
        `${OPENALEX_BASE_URL}/works/doi:${encodeURIComponent(normalizedDoi)}?mailto=${this.email}`,
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

      const data = await response.json() as any;
      return { status: 'found', work: this.transformResponse(data) };
    } catch (error) {
      // Network/timeout errors - can't determine if DOI exists
      console.error(`OpenAlex lookup failed for ${doi}:`, error);
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
      const response = await fetch(
        `${OPENALEX_BASE_URL}/works?filter=${filterString}&per_page=10&mailto=${this.email}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json() as { results: any[] };
      return data.results.map((work: any) => this.transformResponse(work));
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
      const response = await fetch(
        `${OPENALEX_BASE_URL}/works?search=${encodeURIComponent(title)}&per_page=${limit}&mailto=${this.email}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json() as { results: any[] };
      return data.results.map((work: any) => this.transformResponse(work));
    } catch (error) {
      console.error(`OpenAlex search failed for "${title}":`, error);
      return [];
    }
  }

  /**
   * Transform OpenAlex API response to our format
   */
  private transformResponse(work: any): OpenAlexWork {
    const authors =
      work.authorships?.map((a: any) => ({
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
    };
  }
}

// Export singleton instance
export const openalexService = new OpenAlexService();
