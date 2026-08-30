import type { ExtractedCitation } from '../../shared/types';

// DOI regex patterns based on CrossRef recommendations
// Primary pattern: matches 97%+ of DOIs
const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>]+)\b/i;

// PubMed ID patterns (inline "PMID: n" text and pubmed.ncbi.nlm.nih.gov links)
const PMID_REGEX = /\bPMID:\s*(\d+)\b/i;
const PMID_URL_REGEX = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i;
const REFERENCE_HEADING_REGEX =
  /^(?:\d+\.?\s*)?(?:references?|bibliography|works cited|literature cited|references and notes)$/;
const REFERENCE_SECTION_SELECTORS = [
  '[role="doc-bibliography"]',
  '#references',
  '#bibliography',
  '#reference-section',
  '#preview-section-references', // ScienceDirect abstract preview
  '#ref-list',
  '#bib',
  '#Bib1', // Springer/Nature
  'section#bibliography',
  'section[data-title="References" i]',
  'section[aria-label*="reference" i]',
  'ol.references',
  'dl.references',
  '.references',
  '.bibliography',
  '.reference-list',
  '.ref-list',
  '.article-references',
  '.c-article-references', // Nature
];
const REFERENCE_SECTION_SELECTOR = REFERENCE_SECTION_SELECTORS.join(', ');
export const MAX_REFERENCES_PER_PAGE = 500;

const hasReferenceContent = (element: Element): boolean =>
  element.querySelector('li, p, div, tr') !== null ||
  (element.textContent || '').trim().length > 40;

const isReferenceHeading = (element: Element): boolean =>
  /^H[1-4]$/.test(element.tagName) &&
  REFERENCE_HEADING_REGEX.test(element.textContent?.trim().toLowerCase() || '');

/**
 * Generate unique ID for a citation
 */
