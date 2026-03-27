# Chrome Web Store Submission Details

## Extension Name
Citicious

## Short Description (132 characters max)
Detect retracted scientific articles and potentially fake citations by validating DOIs against CrossRef and OpenAlex databases.

## Detailed Description
Citicious helps researchers, reviewers, and readers verify the integrity of scientific citations.

When you visit a page containing academic references, Citicious automatically extracts DOIs and validates them against CrossRef and OpenAlex, two of the largest public scholarly metadata databases.

What it detects:
- Retracted articles: Papers that have been formally retracted by their journal, using retraction metadata from CrossRef (powered by the Retraction Watch Database)
- Fake or hallucinated citations: DOIs that do not exist in any academic database, which may indicate AI-generated or fabricated references
- Metadata mismatches: Citations where the listed authors, title, year, or journal do not match the actual publication record

How it works:
- A top banner warns you if the article you are currently reading has been retracted
- Inline badges appear next to each reference in the bibliography, showing its verification status
- A sidebar panel provides a detailed summary of all citations on the page
- A manual DOI checker in the popup lets you verify any DOI on demand

All processing happens locally in your browser. DOIs are sent only to public academic APIs (CrossRef and OpenAlex) for verification. No personal data is collected, stored, or shared.

Open source: https://github.com/choxos/citicious

## Category
Productivity

## Language
English

## Single Purpose Description (required by Chrome Web Store)
This extension validates scientific citations by checking DOIs against public academic databases to detect retracted or non-existent references.

## Permission Justifications

### sidePanel
Used to display a detailed sidebar panel showing the verification status of all citations found on the current page.

### Host Permissions (<all_urls>)
Required for two reasons:
1. The content script needs to run on any webpage that may contain scientific citations, since academic content appears across many different domains.
2. The extension queries public academic APIs (api.crossref.org, api.openalex.org) to validate DOIs.

## Privacy Policy URL
https://github.com/choxos/citicious/blob/main/PRIVACY_POLICY.md
