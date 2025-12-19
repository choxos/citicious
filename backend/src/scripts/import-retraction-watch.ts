import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

interface RawRetraction {
  'Record ID': string;
  Title: string;
  Subject: string;
  Institution: string;
  Journal: string;
  Publisher: string;
  Country: string;
  Author: string;
  URLS: string;
  ArticleType: string;
  RetractionDate: string;
  RetractionDOI: string;
  RetractionPubMedID: string;
  OriginalPaperDate: string;
  OriginalPaperDOI: string;
  OriginalPaperPubMedID: string;
  RetractionNature: string;
  Reason: string;
  Paywalled: string;
  Notes: string;
}

/**
 * Parse semicolon-separated field into array
 */
function parseArrayField(field: string | undefined): string[] {
  if (!field) return [];
  return field
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse date field (MM/DD/YYYY format)
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr || dateStr === '0') return null;

  // Handle format: "10/24/2025 0:00" or "10/24/2025"
  const cleanDate = dateStr.split(' ')[0];
  const parts = cleanDate.split('/');

  if (parts.length !== 3) return null;

  const [month, day, year] = parts.map(Number);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;

  return new Date(year, month - 1, day);
}

/**
 * Normalize DOI field
 */
function normalizeDoi(doi: string | undefined): string | null {
  if (!doi || doi === '0' || doi.toLowerCase() === 'unavailable') return null;
  return doi.toLowerCase().trim();
}

/**
 * Normalize PubMed ID field
 */
function normalizePmid(pmid: string | undefined): string | null {
  if (!pmid || pmid === '0') return null;
  return pmid.trim();
}

async function importRetractionWatch(filePath: string) {
  console.log(`Starting import from: ${filePath}`);

  const parser = createReadStream(filePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    })
  );

  let batch: any[] = [];
  const BATCH_SIZE = 500;
  let totalProcessed = 0;
  let totalInserted = 0;

  for await (const record of parser as AsyncIterable<RawRetraction>) {
    const retraction = {
      recordId: parseInt(record['Record ID']),
      title: record.Title || null,
      subject: parseArrayField(record.Subject),
      institution: parseArrayField(record.Institution),
      journal: record.Journal || null,
      publisher: record.Publisher || null,
      country: record.Country || null,
      authors: parseArrayField(record.Author),
      urls: parseArrayField(record.URLS),
      articleType: record.ArticleType || null,
      retractionDate: parseDate(record.RetractionDate),
      retractionDoi: normalizeDoi(record.RetractionDOI),
      retractionPubmedId: normalizePmid(record.RetractionPubMedID),
      originalPaperDate: parseDate(record.OriginalPaperDate),
      originalPaperDoi: normalizeDoi(record.OriginalPaperDOI),
      originalPaperPubmedId: normalizePmid(record.OriginalPaperPubMedID),
      retractionNature: record.RetractionNature || null,
      reason: parseArrayField(record.Reason),
      paywalled: record.Paywalled?.toLowerCase() === 'yes',
      notes: record.Notes || null,
    };

    batch.push(retraction);
    totalProcessed++;

    if (batch.length >= BATCH_SIZE) {
      try {
        const result = await prisma.retraction.createMany({
          data: batch,
          skipDuplicates: true,
        });
        totalInserted += result.count;
        console.log(
          `Processed ${totalProcessed} records, inserted ${totalInserted}...`
        );
      } catch (error) {
        console.error(`Error inserting batch at record ${totalProcessed}:`, error);
      }
      batch = [];
    }
  }

  // Insert remaining records
  if (batch.length > 0) {
    try {
      const result = await prisma.retraction.createMany({
        data: batch,
        skipDuplicates: true,
      });
      totalInserted += result.count;
    } catch (error) {
      console.error('Error inserting final batch:', error);
    }
  }

  console.log(`\nImport complete!`);
  console.log(`Total records processed: ${totalProcessed}`);
  console.log(`Total records inserted: ${totalInserted}`);

  // Print stats
  const stats = await prisma.retraction.aggregate({
    _count: true,
  });

  const withDoi = await prisma.retraction.count({
    where: { originalPaperDoi: { not: null } },
  });

  const withPmid = await prisma.retraction.count({
    where: { originalPaperPubmedId: { not: null } },
  });

  console.log(`\nDatabase stats:`);
  console.log(`Total retractions: ${stats._count}`);
  console.log(`With DOI: ${withDoi} (${((withDoi / stats._count) * 100).toFixed(1)}%)`);
  console.log(`With PMID: ${withPmid} (${((withPmid / stats._count) * 100).toFixed(1)}%)`);
}

// Run import
const csvPath = process.argv[2] || '../retraction_watch.csv';
importRetractionWatch(csvPath)
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
