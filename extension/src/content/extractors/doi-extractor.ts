import type { ExtractedCitation } from '../../shared/types';

// DOI regex patterns based on CrossRef recommendations
// Primary pattern - matches 97%+ of DOIs
const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>]+)\b/gi;

// Pattern for DOIs in URLs
const DOI_URL_REGEX = /https?:\/\/(?:dx\.)?doi\.org\/(10\.[^\s"'<>]+)/gi;

// PubMed ID pattern
const PMID_REGEX = /\bPMID:\s*(\d+)\b/gi;
const PMID_URL_REGEX = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/gi;

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
 * Extract DOIs and URLs from the reference section
 */
export function extractReferenceDois(
  referenceSection: HTMLElement
): ExtractedCitation[] {
  const citations: ExtractedCitation[] = [];
  const seenDois = new Set<string>();
  const seenUrls = new Set<string>();
  const processedElements = new Set<HTMLElement>();

  // Method 1: Find links to doi.org
  const doiLinks = referenceSection.querySelectorAll('a[href*="doi.org"]');
  for (const link of doiLinks) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/10\.\d{4,9}\/[^\s"'<>]+/);
    if (match) {
      const doi = normalizeDoi(match[0]);
      if (!seenDois.has(doi)) {
        seenDois.add(doi);
        const refElement = link.closest('li, p, div, tr') as HTMLElement || link as HTMLElement;
        processedElements.add(refElement);
        citations.push({
          id: generateId(),
          doi,
          title: extractTitleFromReference(refElement),
          context: 'reference',
          element: refElement,
        });
      }
    }
  }

  // Method 2: Find DOIs in text
  const walker = document.createTreeWalker(
    referenceSection,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    const doiMatches = text.matchAll(DOI_REGEX);

    for (const match of doiMatches) {
      const doi = normalizeDoi(match[1]);
      if (!seenDois.has(doi)) {
        seenDois.add(doi);
        const parentElement = node.parentElement?.closest('li, p, div, tr') as HTMLElement;
        if (parentElement) {
          processedElements.add(parentElement);
          citations.push({
            id: generateId(),
            doi,
            title: extractTitleFromReference(parentElement),
            context: 'reference',
            element: parentElement,
          });
        }
      }
    }
  }

  // Method 3: Find PubMed IDs
  const pmidMatches = referenceSection.innerHTML.matchAll(PMID_REGEX);
  for (const match of pmidMatches) {
    const pmid = match[1];
    // Find the element containing this PMID
    const elements = referenceSection.querySelectorAll('li, p, div, tr');
    for (const el of elements) {
      if (el.textContent?.includes(`PMID: ${pmid}`) || el.textContent?.includes(`PMID:${pmid}`)) {
        // Check if we already have a DOI for this reference
        const existingDoi = citations.find(
          (c) => c.element === el || c.element.contains(el) || el.contains(c.element)
        );
        if (!existingDoi) {
          processedElements.add(el as HTMLElement);
          citations.push({
            id: generateId(),
            pmid,
            title: extractTitleFromReference(el as HTMLElement),
            context: 'reference',
            element: el as HTMLElement,
          });
        } else if (!existingDoi.pmid) {
          existingDoi.pmid = pmid;
        }
        break;
      }
    }
  }

  // Method 4: Find references with URLs but no DOIs
  // Look for all links in reference items that haven't been processed
  const allLinks = referenceSection.querySelectorAll('a[href^="http"]');
  for (const link of allLinks) {
    const href = (link as HTMLAnchorElement).href;

    // Skip doi.org links (already handled) and common non-content URLs
    if (
      href.includes('doi.org') ||
      href.includes('pubmed') ||
      href.includes('scholar.google') ||
      href.includes('javascript:') ||
      href.includes('#')
    ) {
      continue;
    }

    const refElement = link.closest('li, p, div, tr') as HTMLElement;
    if (!refElement || processedElements.has(refElement) || seenUrls.has(href)) {
      continue;
    }

    // Check if this reference element was already processed (has a DOI)
    const alreadyHasCitation = citations.some(
      (c) => c.element === refElement || c.element.contains(refElement) || refElement.contains(c.element)
    );

    if (!alreadyHasCitation) {
      seenUrls.add(href);
      processedElements.add(refElement);
      citations.push({
        id: generateId(),
        url: href,
        title: extractTitleFromReference(refElement),
        context: 'reference',
        element: refElement,
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
