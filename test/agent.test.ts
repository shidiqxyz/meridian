import { describe, it, expect, beforeEach, vi } from "vitest";
import { getToolsForRole } from "../src/core/agent/agent";

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({})
      }
    }
  }))
}));

vi.mock("../src/core/config/config", () => ({
  default: {
    screeningModel: "test-model",
    generalModel: "test-model",
    managementModel: "test-model",
    hiveMindEnabled: false,
    getMaxPositions: () => 3,
    getManagementIntervalMin: () => 10,
    getScreeningIntervalMin: () => 30,
  }
}));

describe("agent", () => {
  describe("getToolsForRole", () => {
    it("returns all tools for GENERAL role", () => {
      const tools = getToolsForRole("GENERAL");
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("returns subset of tools for SCREENER role", () => {
      const screenerTools = getToolsForRole("SCREENER");
      const generalTools = getToolsForRole("GENERAL");
      expect(screenerTools.length).toBeLessThan(generalTools.length);
      expect(screenerTools.some(t => t.function?.name === "deploy_position")).toBe(true);
    });

    it("returns subset of tools for MANAGER role", () => {
      const managerTools = getToolsForRole("MANAGER");
      const generalTools = getToolsForRole("GENERAL");
      expect(managerTools.length).toBeLessThan(generalTools.length);
      expect(managerTools.some(t => t.function?.name === "close_position")).toBe(true);
    });
  });
});
