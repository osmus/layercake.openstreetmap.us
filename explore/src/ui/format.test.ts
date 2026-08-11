import { describe, expect, it } from "vitest";
import { formatBytes, formatCell, formatRows } from "./format.ts";

describe("formatRows", () => {
  it("abbreviates by magnitude", () => {
    expect(formatRows(999)).toBe("999");
    expect(formatRows(1500)).toBe("1.5K");
    expect(formatRows(2_000_000)).toBe("2M");
    expect(formatRows(2_400_000)).toBe("2.4M");
    expect(formatRows(1_250_000_000)).toBe("1.3B");
  });
});

describe("formatBytes", () => {
  it("uses binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KiB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GiB");
  });
});

describe("formatCell", () => {
  it("renders nulls as blank and structures as JSON", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
    expect(formatCell(0)).toBe("0");
    expect(formatCell(123n)).toBe("123");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
});
