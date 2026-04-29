import type { ToolDefinition } from "../core/types/tools";

/**
 * Tool definitions in OpenAI function-calling format.
 * These are passed to the LLM so it knows what tools are available.
 */
export const tools: ToolDefinition[] = [
  // ════════════════════════════════════════
  //  SCREENING TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "discover_pools",
      description: `Fetch top DLMM pools from the Meteora Pool Discovery API.
Pools are pre-filtered for safety:
- No critical warnings on base/quote tokens
- No high single ownership on base token
- Base token market cap >= $150k
- Base token holders >= 100
- Volume >= $1k (in timeframe)
- Active TVL >= $10k
- Fee/Active TVL ratio >= 0.01 (in timeframe)
- Both tokens organic score >= 60

Returns condensed pool data: address, name, tokens, bin_step, fee_pct,
active_tvl, fee_window, volume_window, fee_tvl_ratio, volatility, organic_score,
holders, mcap, active_positions, price_change_pct, warning count.

Use this as the primary tool for finding new LP opportunities.`,
      parameters: {
        type: "object",
        properties: {
          page_size: {
            type: "number",
            description: "Number of pools to return. Default 50. Use 10-20 for quick scans."
          },
          timeframe: {
            type: "string",
            enum: ["1h", "4h", "12h", "24h"],
            description: "Timeframe for metrics. Use 24h for general screening, 1h for momentum."
          },
          category: {
            type: "string",
            enum: ["top", "new", "trending"],
            description: "Pool category. 'top' = highest fee/TVL, 'new' = recently created, 'trending' = gaining activity."
          }
        }
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_top_candidates",
      description: `Get the top pre-scored pool candidates ready for deployment.
All filtering, scoring, and rule-checking is done in code — no analysis needed.
Returns the top N eligible pools ranked by score (fee/TVL, organic, stability, volume).
Each pool includes a score (0-100) and has already passed all hard disqualifiers.
Use this instead of discover_pools for screening cycles.`,
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of top candidates to return. Default 3."
          }
        }
      }
    }
  },

  // ════════════════════════════════════════
  //  POSITION DEPLOYMENT TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_active_bin",
      description: `Get the current active bin and price for a DLMM pool.
This is an on-chain call via the SDK. Returns:
- binId: the current active bin number
- price: human-readable price (token X per token Y)
- pricePerLamport: raw price in lamports

Only call this if you need the current price to calculate a specific bin range (e.g. user requested a % range). Do NOT call before every deploy — deploy_position fetches the active bin internally.`,
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "The DLMM pool address"
          }
        },
        required: ["pool_address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "deploy_position",
      description: `Open a new DLMM liquidity position.

PRIORITY ORDER for strategy and bins:
1. User explicitly specifies → always follow exactly (user override is absolute)
2. No user spec → use active strategy's lp_strategy and choose bins based on volatility

HARD RULES:
- Never use 'curve'.
- Bin Step: Only deploy in pools with bin_step between 80 and 125.
- For single-side SOL deploys (amount_y only, amount_x=0), do not request upside exposure:
  use bins_below only, keep bins_above=0, and the upper bin will be pinned to the current active bin.

Guidelines (only when user hasn't specified):
- Strategy: use the active strategy's lp_strategy field (bid_ask or spot)
- Bins: choose 35–69 for standard volatility; up to 350 for wide-range strategies. Max 1400 total.
- Deposit: Can be single-sided (SOL only or Base only) or dual-sided.

WARNING: This executes a real on-chain transaction. Check DRY_RUN mode.`,
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "DLMM pool address"
          },
          pool_name: {
            type: "string",
            description: "Pool name for logging (e.g. 'SOL-USDC')"
          },
          strategy: {
            type: "string",
            enum: ["spot", "bid_ask"],
            description: "LP strategy. Default from config: bid_ask"
          },
          bins_below: {
            type: "number",
            description: "Number of bins below active bin. Default from config: 69"
          },
          bins_above: {
            type: "number",
            description: "Number of bins above active bin. Use 0 for single-sided SOL."
          },
          amount_y: {
            type: "number",
            description: "SOL amount to deposit. Default: computeDeployAmount(wallet)"
          },
          amount_x: {
            type: "number",
            description: "Base token amount (for dual-sided). Default 0 = SOL-only."
          },
          skip_swap: {
            type: "boolean",
            description: "Skip auto-swap of base tokens back to SOL after deploy. Default false."
          }
        },
        required: ["pool_address"]
      }
    }
  },

  // ════════════════════════════════════════
  //  POSITION MANAGEMENT TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_my_positions",
      description: `Get all current on-chain positions with live PnL and health data.
This is the primary tool for management cycles. Returns:
- positions: array with position_address, pool, name, strategy, PnL, in_range, minutes_in_range, minutes_since_deploy, fee_per_tvl_24h
- total_positions: count

Returns live on-chain data — always fresh, no caching.`
    }
  },

  {
    type: "function",
    function: {
      name: "get_position_pnl",
      description: `Get detailed PnL and range health for a specific position.
Returns:
- pnl_pct, pnl_usd, fees_earned_usd, fees_earned_sol
- in_range, minutes_in_range, minutes_held, active_bin
- fee_per_tvl_24h, price_range, range_coverage

Use this for detailed analysis of a single position.`,
      parameters: {
        type: "object",
        properties: {
          position_address: {
            type: "string",
            description: "The position address"
          }
        },
        required: ["position_address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "close_position",
      description: `Close an open LP position.

Automatically:
- Claims all accumulated fees
- Swaps base tokens back to SOL (unless skip_swap=true)
- Records performance for learning

WARNING: This executes a real on-chain transaction. Check DRY_RUN mode.`,
      parameters: {
        type: "object",
        properties: {
          position_address: {
            type: "string",
            description: "The position address to close"
          },
          reason: {
            type: "string",
            description: "Why closing (e.g. 'stop loss', 'take profit', 'low yield')"
          },
          skip_swap: {
            type: "boolean",
            description: "Skip auto-swap of base tokens to SOL after close. Default false."
          }
        },
        required: ["position_address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "claim_fees",
      description: `Claim accumulated fees for a position.
Use this when fees are above minClaimAmount and position is healthy.
Returns fees claimed in USD and SOL.`,
      parameters: {
        type: "object",
        properties: {
          position_address: {
            type: "string",
            description: "The position address"
          }
        },
        required: ["position_address"]
      }
    }
  },

  // ════════════════════════════════════════
  //  WALLET & TOKEN TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_wallet_balance",
      description: `Get SOL and USDC wallet balances.
Returns: { sol: number, usdc: number }.`
    }
  },

  {
    type: "function",
    function: {
      name: "get_wallet_positions",
      description: `Get ALL wallet token positions (not just DLMM positions).
Use this to check token balances before/after swaps.
Returns array of { mint, symbol, amount, usd_value }.`,
    }
  },

  {
    type: "function",
    function: {
      name: "swap_token",
      description: `Swap tokens using Jupiter aggregator.
Handles SOL ↔ token swaps. Auto-selects best route.

WARNING: This executes a real on-chain transaction. Check DRY_RUN mode.`,
      parameters: {
        type: "object",
        properties: {
          input_mint: {
            type: "string",
            description: "Input token mint (use 'SOL' for SOL)"
          },
          output_mint: {
            type: "string",
            description: "Output token mint"
          },
          amount: {
            type: "number",
            description: "Amount to swap"
          },
          slippage_pct: {
            type: "number",
            description: "Slippage tolerance %. Default 1.0"
          }
        },
        required: ["input_mint", "output_mint", "amount"]
      }
    }
  },

  // ════════════════════════════════════════
  //  TOKEN ANALYSIS TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_token_info",
      description: `Get token details: mcap, price, supply, holders, socials.
Use this to evaluate a token's fundamentals before deploying.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token mint address or symbol"
          }
        },
        required: ["query"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_token_holders",
      description: `Analyze token holder distribution (Jupiter API).
Returns top holders, concentration %, bot %, bundled %.
Use this to detect bundled/scam tokens.`,
      parameters: {
        type: "object",
        properties: {
          mint: {
            type: "string",
            description: "Token mint address"
          }
        },
        required: ["mint"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_token_narrative",
      description: `Get token narrative and social sentiment (AI-generated).
Returns a short narrative summary + sentiment score.
Use this to understand WHY a token is trending.`,
      parameters: {
        type: "object",
        properties: {
          mint: {
            type: "string",
            description: "Token mint address"
          }
        },
        required: ["mint"]
      }
    }
  },

  // ════════════════════════════════════════
  //  POOL MEMORY & HISTORY TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_pool_detail",
      description: `Get detailed info for a specific DLMM pool by address.
Use this during management to check current pool health (volume, fees, organic score, price trend).
Default timeframe is 5m for real-time accuracy during position management.
Use a longer timeframe (1h, 4h) only when screening for new deployments.

IMPORTANT: Only call this with a real pool address from get_my_positions or get_top_candidates. Never guess or construct a pool address.`,
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "The on-chain pool address (base58 public key)"
          },
          timeframe: {
            type: "string",
            enum: ["5m", "15m", "30m", "1h", "2h", "4h", "12h", "24h"],
            description: "Data timeframe. Default 5m for management (most accurate). Use 4h+ for screening."
          }
        },
        required: ["pool_address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "search_pools",
      description: `Search pools by token symbol or name.
Returns matching pools with basic metrics.
Use this when user mentions a specific token (e.g. "deploy into BONK pool").`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token symbol or name to search for"
          }
        },
        required: ["query"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_pool_memory",
      description: `Recall historical deploy data for a pool.
Returns deploy history, avg PnL, win rate, cooldown status, recent snapshots.
Agent checks this BEFORE deploying to avoid redeploying into losing pools.`,
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "Pool address to recall"
          }
        },
        required: ["pool_address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "add_pool_note",
      description: `Annotate a pool with a freeform note.
Agent can record why it avoided/liked a pool for future reference.`,
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "Pool address"
          },
          note: {
            type: "string",
            description: "Note text (max 280 chars)"
          }
        },
        required: ["pool_address", "note"]
      }
    }
  },

  // ════════════════════════════════════════
  //  SMART WALLETS & SIGNAL TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "check_smart_wallets_on_pool",
      description: `Check if tracked smart wallets have positions in a pool.
Returns matching wallets and their deploy history.
Use this to validate a pool before deploying — smart wallet activity = social proof.`,
      parameters: {
        type: "object",
        properties: {
          pool: {
            type: "string",
            description: "Pool address to check"
          }
        },
        required: ["pool"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "add_smart_wallet",
      description: `Track a new smart wallet for social proof signals.
Agent can proactively add wallets it discovers during screening.`,
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Smart wallet address"
          },
          note: {
            type: "string",
            description: "Why this wallet is interesting (optional)"
          }
        },
        required: ["address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "remove_smart_wallet",
      description: `Stop tracking a smart wallet.`,
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Smart wallet address to remove"
          }
        },
        required: ["address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "list_smart_wallets",
      description: `List all tracked smart wallets with their notes.`
    }
  },

  // ════════════════════════════════════════
  //  STRATEGY TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "add_strategy",
      description: `Save a new LP strategy for future use.
Strategies define: bins_below, bins_above, strategy type, optional filters.`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Strategy name (unique identifier)"
          },
          bins_below: {
            type: "number",
            description: "Bins below active bin"
          },
          bins_above: {
            type: "number",
            description: "Bins above active bin"
          },
          strategy: {
            type: "string",
            enum: ["spot", "bid_ask"],
            description: "LP strategy type"
          },
          filters: {
            type: "object",
            description: "Optional filters (e.g. { minVolatility: 2, maxVolatility: 4 })"
          }
        },
        required: ["name", "bins_below", "bins_above", "strategy"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_strategy",
      description: `Get a specific strategy by name.`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Strategy name"
          }
        },
        required: ["name"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "list_strategies",
      description: `List all saved strategies.`
    }
  },

  {
    type: "function",
    function: {
      name: "set_active_strategy",
      description: `Set the active strategy for future deploys.
This updates config.management.strategy and config.management.binsBelow.`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Strategy name to activate"
          }
        },
        required: ["name"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "remove_strategy",
      description: `Delete a saved strategy by name.`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Strategy name to delete"
          }
        },
        required: ["name"]
      }
    }
  },

  // ════════════════════════════════════════
  //  BLACKLIST TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "add_to_blacklist",
      description: `Blacklist a token mint — agent will never deploy into pools with this base token.
Agent can blacklist tokens it identifies as rugs/scams.`,
      parameters: {
        type: "object",
        properties: {
          mint: {
            type: "string",
            description: "Token mint to blacklist"
          },
          reason: {
            type: "string",
            description: "Why blacklisting (optional)"
          }
        },
        required: ["mint"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "remove_from_blacklist",
      description: `Remove a token from the blacklist.`,
      parameters: {
        type: "object",
        properties: {
          mint: {
            type: "string",
            description: "Token mint to remove"
          }
        },
        required: ["mint"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "list_blacklist",
      description: `List all blacklisted token mints.`
    }
  },

  {
    type: "function",
    function: {
      name: "block_deployer",
      description: `Block a deployer wallet — agent will never deploy into pools whose base token was deployed by this wallet.
Use this to block scam deployers.`,
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Deployer wallet to block"
          },
          reason: {
            type: "string",
            description: "Why blocking (optional)"
          }
        },
        required: ["address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "unblock_deployer",
      description: `Unblock a deployer wallet.`,
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Deployer wallet to unblock"
          }
        },
        required: ["address"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "list_blocked_deployers",
      description: `List all blocked deployer wallets.`
    }
  },

  // ════════════════════════════════════════
  //  LESSON & PERFORMANCE TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "add_lesson",
      description: `Add a manual lesson (from operator observation).
Agent can record why something worked/failed for future reference.`,
      parameters: {
        type: "object",
        properties: {
          rule: {
            type: "string",
            description: "Lesson rule text (max 400 chars)"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for categorization (e.g. ['oor', 'volume'])"
          },
          pinned: {
            type: "boolean",
            description: "Always inject regardless of cap. Default false."
          },
          role: {
            type: "string",
            description: "Restrict to SCREENER/MANAGER/GENERAL. Default null = all roles."
          }
        },
        required: ["rule"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "pin_lesson",
      description: `Pin a lesson by ID — pinned lessons are always injected regardless of cap.`,
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "Lesson ID to pin"
          }
        },
        required: ["id"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "unpin_lesson",
      description: `Unpin a lesson by ID.`,
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "Lesson ID to unpin"
          }
        },
        required: ["id"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "list_lessons",
      description: `List lessons with optional filters — for agent browsing via Telegram.`
    }
  },

  {
    type: "function",
    function: {
      name: "clear_lessons",
      description: `Clear ALL lessons (keeps performance data).`
    }
  },

  {
    type: "function",
    function: {
      name: "get_performance_history",
      description: `Get performance records filtered by time window.
Returns PnL stats and recent closures.`,
      parameters: {
        type: "object",
        properties: {
          hours: {
            type: "number",
            description: "How many hours back to look. Default 24."
          },
          limit: {
            type: "number",
            description: "Max records to return. Default 50."
          }
        }
      }
    }
  },

  // ════════════════════════════════════════
  //  DECISION & STATE TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_recent_decisions",
      description: `Get recent deployment decisions (why agent chose what it did).
Use this when user asks "why did you deploy X" or "why did you skip Y".`
    }
  },

  {
    type: "function",
    function: {
      name: "set_position_note",
      description: `Set a persistent instruction for a position (e.g. "hold until 5% profit").
Overwrites any previous instruction. Pass null to clear.`,
      parameters: {
        type: "object",
        properties: {
          position_address: {
            type: "string",
            description: "Position address"
          },
          instruction: {
            type: "string",
            description: "Instruction text (max 280 chars) or null to clear"
          }
        },
        required: ["position_address"]
      }
    }
  },

  // ════════════════════════════════════════
  //  TOP LPER STUDY TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "study_top_lpers",
      description: `Study top LPers' strategies via LPAgent API.
Returns their positions, strategies, and PnL.
Use this to learn from successful LPers.`,
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of top LPers to study. Default 5."
          }
        }
      }
    }
  },

  {
    type: "function",
    function: {
      name: "get_top_lpers",
      description: `Get cached top LPer data (from last study).`
    }
  },

  // ════════════════════════════════════════
  //  CONFIGURATION TOOLS
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "update_config",
      description: `Update one or more config keys.
Changes are persisted to user-config.json and applied to the live config object.
Only these keys are allowed: minFeeActiveTvlRatio, minTvl, maxTvl, minVolume, minOrganic, minHolders, minMcap, maxMcap, minBinStep, maxBinStep, timeframe, category, minTokenFeesSol, useDiscordSignals, discordSignalMode, avoidPvpSymbols, blockPvpSymbols, maxBundlePct, maxBotHoldersPct, maxTop10Pct, allowedLaunchpads, blockedLaunchpads, minTokenAgeHours, maxTokenAgeHours, athFilterPct, maxVolatility, minClaimAmount, autoSwapAfterClaim, outOfRangeBinsToClose, outOfRangeWaitMinutes, oorCooldownTriggerCount, oorCooldownHours, repeatDeployCooldownEnabled, repeatDeployCooldownTriggerCount, repeatDeployCooldownHours, repeatDeployCooldownScope, repeatDeployCooldownMinFeeEarnedPct, minVolumeToRebalance, stopLossPct, takeProfitPct, minFeePerTvl24h, minAgeBeforeYieldCheck, minSolToOpen, deployAmountSol, gasReserve, positionSizePct, trailingTakeProfit, trailingTriggerPct, trailingDropPct, pnlSanityMaxDiffPct, solMode, managementIntervalMin, screeningIntervalMin, healthCheckIntervalMin, temperature, maxTokens, maxSteps, managementModel, screeningModel, generalModel, darwinEnabled, darwinWindowDays, darwinRecalcEvery, darwinBoost, darwinDecay, darwinFloor, darwinCeiling, darwinMinSamples.

Returns { applied: object, unknown: string[] }.`,
      parameters: {
        type: "object",
        properties: {
          updates: {
            type: "object",
            description: "Key-value pairs to update (e.g. { minVolume: 1000, maxVolatility: 4 })"
          }
        },
        required: ["updates"]
      }
    }
  },

  // ════════════════════════════════════════
  //  SELF-UPDATE TOOL
  // ════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "self_update",
      description: `Pull latest code from git and restart the agent.
Agent will:
1. Run 'git pull' to fetch latest changes
2. Restart itself (new code takes effect)

WARNING: This modifies the running codebase. Only use when explicitly requested by the user.
Requires ALLOW_SELF_UPDATE=true and a TTY session.`
    }
  }
];
