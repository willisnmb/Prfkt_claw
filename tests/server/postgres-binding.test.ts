import { describe, expect, it } from "vitest";
import { serializeJsonParam } from "@/server/db/postgres-core";

describe("postgres binding json parameters", () => {
  it("passes pre-serialised JSON through unchanged and serialises values once", () => {
    expect(serializeJsonParam('{"a":1}')).toBe('{"a":1}');
    expect(serializeJsonParam({ a: 1 })).toBe('{"a":1}');
    expect(serializeJsonParam([1, 2])).toBe("[1,2]");
    expect(serializeJsonParam(null)).toBe("null");
  });
});
