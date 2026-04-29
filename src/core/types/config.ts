export interface ScreeningConfig {
  excludeHighSupplyConcentration: boolean;
  minFeeActiveTvlRatio: number;
  minTvl: number;
  maxTvl: number;
  minVolume: number;
  minOrganic: number;
  minQuoteOrganic: number;
  minHolders: number;
  minMcap: number;
  maxMcap: number;
  minBinStep: number;
  maxBinStep: number;
  timeframe: string;
  category: string;
  minTokenFeesSol: number;
  useDiscordSignals: boolean;
  discordSignalMode: "merge" | "only";
  avoidPvpSymbols: boolean;
  blockPvpSymbols: boolean;
  maxBundlePct: number;
  maxBotHoldersPct: number;
  maxTop10Pct: number;
  allowedLaunchpads: string[];
  blockedLaunchpads: string[];
  minTokenAgeHours: number | null;
  maxTokenAgeHours: number | null;
  athFilterPct: number | null;
  maxVolatility: number;
}

export interface ManagementConfig {
  minClaimAmount: number;
  autoSwapAfterClaim: boolean;
  outOfRangeBinsToClose: number;
  outOfRangeWaitMinutes: number;
  oorCooldownTriggerCount: number;
  oorCooldownHours: number;
  repeatDeployCooldownEnabled: boolean;
  repeatDeployCooldownTriggerCount: number;
  repeatDeployCooldownHours: number;
  repeatDeployCooldownScope: "pool" | "token" | "both";
  repeatDeployCooldownMinFeeEarnedPct: number;
  minVolumeToRebalance: number;
  stopLossPct: number;
  takeProfitPct: number;
  minFeePerTvl24h: number;
  minAgeBeforeYieldCheck: number;
  minSolToOpen: number;
  deployAmountSol: number;
  gasReserve: number;
  positionSizePct: number;
  trailingTakeProfit: boolean;
  trailingTriggerPct: number;
  trailingDropPct: number;
  pnlSanityMaxDiffPct: number;
  solMode: boolean;
}

export interface StrategyConfig {
  strategy: "spot" | "curve" | "bid_ask";
  binsBelow: number;
}

export interface ScheduleConfig {
  managementIntervalMin: number;
  screeningIntervalMin: number;
  healthCheckIntervalMin: number;
}

export interface LlmConfig {
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  managementModel: string;
  screeningModel: string;
  generalModel: string;
}

export interface DarwinConfig {
  enabled: boolean;
  windowDays: number;
  recalcEvery: number;
  boostFactor: number;
  decayFactor: number;
  weightFloor: number;
  weightCeiling: number;
  minSamples: number;
}

export interface TokenConfig {
  SOL: string;
  USDC: string;
  USDT: string;
}

export interface HiveMindConfig {
  url: string | null;
  apiKey: string | null;
  agentId: string | null;
  pullMode: string;
}

export interface ApiConfig {
  url: string | null;
  publicApiKey: string | null;
  lpAgentRelayEnabled: boolean;
}

export interface JupiterConfig {
  apiKey: string;
  referralAccount: string;
  referralFeeBps: number;
}

export interface IndicatorsConfig {
  enabled: boolean;
  entryPreset: string;
  exitPreset: string;
  rsiLength: number;
  intervals: string[];
  candles: number;
  rsiOversold: number;
  rsiOverbought: number;
  requireAllIntervals: boolean;
}

export interface Config {
  risk: {
    maxPositions: number;
    maxDeployAmount: number;
  };
  screening: ScreeningConfig;
  management: ManagementConfig;
  strategy: StrategyConfig;
  schedule: ScheduleConfig;
  llm: LlmConfig;
  darwin: DarwinConfig;
  tokens: TokenConfig;
  hiveMind: HiveMindConfig;
  api: ApiConfig;
  jupiter: JupiterConfig;
  indicators: IndicatorsConfig;
}

export interface UserConfig {
  maxPositions?: number;
  maxDeployAmount?: number;
  minFeeActiveTvlRatio?: number;
  minTvl?: number;
  maxTvl?: number;
  minVolume?: number;
  minOrganic?: number;
  minQuoteOrganic?: number;
  minHolders?: number;
  minMcap?: number;
  maxMcap?: number;
  minBinStep?: number;
  maxBinStep?: number;
  timeframe?: string;
  category?: string;
  minTokenFeesSol?: number;
  useDiscordSignals?: boolean;
  discordSignalMode?: "merge" | "only";
  avoidPvpSymbols?: boolean;
  blockPvpSymbols?: boolean;
  maxBundlePct?: number;
  maxBotHoldersPct?: number;
  maxTop10Pct?: number;
  allowedLaunchpads?: string[];
  blockedLaunchpads?: string[];
  minTokenAgeHours?: number | null;
  maxTokenAgeHours?: number | null;
  athFilterPct?: number | null;
  maxVolatility?: number;
  minClaimAmount?: number;
  autoSwapAfterClaim?: boolean;
  outOfRangeBinsToClose?: number;
  outOfRangeWaitMinutes?: number;
  oorCooldownTriggerCount?: number;
  oorCooldownHours?: number;
  repeatDeployCooldownEnabled?: boolean;
  repeatDeployCooldownTriggerCount?: number;
  repeatDeployCooldownHours?: number;
  repeatDeployCooldownScope?: "pool" | "token" | "both";
  repeatDeployCooldownMinFeeEarnedPct?: number;
  repeatDeployCooldownMinFeeYieldPct?: number;
  minVolumeToRebalance?: number;
  stopLossPct?: number;
  emergencyPriceDropPct?: number;
  takeProfitPct?: number;
  takeProfitFeePct?: number;
  minFeePerTvl24h?: number;
  minAgeBeforeYieldCheck?: number;
  minSolToOpen?: number;
  deployAmountSol?: number;
  gasReserve?: number;
  positionSizePct?: number;
  trailingTakeProfit?: boolean;
  trailingTriggerPct?: number;
  trailingDropPct?: number;
  pnlSanityMaxDiffPct?: number;
  solMode?: boolean;
  managementIntervalMin?: number;
  screeningIntervalMin?: number;
  healthCheckIntervalMin?: number;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  managementModel?: string;
  screeningModel?: string;
  generalModel?: string;
  darwinEnabled?: boolean;
  darwinWindowDays?: number;
  darwinRecalcEvery?: number;
  darwinBoost?: number;
  darwinDecay?: number;
  darwinFloor?: number;
  darwinCeiling?: number;
  darwinMinSamples?: number;
  rpcUrl?: string;
  walletKey?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  dryRun?: boolean;
  publicApiKey?: string;
  agentMeridianApiUrl?: string;
  excludeHighSupplyConcentration?: boolean;
  strategy?: "spot" | "curve" | "bid_ask";
  binsBelow?: number;
  hiveMindUrl?: string;
  hiveMindApiKey?: string;
  hiveMindPullMode?: string;
  agentId?: string | null;
  lpAgentRelayEnabled?: boolean;
  chartIndicators?: {
    enabled?: boolean;
    entryPreset?: string;
    exitPreset?: string;
    rsiLength?: number;
    intervals?: string[];
    candles?: number;
    rsiOversold?: number;
    rsiOverbought?: number;
    requireAllIntervals?: boolean;
  };
}
