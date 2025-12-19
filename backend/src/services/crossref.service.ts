import type { CrossRefWork, CrossRefLookupResult } from '../types.js';

const CROSSREF_BASE_URL = 'https://api.crossref.org';

export class CrossRefService {
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
   * Normalize DOI for API lookup
   */
  private normalizeDoi(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//i, '');
  }

  /**
   * Get work metadata by DOI
   * Returns a result object that distinguishes found/not_found/error
   */
  async getWork(doi: string): Promise<CrossRefLookupResult> {
    const normalizedDoi = this.normalizeDoi(doi);

    try {
      const response = await fetch(
        `${CROSSREF_BASE_URL}/works/${encodeURIComponent(normalizedDoi)}`,
        { headers: this.headers }
      );

      // DOI doesn't exist - this is a definitive "not found"
      if (response.status === 404) {
        return { status: 'not_found' };
      }

      // Other HTTP errors - this is an API error, not "not found"
      if (!response.ok) {
        return { status: 'error', message: `CrossRef API error: ${response.status}` };
      }

      const data = await response.json() as { message: any };
      return { status: 'found', work: this.transformResponse(data.message) };
    } catch (error) {
      // Network/timeout errors - can't determine if DOI exists
      console.error(`CrossRef lookup failed for ${doi}:`, error);
      return { status: 'error', message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Search for works by title
   */
  async searchByTitle(title: string, limit = 5): Promise<CrossRefWork[]> {
    try {
      const response = await fetch(
        `${CROSSREF_BASE_URL}/works?query.title=${encodeURIComponent(title)}&rows=${limit}`,
        { headers: this.headers }
      );

      if (!response.ok) {
        throw new Error(`CrossRef API error: ${response.status}`);
      }

      const data = await response.json() as { message: { items: any[] } };
      return data.message.items.map((item: any) => this.transformResponse(item));
    } catch (error) {
      console.error(`CrossRef search failed for "${title}":`, error);
      return [];
    }
  }

  /**
   * Search for works by author and title
   */
  async searchByAuthorAndTitle(
    author: string,
    title: string,
    limit = 5
  ): Promise<CrossRefWork[]> {
    try {
      const query = `query.author=${encodeURIComponent(author)}&query.title=${encodeURIComponent(title)}&rows=${limit}`;
      const response = await fetch(`${CROSSREF_BASE_URL}/works?${query}`, {
        headers: this.headers,
      });

      if (!response.ok) {
        throw new Error(`CrossRef API error: ${response.status}`);
      }

      const data = await response.json() as { message: { items: any[] } };
      return data.message.items.map((item: any) => this.transformResponse(item));
    } catch (error) {
      console.error(`CrossRef search failed:`, error);
      return [];
    }
  }

  /**
   * Transform CrossRef API response to our format
   */
  private transformResponse(message: any): CrossRefWork {
    const authors =
      message.author?.map((a: any) => ({
        given: a.given,
        family: a.family,
        name: a.given && a.family ? `${a.given} ${a.family}` : a.name || 'Unknown',
      })) || [];

    const year =
      message['published-print']?.['date-parts']?.[0]?.[0] ||
      message['published-online']?.['date-parts']?.[0]?.[0] ||
      message.issued?.['date-parts']?.[0]?.[0] ||
      message.created?.['date-parts']?.[0]?.[0];

    return {
      doi: message.DOI,
      title: message.title?.[0] || '',
      authors,
      year: year || 0,
      journal: message['container-title']?.[0] || '',
      publisher: message.publisher,
      type: message.type,
      volume: message.volume,
      issue: message.issue,
      pages: message.page,
    };
  }
}

// Export singleton instance
export const crossrefService = new CrossRefService();
