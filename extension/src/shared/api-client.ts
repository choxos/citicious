import type { FullCheckResult, ExtractedCitation, CitationStatus, RetractionDetails, Discrepancy, MatchedData } from './types';

const CROSSREF_BASE_URL = 'https://api.crossref.org';
const OPENALEX_BASE_URL = 'https://api.openalex.org';

// Email for polite pool access (better rate limits)
const CONTACT_EMAIL = 'citicious@example.com';

// URL fetch timeout (ms)
const URL_FETCH_TIMEOUT = 10000;

/**
 * Normalize DOI for API lookup
 */
function normalizeDoi(doi: string): string {
  return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//i, '');
}

/**
 * Calculate string similarity (simple word overlap)
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 1;

  // Simple word overlap similarity
  const aWords = new Set(aLower.split(/\s+/).filter(w => w.length > 2));
  const bWords = new Set(bLower.split(/\s+/).filter(w => w.length > 2));
  const intersection = [...aWords].filter(w => bWords.has(w));
  const union = new Set([...aWords, ...bWords]);

  return union.size > 0 ? intersection.length / union.size : 0;
}

/**
 * Check CrossRef for DOI
 */
async function checkCrossRef(doi: string): Promise<{ status: 'found' | 'not_found' | 'error'; work?: any }> {
  const normalizedDoi = normalizeDoi(doi);

  try {
    const response = await fetch(
      `${CROSSREF_BASE_URL}/works/${encodeURIComponent(normalizedDoi)}`,
      {
        headers: {
          'User-Agent': `Citicious/0.1.0 (mailto:${CONTACT_EMAIL})`,
          'Accept': 'application/json',
        },
      }
    );

    if (response.status === 404) {
      return { status: 'not_found' };
    }

    if (!response.ok) {
      return { status: 'error' };
    }

    const data = await response.json();
    return { status: 'found', work: data.message };
  } catch (error) {
    console.error('CrossRef lookup failed:', error);
    return { status: 'error' };
  }
}

/**
 * Check OpenAlex for DOI
 */
async function checkOpenAlex(doi: string): Promise<{ status: 'found' | 'not_found' | 'error'; work?: any }> {
  const normalizedDoi = normalizeDoi(doi);

  try {
    const response = await fetch(
      `${OPENALEX_BASE_URL}/works/doi:${encodeURIComponent(normalizedDoi)}?mailto=${CONTACT_EMAIL}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': `Citicious/0.1.0 (mailto:${CONTACT_EMAIL})`,
        },
      }
    );

    if (response.status === 404) {
      return { status: 'not_found' };
    }

    if (!response.ok) {
      return { status: 'error' };
    }

    const data = await response.json();
    return { status: 'found', work: data };
  } catch (error) {
    console.error('OpenAlex lookup failed:', error);
    return { status: 'error' };
  }
}

/**
 * Check if a URL exists and extract its title
 * Returns: { status: 'found'|'not_found'|'error', title?: string }
 */
async function checkUrl(url: string): Promise<{ status: 'found' | 'not_found' | 'error'; title?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; Citicious/0.1.0)',
      },
    });

    clearTimeout(timeoutId);

    // 404 or similar = page not found -> FAKE
    if (response.status === 404 || response.status === 410) {
      return { status: 'not_found' };
    }

    if (!response.ok) {
      return { status: 'error' };
    }

    // Get the HTML and extract the title
    const html = await response.text();

    // Check for common "page not found" indicators in the content
    const lowerHtml = html.toLowerCase();
    if (
      lowerHtml.includes('page not found') ||
      lowerHtml.includes('404') ||
      lowerHtml.includes('not found') ||
      lowerHtml.includes('does not exist') ||
      lowerHtml.includes('no longer available') ||
      lowerHtml.includes('has been removed')
    ) {
      return { status: 'not_found' };
    }

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    // Check if title indicates page not found
    if (title) {
      const lowerTitle = title.toLowerCase();
      if (
        lowerTitle.includes('page not found') ||
        lowerTitle.includes('404') ||
        lowerTitle.includes('not found') ||
        lowerTitle.includes('error')
      ) {
        return { status: 'not_found' };
      }
    }

    return { status: 'found', title };
  } catch (error) {
    console.error('URL check failed:', error);
    // Network errors, timeouts, CORS errors
    return { status: 'error' };
  }
}

/**
 * Check Retraction Watch Database for DOI
 * Uses the public Crossref metadata which includes retraction info
 */
async function checkRetractionStatus(crossrefWork: any): Promise<RetractionDetails | null> {
  // Check if the work has been updated/retracted via Crossref metadata
  const updateTo = crossrefWork['update-to'];
  const relation = crossrefWork.relation;

  // Check for retraction in updates
  if (updateTo && Array.isArray(updateTo)) {
    for (const update of updateTo) {
      const updateType = update.type?.toLowerCase() || '';
      if (updateType.includes('retraction') || updateType.includes('withdrawal')) {
        return {
          recordId: 0,
          title: crossrefWork.title?.[0] || null,
          journal: crossrefWork['container-title']?.[0] || null,
          publisher: crossrefWork.publisher || null,
          authors: crossrefWork.author?.map((a: any) => a.given && a.family ? `${a.given} ${a.family}` : a.name) || [],
          retractionDate: update.updated?.['date-time'] || null,
          retractionNature: update.type || 'Retraction',
          reason: [],
          retractionNoticeUrl: update.DOI ? `https://doi.org/${update.DOI}` : null,
          originalPaperDate: null,
        };
      }
    }
  }

  // Check for retraction in relations
  if (relation) {
    const retractionRelations = ['is-retracted-by', 'has-retraction'];
    for (const relType of retractionRelations) {
      if (relation[relType]) {
        return {
          recordId: 0,
          title: crossrefWork.title?.[0] || null,
          journal: crossrefWork['container-title']?.[0] || null,
          publisher: crossrefWork.publisher || null,
          authors: crossrefWork.author?.map((a: any) => a.given && a.family ? `${a.given} ${a.family}` : a.name) || [],
          retractionDate: null,
          retractionNature: 'Retraction',
          reason: [],
          retractionNoticeUrl: relation[relType]?.[0]?.id ? `https://doi.org/${relation[relType][0].id}` : null,
          originalPaperDate: null,
        };
      }
    }
  }

  return null;
}

