import type { CitationStatus, RetractionDetails, Discrepancy } from '../../shared/types';

// Badge configuration per status
// Note: 'skip' status doesn't show a badge
const BADGE_CONFIG: Partial<Record<CitationStatus, { icon: string; label: string; className: string }>> = {
  verified: { icon: '✓', label: 'Verified', className: 'citicious-badge--verified' },
  unverified: { icon: 'ℹ', label: 'Unverified', className: 'citicious-badge--unverified' },
  retracted: { icon: '⚠️', label: 'RETRACTED', className: 'citicious-badge--retracted' },
  concern: { icon: '⚠️', label: 'CONCERN', className: 'citicious-badge--concern' },
  correction: { icon: '📝', label: 'CORRECTION', className: 'citicious-badge--correction' },
  'fake-likely': { icon: '❌', label: 'DOI NOT FOUND', className: 'citicious-badge--fake-likely' },
  'fake-probably': { icon: '⚠️', label: 'TITLE MISMATCH', className: 'citicious-badge--fake-probably' },
  checking: { icon: '⟳', label: 'Checking...', className: 'citicious-badge--checking' },
  // 'skip' intentionally not included - no badge shown
};

// Per-status banner copy: sentence-case title + one-line summary
const BANNER_COPY: Partial<Record<CitationStatus, { title: string; summary: string }>> = {
  retracted: {
    title: 'Retracted article',
    summary: 'This article has been retracted. Treat its findings and conclusions with caution.',
  },
  concern: {
    title: 'Expression of concern',
    summary: 'The publisher has issued an expression of concern for this article.',
  },
  correction: {
    title: 'Correction issued',
    summary: 'A correction is available. Review it before relying on the original article.',
  },
  'fake-likely': {
    title: 'DOI not found',
    summary: 'This DOI is not registered or indexed. Check for a typo before citing this work.',
  },
  'fake-probably': {
    title: 'Citation details mismatch',
    summary: 'Citation metadata differs from the published record. Review the mismatched fields.',
  },
};

// The body margin as it was before the first banner was injected, so
// dismissing the banner can restore the site's own layout. Null means
// "nothing captured". The computed base (px) is kept separately so the
// offset can be reapplied when the banner's height changes.
let previousBodyMarginTop: string | null = null;
let baseBodyMarginPx = 0;
let bannerResizeObserver: ResizeObserver | null = null;

function pushBodyDown(banner: HTMLElement): void {
  if (previousBodyMarginTop === null) {
    previousBodyMarginTop = document.body.style.marginTop;
    baseBodyMarginPx = parseFloat(getComputedStyle(document.body).marginTop) || 0;
  }
  document.body.style.marginTop = `${baseBodyMarginPx + banner.offsetHeight}px`;

  // Keep the offset in sync when wrapping or viewport changes alter the
  // banner's height.
  bannerResizeObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    bannerResizeObserver = new ResizeObserver(() => {
      if (banner.isConnected && previousBodyMarginTop !== null) {
        document.body.style.marginTop = `${baseBodyMarginPx + banner.offsetHeight}px`;
      }
    });
    bannerResizeObserver.observe(banner);
  }
}

function restoreBodyMargin(): void {
  bannerResizeObserver?.disconnect();
  bannerResizeObserver = null;
  if (previousBodyMarginTop !== null) {
    document.body.style.marginTop = previousBodyMarginTop;
    previousBodyMarginTop = null;
    baseBodyMarginPx = 0;
  }
}

/**
 * Hide the banner, restore the page layout immediately, and remove the
 * element once its exit transition finishes (with a fallback timer for
 * pages or settings where the transition never fires).
 */
function dismissBanner(banner: HTMLElement): void {
  restoreBodyMargin();
  banner.classList.add('citicious-banner--hidden');
  const remove = () => banner.remove();
  banner.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 250);
}

/** Only http(s) notice URLs are ever rendered as links. */
function safeNoticeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Human-readable date for a banner chip, or null when unparseable. */
function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function metaChip(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'citicious-banner__meta-item';
  const dt = document.createElement('dt');
  dt.className = 'citicious-banner__meta-label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = 'citicious-banner__meta-value';
  dd.textContent = value;
  item.appendChild(dt);
  item.appendChild(dd);
  return item;
}

/**
 * Shared banner scaffold: severity strip with icon mark, Citicious brand
 * pill, title, summary, optional details row, and an accessible close
 * button. Content is built with createElement/textContent only.
 */
