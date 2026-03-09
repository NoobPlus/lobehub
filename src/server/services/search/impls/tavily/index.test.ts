// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TavilyImpl } from './index';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockTavilyResponse = {
  query: 'test',
  response_time: 0.5,
  results: [
    {
      content: 'This is test content',
      score: 0.9,
      title: 'Test Title',
      url: 'https://example.com/page',
    },
    {
      content: 'Another result',
      score: 0.7,
      title: 'Another Title',
      url: 'https://another.com/page',
    },
  ],
};

describe('TavilyImpl', () => {
  let impl: TavilyImpl;

  beforeEach(() => {
    impl = new TavilyImpl();
    vi.clearAllMocks();
    process.env.TAVILY_API_KEY = 'test-api-key';
    delete process.env.TAVILY_SEARCH_DEPTH;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_SEARCH_DEPTH;
  });

  describe('query', () => {
    it('should return mapped results on successful response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockTavilyResponse),
        ok: true,
      });

      const result = await impl.query('test');

      expect(result.query).toBe('test');
      expect(result.resultNumbers).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        category: 'general',
        content: 'This is test content',
        engines: ['tavily'],
        parsedUrl: 'example.com',
        score: 0.9,
        title: 'Test Title',
        url: 'https://example.com/page',
      });
    });

    it('should use Bearer token authorization header', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer test-api-key');
    });

    it('should use empty authorization when no API key', async () => {
      delete process.env.TAVILY_API_KEY;
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('');
    });

    it('should use TAVILY_SEARCH_DEPTH env var when set', async () => {
      process.env.TAVILY_SEARCH_DEPTH = 'advanced';
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.search_depth).toBe('advanced');
    });

    it('should default to basic search_depth', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.search_depth).toBe('basic');
    });

    it('should pass time_range when searchTimeRange is not "anytime"', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'day' });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.time_range).toBe('day');
    });

    it('should not pass time_range when searchTimeRange is "anytime"', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test', { searchTimeRange: 'anytime' });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.time_range).toBeUndefined();
    });

    it('should set topic from searchCategories for news', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test', { searchCategories: ['news'] });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.topic).toBe('news');
    });

    it('should set topic from searchCategories for general', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      await impl.query('test', { searchCategories: ['general'] });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.topic).toBe('general');
    });

    it('should return category from body.topic or default to "general"', async () => {
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            ...mockTavilyResponse,
            results: [{ content: 'c', score: 1, title: 't', url: 'https://a.com' }],
          }),
        ok: true,
      });

      const result = await impl.query('test', { searchCategories: ['news'] });

      expect(result.results[0].category).toBe('news');
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Failed to connect to Tavily.',
      });
    });

    it('should throw TRPCError SERVICE_UNAVAILABLE on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      });

      await expect(impl.query('test')).rejects.toThrow(TRPCError);
      await expect(impl.query('test')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Tavily request failed: Unauthorized',
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
        message: 'Failed to parse Tavily response.',
      });
    });

    it('should handle empty results array', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      const result = await impl.query('test');

      expect(result.results).toHaveLength(0);
      expect(result.resultNumbers).toBe(0);
    });

    it('should handle missing score with default 0', async () => {
      mockFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            ...mockTavilyResponse,
            results: [{ title: 'T', url: 'https://x.com' }],
          }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(result.results[0].score).toBe(0);
    });

    it('should include costTime in response', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ...mockTavilyResponse, results: [] }),
        ok: true,
      });

      const result = await impl.query('test');
      expect(typeof result.costTime).toBe('number');
      expect(result.costTime).toBeGreaterThanOrEqual(0);
    });
  });
});
