import { describe, expect, it } from "vitest";
import { decideOwnerAccess, parseAdminEmails, safeNextPath } from "@/server/auth/decide";

const confirmed = { id: "u1", email: "owner@prfkt.test", emailConfirmedAt: "2026-09-01T00:00:00Z" };

describe("decideOwnerAccess", () => {
  it("allows a confirmed owner", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"])).toEqual({
      allowed: true,
      principal: { userId: "u1", email: "owner@prfkt.test" },
    });
  });
  it("denies when signed out", () => {
    expect(decideOwnerAccess(null, ["owner@prfkt.test"])).toEqual({ allowed: false, reason: "unauthenticated" });
    expect(decideOwnerAccess(undefined, ["owner@prfkt.test"])).toMatchObject({ allowed: false, reason: "unauthenticated" });
    expect(decideOwnerAccess({ ...confirmed, id: "" }, ["owner@prfkt.test"])).toMatchObject({ reason: "unauthenticated" });
  });
  it("denies an unconfirmed email even if listed", () => {
    expect(decideOwnerAccess({ ...confirmed, emailConfirmedAt: null }, ["owner@prfkt.test"])).toMatchObject({ reason: "email-unconfirmed" });
    expect(decideOwnerAccess({ ...confirmed, emailConfirmedAt: "" }, ["owner@prfkt.test"])).toMatchObject({ reason: "email-unconfirmed" });
    expect(decideOwnerAccess({ ...confirmed, email: null }, ["owner@prfkt.test"])).toMatchObject({ reason: "email-unconfirmed" });
  });
  it("denies everyone when no owners are configured", () => {
    expect(decideOwnerAccess(confirmed, [])).toMatchObject({ reason: "no-owners-configured" });
    expect(decideOwnerAccess(confirmed, ["", "  ", "not-an-email"])).toMatchObject({ reason: "no-owners-configured" });
  });
  it("matches case- and whitespace-insensitively", () => {
    expect(decideOwnerAccess({ ...confirmed, email: " Owner@PRFKT.test " }, ["OWNER@prfkt.test"])).toMatchObject({ allowed: true });
  });
  it("does not fold plus-addressing or dots", () => {
    expect(decideOwnerAccess({ ...confirmed, email: "owner+x@prfkt.test" }, ["owner@prfkt.test"])).toMatchObject({ reason: "not-owner" });
    expect(decideOwnerAccess({ ...confirmed, email: "o.wner@prfkt.test" }, ["owner@prfkt.test"])).toMatchObject({ reason: "not-owner" });
  });
  it("denies look-alike domains and substrings", () => {
    for (const email of ["owner@prfkt.test.evil", "xowner@prfkt.test", "owner@evil-prfkt.test"]) {
      expect(decideOwnerAccess({ ...confirmed, email }, ["owner@prfkt.test"])).toMatchObject({ reason: "not-owner" });
    }
  });
  it("revocation: removing the email denies on the next decision", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"]).allowed).toBe(true);
    expect(decideOwnerAccess(confirmed, ["someone@prfkt.test"]).allowed).toBe(false);
  });
});

describe("parseAdminEmails", () => {
  it("normalizes and drops invalid entries", () => {
    expect(parseAdminEmails(" A@x.test, ,b@y.test ,nope, c @z.test")).toEqual(["a@x.test", "b@y.test"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });
});

describe("safeNextPath (open-redirect guard)", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/admin/catalog?x=1")).toBe("/admin/catalog?x=1");
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "\\\\evil.test", "javascript:alert(1)", "/ok\r\nSet-Cookie:x", "", null])(
    "rejects %s",
    (v) => {
      expect(safeNextPath(v as string, "/dashboard")).toBe("/dashboard");
    },
  );
});
