import { describe, it, expect } from "vitest";
import { safeNumber } from "../src/core/utils/number.js";

describe("safeNumber", () => {
  it("returns the number for valid numeric input", () => {
    expect(safeNumber(42)).toBe(42);
    expect(safeNumber(0)).toBe(0);
    expect(safeNumber(-5)).toBe(-5);
    expect(safeNumber(3.14)).toBe(3.14);
  });

  it("parses numeric strings", () => {
    expect(safeNumber("42")).toBe(42);
    expect(safeNumber("0.5")).toBe(0.5);
    expect(safeNumber("-10")).toBe(-10);
  });

  it("returns fallback for non-numeric values", () => {
    expect(safeNumber("hello")).toBeNull();
    expect(safeNumber("abc123")).toBeNull();
    expect(safeNumber(NaN)).toBeNull();
    expect(safeNumber(Infinity)).toBeNull();
    expect(safeNumber(-Infinity)).toBeNull();
  });

  it("treats empty string and null as 0 (Number coercion)", () => {
    expect(safeNumber("")).toBe(0);       // Number("") === 0
    expect(safeNumber(null)).toBe(0);     // Number(null) === 0
    expect(safeNumber(undefined)).toBeNull(); // Number(undefined) === NaN -> returns fallback (null)
  });

  it("uses custom fallback value when input is invalid", () => {
    expect(safeNumber("bad", 0)).toBe(0);
    expect(safeNumber(NaN, -1)).toBe(-1);
    expect(safeNumber(Infinity, 99)).toBe(99);
  });

  it("returns number even when fallback is provided", () => {
    expect(safeNumber(7, 0)).toBe(7);
    expect(safeNumber("12", -1)).toBe(12);
  });
});
