import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { citationRoutes } from '../dist/routes/citation.routes.js';
import { CitationValidatorService } from '../dist/services/citation-validator.service.js';
import {
  RetractionService,
  retractionService,
} from '../dist/services/retraction.service.js';

function crossrefResponse(updates) {
  return new Response(JSON.stringify({
    message: {
      title: ['Reviewed article'],
      'container-title': ['Test Journal'],
      publisher: 'Test Publisher',
      author: [{ given: 'Ada', family: 'Lovelace' }],
      created: { 'date-time': '2020-01-01T00:00:00Z' },
      'updated-by': updates,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function update(type, date, doi = `10.1234/${type}`) {
  return { type, DOI: doi, updated: { 'date-time': date } };
}

function openalexResponse({ doi = '10.1234/article', isRetracted = false } = {}) {
  return new Response(JSON.stringify({
    doi: doi ? `https://doi.org/${doi}` : null,
    title: 'Reviewed article',
    authorships: [{ author: { display_name: 'Ada Lovelace' } }],
    publication_year: 2020,
    primary_location: { source: { display_name: 'Test Journal' } },
    id: 'https://openalex.org/W123',
    is_retracted: isRetracted,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('automated-review citation states stay distinct and order-independent', async (t) => {
  const originalFetch = globalThis.fetch;
  const retractions = new RetractionService();
  const validator = new CitationValidatorService();

  try {
    await t.test('selects retraction severity independent of Crossref array order', async () => {
      const concern = update('expression-of-concern', '2024-01-01T00:00:00Z');
      const retraction = update('retraction', '2023-01-01T00:00:00Z');

      globalThis.fetch = async () => crossrefResponse([concern, retraction]);
      const concernFirst = await retractions.checkViaCrossRefApi('10.1234/article');
      globalThis.fetch = async () => crossrefResponse([retraction, concern]);
      const retractionFirst = await retractions.checkViaCrossRefApi('10.1234/article');

      assert.equal(concernFirst.status, 'retracted');
      assert.equal(concernFirst.details?.retractionNature, 'Retraction');
      assert.deepEqual(concernFirst, retractionFirst);
    });

    await t.test('does not resurrect a reinstated paper from stale local history', async () => {
      globalThis.fetch = async () => crossrefResponse([
        update('retraction', '2023-01-01T00:00:00Z'),
        update('reinstatement', '2024-01-01T00:00:00Z'),
      ]);
      const originalLocalCheck = retractions.checkByDoiLocal;
      let localChecked = false;
      retractions.checkByDoiLocal = async () => {
        localChecked = true;
        return { isRetracted: true, status: 'retracted' };
      };

      try {
        const result = await retractions.checkByDoi('10.1234/article');
        assert.equal(result.status, undefined);
        assert.equal(result.isRetracted, false);
        assert.equal(localChecked, false);

        const publicResult = await retractions.check('10.1234/article');
        assert.deepEqual(publicResult, { isRetracted: false });

        globalThis.fetch = async () => crossrefResponse([]);
        const noCrossrefSignal = await retractions.checkByDoi('10.1234/article');
        assert.equal(noCrossrefSignal.status, 'retracted');
        assert.equal(localChecked, true);
      } finally {
        retractions.checkByDoiLocal = originalLocalCheck;
      }
    });

    await t.test('lets confirmed local evidence override weaker Crossref states', async () => {
      globalThis.fetch = async () => crossrefResponse([
        update('expression-of-concern', '2024-01-01T00:00:00Z'),
      ]);
      const originalDoiCheck = retractions.checkByDoiLocal;
      const originalPmidCheck = retractions.checkByPmid;

      try {
        retractions.checkByDoiLocal = async () => ({
          isRetracted: true,
          status: 'retracted',
        });
        const doiResult = await retractions.checkByDoi('10.1234/article');
        assert.equal(doiResult.status, 'retracted');

        retractions.checkByDoiLocal = async () => ({ isRetracted: false });
        retractions.checkByPmid = async () => ({
          isRetracted: true,
          status: 'retracted',
        });
        const combinedResult = await retractions.check('10.1234/article', '12345678');
        assert.equal(combinedResult.status, 'retracted');
      } finally {
        retractions.checkByDoiLocal = originalDoiCheck;
        retractions.checkByPmid = originalPmidCheck;
      }
    });

    await t.test('preserves expression-of-concern status through the full route', async () => {
      globalThis.fetch = async () => crossrefResponse([
        update('expression-of-concern', '2024-01-01T00:00:00Z'),
      ]);
      const originalLocalCheck = retractionService.checkByDoiLocal;
      retractionService.checkByDoiLocal = async () => ({ isRetracted: false });
      const app = Fastify();
      await app.register(citationRoutes);

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/check/full',
          payload: { doi: '10.1234/article' },
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().status, 'concern');
        assert.equal(response.json().isRetracted, false);
      } finally {
        retractionService.checkByDoiLocal = originalLocalCheck;
        await app.close();
      }
    });

    await t.test('distinguishes a missing PMID from a transient lookup error', async () => {
      globalThis.fetch = async () => new Response(null, { status: 404 });
      const missing = await validator.validate({ pmid: '99999999' });
      globalThis.fetch = async () => new Response(null, { status: 503 });
      const unavailable = await validator.validate({ pmid: '99999999' });

      assert.equal(missing.status, 'unverified');
      assert.equal(missing.source, 'openalex');
      assert.equal(unavailable.status, 'skip');
    });

    await t.test('preserves retraction evidence discovered through a PMID', async () => {
      const originalPmidCheck = retractionService.checkByPmid;
      const originalDoiCheck = retractionService.checkByDoi;
      const app = Fastify();
      await app.register(citationRoutes);

      try {
        retractionService.checkByPmid = async () => ({ isRetracted: false });
        retractionService.checkByDoi = async () => ({ isRetracted: false });
        globalThis.fetch = async () => openalexResponse({ doi: '', isRetracted: true });

        const openalexFlag = await app.inject({
          method: 'POST',
          url: '/check/full',
          payload: { pmid: '12345678' },
        });
        assert.equal(openalexFlag.statusCode, 200);
        assert.equal(openalexFlag.json().status, 'retracted');
        assert.equal(openalexFlag.json().isRetracted, true);

        retractionService.checkByDoi = async (doi) => {
          assert.equal(doi, '10.1234/article');
          return { isRetracted: true, status: 'retracted' };
        };
        globalThis.fetch = async () => openalexResponse();

        const linkedDoi = await app.inject({
          method: 'POST',
          url: '/check/full',
          payload: { pmid: '12345678' },
        });
        assert.equal(linkedDoi.statusCode, 200);
        assert.equal(linkedDoi.json().status, 'retracted');
        assert.equal(linkedDoi.json().isRetracted, true);
      } finally {
        retractionService.checkByPmid = originalPmidCheck;
        retractionService.checkByDoi = originalDoiCheck;
        await app.close();
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
