import type { ToolDefinition, ToolCall, ToolResult } from "./tools";
import type { Config } from "./config";
import type { Position } from "./state";

export type AgentType = "SCREENER" | "MANAGER" | "GENERAL";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentContext {
  agentType: AgentType;
  portfolio?: {
    sol: number;
    usdc: number;
  };
  positions?: Position[];
  stateSummary?: string | null;
  lessons?: string | null;
  perfSummary?: string | null;
  weightsSummary?: string | null;
  decisionSummary?: string | null;
}

export interface ToolExecutionResult {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
  duration_ms: number;
  success: boolean;
}

export interface AgentLoopOptions {
  maxSteps?: number;
  model?: string;
  maxOutputTokens?: number;
  interactive?: boolean;
  onToolStart?: (data: { name: string }) => Promise<void>;
  onToolFinish?: (data: { name: string; result: ToolResult; success: boolean }) => Promise<void>;
}

export interface LiveMessage {
  toolStart: (name: string) => Promise<void>;
  toolFinish: (name: string, result: ToolResult, success: boolean) => Promise<void>;
  finalize: (content: string) => Promise<void>;
  fail: (message: string) => Promise<void>;
}

export interface IntentMatch {
  intent: string;
  re: RegExp;
}

export type ToolName = 
  | "deploy_position"
  | "close_position"
  | "claim_fees"
  | "swap_token"
  | "get_position_pnl"
  | "get_my_positions"
  | "get_wallet_positions"
  | "get_active_bin"
  | "get_top_candidates"
  | "get_pool_detail"
  | "search_pools"
  | "discover_pools"
  | "check_smart_wallets_on_pool"
  | "get_token_holders"
  | "get_token_narrative"
  | "get_token_info"
  | "update_config"
  | "add_lesson"
  | "pin_lesson"
  | "unpin_lesson"
  | "clear_lessons"
  | "list_lessons"
  | "add_to_blacklist"
  | "remove_from_blacklist"
  | "list_blacklist"
  | "block_deployer"
  | "unblock_deployer"
  | "list_blocked_deployers"
  | "add_pool_note"
  | "set_position_note"
  | "add_smart_wallet"
  | "remove_smart_wallet"
  | "list_smart_wallets"
  | "study_top_lpers"
  | "get_top_lpers"
  | "get_performance_history"
  | "get_recent_decisions"
  | "add_strategy"
  | "remove_strategy"
  | "set_active_strategy"
  | "list_strategies"
  | "get_strategy"
  | "self_update"
  | "get_wallet_balance";

export interface DecisionRecord {
  type: string;
  actor: string;
  summary: string;
  reason?: string;
  timestamp?: string;
}