/**
 * Transform CrossRef work to matched data format
 */
function crossrefToMatchedData(work: any): MatchedData {
  const authors = work.author?.map((a: any) => ({
    given: a.given,
    family: a.family,
    name: a.given && a.family ? `${a.given} ${a.family}` : a.name || 'Unknown',
  })) || [];

  const year =
    work['published-print']?.['date-parts']?.[0]?.[0] ||
    work['published-online']?.['date-parts']?.[0]?.[0] ||
    work.issued?.['date-parts']?.[0]?.[0] ||
    work.created?.['date-parts']?.[0]?.[0];

  return {
    doi: work.DOI,
    title: work.title?.[0] || '',
    authors,
    year: year || 0,
    journal: work['container-title']?.[0] || '',
    publisher: work.publisher,
  };
}

/**
 * Transform OpenAlex work to matched data format
 */
function openalexToMatchedData(work: any): MatchedData {
  const authors = work.authorships?.map((a: any) => ({
    name: a.author?.display_name || 'Unknown',
  })) || [];

  return {
    doi: work.doi?.replace('https://doi.org/', '') || '',
    title: work.title || '',
    authors,
    year: work.publication_year || 0,
    journal: work.primary_location?.source?.display_name || '',
  };
}

/**
 * Compare metadata and find discrepancies
 */
function compareMetadata(
  provided: { title?: string; authors?: string[]; year?: number; journal?: string },
  actual: MatchedData
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Compare title
  if (provided.title && actual.title) {
    const titleSimilarity = stringSimilarity(provided.title, actual.title);
    if (titleSimilarity < 0.9) {
      discrepancies.push({
        field: 'title',
        provided: provided.title,
        actual: actual.title,
        severity: titleSimilarity < 0.5 ? 'critical' : 'major',
      });
    }
  }

  // Compare year
  if (provided.year && actual.year && provided.year !== actual.year) {
    const yearDiff = Math.abs(provided.year - actual.year);
    discrepancies.push({
      field: 'year',
      provided: String(provided.year),
      actual: String(actual.year),
      severity: yearDiff > 2 ? 'major' : 'minor',
    });
  }

  // Compare first author
  if (provided.authors?.length && actual.authors?.length) {
    const providedFirstAuthor = provided.authors[0].toLowerCase();
    const actualFirstAuthor = actual.authors[0].name.toLowerCase();
    const authorSimilarity = stringSimilarity(providedFirstAuthor, actualFirstAuthor);

    if (authorSimilarity < 0.7) {
      discrepancies.push({
        field: 'authors',
        provided: provided.authors[0],
        actual: actual.authors[0].name,
        severity: 'major',
      });
    }
  }

  return discrepancies;
}

