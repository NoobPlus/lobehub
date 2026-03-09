// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleImpl } from './index';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGoogleResponse = {
  items: [
    {
      link: 'https://example.com/page',
      snippet: 'This is test content',
      title: 'Test Title',
    },
    {
      link: 'https://another.com/page',
      snippet: 'Another result',
      title: 'Another Title',
    },
  ],
  kind: 'customsearch#search',
};

describe('GoogleImpl', () => {
  let impl: GoogleImpl;

  beforeEach(() => {
    impl = new GoogleImpl();
    vi.clearAllMocks();
    process.env.GOOGLE_PSE_API_KEY = 'test-google-key';
    process.env.GOOGLE_PSE_ENGINE_ID = 'test-engine-id';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_PSE_API_KEY;
    delete process.env.GOOGLE_PSE_ENGINE_ID;
  });

  describe('query', () => {
    it('should return mapped results on successful response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockGoogleResponse),
        ok: true,
      });

      const result = await impl.query('test');

      expect(result.query).toBe('test');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'This is test content',
        engines: ['google'],
        parsedUrl: 'example.com',
        score: 1,
        title: 'Test Title',
        url: 'https://example.com/page',
      });
    });

    it('should use GET method with query parameters', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('hello world');

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('GET');
      expect(url).toContain('q=hello+world');
    });

    it('should include API key and engine ID in request', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('key=test-google-key');
      expect(url).toContain('cx=test-engine-id');
    });

    it('should use empty strings when env vars not set', async () => {
      delete process.env.GOOGLE_PSE_API_KEY;
      delete process.env.GOOGLE_PSE_ENGINE_ID;

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('key=');
      expect(url).toContain('cx=');
    });

    it('should map day searchTimeRange to "d1" dateRestrict', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'day' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('dateRestrict=d1');
    });

    it('should map week searchTimeRange to "w1" dateRestrict', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'week' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('dateRestrict=w1');
    });

    it('should map month searchTimeRange to "m1" dateRestrict', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'month' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('dateRestrict=m1');
    });

    it('should map year searchTimeRange to "y1" dateRestrict', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'year' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('dateRestrict=y1');
    });

    it('should not include dateRestrict when searchTimeRange is "anytime"', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'anytime' });

      const [url] = mockFetch.mock.calls[0];
      // When anytime, dateRestrict should not be set to a valid time range value
      expect(url).not.toContain('dateRestrict=d1');
      expect(url).not.toContain('dateRestrict=w1');
      expect(url).not.toContain('dateRestrict=m1');
      expect(url).not.toContain('dateRestrict=y1');
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on network error', async () => {
      mockFetch.mockRejectedValue(new Error('DNS lookup failed'));

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Google.',
      });
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Daily limit exceeded'),
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Google request failed: Forbidden',
      });
    });

    it('should throw TRPCError INTERNAL_SERVER_ERROR on parse error', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.reject(new Error('Invalid JSON')),
        ok: true,
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Google response.',
      });
    });

    it('should handle empty items array', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(result.results).toHaveLength(0);
      expect(result.resultNumbers).toBe(0);
    });

    it('should handle missing items with empty results', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({}),
        ok: true,
      });

      const result = await impl.query('test');
      expect(result.results).toHaveLength(0);
    });

    it('should include costTime in response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ items: [] }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });
  });
});
