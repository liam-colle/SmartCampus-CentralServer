import { describe, expect, it } from "vitest";
import { normalizeCardUid } from "../cards.js";

describe("normalizeCardUid", () => {
  it("accepts the usual notations and yields upper-case hex", () => {
    expect(normalizeCardUid("04:a2:2b:1c")).toBe("04A22B1C");
    expect(normalizeCardUid("04-A2-2B-1C")).toBe("04A22B1C");
    expect(normalizeCardUid(" 04a22b1c ")).toBe("04A22B1C");
  });

  it("accepts 4, 7 and 10 byte serial numbers", () => {
    expect(normalizeCardUid("04A22B1C")).not.toBeNull();
    expect(normalizeCardUid("04A22B1C5D6E7F")).not.toBeNull();
    expect(normalizeCardUid("04A22B1C5D6E7F8091A2")).not.toBeNull();
  });

  it("rejects anything else", () => {
    expect(normalizeCardUid("")).toBeNull();
    expect(normalizeCardUid("04A22B")).toBeNull();
    expect(normalizeCardUid("04A22B1C5")).toBeNull();
    expect(normalizeCardUid("ZZZZZZZZ")).toBeNull();
  });
});
