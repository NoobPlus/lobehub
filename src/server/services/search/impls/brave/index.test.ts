// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BraveImpl } from './index';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockBraveResponse = {
  mixed: {},
  type: 'search',
  web: {
    results: [
      {
        description: 'This is test content',
        title: 'Test Title',
        type: 'SearchResult',
        url: 'https://example.com/page',
      },
      {
        description: 'Another result',
        title: 'Another Title',
        type: 'SearchResult',
        url: 'https://another.com/page',
      },
    ],
    type: 'search',
  },
};

describe('BraveImpl', () => {
  let impl: BraveImpl;

  beforeEach(() => {
    impl = new BraveImpl();
    vi.clearAllMocks();
    process.env.BRAVE_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BRAVE_API_KEY;
  });

  describe('query', () => {
    it('should return mapped results on successful response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockBraveResponse),
        ok: true,
      });

      const result = await impl.query('test');

      expect(result.query).toBe('test');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'This is test content',
        engines: ['brave'],
        parsedUrl: 'example.com',
        score: 1,
        title: 'Test Title',
        url: 'https://example.com/page',
      });
    });

    it('should use GET method with query parameters', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test query');

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('GET');
      expect(url).toContain('q=test+query');
    });

    it('should use X-Subscription-Token header with API key', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Subscription-Token']).toBe('test-api-key');
    });

    it('should use empty token when no API key', async () => {
      delete process.env.BRAVE_API_KEY;
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Subscription-Token']).toBe('');
    });

    it('should map day searchTimeRange to "pd" freshness', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'day' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('freshness=pd');
    });

    it('should map week searchTimeRange to "pw" freshness', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'week' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('freshness=pw');
    });

    it('should map month searchTimeRange to "pm" freshness', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'month' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('freshness=pm');
    });

    it('should map year searchTimeRange to "py" freshness', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'year' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('freshness=py');
    });

    it('should not include freshness when searchTimeRange is "anytime"', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'anytime' });

      const [url] = mockFetch.mock.calls[0];
      // When anytime, freshness should not be set to one of the valid time range values
      expect(url).not.toContain('freshness=pd');
      expect(url).not.toContain('freshness=pw');
      expect(url).not.toContain('freshness=pm');
      expect(url).not.toContain('freshness=py');
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Brave.',
      });
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Brave request failed: Too Many Requests',
      });
    });

    it('should throw TRPCError INTERNAL_SERVER_ERROR on parse error', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.reject(new Error('Bad JSON')),
        ok: true,
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to parse Brave response.',
      });
    });

    it('should handle empty web results', async () => {
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            ...mockBraveResponse,
            web: { results: [], type: 'search' },
          }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(result.results).toHaveLength(0);
      expect(result.resultNumbers).toBe(0);
    });

    it('should include costTime in response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockBraveResponse, web: { results: [], type: 'search' } }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });
  });
});
