import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/core/config/config.js', () => ({
  config: {
    screening: { minFeeActiveTvlRatio: 0.05, minTvl: 10000, maxTvl: 150000 },
    api: { publicApiKey: 'test-key' },
    indicators: { enabled: false },
  },
}));

vi.mock('../src/core/logger/logger.js', () => ({
  log: vi.fn(),
}));

describe('screening.ts', () => {
  it('should export discoverPools function', async () => {
    const { discoverPools } = await import('../src/tools/screening.js');
    expect(typeof discoverPools).toBe('function');
  });

  it('should export getTopCandidates function', async () => {
    const { getTopCandidates } = await import('../src/tools/screening.js');
    expect(typeof getTopCandidates).toBe('function');
  });

  it('should export getPoolDetail function', async () => {
    const { getPoolDetail } = await import('../src/tools/screening.js');
    expect(typeof getPoolDetail).toBe('function');
  });
});
