export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolFunction {
  name: string;
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunction;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  success: boolean;
  error?: string;
  blocked?: boolean;
  [key: string]: unknown;
}

export interface ExecutionContext {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
  duration_ms: number;
  success: boolean;
}

export type ToolMap = Record<string, (args: any) => any>;

export interface SafetyCheck {
  allowed: boolean;
  reason?: string;
}