/**
 * Compare provided title with actual page title
 */
function compareTitles(providedTitle: string, actualTitle: string): { match: boolean; similarity: number } {
  const similarity = stringSimilarity(providedTitle, actualTitle);
  return {
    match: similarity >= 0.3, // Low threshold because page titles often differ from citation titles
    similarity,
  };
}

export class CiticiousAPI {
  /**
   * Check a single citation (validation + retraction status)
   */
  async checkCitation(citation: {
    doi?: string;
    pmid?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    journal?: string;
  }): Promise<FullCheckResult> {
    // Priority 1: DOI-based validation
    if (citation.doi) {
      return this.checkByDoi(citation);
    }

    // Priority 2: URL-based validation (for non-academic citations)
    if (citation.url) {
      return this.checkByUrl(citation);
    }

    // No DOI and no URL -> can't validate, skip
    return {
      status: 'skip',
      isRetracted: false,
      retractionDetails: null,
      validation: null,
    };
  }

  /**
   * Check citation by DOI
   */
  private async checkByDoi(citation: {
    doi?: string;
    title?: string;
    authors?: string[];
    year?: number;
    journal?: string;
  }): Promise<FullCheckResult> {
    if (!citation.doi) {
      return {
        status: 'skip',
        isRetracted: false,
        retractionDetails: null,
        validation: null,
      };
    }

    // Step 1: Check if DOI exists in CrossRef
    const crossrefResult = await checkCrossRef(citation.doi);

    let matchedData: MatchedData | undefined;
    let source: 'crossref' | 'openalex' | 'none' = 'none';
    let rawCrossrefWork: any = null;

    if (crossrefResult.status === 'found') {
      matchedData = crossrefToMatchedData(crossrefResult.work);
      rawCrossrefWork = crossrefResult.work;
      source = 'crossref';
    } else if (crossrefResult.status === 'not_found') {
      // Try OpenAlex as fallback
      const openalexResult = await checkOpenAlex(citation.doi);

      if (openalexResult.status === 'found') {
        matchedData = openalexToMatchedData(openalexResult.work);
        source = 'openalex';
      } else if (openalexResult.status === 'not_found') {
        // DOI doesn't exist in either database -> FAKE (likely)
        return {
          status: 'fake-likely',
          isRetracted: false,
          retractionDetails: null,
          validation: {
            exists: false,
            confidence: 0,
            source: 'none',
            discrepancies: [{
              field: 'doi',
              provided: citation.doi,
              actual: 'NOT FOUND',
              severity: 'critical',
            }],
            status: 'fake-likely',
          },
        };
      } else {
        // OpenAlex error, can't determine
        return {
          status: 'skip',
          isRetracted: false,
          retractionDetails: null,
          validation: null,
        };
      }
    } else {
      // CrossRef error, try OpenAlex
      const openalexResult = await checkOpenAlex(citation.doi);

      if (openalexResult.status === 'found') {
        matchedData = openalexToMatchedData(openalexResult.work);
        source = 'openalex';
      } else if (openalexResult.status === 'not_found') {
        // CrossRef had error, but OpenAlex confirmed not found -> FAKE (likely)
        return {
          status: 'fake-likely',
          isRetracted: false,
          retractionDetails: null,
          validation: {
            exists: false,
            confidence: 0,
            source: 'none',
            discrepancies: [{
              field: 'doi',
              provided: citation.doi,
              actual: 'NOT FOUND',
              severity: 'critical',
            }],
            status: 'fake-likely',
          },
        };
      } else {
        // Both APIs had errors -> skip (can't determine)
        return {
          status: 'skip',
          isRetracted: false,
          retractionDetails: null,
          validation: null,
        };
      }
    }

    // DOI exists! Now check for discrepancies and retraction status
    const discrepancies = matchedData ? compareMetadata(citation, matchedData) : [];

    // Step 2: Check retraction status from CrossRef metadata
    let retractionDetails: RetractionDetails | null = null;
    if (rawCrossrefWork) {
      retractionDetails = await checkRetractionStatus(rawCrossrefWork);
    }

    if (retractionDetails) {
      return {
        status: 'retracted',
        isRetracted: true,
        retractionDetails,
        validation: {
          exists: true,
          confidence: 1.0,
          source,
          matchedData,
          discrepancies,
          status: 'retracted',
        },
      };
    }

    // DOI exists and not retracted -> VERIFIED
    return {
      status: 'verified',
      isRetracted: false,
      retractionDetails: null,
      validation: {
        exists: true,
        confidence: 1.0,
        source,
        matchedData,
        discrepancies,
        status: 'verified',
      },
    };
  }

