# Citicious

> Detect retracted articles and fake/hallucinated citations in scientific papers

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Citicious is a Chrome extension that helps researchers and readers identify:

- **Retracted articles** - Papers that have been formally retracted by journals
- **Retracted citations** - References in a paper that cite retracted articles
- **Fake citations** - Potentially hallucinated citations (e.g., from LLM-generated content)

## Features

- **Top Banner Alert** - Prominent warning when viewing a retracted article
- **Inline Badges** - Visual indicators next to each reference
- **Sidebar Panel** - Detailed information about all citations on the page
- **Manual DOI Check** - Check any DOI directly from the popup
- **Works Everywhere** - Supports PubMed, Google Scholar, ScienceDirect, Nature, arXiv, and many more

## How It Works

1. **Retraction Detection**: Uses the [Retraction Watch Database](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) via CrossRef API (68,000+ retracted articles)
2. **Citation Validation**: Verifies citations against CrossRef and OpenAlex APIs
3. **Fake Detection**: Identifies potentially hallucinated citations by checking if DOIs exist and comparing metadata (authors, year, title, journal)

## Screenshot

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️ This article has been RETRACTED                          │
│ Retraction · Retracted: Jan 15, 2024 · Reason: Plagiarism   │
│ View retraction notice →                                     │
└──────────────────────────────────────────────────────────────┘
```

## Installation

### From Source (Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/choxos/citicious.git
   cd citicious
   ```

2. Install dependencies and build the extension:
   ```bash
   cd extension
   npm install
   npm run build
   ```

3. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder

### Backend Setup (Optional)

The extension can use a local backend for enhanced performance:

1. Set up PostgreSQL database
2. Install backend dependencies:
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. Initialize database and import Retraction Watch data:
   ```bash
   npm run db:push
   npm run import:retractions ../retraction_watch.csv
   ```

4. Start the server:
   ```bash
   npm run dev
   ```

## Citation Status Types

| Status | Badge | Description |
|--------|-------|-------------|
| Retracted | ⚠️ RETRACTED | Article has been formally retracted |
| Fake | ❌ FAKE | Citation could not be verified in databases |
| Suspicious | ❓ SUSPICIOUS | Metadata discrepancies found |
| Verified | ✓ Verified | Citation confirmed valid |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/check/retraction` | POST | Check if DOI/PMID is retracted |
| `/api/v1/check/citation` | POST | Validate citation exists & metadata |
| `/api/v1/check/full` | POST | Combined retraction + validation check |
| `/api/v1/check/batch` | POST | Batch check multiple citations |
| `/api/v1/health` | GET | Health check |
| `/api/v1/stats` | GET | Database statistics |

## Tech Stack

- **Extension**: Chrome Manifest V3, TypeScript, Webpack
- **Backend**: Node.js, Fastify, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **External APIs**: CrossRef, OpenAlex

## Data Sources

- [Retraction Watch Database](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) - 68,000+ retracted articles, updated daily
- [CrossRef API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) - DOI metadata and retraction notices
- [OpenAlex API](https://docs.openalex.org/) - Open catalog of scholarly works

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**Ahmad Sofi-Mahmudi**

- GitHub: [@choxos](https://github.com/choxos)
- LinkedIn: [asofimahmudi](https://www.linkedin.com/in/asofimahmudi/)
- X/Twitter: [@ASofiMahmudi](https://x.com/ASofiMahmudi)

## Acknowledgments

- [Crossref](https://www.crossref.org/) for the Retraction Watch Database API
- [OpenAlex](https://openalex.org/) for the open scholarly metadata API
- [Retraction Watch](https://retractionwatch.com/) for their invaluable work in tracking retractions
