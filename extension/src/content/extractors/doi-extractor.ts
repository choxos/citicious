import type { ExtractedCitation } from '../../shared/types';

// DOI regex pattern based on CrossRef recommendations
// Matches 97%+ of DOIs
const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>]+)\b/gi;

/**
 * Generate unique ID for a citation
 */
function generateId(): string {
  return `cit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Normalize DOI (lowercase, remove trailing punctuation)
 */
function normalizeDoi(doi: string): string {
  return doi
    .toLowerCase()
    .trim()
    .replace(/[.,;:)\]}>]+$/, ''); // Remove trailing punctuation
}

/**
 * Extract the current article's DOI (the paper being viewed)
 */
export function extractCurrentArticleDoi(document: Document): ExtractedCitation | null {
  // Method 1: Check meta tags
  const metaSelectors = [
    'meta[name="citation_doi"]',
    'meta[name="dc.identifier"][scheme="doi"]',
    'meta[property="og:url"][content*="doi.org"]',
    'meta[name="DOI"]',
    'meta[name="doi"]',
  ];

  for (const selector of metaSelectors) {
    const meta = document.querySelector(selector) as HTMLMetaElement;
    if (meta?.content) {
      const match = meta.content.match(/10\.\d{4,9}\/[^\s"'<>]+/);
      if (match) {
        return {
          id: generateId(),
          doi: normalizeDoi(match[0]),
          context: 'current-article',
          element: document.body,
        };
      }
    }
  }

  // Method 2: Check canonical link
  const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
  if (canonical?.href) {
    const match = canonical.href.match(/10\.\d{4,9}\/[^\s"'<>]+/);
    if (match) {
      return {
        id: generateId(),
        doi: normalizeDoi(match[0]),
        context: 'current-article',
        element: document.body,
      };
    }
  }

  // Method 3: Check data attributes
  const dataDoiElements = document.querySelectorAll('[data-doi]');
  for (const el of dataDoiElements) {
    const doi = el.getAttribute('data-doi');
    if (doi) {
      return {
        id: generateId(),
        doi: normalizeDoi(doi),
        context: 'current-article',
        element: document.body,
      };
    }
  }

  // Method 4: Look for DOI in specific page elements
  const doiContainerSelectors = [
    '.doi',
    '.article-doi',
    '#doi',
    '[class*="doi"]',
    '.citation-doi',
  ];

  for (const selector of doiContainerSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const text = el.textContent || '';
      const match = text.match(/10\.\d{4,9}\/[^\s"'<>]+/);
      if (match) {
        return {
          id: generateId(),
          doi: normalizeDoi(match[0]),
          context: 'current-article',
          element: document.body,
        };
      }
    }
  }

  // Method 5: Check URL
  const urlMatch = window.location.href.match(/10\.\d{4,9}\/[^\s"'<>]+/);
  if (urlMatch) {
    return {
      id: generateId(),
      doi: normalizeDoi(urlMatch[0]),
      context: 'current-article',
      element: document.body,
    };
  }

  return null;
}

/**
 * Find the reference section in the document
 */
export function findReferenceSection(document: Document): HTMLElement | null {
  // Common selectors for reference sections
  const selectors = [
    '#references',
    '#bibliography',
    '#reference-section',
    '#ref-list',
    '.references',
    '.bibliography',
    '.reference-list',
    '[class*="reference"]',
    '[id*="reference"]',
    'section[data-title="References"]',
  ];

  for (const selector of selectors) {
    const section = document.querySelector(selector) as HTMLElement;
    if (section) {
      return section;
    }
  }

  // Look for h2/h3 with "References" and get parent section
  const headings = document.querySelectorAll('h2, h3, h4');
  for (const heading of headings) {
    if (heading.textContent?.toLowerCase().includes('references')) {
      // Return the parent section or the heading's next siblings container
      const parent = heading.closest('section') || heading.parentElement;
      if (parent) {
        return parent as HTMLElement;
      }
    }
  }

  return null;
}

/**
 * Extract citation title from reference element
 */
function extractTitleFromReference(element: HTMLElement): string | undefined {
  // Look for title in common citation patterns
  const titleSelectors = [
    '.citation-title',
    '.reference-title',
    '.title',
    'em',
    'i',
    '[data-title]',
  ];

  for (const selector of titleSelectors) {
    const titleEl = element.querySelector(selector);
    if (titleEl?.textContent) {
      const title = titleEl.textContent.trim();
      // Title should be reasonably long and not look like an author list
      if (title.length > 10 && !title.match(/^\d/) && !title.includes('et al')) {
        return title;
      }
    }
  }

  // Try to extract from text content (often after author names and before journal)
  const text = element.textContent || '';
  // Common pattern: Author(s). Title. Journal...
  const titleMatch = text.match(/\.\s+([A-Z][^.]+[.?!])\s+[A-Z]/);
  if (titleMatch && titleMatch[1].length > 20) {
    return titleMatch[1].trim();
  }

  return undefined;
}

/**
 * Extract identifier from a reference element
 * Priority: DOI > PMID > URL (first valid URL found)
 */
function extractIdentifierFromReference(element: HTMLElement): { doi?: string; pmid?: string; url?: string } {
  const text = element.textContent || '';

  // 1. Try to find DOI (highest priority)
  // First check DOI links
  const doiLink = element.querySelector('a[href*="doi.org"]') as HTMLAnchorElement;
  if (doiLink) {
    const match = doiLink.href.match(/10\.\d{4,9}\/[^\s"'<>]+/);
    if (match) {
      return { doi: normalizeDoi(match[0]) };
    }
  }

  // Then check DOI in text
  const doiMatch = text.match(DOI_REGEX);
  if (doiMatch) {
    return { doi: normalizeDoi(doiMatch[1]) };
  }

  // 2. Try to find PMID
  const pmidMatch = text.match(/PMID:\s*(\d+)/i);
  if (pmidMatch) {
    return { pmid: pmidMatch[1] };
  }

  // 3. Try to find URL (look for "Available from:" pattern first)
  const availableFromMatch = text.match(/Available from:\s*(https?:\/\/[^\s<>"]+)/i);
  if (availableFromMatch) {
    return { url: availableFromMatch[1].replace(/[.,;]+$/, '') };
  }

  // 4. Find first external URL that's not a navigation link
  const links = element.querySelectorAll('a[href^="http"]');
  for (const link of links) {
    const anchor = link as HTMLAnchorElement;
    const href = anchor.href;

    // Skip common navigation/database links
    if (
      href.includes('doi.org') ||
      href.includes('pubmed') ||
      href.includes('scholar.google') ||
      href.includes('springer.com') ||
      href.includes('wiley.com') ||
      href.includes('sciencedirect.com') ||
      href.includes('nature.com') ||
      href.includes('ncbi.nlm.nih.gov') ||
      href.includes('crossref.org') ||
      href.includes('javascript:') ||
      href.includes('#')
    ) {
      continue;
    }

    // Found a valid URL
    return { url: href };
  }

  return {};
}

/**
 * Extract DOIs and URLs from the reference section
 */
export function extractReferenceDois(
  referenceSection: HTMLElement
): ExtractedCitation[] {
  const citations: ExtractedCitation[] = [];
  const seenDois = new Set<string>();
  const seenPmids = new Set<string>();
  const seenUrls = new Set<string>();

  // Find all reference items (typically li elements in an ol/ul, or p/div elements)
  const refItems = referenceSection.querySelectorAll('li, p.reference, div.reference, tr');

  // If no specific reference items found, try broader selectors
  const items = refItems.length > 0
    ? refItems
    : referenceSection.querySelectorAll('li, p, div');

  for (const item of items) {
    const element = item as HTMLElement;

    // Skip very short elements (likely not full references)
    const text = element.textContent || '';
    if (text.length < 30) continue;

    // Skip if this element contains child reference items (it's a container)
    if (element.querySelector('li, p.reference, div.reference')) continue;

    // Extract identifier from this reference
    const { doi, pmid, url } = extractIdentifierFromReference(element);

    // Create citation if we found any identifier
    if (doi && !seenDois.has(doi)) {
      seenDois.add(doi);
      citations.push({
        id: generateId(),
        doi,
        title: extractTitleFromReference(element),
        context: 'reference',
        element,
      });
    } else if (pmid && !seenPmids.has(pmid)) {
      seenPmids.add(pmid);
      citations.push({
        id: generateId(),
        pmid,
        title: extractTitleFromReference(element),
        context: 'reference',
        element,
      });
    } else if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      citations.push({
        id: generateId(),
        url,
        title: extractTitleFromReference(element),
        context: 'reference',
        element,
      });
    }
  }

  return citations;
}

/**
 * Scan the entire page for DOIs
 */
export function scanPageForDois(document: Document): ExtractedCitation[] {
  const citations: ExtractedCitation[] = [];
  const seenDois = new Set<string>();

  // Get current article DOI
  const currentArticle = extractCurrentArticleDoi(document);
  if (currentArticle?.doi) {
    seenDois.add(currentArticle.doi);
    citations.push(currentArticle);
  }

  // Find and scan reference section
  const referenceSection = findReferenceSection(document);
  if (referenceSection) {
    const referenceCitations = extractReferenceDois(referenceSection);
    for (const citation of referenceCitations) {
      if (citation.doi && !seenDois.has(citation.doi)) {
        seenDois.add(citation.doi);
        citations.push(citation);
      } else if (citation.pmid) {
        // Include PMID-only citations
        citations.push(citation);
      } else if (citation.url) {
        // Include URL-only citations (for non-academic references)
        citations.push(citation);
      }
    }
  }

  return citations;
}