  /**
   * Check citation by URL (for non-academic citations without DOIs)
   */
  private async checkByUrl(citation: {
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
  }): Promise<FullCheckResult> {
    if (!citation.url) {
      return {
        status: 'skip',
        isRetracted: false,
        retractionDetails: null,
        validation: null,
      };
    }

    // Fetch the URL and check if it exists
    const urlResult = await checkUrl(citation.url);

    // URL returns 404 or "Page Not Found" -> FAKE (likely)
    if (urlResult.status === 'not_found') {
      return {
        status: 'fake-likely',
        isRetracted: false,
        retractionDetails: null,
        validation: {
          exists: false,
          confidence: 0,
          source: 'none',
          discrepancies: [{
            field: 'url',
            provided: citation.url,
            actual: 'PAGE NOT FOUND',
            severity: 'critical',
          }],
          status: 'fake-likely',
        },
      };
    }

    // URL fetch error (CORS, timeout, etc.) -> skip (can't determine)
    if (urlResult.status === 'error') {
      return {
        status: 'skip',
        isRetracted: false,
        retractionDetails: null,
        validation: null,
      };
    }

    // URL exists! Now compare titles if we have both
    if (citation.title && urlResult.title) {
      const titleComparison = compareTitles(citation.title, urlResult.title);

      // If titles are completely different (<30% similar) -> FAKE (likely)
      if (titleComparison.similarity < 0.3) {
        return {
          status: 'fake-likely',
          isRetracted: false,
          retractionDetails: null,
          validation: {
            exists: true,
            confidence: titleComparison.similarity,
            source: 'none',
            discrepancies: [{
              field: 'title',
              provided: citation.title,
              actual: urlResult.title,
              severity: 'critical',
            }],
            status: 'fake-likely',
          },
        };
      }

      // If titles are somewhat different (30-70% similar) -> FAKE (probably)
      if (titleComparison.similarity < 0.7) {
        return {
          status: 'fake-probably',
          isRetracted: false,
          retractionDetails: null,
          validation: {
            exists: true,
            confidence: titleComparison.similarity,
            source: 'none',
            discrepancies: [{
              field: 'title',
              provided: citation.title,
              actual: urlResult.title,
              severity: 'major',
            }],
            status: 'fake-probably',
          },
        };
      }
    }

    // URL exists and title matches (or no title to compare) -> VERIFIED
    return {
      status: 'verified',
      isRetracted: false,
      retractionDetails: null,
      validation: {
        exists: true,
        confidence: 1.0,
        source: 'none',
        matchedData: urlResult.title ? {
          doi: '',
          title: urlResult.title,
          authors: [],
          year: 0,
          journal: '',
        } : undefined,
        discrepancies: [],
        status: 'verified',
      },
    };
  }

  /**
   * Batch check multiple citations
   */
  async checkBatch(
    citations: ExtractedCitation[]
  ): Promise<Map<string, FullCheckResult>> {
    const results = new Map<string, FullCheckResult>();

    // Process citations in parallel (with concurrency limit)
    const BATCH_SIZE = 5;

    for (let i = 0; i < citations.length; i += BATCH_SIZE) {
      const batch = citations.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (c) => {
          const result = await this.checkCitation({
            doi: c.doi,
            pmid: c.pmid,
            url: c.url,
            title: c.title,
            authors: c.authors,
            year: c.year,
            journal: c.journal,
          });
          return { id: c.id, result };
        })
      );

      for (const { id, result } of batchResults) {
        results.set(id, result);
      }
    }

    return results;
  }

  /**
   * Check API health (always returns true for direct API calls)
   */
  async checkHealth(): Promise<boolean> {
    return true;
  }

  /**
   * Get API stats (not available for direct API calls)
   */
  async getStats(): Promise<{
    totalRetractions: number;
    lastUpdated: string;
  } | null> {
    return null;
  }
}

// Export singleton instance
export const citiciousAPI = new CiticiousAPI();
