import { stringSimilarity } from 'string-similarity-js';
import { crossrefService } from './crossref.service.js';
import { openalexService } from './openalex.service.js';
import type {
  CitationInput,
  CitationValidationResponse,
  CitationStatus,
  Discrepancy,
  MatchedData,
  CrossRefWork,
  OpenAlexWork,
} from '../types.js';

export class CitationValidatorService {
  /**
   * Validate a citation and detect if it's fake/hallucinated
   */
  async validate(citation: CitationInput): Promise<CitationValidationResponse> {
    // Priority 1: DOI lookup (fastest, most reliable)
    if (citation.doi) {
      return this.validateByDoi(citation);
    }

    // Priority 2: Fuzzy search by metadata
    return this.validateByMetadata(citation);
  }

  /**
   * Validate citation by DOI lookup
   * Key logic: DOI existence = real citation (VERIFIED)
   * Only mark as FAKE if DOI confirmed to not exist (404 from both APIs)
   */
  private async validateByDoi(
    citation: CitationInput
  ): Promise<CitationValidationResponse> {
    // Try CrossRef first
    const crossrefResult = await crossrefService.getWork(citation.doi!);

    // DOI FOUND in CrossRef → VERIFIED (regardless of metadata)
    if (crossrefResult.status === 'found') {
      const matchedData = this.crossrefToMatchedData(crossrefResult.work);
      // Metadata comparison is informational only, doesn't affect status
      const discrepancies = this.compareMetadata(citation, matchedData);

      return {
        exists: true,
        confidence: 1.0,
        source: 'crossref',
        matchedData,
        discrepancies,
        status: 'verified',
      };
    }

    // DOI NOT FOUND in CrossRef (404) → try OpenAlex as fallback
    if (crossrefResult.status === 'not_found') {
      const openalexResult = await openalexService.getWork(citation.doi!);

      if (openalexResult.status === 'found') {
        const matchedData = this.openalexToMatchedData(openalexResult.work);
        const discrepancies = this.compareMetadata(citation, matchedData);
        return {
          exists: true,
          confidence: 1.0,
          source: 'openalex',
          matchedData,
          discrepancies,
          status: 'verified',
        };
      }

      if (openalexResult.status === 'not_found') {
        // CONFIRMED: DOI doesn't exist in either database → FAKE (likely)
        return {
          exists: false,
          confidence: 0,
          source: 'none',
          discrepancies: [
            {
              field: 'doi',
              provided: citation.doi!,
              actual: 'NOT FOUND',
              severity: 'critical',
            },
          ],
          status: 'fake-likely',
        };
      }

      // OpenAlex error but CrossRef said not_found → lean towards fake-likely
      return {
        exists: false,
        confidence: 0,
        source: 'none',
        discrepancies: [
          {
            field: 'doi',
            provided: citation.doi!,
            actual: 'NOT FOUND IN CROSSREF, OPENALEX ERROR',
            severity: 'critical',
          },
        ],
        status: 'fake-likely',
      };
    }

    // CrossRef ERROR → try OpenAlex as fallback
    const openalexResult = await openalexService.getWork(citation.doi!);

    if (openalexResult.status === 'found') {
      const matchedData = this.openalexToMatchedData(openalexResult.work);
      const discrepancies = this.compareMetadata(citation, matchedData);
      return {
        exists: true,
        confidence: 1.0,
        source: 'openalex',
        matchedData,
        discrepancies,
        status: 'verified',
      };
    }

    if (openalexResult.status === 'not_found') {
      // CrossRef had error, but OpenAlex confirmed not found → fake-likely
      return {
        exists: false,
        confidence: 0,
        source: 'none',
        discrepancies: [
          {
            field: 'doi',
            provided: citation.doi!,
            actual: 'NOT FOUND',
            severity: 'critical',
          },
        ],
        status: 'fake-likely',
      };
    }

    // Both APIs had errors → can't determine, skip (no badge)
    return {
      exists: false,
      confidence: 0,
      source: 'none',
      discrepancies: [],
      status: 'skip',
    };
  }

