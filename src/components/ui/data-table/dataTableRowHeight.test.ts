import { describe, expect, it } from "vitest";
import { dataTableRowHeight } from "./dataTableRowHeight";

describe("dataTableRowHeight", () => {
  it("fits the rendered row at 12px, 16px, and 18px", () => {
    expect(dataTableRowHeight(12)).toBe(29);
    expect(dataTableRowHeight(16)).toBe(35);
    expect(dataTableRowHeight(18)).toBe(40);
  });
});