function generateId(): string {
  return `cit-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Syntactic DOI check applied before any lookup, so malformed strings from
 * data attributes or manual input are never sent to APIs (or labeled fake).
 */
export function isValidDoi(doi: string): boolean {
  return /^10\.\d{4,9}\/\S+$/.test(doi);
}

/**
 * Strip a trailing closer character only when it is unbalanced; DOIs can
 * legitimately contain and even end with parentheses or brackets, e.g.
 * 10.1016/S0140-6736(97)11096-0.
 */
function stripUnbalancedTrailing(doi: string, open: string, close: string): string {
  let d = doi;
  while (d.endsWith(close)) {
    const opens = d.split(open).length - 1;
    const closes = d.split(close).length - 1;
    if (closes > opens) {
      d = d.slice(0, -1).replace(/[.,;:!]+$/, '');
    } else {
      break;
    }
  }
  return d;
}

/**
 * Extract a DOI candidate from a URL, tolerating percent-encoding. Springer
 * (among others) encodes the DOI slash in doi.org hrefs (10.1001%2Fjamaoncol...),
 * which a literal-slash regex never matches.
 */
function doiFromUrl(url: string): string | null {
  let candidate = url;
  try {
    candidate = decodeURIComponent(url);
  } catch {
    // Malformed escape sequence: fall back to the raw URL
  }
  const match = candidate.match(/10\.\d{4,9}\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

/**
 * Normalize DOI (lowercase, strip a doi.org URL prefix, URL query/fragment
 * leftovers, and trailing sentence punctuation that is never part of the DOI)
 */
export function normalizeDoi(doi: string): string {
  let d = doi.toLowerCase().trim();
  d = d.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  d = d.replace(/[?#].*$/, '');
  d = d.replace(/[.,;:!]+$/, '');
  d = stripUnbalancedTrailing(d, '(', ')');
  d = stripUnbalancedTrailing(d, '[', ']');
  d = stripUnbalancedTrailing(d, '{', '}');
  return d;
}

/**
 * Build a current-article citation from a raw DOI candidate, or null when the
 * candidate does not survive normalization + syntax validation.
 */
function currentArticleCitation(raw: string, document: Document): ExtractedCitation | null {
  const doi = normalizeDoi(raw);
  if (!isValidDoi(doi)) return null;
  return {
    id: generateId(),
    doi,
    context: 'current-article',
    element: document.body,
  };
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
        const citation = currentArticleCitation(match[0], document);
        if (citation) return citation;
      }
    }
  }

  // Method 2: Check canonical link
  const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
  if (canonical?.href) {
    const candidate = doiFromUrl(canonical.href);
    if (candidate) {
      const citation = currentArticleCitation(candidate, document);
      if (citation) return citation;
    }
  }

  // Method 3: Check data attributes (values are unconstrained, so the syntax
  // check in currentArticleCitation is what keeps garbage out)
  const dataDoiElements = document.querySelectorAll('[data-doi]');
  for (const el of dataDoiElements) {
    const doi = el.getAttribute('data-doi');
    if (doi) {
      const citation = currentArticleCitation(doi, document);
      if (citation) return citation;
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
        const citation = currentArticleCitation(match[0], document);
        if (citation) return citation;
      }
    }
  }

  // Method 5: Check URL
  const urlCandidate = doiFromUrl(window.location.href);
  if (urlCandidate) {
    const citation = currentArticleCitation(urlCandidate, document);
    if (citation) return citation;
  }

  return null;
}

/**
 * Find the reference section in the document
 */
export function findReferenceSection(document: Document): HTMLElement | null {
  // Jump-target anchors (e.g. PLOS's `<a id="references">`) and placeholder
  // nodes match the id selectors but contain no list; require actual content
  // before accepting a match so the real list further down is not shadowed.
  for (const selector of REFERENCE_SECTION_SELECTORS) {
    const section = document.querySelector(selector) as HTMLElement;
    if (section && hasReferenceContent(section)) {
      return section;
    }
  }

  // Look for a section heading like "References"/"Bibliography" and return its
  // container. Kept to standalone headings to avoid matching sidebar widgets
  // like "References & Citations".
  const headings = document.querySelectorAll('h1, h2, h3, h4');
  for (const heading of headings) {
    if (isReferenceHeading(heading)) {
      // Return the parent section or the heading's next siblings container
      const parent = heading.closest('section, article, .content, .paper-content, main') || heading.parentElement;
      if (parent) {
        return parent as HTMLElement;
      }
    }
  }

  return findReferenceListByContent(document);
}

export function containsReferenceSectionMarker(element: Element): boolean {
  const nearestSection = element.closest(REFERENCE_SECTION_SELECTOR);
  if (nearestSection && hasReferenceContent(nearestSection)) return true;
  if (
    Array.from(element.querySelectorAll(REFERENCE_SECTION_SELECTOR)).some(hasReferenceContent)
  ) {
    return true;
  }
  if (isReferenceHeading(element)) return true;
  return Array.from(element.querySelectorAll('h1, h2, h3, h4')).some(isReferenceHeading);
}

/**
 * Publisher-agnostic fallback for sites whose markup matches none of the known
 * selectors or headings: find the tightest list-like container that holds
 * several identifier-bearing reference entries. Sidebars and "related article"
 * widgets are excluded, and at least MIN_REFERENCE_ITEMS entries are required,
 * so ordinary prose that happens to mention a DOI never qualifies.
 */
function findReferenceListByContent(document: Document): HTMLElement | null {
  const MIN_REFERENCE_ITEMS = 3;
  const EXCLUDED_ANCESTORS = 'aside, nav, header, footer, [role="complementary"], [role="navigation"]';
  const EXCLUDED_HINT = /recommend|related|sidebar|promo|advert|cited-by|citedby|metrics|toc|menu/i;
  const CONTAINER_SELECTOR = 'ol, ul, section, div, dl';
  const ENTRY_SELECTOR = 'li, dd, p, div, tr';

  const root = (document.querySelector('main, article') || document.body) as HTMLElement | null;
  if (!root) return null;

  let best: { element: HTMLElement; items: number; size: number } | null = null;
  const stack: Array<{
    element: HTMLElement;
    matchesEntry: boolean;
    hasDescendantEntry: boolean;
    identifierItems: number;
    textSize: number;
    excluded: boolean;
  }> = [];
  let current = root.firstElementChild as HTMLElement | null;

  while (current) {
    const parent = stack[stack.length - 1];
    const className = typeof current.className === 'string' ? current.className : '';
    const hint = `${current.id} ${className}`;
    let textSize = 0;
    for (const child of current.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) textSize += child.textContent?.length || 0;
    }
    stack.push({
      element: current,
      matchesEntry: current.matches(ENTRY_SELECTOR),
      hasDescendantEntry: false,
      identifierItems: 0,
      textSize,
      excluded:
        (parent?.excluded || false) ||
        current.matches(EXCLUDED_ANCESTORS) ||
        EXCLUDED_HINT.test(hint),
    });

    const child = current.firstElementChild as HTMLElement | null;
    if (child) {
      current = child;
      continue;
    }

    current = null;
    while (stack.length > 0) {
      const completed = stack.pop()!;
      if (completed.matchesEntry && !completed.hasDescendantEntry) {
        const text = completed.element.textContent || '';
        const hasIdentifier =
          /\b10\.\d{4,9}\//.test(text) ||
          PMID_REGEX.test(text) ||
          completed.element.querySelector(
            'a[href*="doi.org"], a[href*="pubmed.ncbi.nlm.nih.gov"]'
          ) !== null;
        if (hasIdentifier) completed.identifierItems++;
      }

      if (
        !completed.excluded &&
        completed.element.matches(CONTAINER_SELECTOR) &&
        completed.identifierItems >= MIN_REFERENCE_ITEMS &&
        (!best ||
          completed.identifierItems > best.items ||
          (completed.identifierItems === best.items && completed.textSize < best.size))
      ) {
        best = {
          element: completed.element,
          items: completed.identifierItems,
          size: completed.textSize,
        };
      }

      const ancestor = stack[stack.length - 1];
      if (ancestor && !completed.excluded) {
        ancestor.identifierItems += completed.identifierItems;
        ancestor.textSize += completed.textSize;
        ancestor.hasDescendantEntry ||=
          completed.matchesEntry || completed.hasDescendantEntry;
      }

      const sibling = completed.element.nextElementSibling as HTMLElement | null;
      if (sibling) {
        current = sibling;
        break;
      }
    }
  }

  return best?.element || null;
}

/**
 * Extract citation title from reference element
 */
function extractTitleFromReference(element: HTMLElement): string | undefined {
  // Only trust markup that explicitly labels the title. Earlier heuristics
  // (any <em>/<i>, or a regex over the reference prose) routinely captured the
  // journal name or a stray sentence instead, and a wrong title here becomes a
  // false "title mismatch" accusation against a perfectly good reference. When
  // no title can be read with confidence, none is reported and the citation is
  // judged on its identifier alone.
  const titleSelectors = [
    '.citation-title',
    '.reference-title',
    '.article-title',
    '[data-title]',
    '[itemprop="name"]',
    '.title',
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

  return undefined;
}

/**
 * Extract DOIs and URLs from the reference section
 */
function findLeafReferenceElements(
  referenceSection: HTMLElement,
  selector: string,
  limit: number,
  afterHeading?: Element
): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const stack: Array<{
    element: HTMLElement;
    matches: boolean;
    hasMatchingDescendant: boolean;
  }> = [];
  let current = referenceSection.firstElementChild as HTMLElement | null;

  while (current) {
    stack.push({
      element: current,
      matches: current.matches(selector),
      hasMatchingDescendant: false,
    });

    const child = current.firstElementChild as HTMLElement | null;
    if (child) {
      current = child;
      continue;
    }

    current = null;
    while (stack.length > 0) {
      const completed = stack.pop()!;
      const subtreeMatched = completed.matches || completed.hasMatchingDescendant;
      if (
        completed.matches &&
        !completed.hasMatchingDescendant &&
        (completed.element.textContent || '').trim() &&
        (!afterHeading ||
          Boolean(
            afterHeading.compareDocumentPosition(completed.element) &
              Node.DOCUMENT_POSITION_FOLLOWING
          ))
      ) {
        elements.push(completed.element);
        if (elements.length >= limit) return elements;
      }
      if (stack.length > 0 && subtreeMatched) {
        stack[stack.length - 1].hasMatchingDescendant = true;
      }
      const sibling = completed.element.nextElementSibling as HTMLElement | null;
      if (sibling) {
        current = sibling;
        break;
      }
    }
  }

  return elements;
}

export function extractReferenceDois(
  referenceSection: HTMLElement,
  limit = MAX_REFERENCES_PER_PAGE
): ExtractedCitation[] {
  const selectorGroups = [
    'li, [role="doc-biblioentry"], [role="listitem"]',
    'dd',
    'tr',
    '.references__item, .reference-list__item, .ref-list__item, .c-article-references__item, [data-reference-id]',
    '.reference, .ref, .citation',
    'p',
  ];

  const boundedLimit = Math.max(
    0,
    Math.min(
      Number.isFinite(limit) ? Math.floor(limit) : MAX_REFERENCES_PER_PAGE + 1,
      MAX_REFERENCES_PER_PAGE + 1
    )
  );
  if (boundedLimit === 0) return [];

  const referenceHeading = Array.from(
    referenceSection.querySelectorAll('h1, h2, h3, h4')
  ).find((heading) =>
    REFERENCE_HEADING_REGEX.test(heading.textContent?.trim().toLowerCase() || '')
  );
  let elements: HTMLElement[] = [];
  for (const selector of selectorGroups) {
    const matches = findLeafReferenceElements(
      referenceSection,
      selector,
      boundedLimit,
      referenceHeading
    );
    if (
      matches.length > 0 &&
      (!referenceHeading ||
        elements.length === 0 ||
        Boolean(
          matches[0].compareDocumentPosition(elements[0]) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ))
    ) {
      elements = matches;
      if (!referenceHeading) break;
    }
  }

  if (elements.length === 0 && (referenceSection.textContent || '').trim()) {
    elements = [
      (referenceHeading?.nextElementSibling as HTMLElement | null) || referenceSection,
    ];
  }

  return elements.map((element) => {
    const textElement = element.cloneNode(true) as HTMLElement;
    textElement.querySelectorAll('.citicious-badge, .citicious-banner').forEach((node) => node.remove());
    const text = (textElement.textContent || '').replace(/\s+/g, ' ').trim();
    const doiLink = element.querySelector<HTMLAnchorElement>('a[href*="doi.org"]');
    const rawDoi = (doiLink ? doiFromUrl(doiLink.href) : null) || text.match(DOI_REGEX)?.[1];
    const normalizedDoi = rawDoi ? normalizeDoi(rawDoi) : undefined;
    const pmidLink = element.querySelector<HTMLAnchorElement>(
      'a[href*="pubmed.ncbi.nlm.nih.gov"]'
    );
    const pmid = pmidLink?.href.match(PMID_URL_REGEX)?.[1] || text.match(PMID_REGEX)?.[1];

    return {
      id: generateId(),
      doi: normalizedDoi && isValidDoi(normalizedDoi) ? normalizedDoi : undefined,
      pmid,
      title: extractTitleFromReference(element),
      referenceText: text.slice(0, 500),
      context: 'reference' as const,
      element,
    };
  });
}

/**
 * Scan the entire page for DOIs
 */
export function scanPageForDois(
  document: Document,
  referenceLimit = MAX_REFERENCES_PER_PAGE
): ExtractedCitation[] {
  const citations: ExtractedCitation[] = [];

  // Get current article DOI
  const currentArticle = extractCurrentArticleDoi(document);
  if (currentArticle?.doi) {
    citations.push(currentArticle);
  }

  // Find and scan reference section
  const referenceSection = findReferenceSection(document);
  if (referenceSection) {
    citations.push(...extractReferenceDois(referenceSection, referenceLimit));
  }

  return citations;
}