function buildBanner(options: {
  statusClass: string;
  status: string;
  title: string;
  summary: string;
  metaChips?: HTMLElement[];
  linkUrl?: string | null;
  linkText?: string;
  sourceText?: string | null;
}): HTMLElement {
  const banner = document.createElement('div');
  banner.id = 'citicious-top-banner';
  banner.className = `citicious-banner citicious-banner--${options.statusClass}`;
  banner.setAttribute('data-citicious-status', options.status);
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-atomic', 'true');
  banner.setAttribute('aria-labelledby', 'citicious-banner-title');
  banner.setAttribute('aria-describedby', 'citicious-banner-summary');

  const inner = document.createElement('div');
  inner.className = 'citicious-banner__inner';

  const mark = document.createElement('span');
  mark.className = 'citicious-banner__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '!';
  inner.appendChild(mark);

  const body = document.createElement('div');
  body.className = 'citicious-banner__body';

  const heading = document.createElement('div');
  heading.className = 'citicious-banner__heading';
  const brand = document.createElement('span');
  brand.className = 'citicious-banner__brand';
  brand.textContent = 'Citicious';
  heading.appendChild(brand);
  const title = document.createElement('strong');
  title.id = 'citicious-banner-title';
  title.className = 'citicious-banner__title';
  title.textContent = options.title;
  heading.appendChild(title);
  body.appendChild(heading);

  const summary = document.createElement('p');
  summary.id = 'citicious-banner-summary';
  summary.className = 'citicious-banner__summary';
  summary.textContent = options.summary;
  body.appendChild(summary);

  const hasMeta = options.metaChips && options.metaChips.length > 0;
  const linkUrl = safeNoticeUrl(options.linkUrl);
  if (hasMeta || linkUrl || options.sourceText) {
    const details = document.createElement('div');
    details.className = 'citicious-banner__details';

    if (hasMeta) {
      const meta = document.createElement('dl');
      meta.className = 'citicious-banner__meta';
      for (const chip of options.metaChips!) {
        meta.appendChild(chip);
      }
      details.appendChild(meta);
    }

    if (linkUrl || options.sourceText) {
      const actions = document.createElement('div');
      actions.className = 'citicious-banner__actions';
      if (linkUrl) {
        const link = document.createElement('a');
        link.className = 'citicious-banner__link';
        link.href = linkUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = options.linkText || 'Read notice';
        link.setAttribute('aria-label', `${options.linkText || 'Read notice'}, opens in a new tab`);
        actions.appendChild(link);
      }
      if (options.sourceText) {
        const source = document.createElement('span');
        source.className = 'citicious-banner__source';
        source.textContent = options.sourceText;
        actions.appendChild(source);
      }
      details.appendChild(actions);
    }

    body.appendChild(details);
  }

  inner.appendChild(body);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'citicious-banner__close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss Citicious warning');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => dismissBanner(banner));
  inner.appendChild(closeBtn);

  banner.appendChild(inner);
  return banner;
}

/**
 * Create and inject a top banner for problematic articles
 * Only shows for: retracted, concern, correction, fake-likely, fake-probably
 * Does NOT show for: verified, unverified, skip, checking
 */
export function injectTopBanner(
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): HTMLElement | null {
  const copy = BANNER_COPY[status];
  if (!copy) {
    return null;
  }

  // Remove existing banner if any
  document.getElementById('citicious-top-banner')?.remove();

  const metaChips: HTMLElement[] = [];
  let linkText = 'Read notice';
  let sourceText: string | null = null;

  if (status === 'retracted' || status === 'concern' || status === 'correction') {
    const date = formatDate(details?.retractionDate);
    if (date) metaChips.push(metaChip('Date', date));
    if (details?.retractionNature) metaChips.push(metaChip('Nature', details.retractionNature));
    linkText = status === 'correction' ? 'Read correction' : 'Read retraction notice';
    sourceText =
      details?.source === 'retraction-watch'
        ? 'Retraction data: Retraction Watch'
        : 'Source: publisher record';
  } else if (status === 'fake-probably' && discrepancies?.length) {
    metaChips.push(metaChip('Fields', discrepancies.map((d) => d.field).join(', ')));
  }

  const banner = buildBanner({
    statusClass: status,
    status,
    title: copy.title,
    summary: copy.summary,
    metaChips,
    linkUrl: details?.retractionNoticeUrl,
    linkText,
    sourceText,
  });

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Push page content down without losing the site's own margin
  pushBodyDown(banner);

  return banner;
}

// Per-status counts for the references summary banner, so severity is not
// collapsed before it reaches the UI.
export interface ReferenceIssueCounts {
  retracted: number;
  notFound: number;
  mismatch: number;
  concern: number;
  correction: number;
}

/**
 * Inject a summary banner for references with issues
 */
export function injectReferencesBanner(counts: ReferenceIssueCounts): HTMLElement | null {
  const total =
    counts.retracted + counts.notFound + counts.mismatch + counts.concern + counts.correction;
  if (total === 0) {
    return null;
  }

  // Remove existing banner if any
  document.getElementById('citicious-top-banner')?.remove();

  // Highest severity wins: red, then amber, then yellow
  let statusClass = 'correction';
  if (counts.retracted > 0 || counts.notFound > 0) {
    statusClass = 'retracted';
  } else if (counts.mismatch > 0 || counts.concern > 0) {
    statusClass = 'concern';
  }

  const parts: string[] = [];
  if (counts.retracted > 0) parts.push(`${counts.retracted} retracted`);
  if (counts.notFound > 0) parts.push(`${counts.notFound} with unregistered DOIs`);
  if (counts.mismatch > 0) parts.push(`${counts.mismatch} with mismatched details`);
  if (counts.concern > 0) parts.push(`${counts.concern} with expressions of concern`);
  if (counts.correction > 0) parts.push(`${counts.correction} with corrections`);
  const summary = `This page cites ${parts.join(', ')} reference${total > 1 ? 's' : ''}. Flagged entries are highlighted in the bibliography.`;

  const banner = buildBanner({
    statusClass,
    status: 'references-summary',
    title: 'Citation issues found',
    summary,
  });

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Push page content down without losing the site's own margin
  pushBodyDown(banner);

  return banner;
}

