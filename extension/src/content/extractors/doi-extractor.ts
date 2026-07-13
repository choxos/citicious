import type { ExtractedCitation } from '../../shared/types';

// DOI regex patterns based on CrossRef recommendations
// Primary pattern: matches 97%+ of DOIs
const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>]+)\b/gi;

// PubMed ID patterns (inline "PMID: n" text and pubmed.ncbi.nlm.nih.gov links)
const PMID_REGEX = /\bPMID:\s*(\d+)\b/gi;
const PMID_URL_REGEX = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i;

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
  // Common selectors for reference sections (specific, not sidebar-like elements).
  // Covers the markup used by major publishers (Springer/Nature, Elsevier,
  // Wiley, PMC, JATS-derived sites) plus the ARIA DPUB bibliography role.
  const selectors = [
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

  // Jump-target anchors (e.g. PLOS's `<a id="references">`) and placeholder
  // nodes match the id selectors but contain no list; require actual content
  // before accepting a match so the real list further down is not shadowed.
  const hasReferenceContent = (el: HTMLElement): boolean =>
    el.querySelector('li, p, div, tr') !== null || (el.textContent || '').trim().length > 40;

  for (const selector of selectors) {
    const section = document.querySelector(selector) as HTMLElement;
    if (section && hasReferenceContent(section)) {
      return section;
    }
  }

  // Look for a section heading like "References"/"Bibliography" and return its
  // container. Kept to standalone headings to avoid matching sidebar widgets
  // like "References & Citations".
  const HEADING_TERMS = '(references?|bibliography|works cited|literature cited|references and notes)';
  const headingRegex = new RegExp(`^(?:\\d+\\.?\\s*)?${HEADING_TERMS}$`);
  const headings = document.querySelectorAll('h1, h2, h3, h4');
  for (const heading of headings) {
    const headingText = heading.textContent?.trim().toLowerCase() || '';
    if (headingRegex.test(headingText)) {
      // Return the parent section or the heading's next siblings container
      const parent = heading.closest('section, article, .content, .paper-content, main') || heading.parentElement;
      if (parent) {
        return parent as HTMLElement;
      }
    }
  }

  return findReferenceListByContent(document);
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

  const root = (document.querySelector('main, article') || document.body) as HTMLElement | null;
  if (!root) return null;

  let best: { element: HTMLElement; items: number; size: number } | null = null;

  for (const candidate of root.querySelectorAll<HTMLElement>('ol, ul, section, div, dl')) {
    if (candidate.closest(EXCLUDED_ANCESTORS)) continue;
    const hint = `${candidate.id} ${candidate.className}`;
    if (typeof candidate.className === 'string' && EXCLUDED_HINT.test(hint)) continue;

    const entries = candidate.querySelectorAll<HTMLElement>('li, dd, p, div, tr');
    let items = 0;
    for (const entry of entries) {
      const text = entry.textContent || '';
      const hasIdentifier =
        /\b10\.\d{4,9}\//.test(text) ||
        PMID_REGEX.test(text) ||
        entry.querySelector('a[href*="doi.org"], a[href*="pubmed.ncbi.nlm.nih.gov"]') !== null;
      PMID_REGEX.lastIndex = 0;
      // Count only the entries that directly hold an identifier, not their
      // ancestors, so a wrapper does not inherit its children's score.
      if (hasIdentifier && !entry.querySelector('li, dd, tr')) {
        items++;
      }
    }

    if (items < MIN_REFERENCE_ITEMS) continue;

    const size = (candidate.textContent || '').length;
    // Most identifier-bearing entries wins; ties go to the tightest container,
    // which keeps the result off <main> and on the actual list
    if (!best || items > best.items || (items === best.items && size < best.size)) {
      best = { element: candidate, items, size };
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
export function extractReferenceDois(
  referenceSection: HTMLElement
): ExtractedCitation[] {
  const citations: ExtractedCitation[] = [];
  const seenDois = new Set<string>();

  // Method 1: Find links to doi.org
  const doiLinks = referenceSection.querySelectorAll('a[href*="doi.org"]');
  for (const link of doiLinks) {
    const candidate = doiFromUrl((link as HTMLAnchorElement).href);
    if (candidate) {
      const doi = normalizeDoi(candidate);
      if (isValidDoi(doi) && !seenDois.has(doi)) {
        seenDois.add(doi);
        // Prefer the whole list item so highlights and badges attach to the
        // full reference, not just the publisher's link row inside it
        const refElement =
          (link.closest('li') as HTMLElement) ||
          (link.closest('p, div, tr') as HTMLElement) ||
          (link as HTMLElement);
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
      if (isValidDoi(doi) && !seenDois.has(doi)) {
        seenDois.add(doi);
        const parentElement = (node.parentElement?.closest('li') ||
          node.parentElement?.closest('p, div, tr')) as HTMLElement;
        if (parentElement) {
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

  // Shared for both PMID methods: attach the PMID to an existing citation for
  // the same reference element, or create a PMID-only citation.
  const seenPmids = new Set(citations.map((c) => c.pmid).filter(Boolean));
  const addPmid = (pmid: string, el: HTMLElement) => {
    if (seenPmids.has(pmid)) return;
    const existing = citations.find(
      (c) => c.element === el || c.element.contains(el) || el.contains(c.element)
    );
    if (existing) {
      if (!existing.pmid) {
        existing.pmid = pmid;
        seenPmids.add(pmid);
      }
      return;
    }
    seenPmids.add(pmid);
    citations.push({
      id: generateId(),
      pmid,
      title: extractTitleFromReference(el),
      context: 'reference',
      element: el,
    });
  };

  // Method 3: Find PubMed IDs written as "PMID: n" text
  const pmidMatches = referenceSection.innerHTML.matchAll(PMID_REGEX);
  for (const match of pmidMatches) {
    const pmid = match[1];
    // Find the element containing this PMID
    const elements = referenceSection.querySelectorAll('li, p, div, tr');
    for (const el of elements) {
      if (el.textContent?.includes(`PMID: ${pmid}`) || el.textContent?.includes(`PMID:${pmid}`)) {
        addPmid(pmid, el as HTMLElement);
        break;
      }
    }
  }

  // Method 4: Find PubMed IDs linked via pubmed.ncbi.nlm.nih.gov URLs
  const pubmedLinks = referenceSection.querySelectorAll('a[href*="pubmed.ncbi.nlm.nih.gov"]');
  for (const link of pubmedLinks) {
    const match = (link as HTMLAnchorElement).href.match(PMID_URL_REGEX);
    if (match) {
      const refElement =
        (link.closest('li') as HTMLElement) ||
        (link.closest('p, div, tr') as HTMLElement) ||
        (link as HTMLElement);
      addPmid(match[1], refElement);
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
      }
    }
  }

  return citations;
}
