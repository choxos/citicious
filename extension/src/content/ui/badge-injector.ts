import type { CitationStatus, RetractionDetails, Discrepancy } from '../../shared/types';

// Badge configuration per status
// Note: 'skip' status doesn't show a badge
const BADGE_CONFIG: Partial<Record<CitationStatus, { icon: string; label: string; className: string }>> = {
  verified: { icon: '✓', label: 'Verified', className: 'citicious-badge--verified' },
  retracted: { icon: '⚠️', label: 'RETRACTED', className: 'citicious-badge--retracted' },
  concern: { icon: '⚠️', label: 'CONCERN', className: 'citicious-badge--concern' },
  correction: { icon: '📝', label: 'CORRECTION', className: 'citicious-badge--correction' },
  'fake-likely': { icon: '❌', label: 'FAKE (likely)', className: 'citicious-badge--fake-likely' },
  'fake-probably': { icon: '⚠️', label: 'FAKE (probably)', className: 'citicious-badge--fake-probably' },
  checking: { icon: '⟳', label: 'Checking...', className: 'citicious-badge--checking' },
  // 'skip' intentionally not included - no badge shown
};

/**
 * Create and inject a top banner for problematic articles
 * Only shows for: retracted, concern, correction, fake-likely, fake-probably
 * Does NOT show for: verified, skip, checking
 */
export function injectTopBanner(
  status: CitationStatus,
  details?: RetractionDetails,
  discrepancies?: Discrepancy[]
): HTMLElement | null {
  // Skip statuses that don't need a banner
  if (status === 'verified' || status === 'skip' || status === 'checking') {
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
    text = 'FAKE CITATION DETECTED — DOI does not exist';
  } else if (status === 'fake-probably') {
    icon = '⚠️';
    text = 'SUSPICIOUS CITATION — Metadata mismatch detected';
  }

  if (!icon) {
    return null;
  }

  const content = `
    <span class="citicious-banner__icon">${icon}</span>
    <span class="citicious-banner__text">${text}</span>
    ${linkUrl ? `<a href="${linkUrl}" target="_blank" class="citicious-banner__link">${linkText}</a>` : ''}
    <button class="citicious-banner__close" aria-label="Dismiss banner">×</button>
  `;

  banner.innerHTML = content;

  // Add close button handler
  const closeBtn = banner.querySelector('.citicious-banner__close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.classList.add('citicious-banner--hidden');
      setTimeout(() => banner.remove(), 300);
    });
  }

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Add body padding to prevent content overlap
  document.body.style.marginTop = `${banner.offsetHeight}px`;

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
  discrepancies?: Discrepancy[],
  onClick?: () => void
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

  badge.innerHTML = `
    <span class="citicious-badge__icon">${config.icon}</span>
    <span class="citicious-badge__label">${config.label}</span>
  `;

  // Add tooltip with details
  if (status === 'retracted' && details) {
    badge.title = `Retracted: ${details.reason?.join(', ') || 'Unknown reason'}`;
  } else if (status === 'concern' && details) {
    badge.title = `Expression of Concern: ${details.reason?.join(', ') || 'See details'}`;
  } else if (status === 'correction' && details) {
    badge.title = `Correction issued: ${details.reason?.join(', ') || 'See details'}`;
  } else if (status === 'fake-likely') {
    badge.title = 'This DOI does not exist in academic databases';
  } else if (status === 'fake-probably' && discrepancies?.length) {
    badge.title = `Significant discrepancies: ${discrepancies.map(d => d.field).join(', ')}`;
  } else if (status === 'verified') {
    badge.title = 'Citation verified in academic databases';
  }

  // Add click handler
  if (onClick) {
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
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
  existingBadge.innerHTML = `
    <span class="citicious-badge__icon">${config.icon}</span>
    <span class="citicious-badge__label">${config.label}</span>
  `;

  // Update tooltip
  if (status === 'retracted' && details) {
    existingBadge.title = `Retracted: ${details.reason?.join(', ') || 'Unknown reason'}`;
  } else if (status === 'concern' && details) {
    existingBadge.title = `Expression of Concern: ${details.reason?.join(', ') || 'See details'}`;
  } else if (status === 'correction' && details) {
    existingBadge.title = `Correction: ${details.reason?.join(', ') || 'See details'}`;
  } else if (status === 'fake-likely') {
    existingBadge.title = 'This DOI does not exist in academic databases';
  } else if (status === 'fake-probably' && discrepancies?.length) {
    existingBadge.title = `Significant discrepancies: ${discrepancies.map(d => d.field).join(', ')}`;
  } else if (status === 'verified') {
    existingBadge.title = 'Citation verified in academic databases';
  }
}

/**
 * Inject a summary banner for references with issues
 */
export function injectReferencesBanner(
  retractedCount: number,
  fakeCount: number,
  concernCount: number
): HTMLElement | null {
  const totalProblems = retractedCount + fakeCount + concernCount;
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
  } else if (fakeCount > 0) {
    bannerClass = 'citicious-banner--fake-likely';
    icon = '❌';
  }

  banner.className = `citicious-banner ${bannerClass}`;

  // Build text
  const parts: string[] = [];
  if (retractedCount > 0) {
    parts.push(`${retractedCount} retracted`);
  }
  if (fakeCount > 0) {
    parts.push(`${fakeCount} fake`);
  }
  if (concernCount > 0) {
    parts.push(`${concernCount} with concerns`);
  }
  const text = `This page cites ${parts.join(', ')} reference${totalProblems > 1 ? 's' : ''}`;

  const content = `
    <span class="citicious-banner__icon">${icon}</span>
    <span class="citicious-banner__text">${text}</span>
    <button class="citicious-banner__close" aria-label="Dismiss banner">×</button>
  `;

  banner.innerHTML = content;

  // Add close button handler
  const closeBtn = banner.querySelector('.citicious-banner__close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.classList.add('citicious-banner--hidden');
      setTimeout(() => banner.remove(), 300);
    });
  }

  // Insert at top of body
  document.body.insertBefore(banner, document.body.firstChild);

  // Add body padding to prevent content overlap
  document.body.style.marginTop = `${banner.offsetHeight}px`;

  return banner;
}

/**
 * Remove all Citicious badges from the page
 */
export function removeAllBadges(): void {
  document.querySelectorAll('.citicious-badge').forEach((badge) => badge.remove());
  document.querySelectorAll('.citicious-banner').forEach((banner) => banner.remove());
  document.body.style.marginTop = '';
}

/**
 * Get the status icon for use in sidebar
 */
export function getStatusIcon(status: CitationStatus): string {
  return BADGE_CONFIG[status]?.icon || '?';
}
