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

// The body margin as it was before the first banner was injected, so
// dismissing the banner can restore the site's own layout. Null means
// "nothing captured".
let previousBodyMarginTop: string | null = null;

function pushBodyDown(banner: HTMLElement): void {
  if (previousBodyMarginTop === null) {
    previousBodyMarginTop = document.body.style.marginTop;
  }
  document.body.style.marginTop = `${banner.offsetHeight}px`;
}

function restoreBodyMargin(): void {
  if (previousBodyMarginTop !== null) {
    document.body.style.marginTop = previousBodyMarginTop;
    previousBodyMarginTop = null;
  }
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
 * Create and inject a top banner for problematic articles
 * Only shows for: retracted, concern, correction, fake-likely, fake-probably
 * Does NOT show for: verified, unverified, skip, checking
 */
export function injectTopBanner(
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): HTMLElement | null {
  // Skip statuses that don't need a banner
  if (status === 'verified' || status === 'unverified' || status === 'skip' || status === 'checking') {
    return null;
  }

  // Remove existing banner if any
  const existingBanner = document.getElementById('citicious-top-banner');
  if (existingBanner) {
    existingBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'citicious-top-banner';
  banner.className = `citicious-banner citicious-banner--${status}`;

  let icon = '';
  let text = '';
  let linkUrl = details?.retractionNoticeUrl || null;
  let linkText = '';

  if (status === 'retracted') {
    icon = '⚠️';
    text = 'This article has been RETRACTED';
    linkText = 'View notice →';
  } else if (status === 'concern') {
    icon = '⚠️';
    text = 'EXPRESSION OF CONCERN';
    linkText = 'View notice →';
  } else if (status === 'correction') {
    icon = '📝';
    text = 'CORRECTION ISSUED';
    linkText = 'View notice →';
  } else if (status === 'fake-likely') {
    icon = '❌';
    text = 'DOI NOT FOUND: this DOI is not registered and may be a fabricated reference';
  } else if (status === 'fake-probably') {
    icon = '⚠️';
    text = 'TITLE MISMATCH: citation details differ from the published record';
  }

  if (!icon) {
    return null;
  }

  const iconSpan = document.createElement('span');
  iconSpan.className = 'citicious-banner__icon';
  iconSpan.textContent = icon;
  banner.appendChild(iconSpan);

  const textSpan = document.createElement('span');
  textSpan.className = 'citicious-banner__text';
  textSpan.textContent = text;
  banner.appendChild(textSpan);

  if (linkUrl) {
    const link = document.createElement('a');
    link.href = linkUrl;
    link.target = '_blank';
    link.className = 'citicious-banner__link';
    link.textContent = linkText;
    banner.appendChild(link);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'citicious-banner__close';
  closeBtn.setAttribute('aria-label', 'Dismiss banner');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    restoreBodyMargin();
    banner.classList.add('citicious-banner--hidden');
    setTimeout(() => banner.remove(), 300);
  });
  banner.appendChild(closeBtn);

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Push page content down without losing the site's own margin
  pushBodyDown(banner);

  return banner;
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
  badgeIcon.textContent = config.icon;
  badge.appendChild(badgeIcon);

  const badgeLabel = document.createElement('span');
  badgeLabel.className = 'citicious-badge__label';
  badgeLabel.textContent = config.label;
  badge.appendChild(badgeLabel);

  const tooltip = badgeTooltip(status, details, discrepancies);
  if (tooltip) {
    badge.title = tooltip;
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
  updatedIcon.textContent = config.icon;
  existingBadge.appendChild(updatedIcon);

  const updatedLabel = document.createElement('span');
  updatedLabel.className = 'citicious-badge__label';
  updatedLabel.textContent = config.label;
  existingBadge.appendChild(updatedLabel);

  const tooltip = badgeTooltip(status, details, discrepancies);
  if (tooltip) {
    existingBadge.title = tooltip;
  }
}

/**
 * Inject a summary banner for references with issues
 */
export function injectReferencesBanner(
  retractedCount: number,
  suspiciousCount: number,
  concernCount: number
): HTMLElement | null {
  const totalProblems = retractedCount + suspiciousCount + concernCount;
  if (totalProblems === 0) {
    return null;
  }

  // Remove existing banner if any
  const existingBanner = document.getElementById('citicious-top-banner');
  if (existingBanner) {
    existingBanner.remove();
  }

  const banner = document.createElement('div');
  banner.id = 'citicious-top-banner';

  // Use the most severe status for styling
  let bannerClass = 'citicious-banner--fake-probably';
  let icon = '⚠️';

  if (retractedCount > 0) {
    bannerClass = 'citicious-banner--retracted';
    icon = '⚠️';
  } else if (suspiciousCount > 0) {
    bannerClass = 'citicious-banner--fake-likely';
    icon = '❌';
  }

  banner.className = `citicious-banner ${bannerClass}`;

  // Build text
  const parts: string[] = [];
  if (retractedCount > 0) {
    parts.push(`${retractedCount} retracted`);
  }
  if (suspiciousCount > 0) {
    parts.push(`${suspiciousCount} suspicious`);
  }
  if (concernCount > 0) {
    parts.push(`${concernCount} with concerns`);
  }
  const text = `This page cites ${parts.join(', ')} reference${totalProblems > 1 ? 's' : ''}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'citicious-banner__icon';
  iconSpan.textContent = icon;
  banner.appendChild(iconSpan);

  const textSpan = document.createElement('span');
  textSpan.className = 'citicious-banner__text';
  textSpan.textContent = text;
  banner.appendChild(textSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'citicious-banner__close';
  closeBtn.setAttribute('aria-label', 'Dismiss banner');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    restoreBodyMargin();
    banner.classList.add('citicious-banner--hidden');
    setTimeout(() => banner.remove(), 300);
  });
  banner.appendChild(closeBtn);

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Push page content down without losing the site's own margin
  pushBodyDown(banner);

  return banner;
}

/**
 * Remove all Citicious badges from the page
 */
export function removeAllBadges(): void {
  document.querySelectorAll('.citicious-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.citicious-banner').forEach((banner) => banner.remove());
  restoreBodyMargin();
}