  /**
   * Validate citation by fuzzy metadata search (no DOI)
   * For citations without DOI, we try to find a match by title/author
   * If found with high confidence → verified
   * If found but metadata differs significantly → fake-probably
   * If not found → skip (can't definitively say it's fake without DOI)
   */
  private async validateByMetadata(
    citation: CitationInput
  ): Promise<CitationValidationResponse> {
    if (!citation.title) {
      // No DOI and no title → can't validate, skip
      return {
        exists: false,
        confidence: 0,
        source: 'none',
        discrepancies: [],
        status: 'skip',
      };
    }

    // Search OpenAlex by title (and optionally author)
    const searchQuery: { title: string; author?: string; year?: number } = {
      title: citation.title,
    };

    if (citation.authors?.length) {
      searchQuery.author = citation.authors[0];
    }
    if (citation.year) {
      searchQuery.year = citation.year;
    }

    const searchResults = await openalexService.search(searchQuery);

    if (searchResults.length === 0) {
      // Try CrossRef as fallback
      const crossrefResults = citation.authors?.length
        ? await crossrefService.searchByAuthorAndTitle(
            citation.authors[0],
            citation.title
          )
        : await crossrefService.searchByTitle(citation.title);

      if (crossrefResults.length > 0) {
        const bestMatch = this.findBestCrossRefMatch(citation, crossrefResults);
        if (bestMatch && bestMatch.score > 0.7) {
          const matchedData = this.crossrefToMatchedData(bestMatch.work);
          const discrepancies = this.compareMetadata(citation, matchedData);
          const status = this.getMetadataBasedStatus(bestMatch.score, discrepancies);

          return {
            exists: true,
            confidence: bestMatch.score,
            source: 'crossref',
            matchedData,
            discrepancies,
            status,
          };
        }
      }

      // Could not find by metadata search → skip (can't prove it's fake without DOI)
      return {
        exists: false,
        confidence: 0,
        source: 'none',
        discrepancies: [],
        status: 'skip',
      };
    }

    // Find best match from OpenAlex results
    const bestMatch = this.findBestOpenAlexMatch(citation, searchResults);

    if (bestMatch && bestMatch.score > 0.7) {
      const matchedData = this.openalexToMatchedData(bestMatch.work);
      const discrepancies = this.compareMetadata(citation, matchedData);
      const status = this.getMetadataBasedStatus(bestMatch.score, discrepancies);

      return {
        exists: true,
        confidence: bestMatch.score,
        source: 'openalex',
        matchedData,
        discrepancies,
        status,
      };
    }

    // Low confidence match → skip
    return {
      exists: false,
      confidence: bestMatch?.score || 0,
      source: 'none',
      discrepancies: [],
      status: 'skip',
    };
  }

