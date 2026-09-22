import type { ExtractedCitation } from '../../shared/types';

// DOI regex patterns based on CrossRef recommendations
// Primary pattern: matches 97%+ of DOIs
const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>]+)\b/i;

// PubMed ID patterns (inline "PMID: n" text and pubmed.ncbi.nlm.nih.gov links)
const PMID_REGEX = /\bPMID:\s*(\d+)\b/i;
const PMID_URL_REGEX = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i;
const REFERENCE_HEADING_REGEX =
  /^(?:\d+\.?\s*)?(?:references?|bibliography|works cited|literature cited|references and notes)$/;
const NON_REFERENCE_SECTION_HINT =
  /recommend|related|sidebar|promo|advert|cited-by|citedby|metrics|toc|menu/i;
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
  '.article-section__references', // Wiley
  '.c-article-references', // Nature
];
const REFERENCE_SECTION_SELECTOR = REFERENCE_SECTION_SELECTORS.join(', ');
export const MAX_REFERENCES_PER_PAGE = 500;
// ponytail: cap hostile bibliography DOM traversal; raise only if real publisher markup exceeds it.
const MAX_REFERENCE_SCAN_ELEMENTS = 20_000;

const hasReferenceContent = (element: Element): boolean =>
  element.querySelector('li, p, div, tr') !== null ||
  (element.textContent || '').trim().length > 40;

// A heading inside a link, button, tab, or nav is a control label, not a
// section heading: Wiley's sidebar renders <a role="tab"><h2>References</h2></a>,
// and treating it as the heading made the whole article the reference section.
// Ancestor-based on purpose; Wiley's real heading wraps a role="button" toggle.
const CONTROL_ANCESTOR_SELECTOR = 'a[href], button, [role="tab"], [role="tablist"], nav';

