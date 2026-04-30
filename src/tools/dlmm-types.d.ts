// Type definitions for DLMM SDK (missing TypeScript types)

export interface DLMMInstance {
  lbPair: {
    pubkey: string;
    parameters?: {
      binStep: number;
      baseFactor?: number;
    };
  };
  tokenX: { mint: string; decimals: number };
  tokenY: { mint: string; decimals: number };
  [key: string]: any;
}

export type StrategyType = any; // From DLMM SDK

export interface BinArrayData {
  bins: Array<{ price: string; [key: string]: any }>;
  [key: string]: any;
}

export type GetBinIdFromPrice = (price: number, binStep: number, roundUp: boolean) => number;
export type GetPriceOfBinByBinId = (binId: number, binStep: number) => { toString(): string };
export type GetBinArrayKeysCoverage = (minBinId: number, maxBinId: number) => any;
export type GetBinArrayIndexesCoverage = (minBinId: number, maxBinId: number) => any;
export type DeriveBinArrayBitmapExtension = (pool: any, minBinId: number, maxBinId: number) => any;
export type IsOverflowDefaultBinArrayBitmap = (pool: any) => boolean;
