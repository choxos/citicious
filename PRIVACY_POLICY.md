# Privacy Policy for Citicious

**Last updated:** May 21, 2026

## Overview

Citicious is a browser extension that helps users identify retracted scientific articles and fake/hallucinated citations. This privacy policy explains what data the extension accesses and how it is used.

## Data Collection

### What We Access

Citicious accesses the following data from webpages you visit:

- **DOIs (Digital Object Identifiers)**: Unique identifiers for scientific publications found in page text and links
- **PubMed IDs**: Identifiers for articles in the PubMed database
- **Citation metadata**: Title, authors, journal name, and publication year when available in the page content

### What We DO NOT Collect

- Personal information (name, email, address)
- Browsing history
- Passwords or authentication data
- Financial information
- Location data
- Cookies or tracking identifiers

## Data Usage

### How Data Is Processed

1. DOIs and citation identifiers are extracted from the current webpage
2. These identifiers are sent to public academic APIs (CrossRef, OpenAlex) to verify they exist
3. If a DOI is not found in those databases, the identifier is checked against the public DOI resolver (doi.org) to confirm whether it is a registered DOI before any "fake" determination is made
4. Results are cached locally in your browser to avoid re-querying the same identifiers
5. No data is sent to our servers - all API calls go directly to public databases

### Third-Party Services

Citicious makes requests to the following public APIs:

- **CrossRef API** (api.crossref.org) - To verify DOI existence and retrieve metadata, including retraction notices
- **OpenAlex API** (api.openalex.org) - As a fallback for DOI verification, for PubMed ID lookups, and for the retraction flag
- **DOI Resolver** (doi.org) - To confirm whether a DOI is registered with any registration agency before flagging it as fake

These services have their own privacy policies. We only send DOI or PubMed ID strings to these services - no personal or identifying information.

## Data Storage

- Citation validation results are cached locally on your device using the browser's extension storage (`chrome.storage.local`)
- Each cached entry expires automatically after 24 hours and is then removed
- The cache contains only DOIs/PubMed IDs and their public validation results - no personal data
- No data is stored on external servers
- You can clear cached data at any time by removing the extension

## Data Sharing

We do not:
- Sell or transfer user data to third parties
- Use data for advertising or marketing purposes
- Share data with any external parties beyond the public APIs mentioned above
- Use data to determine creditworthiness or for lending purposes

## Permissions Explained

- **sidePanel**: Displays a summary of citation validation results in a sidebar
- **storage**: Caches DOI/PubMed ID validation results locally (with a 24-hour expiry) so the same identifiers are not re-queried on every visit
- **Host permissions (<all_urls>)**: Needed to run on any webpage containing scientific citations and to query public APIs (CrossRef, OpenAlex, and the doi.org resolver)

## Your Rights

You can:
- Disable the extension at any time
- Uninstall the extension to remove all locally cached data
- Use browser privacy settings to control extension behavior

## Children's Privacy

This extension does not knowingly collect any personal information from children under 13 years of age.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last updated" date at the top of this document.

## Contact

For questions about this privacy policy or the extension, please open an issue at:
https://github.com/choxos/citicious/issues

## Open Source

Citicious is open source software. You can review the complete source code at:
https://github.com/choxos/citicious
