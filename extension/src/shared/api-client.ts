import type { FullCheckResult, ExtractedCitation } from './types';

// Backend API URL - configurable via storage
const DEFAULT_API_URL = 'https://api.citicious.app';

export class CiticiousAPI {
  private apiUrl: string;

  constructor(apiUrl?: string) {
    this.apiUrl = apiUrl || DEFAULT_API_URL;
  }

  /**
   * Set API URL (for custom backends)
   */
  setApiUrl(url: string) {
    this.apiUrl = url;
  }

  /**
   * Get current API URL
   */
  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Check a single citation (retraction + validation)
   */
  async checkCitation(citation: {
    doi?: string;
    pmid?: string;
    title?: string;
    authors?: string[];
    year?: number;
    journal?: string;
  }): Promise<FullCheckResult> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/check/full`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(citation),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Citicious API error:', error);
      return {
        status: 'unknown',
        isRetracted: false,
        retractionDetails: null,
        validation: null,
      };
    }
  }

  /**
   * Batch check multiple citations
   */
  async checkBatch(
    citations: ExtractedCitation[]
  ): Promise<Map<string, FullCheckResult>> {
    const results = new Map<string, FullCheckResult>();

    try {
      const items = citations.map((c) => ({
        doi: c.doi,
        pmid: c.pmid,
        title: c.title,
        authors: c.authors,
        year: c.year,
        journal: c.journal,
      }));

      const response = await fetch(`${this.apiUrl}/api/v1/check/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Map results back to citation IDs
      for (let i = 0; i < citations.length; i++) {
        if (data.results[i]) {
          results.set(citations[i].id, data.results[i]);
        }
      }
    } catch (error) {
      console.error('Citicious API batch error:', error);
      // Return unknown status for all
      for (const citation of citations) {
        results.set(citation.id, {
          status: 'unknown',
          isRetracted: false,
          retractionDetails: null,
          validation: null,
        });
      }
    }

    return results;
  }

  /**
   * Check API health
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get API stats
   */
  async getStats(): Promise<{
    totalRetractions: number;
    lastUpdated: string;
  } | null> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/stats`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const citiciousAPI = new CiticiousAPI();