const isReferenceHeading = (element: Element): boolean =>
  /^H[1-4]$/.test(element.tagName) &&
  REFERENCE_HEADING_REGEX.test(element.textContent?.trim().toLowerCase() || '') &&
  element.closest(CONTROL_ANCESTOR_SELECTOR) === null;

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
export function extractCurrentArticleDoi(
  document: Document,
  referenceSection = findReferenceSection(document)
): ExtractedCitation | null {
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

  const dataDoiElements = document.querySelectorAll(
    'article[data-doi], main[data-doi], [itemtype*="ScholarlyArticle"][data-doi]'
  );
  for (const el of dataDoiElements) {
    if (referenceSection?.contains(el)) continue;
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
      if (referenceSection?.contains(el)) continue;
      const link = (el.matches('a[href]') ? el : el.querySelector('a[href]')) as
        | HTMLAnchorElement
        | null;
      const linkCandidate = link?.href ? doiFromUrl(link.href) : null;
      if (linkCandidate) {
        const citation = currentArticleCitation(linkCandidate, document);
        if (citation) return citation;
      }
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

  // Accordions and collapsible panels: a control labeled "References" names
  // the element it opens (aria-controls / data-target). That element is the
  // bibliography even when nothing about its own markup says so, which is how
  // Bentham and other Bootstrap-style layouts hide a reference list behind a
  // toggle. An empty tab pane fails the content check and is skipped.
  const disclosed = findReferenceDisclosure(document);
  if (disclosed) return disclosed;

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

/**
 * Resolve a "References" disclosure control to the element it opens.
 */
function findReferenceDisclosure(document: Document): HTMLElement | null {
  const controls = document.querySelectorAll('[aria-controls], [data-target]');
  for (const control of controls) {
    const label = (control.textContent || '').trim().toLowerCase();
    if (!REFERENCE_HEADING_REGEX.test(label)) continue;
    const target =
      (control.getAttribute('aria-controls') || '').trim().split(/\s+/)[0] ||
      (control.getAttribute('data-target') || '').trim().replace(/^#/, '');
    if (!target) continue;
    const element = document.getElementById(target);
    if (element && hasReferenceContent(element)) return element as HTMLElement;
  }
  return null;
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
    hasIdentifier: boolean;
    excluded: boolean;
  }> = [];
  let current = root.firstElementChild as HTMLElement | null;
  let visited = 0;

  while (current && visited < MAX_REFERENCE_SCAN_ELEMENTS) {
    visited += 1;
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
      hasIdentifier: hasOwnReferenceIdentifier(current),
      excluded:
        (parent?.excluded || false) ||
        current.matches(EXCLUDED_ANCESTORS) ||
        NON_REFERENCE_SECTION_HINT.test(hint),
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
        if (completed.hasIdentifier) completed.identifierItems++;
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
        ancestor.hasIdentifier ||= completed.hasIdentifier;
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

function hasOwnReferenceIdentifier(element: Element): boolean {
  if (element.matches('a[href*="doi.org"]')) return true;
  // Only a link to a specific PubMed record counts. PubMed Central prints an
  // author-search link (pubmed.../?term="Name"[Author]) beside every author, and
  // treating those as identifiers made the article's own byline block look like
  // a reference list on papers that have no bibliography at all.
  if (
    element.matches('a[href*="pubmed.ncbi.nlm.nih.gov"]') &&
    PMID_URL_REGEX.test(element.getAttribute('href') || '')
  ) {
    return true;
  }
  for (const child of element.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    const text = child.nodeValue || '';
    if (DOI_REGEX.test(text) || PMID_REGEX.test(text)) return true;
  }
  return false;
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
    '[itemprop="headline"]',
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
function isReferenceEndBoundary(element: Element, referenceHeading: Element): boolean {
  const headingMatch = /^H([1-4])$/.exec(element.tagName);
  if (headingMatch && Number(headingMatch[1]) <= Number(referenceHeading.tagName[1])) return true;
  if (
    element.matches('aside, nav, footer, [role="complementary"], [role="navigation"]')
  ) {
    return true;
  }
  const className = typeof element.className === 'string' ? element.className : '';
  return NON_REFERENCE_SECTION_HINT.test(
    `${element.id} ${className} ${element.getAttribute('aria-label') || ''}`
  );
}

function findReferenceEndBoundary(
  referenceSection: HTMLElement,
  referenceHeading: Element
): Element | undefined {
  let branch: Element | null = referenceHeading;
  while (branch && branch !== referenceSection) {
    let sibling = branch.nextElementSibling;
    while (sibling) {
      if (isReferenceEndBoundary(sibling, referenceHeading)) return sibling;
      sibling = sibling.nextElementSibling;
    }
    branch = branch.parentElement;
  }
  return undefined;
}

function isWithinReferenceBounds(
  element: Element,
  afterHeading?: Element,
  beforeBoundary?: Element
): boolean {
  if (
    afterHeading &&
    !(afterHeading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
  ) {
    return false;
  }
  return Boolean(
    !beforeBoundary ||
      (element !== beforeBoundary &&
        !beforeBoundary.contains(element) &&
        element.compareDocumentPosition(beforeBoundary) & Node.DOCUMENT_POSITION_FOLLOWING)
  );
}

function findReferenceElements(
  referenceSection: HTMLElement,
  selector: string,
  limit: number,
  afterHeading?: Element,
  beforeBoundary?: Element,
  preferOuter = false
): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const stack: Array<{
    element: HTMLElement;
    matches: boolean;
    hasMatchingAncestor: boolean;
    hasMatchingDescendant: boolean;
  }> = [];
  let current = referenceSection.firstElementChild as HTMLElement | null;
  let visited = 0;

  while (current && visited < MAX_REFERENCE_SCAN_ELEMENTS) {
    visited += 1;
    const parent = stack[stack.length - 1];
    stack.push({
      element: current,
      matches: current.matches(selector),
      hasMatchingAncestor: Boolean(parent && (parent.matches || parent.hasMatchingAncestor)),
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
        (preferOuter ? !completed.hasMatchingAncestor : !completed.hasMatchingDescendant) &&
        (completed.element.textContent || '').trim() &&
        isWithinReferenceBounds(completed.element, afterHeading, beforeBoundary)
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

function findPlainDivReferenceElements(
  referenceSection: HTMLElement,
  afterHeading?: Element,
  beforeBoundary?: Element
): HTMLElement[] {
  const nodes: Element[] = [referenceSection];
  const walker = referenceSection.ownerDocument.createTreeWalker(
    referenceSection,
    NodeFilter.SHOW_ELEMENT
  );
  while (nodes.length < MAX_REFERENCE_SCAN_ELEMENTS) {
    const element = walker.nextNode();
    if (!element) break;
    if (element instanceof Element) nodes.push(element);
  }

  const order = new WeakMap<Element, number>();
  nodes.forEach((element, index) => order.set(element, index));
  const afterIndex = afterHeading ? order.get(afterHeading) : undefined;
  const beforeIndex = beforeBoundary ? order.get(beforeBoundary) : undefined;
  const boundaryAncestors = new WeakSet<Element>();
  for (
    let ancestor = beforeBoundary?.parentElement;
    ancestor && ancestor !== referenceSection;
    ancestor = ancestor.parentElement
  ) {
    boundaryAncestors.add(ancestor);
  }
  const isWithinBounds = (element: Element): boolean => {
    const index = order.get(element);
    return Boolean(
      index !== undefined &&
      (afterIndex === undefined || index > afterIndex) &&
      (beforeIndex === undefined || index < beforeIndex) &&
      !boundaryAncestors.has(element)
    );
  };

  const identifierSubtrees = new WeakSet<Element>();
  let bestPlainDivs: HTMLElement[] = [];
  let bestIdentifierCount = 0;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const element = nodes[index];
    let hasIdentifier = hasOwnReferenceIdentifier(element);
    if (!hasIdentifier) {
      for (const child of element.children) {
        if (identifierSubtrees.has(child)) {
          hasIdentifier = true;
          break;
        }
      }
    }
    if (hasIdentifier) identifierSubtrees.add(element);
    if (element !== referenceSection && element.tagName !== 'DIV') continue;

    let directDivCount = 0;
    let identifierCount = 0;
    for (const child of element.children) {
      if (!(child instanceof HTMLElement) || child.tagName !== 'DIV' || !isWithinBounds(child)) {
        continue;
      }
      directDivCount += 1;
      if (identifierSubtrees.has(child)) identifierCount += 1;
    }
    if (directDivCount < 2) continue;
    if (identifierCount >= 2 && identifierCount > bestIdentifierCount) {
      bestPlainDivs = Array.from(element.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.tagName === 'DIV' && isWithinBounds(child)
      );
      bestIdentifierCount = identifierCount;
    }
  }
  return bestPlainDivs;
}

/**
 * Split a single selected block into its reference rows when it is really a
 * list: several sibling children of the same tag and class, each long enough to
 * be a reference. Bentham wraps every entry in <div class="line"> inside one
 * <div class="reference">, so selecting the wrapper badged ten references once.
 * Short children (author spans, labels) never qualify, so a single reference is
 * left alone.
 */
const MIN_SPLIT_CHILD_TEXT = 40;
const MIN_ENTRY_TEXT = 25;
const IDENTIFIER_LINK_SELECTOR = 'a[href*="doi.org"], a[href*="pubmed.ncbi.nlm.nih.gov"]';

function splitUniformChildren(element: HTMLElement, limit: number): HTMLElement[] {
  if (element.matches('li, dd, tr, [role="doc-biblioentry"], [role="listitem"]')) return [];
  const children = Array.from(element.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      (child.textContent || '').trim().length >= MIN_SPLIT_CHILD_TEXT
  );
  if (children.length < 2) return [];
  const { tagName, className } = children[0];
  if (!children.every((child) => child.tagName === tagName && child.className === className)) {
    return [];
  }
  return children.slice(0, limit);
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
  ).find(isReferenceHeading);
  const referenceEndBoundary = referenceHeading
    ? findReferenceEndBoundary(referenceSection, referenceHeading)
    : undefined;
  let elements: HTMLElement[] = [];
  for (const selector of selectorGroups) {
    const matches = findReferenceElements(
      referenceSection,
      selector,
      boundedLimit,
      referenceHeading,
      referenceEndBoundary,
      selector === selectorGroups[0]
    );
    if (matches.length > 0) {
      elements = matches;
      break;
    }
  }

  if (elements.length === 0) {
    elements = findPlainDivReferenceElements(
      referenceSection,
      referenceHeading,
      referenceEndBoundary
    ).slice(0, boundedLimit);
  }

  if (elements.length === 0 && (referenceSection.textContent || '').trim()) {
    // Every sibling after the heading, not only the first: Cambridge Core lists
    // each reference as its own <div> after the <h2>, and taking one sibling
    // badged the first reference and silently dropped the rest.
    const siblings: HTMLElement[] = [];
    for (
      let sibling = (referenceHeading?.nextElementSibling as HTMLElement | null) || null;
      sibling && siblings.length < boundedLimit;
      sibling = sibling.nextElementSibling as HTMLElement | null
    ) {
      if (!isWithinReferenceBounds(sibling, referenceHeading, referenceEndBoundary)) break;
      if ((sibling.textContent || '').trim()) siblings.push(sibling);
    }
    if (siblings.length > 0) {
      elements = siblings;
    } else if (!referenceHeading) {
      elements = [referenceSection];
    }
  }

  // A reference is a sentence, not a word. Tab strips and link rows sit inside
  // the same container on abstract-only pages ("Article", "Metrics", "Author
  // information"), and badging those is worse than missing a short entry, which
  // could only ever have been reported as "not checked" anyway. An entry that
  // carries an identifier is kept however short it reads.
  const meaningful = elements.filter((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= MIN_ENTRY_TEXT) return true;
    if (element.querySelector(IDENTIFIER_LINK_SELECTOR)) return true;
    return DOI_REGEX.test(text) || PMID_REGEX.test(text);
  });
  // When nothing survives, the container was not a bibliography at all: report
  // no references rather than badging a row of download links.
  elements = meaningful;

  // One element for a whole bibliography is usually a wrapper, not a reference.
  if (elements.length === 1) {
    const split = splitUniformChildren(elements[0], boundedLimit);
    if (split.length >= 2) elements = split;
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
  const referenceSection = findReferenceSection(document);

  // Get current article DOI
  const currentArticle = extractCurrentArticleDoi(document, referenceSection);
  if (currentArticle?.doi) {
    citations.push(currentArticle);
  }

  // Find and scan reference section
  if (referenceSection) {
    citations.push(...extractReferenceDois(referenceSection, referenceLimit));
  }

  return citations;
}