  /**
   * Compare provided citation metadata with actual data
   */
  private compareMetadata(
    provided: CitationInput,
    actual: MatchedData
  ): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];

    // Compare title (fuzzy)
    if (provided.title && actual.title) {
      const titleSimilarity = stringSimilarity(
        provided.title.toLowerCase(),
        actual.title.toLowerCase()
      );

      if (titleSimilarity < 0.9) {
        discrepancies.push({
          field: 'title',
          provided: provided.title,
          actual: actual.title,
          severity: titleSimilarity < 0.5 ? 'critical' : 'major',
        });
      }
    }

    // Compare year (exact)
    if (provided.year && actual.year && provided.year !== actual.year) {
      const yearDiff = Math.abs(provided.year - actual.year);
      discrepancies.push({
        field: 'year',
        provided: String(provided.year),
        actual: String(actual.year),
        severity: yearDiff > 2 ? 'major' : 'minor',
      });
    }

    // Compare first author (fuzzy)
    if (provided.authors?.length && actual.authors?.length) {
      const providedFirstAuthor = provided.authors[0].toLowerCase();
      const actualFirstAuthor = actual.authors[0].name.toLowerCase();

      const authorSimilarity = stringSimilarity(
        providedFirstAuthor,
        actualFirstAuthor
      );

      if (authorSimilarity < 0.7) {
        discrepancies.push({
          field: 'authors',
          provided: provided.authors[0],
          actual: actual.authors[0].name,
          severity: 'major',
        });
      }
    }

    // Compare journal (fuzzy)
    if (provided.journal && actual.journal) {
      const journalSimilarity = stringSimilarity(
        provided.journal.toLowerCase(),
        actual.journal.toLowerCase()
      );

      if (journalSimilarity < 0.7) {
        discrepancies.push({
          field: 'journal',
          provided: provided.journal,
          actual: actual.journal,
          severity: 'minor',
        });
      }
    }

    return discrepancies;
  }

  /**
   * Calculate confidence score based on discrepancies
   */
  private calculateConfidence(discrepancies: Discrepancy[]): number {
    let confidence = 1.0;

    for (const d of discrepancies) {
      switch (d.severity) {
        case 'critical':
          confidence -= 0.5;
          break;
        case 'major':
          confidence -= 0.2;
          break;
        case 'minor':
          confidence -= 0.05;
          break;
      }
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determine status for fuzzy-matched citations (no DOI)
   * Used when we found a citation by title/author search
   * Key: If we found a match, it's likely real - only flag as fake-probably if significant issues
   */
  private getMetadataBasedStatus(
    confidence: number,
    discrepancies: Discrepancy[]
  ): CitationStatus {
    const hasCritical = discrepancies.some((d) => d.severity === 'critical');
    const hasMajor = discrepancies.some((d) => d.severity === 'major');

    // Found a match with high confidence and no major issues → verified
    if (confidence >= 0.8 && !hasCritical && !hasMajor) {
      return 'verified';
    }

    // Found a match but title is completely different (<30% similar) → fake-likely
    const titleDiscrepancy = discrepancies.find((d) => d.field === 'title' && d.severity === 'critical');
    if (titleDiscrepancy) {
      return 'fake-likely';
    }

    // Found a match but year/author very different → fake-probably
    if (hasMajor) {
      const yearDiscrepancy = discrepancies.find((d) => d.field === 'year');
      const authorDiscrepancy = discrepancies.find((d) => d.field === 'authors');
      if (yearDiscrepancy || authorDiscrepancy) {
        return 'fake-probably';
      }
    }

    // Found a match with reasonable confidence → verified
    if (confidence >= 0.7) {
      return 'verified';
    }

    // Low confidence but found something → skip (uncertain)
    return 'skip';
  }

  /**
   * Find best matching CrossRef work
   */
  private findBestCrossRefMatch(
    citation: CitationInput,
    works: CrossRefWork[]
  ): { work: CrossRefWork; score: number } | null {
    let bestMatch: { work: CrossRefWork; score: number } | null = null;

    for (const work of works) {
      let score = 0;

      // Title similarity (weighted heavily)
      if (citation.title && work.title) {
        score += stringSimilarity(
          citation.title.toLowerCase(),
          work.title.toLowerCase()
        ) * 0.5;
      }

      // Author match
      if (citation.authors?.length && work.authors?.length) {
        const authorScore = stringSimilarity(
          citation.authors[0].toLowerCase(),
          work.authors[0].name.toLowerCase()
        );
        score += authorScore * 0.3;
      }

      // Year match
      if (citation.year && work.year && citation.year === work.year) {
        score += 0.2;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { work, score };
      }
    }

    return bestMatch;
  }

  /**
   * Find best matching OpenAlex work
   */
  private findBestOpenAlexMatch(
    citation: CitationInput,
    works: OpenAlexWork[]
  ): { work: OpenAlexWork; score: number } | null {
    let bestMatch: { work: OpenAlexWork; score: number } | null = null;

    for (const work of works) {
      let score = 0;

      // Title similarity
      if (citation.title && work.title) {
        score += stringSimilarity(
          citation.title.toLowerCase(),
          work.title.toLowerCase()
        ) * 0.5;
      }

      // Author match
      if (citation.authors?.length && work.authors?.length) {
        const authorScore = stringSimilarity(
          citation.authors[0].toLowerCase(),
          work.authors[0].name.toLowerCase()
        );
        score += authorScore * 0.3;
      }

      // Year match
      if (citation.year && work.year && citation.year === work.year) {
        score += 0.2;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { work, score };
      }
    }

    return bestMatch;
  }

  /**
   * Convert CrossRef work to matched data format
   */
  private crossrefToMatchedData(work: CrossRefWork): MatchedData {
    return {
      doi: work.doi,
      title: work.title,
      authors: work.authors,
      year: work.year,
      journal: work.journal,
      publisher: work.publisher,
      type: work.type,
      volume: work.volume,
      issue: work.issue,
      pages: work.pages,
    };
  }

  /**
   * Convert OpenAlex work to matched data format
   */
  private openalexToMatchedData(work: OpenAlexWork): MatchedData {
    return {
      doi: work.doi,
      title: work.title,
      authors: work.authors.map((a) => ({ name: a.name })),
      year: work.year,
      journal: work.journal,
    };
  }
}

// Export singleton instance
export const citationValidatorService = new CitationValidatorService();
