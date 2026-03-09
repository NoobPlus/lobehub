// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExaImpl } from './index';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockExaResponse = {
  results: [
    {
      score: 0.85,
      text: 'This is test content',
      title: 'Test Title',
      url: 'https://example.com/page',
    },
    {
      score: 0.7,
      text: 'Another result',
      title: 'Another Title',
      url: 'https://another.com/page',
    },
  ],
};

describe('ExaImpl', () => {
  let impl: ExaImpl;

  beforeEach(() => {
    impl = new ExaImpl();
    vi.clearAllMocks();
    process.env.EXA_API_KEY = 'test-exa-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EXA_API_KEY;
  });

  describe('query', () => {
    it('should return mapped results on successful response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockExaResponse),
        ok: true,
      });

      const result = await impl.query('test');

      expect(result.query).toBe('test');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'This is test content',
        engines: ['exa'],
        parsedUrl: 'example.com',
        score: 0.85,
        title: 'Test Title',
        url: 'https://example.com/page',
      });
    });

    it('should use x-api-key header for authorization', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['x-api-key']).toBe('test-exa-key');
    });

    it('should use empty api key when EXA_API_KEY not set', async () => {
      delete process.env.EXA_API_KEY;
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['x-api-key']).toBe('');
    });

    it('should include date range for "day" searchTimeRange', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      const before = Date.now();
      await impl.query('test', { searchTimeRange: 'day' });
      const after = Date.now();

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.startPublishedDate).toBeDefined();
      expect(body.endPublishedDate).toBeDefined();

      const start = new Date(body.startPublishedDate).getTime();
      const end = new Date(body.endPublishedDate).getTime();
      expect(end - start).toBeCloseTo(1 * 86_400 * 1000, -3); // ~1 day
    });

    it('should include date range for "week" searchTimeRange', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'week' });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.startPublishedDate).toBeDefined();
      expect(body.endPublishedDate).toBeDefined();

      const diff =
        new Date(body.endPublishedDate).getTime() - new Date(body.startPublishedDate).getTime();
      expect(diff).toBeCloseTo(7 * 86_400 * 1000, -3);
    });

    it('should not include date range for "anytime" searchTimeRange', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'anytime' });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.startPublishedDate).toBeUndefined();
      expect(body.endPublishedDate).toBeUndefined();
    });

    it('should set category to news for news searchCategory', async () => {
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            results: [{ text: 'c', title: 't', url: 'https://x.com' }],
          }),
        ok: true,
      });

      const result = await impl.query('test', { searchCategories: ['news'] });

      expect(result.results[0].category).toBe('news');
    });

    it('should default category to "general" when not news', async () => {
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            results: [{ text: 'c', title: 't', url: 'https://x.com' }],
          }),
        ok: true,
      });

      const result = await impl.query('test', { searchCategories: ['general'] });

      expect(result.results[0].category).toBe('general');
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Exa.',
      });
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Access denied'),
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Exa request failed: Forbidden',
      });
    });

    it('should throw TRPCError INTERNAL_SERVER_ERROR on parse error', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.reject(new Error('Malformed JSON')),
        ok: true,
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Exa response.',
      });
    });

    it('should handle missing score with default 0', async () => {
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            results: [{ text: 'content', title: 'Title', url: 'https://x.com' }],
          }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(result.results[0].score).toBe(0);
    });

    it('should handle empty results array', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(result.results).toHaveLength(0);
      expect(result.resultNumbers).toBe(0);
    });

    it('should use POST method with JSON body', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ results: [] }),
        ok: true,
      });

      await impl.query('hello world');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.query).toBe('hello world');
    });
  });
});
