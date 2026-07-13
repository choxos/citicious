# Chrome Web Store Submission Kit

Everything below is copy-paste ready for the developer dashboard. The assets are in `store-assets/`.

**Critical:** the live listing currently contains the text that caused the keyword-spam rejection ("Works on PubMed, Google Scholar, Nature, Science, arXiv, bioRxiv, and most academic sites"). Replace the entire description with the version below; do not reintroduce a list of site names anywhere in the metadata.

---

## Store listing tab

### Title (from package, read-only)
Citicious

### Summary (from package, read-only; 132 characters max)
Detect retracted articles and fake/hallucinated citations in scientific papers

### Description (paste verbatim)

Citicious checks the science you are reading, while you read it.

Open a paper and Citicious quietly verifies the article itself and every reference in its bibliography against the public scholarly record. If something is wrong, you see it immediately, in place, without leaving the page.

WHAT IT CATCHES

Retracted articles. A banner appears the moment you open a paper that has been retracted, with the date, the type of notice, and a direct link to the retraction notice itself.

Fabricated citations. AI writing tools invent references that look perfectly real. Citicious flags a DOI that is registered nowhere and resolves nowhere, so you can catch an invented reference before it reaches your manuscript.

Expressions of concern and corrections. The quieter signals that a paper has been questioned or amended, surfaced next to the citation instead of buried in a notice you would never see.

Citation details that do not match the published record. When a reference's title differs from the work its DOI actually points to, the entry is marked so you can check it.

HOW IT WORKS

Citicious reads the identifiers already printed on the page (DOIs and PubMed IDs) and validates them against CrossRef and OpenAlex, two of the largest public scholarly databases, plus the official doi.org resolver. Retraction status comes from CrossRef, which carries the Retraction Watch database. Results are cached locally for a day so the same reference is never looked up twice.

WHAT YOU SEE

A banner at the top of a retracted article, with a link to the notice.
An inline badge beside every reference in the bibliography.
A glass summary bar that counts the problems on the page; click a count to jump straight to the first flagged reference.
A side panel listing every citation and its status.
A DOI checker in the toolbar popup, for verifying any reference on demand.

BUILT TO BE FAIR

A conservative tool is the only kind worth trusting. A DOI that is registered but simply not indexed, such as a dataset, a thesis, or a piece of software, is labeled "Unverified" rather than fake. When a database is unreachable, Citicious says nothing at all rather than guessing. It will never call a reference fake unless the DOI fails to resolve anywhere.

PRIVACY

All processing happens in your browser. Citicious sends only DOIs and PubMed IDs, and only to the public APIs it validates against. No accounts, no tracking, no analytics, no personal data, and nothing sent to any server of ours, because there is no server of ours.

Free, open source, and built by a researcher: https://github.com/choxos/citicious

### Category
Education

### Language
English

---

## Graphic assets (in `store-assets/`)

| Asset | File | Size |
|---|---|---|
| Store icon | `store-icon-128.png` | 128 x 128 |
| Screenshot 1 | `screenshot-1-retracted.png` | 1280 x 800 |
| Screenshot 2 | `screenshot-2-references.png` | 1280 x 800 |
| Screenshot 3 | `screenshot-3-panel-popup.png` | 1280 x 800 |
| Screenshot 4 | `screenshot-4-status-key.png` | 1280 x 800 |
| Small promo tile | `promo-tile-440x280.png` | 440 x 280 |

Upload the screenshots in that order; the first one is the hero image shown in search results. Every screenshot was captured from the extension running on real published articles.

---

## Privacy tab

### Single purpose

Citicious has one purpose: to verify scientific citations. It reads the DOIs and PubMed IDs printed on a scholarly page, checks them against public academic databases, and shows whether each cited work has been retracted, corrected, or cannot be found.

### Permission justifications

**sidePanel**
Used to display the side panel that lists every citation found on the current page along with its verification status.

**storage**
Used to cache validation results locally with a 24-hour expiry, so the same DOI is not re-queried from the public APIs on every page load. The cache holds DOIs and PubMed IDs, their public validation results, any metadata comparison outcome, and, when a reference title was read from the page for comparison, that publicly visible title. No personal data is stored.

**Host permissions (api.crossref.org, api.openalex.org, doi.org)**
Network access is limited to exactly these three public APIs. CrossRef and OpenAlex provide the scholarly metadata and retraction status; doi.org confirms whether a DOI is registered at all, which is what prevents a real but unindexed DOI from being called fake. The extension contacts no other server.

**Content script on all HTTPS sites (https://*/*)**
Scholarly articles are published across thousands of publisher, repository, and preprint domains, so the citation scanner cannot be limited to a fixed list of sites without missing most of the literature. The script activates only on pages that look academic (a known scholarly domain, a DOI in the URL, or scholarly citation meta tags) and reads only citation identifiers and reference titles. It transmits nothing beyond the identifiers, and only to the three public APIs above.

### Remote code
No, I am not using remote code. All code is bundled in the package. The extension fetches JSON data from public APIs; it never loads or executes remote scripts.

### Data usage

Check exactly one category: **Website content** (the citation identifiers and reference titles read from the pages you visit).

Do not check: personally identifiable information, health information, financial information, authentication information, personal communications, location, web history, or user activity.

Certify all three statements:
- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL
https://github.com/choxos/citicious/blob/main/PRIVACY_POLICY.md

---

## Notes for the reviewer (optional field)

The `storage` permission is actively used for a 24-hour local result cache; see `getCached` and `setCached` in `background/service-worker.js`. Network requests go only to the three declared API origins. The content script is declared broadly because academic articles are hosted on thousands of domains, but it gates itself at runtime to pages that carry scholarly signals, and it reads only citation identifiers. To see it work, open any retracted article, for example https://link.springer.com/article/10.1186/1471-2148-4-18, or paste the DOI 10.1016/S0140-6736(97)11096-0 into the popup's DOI checker.

---

## Pre-submission checklist

- [ ] Description replaced with the version above; no list of site names anywhere in the metadata
- [ ] Category set to Education, language English
- [ ] Four screenshots and the promo tile uploaded from `store-assets/`
- [ ] Single purpose, four permission justifications, and the privacy policy URL filled in
- [ ] Remote code: No
- [ ] Data usage: Website content only, three certifications checked
- [ ] Package uploaded: `extension/citicious-extension-v0.1.0.zip` (build it with `npm run package` in `extension/`)