/**
 * Tooltip text for a badge. Retraction reasons are rarely available from the
 * public APIs, so the reason list is only mentioned when it is non-empty.
 */
function badgeTooltip(
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): string {
  const reasons = details?.reason?.length ? `: ${details.reason.join(', ')}` : '';

  switch (status) {
    case 'retracted':
      return `This article has been retracted${reasons}`;
    case 'concern':
      return `An expression of concern has been issued for this article${reasons}`;
    case 'correction':
      return `A correction has been issued for this article${reasons}`;
    case 'fake-likely':
      return 'This DOI is not registered at doi.org or indexed in academic databases; possible typo or fabricated reference';
    case 'fake-probably':
      return discrepancies?.length
        ? `Citation details differ from the published record: ${discrepancies.map((d) => d.field).join(', ')}`
        : 'Citation details differ from the published record';
    case 'verified':
      return 'Citation verified in academic databases';
    case 'unverified':
      return 'This DOI is registered (resolves at doi.org) but is not indexed in CrossRef/OpenAlex; common for datasets, software, or theses';
    default:
      return '';
  }
}

/**
 * Inject a badge next to a citation element
 * Returns null if status is 'skip' (no badge shown)
 */
export function injectBadge(
  element: HTMLElement,
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): HTMLElement | null {
  // Remove existing badge if any
  const existingBadge = element.querySelector('.citicious-badge');
  if (existingBadge) {
    existingBadge.remove();
  }

  // Skip status = no badge
  const config = BADGE_CONFIG[status];
  if (!config) {
    return null;
  }

  const badge = document.createElement('span');
  badge.className = `citicious-badge ${config.className}`;
  badge.setAttribute('data-citicious-status', status);

  const badgeIcon = document.createElement('span');
  badgeIcon.className = 'citicious-badge__icon';
  badgeIcon.setAttribute('aria-hidden', 'true');
  badgeIcon.textContent = config.icon;
  badge.appendChild(badgeIcon);

  const badgeLabel = document.createElement('span');
  badgeLabel.className = 'citicious-badge__label';
  badgeLabel.textContent = config.label;
  badge.appendChild(badgeLabel);

  const tooltip = badgeTooltip(status, details, discrepancies);
  if (tooltip) {
    badge.title = tooltip;
    badge.setAttribute('aria-label', tooltip);
  }

  // Insert after the element (or at the end if it's a block element)
  if (element.tagName === 'LI' || element.tagName === 'P' || element.tagName === 'DIV') {
    // For block elements, prepend the badge
    element.insertBefore(badge, element.firstChild);
  } else {
    // For inline elements, insert after
    element.insertAdjacentElement('afterend', badge);
  }

  return badge;
}

/**
 * Update an existing badge's status
 * If status is 'skip', removes the badge
 */
export function updateBadge(
  element: HTMLElement,
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): void {
  const existingBadge = element.querySelector('.citicious-badge') as HTMLElement;

  // Skip status = remove badge if it exists
  const config = BADGE_CONFIG[status];
  if (!config) {
    if (existingBadge) {
      existingBadge.remove();
    }
    return;
  }

  // No existing badge and not skip = inject new badge
  if (!existingBadge) {
    injectBadge(element, status, details, discrepancies);
    return;
  }

  // Update existing badge
  existingBadge.className = `citicious-badge ${config.className}`;
  existingBadge.setAttribute('data-citicious-status', status);

  // Update content
  existingBadge.textContent = '';
  const updatedIcon = document.createElement('span');
  updatedIcon.className = 'citicious-badge__icon';
  updatedIcon.setAttribute('aria-hidden', 'true');
  updatedIcon.textContent = config.icon;
  existingBadge.appendChild(updatedIcon);

  const updatedLabel = document.createElement('span');
  updatedLabel.className = 'citicious-badge__label';
  updatedLabel.textContent = config.label;
  existingBadge.appendChild(updatedLabel);

  const tooltip = badgeTooltip(status, details, discrepancies);
  if (tooltip) {
    existingBadge.title = tooltip;
    existingBadge.setAttribute('aria-label', tooltip);
  }
}

/**
 * Remove all Citicious badges from the page
 */
export function removeAllBadges(): void {
  document.querySelectorAll('.citicious-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.citicious-banner').forEach((banner) => banner.remove());
  restoreBodyMargin();
}
