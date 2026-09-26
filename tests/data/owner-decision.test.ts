import { describe, expect, it } from "vitest";
import { decideOwnerAccess, parseAdminEmails, safeNextPath } from "@/server/auth/decide";

const confirmed = { id: "u1", email: "owner@prfkt.test", emailConfirmedAt: "2026-09-01T00:00:00Z" };
const aal2 = { aal: "aal2", verifiedFactors: 1 };

describe("decideOwnerAccess", () => {
  it("allows a confirmed owner", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], aal2)).toEqual({
      allowed: true,
      principal: { userId: "u1", email: "owner@prfkt.test" },
    });
  });
  it("denies when signed out", () => {
    expect(decideOwnerAccess(null, ["owner@prfkt.test"], aal2)).toEqual({ allowed: false, reason: "unauthenticated" });
    expect(decideOwnerAccess(undefined, ["owner@prfkt.test"], aal2)).toMatchObject({ allowed: false, reason: "unauthenticated" });
    expect(decideOwnerAccess({ ...confirmed, id: "" }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "unauthenticated" });
  });
  it("denies an unconfirmed email even if listed", () => {
    expect(decideOwnerAccess({ ...confirmed, emailConfirmedAt: null }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "email-unconfirmed" });
    expect(decideOwnerAccess({ ...confirmed, emailConfirmedAt: "" }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "email-unconfirmed" });
    expect(decideOwnerAccess({ ...confirmed, email: null }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "email-unconfirmed" });
  });
  it("denies everyone when no owners are configured", () => {
    expect(decideOwnerAccess(confirmed, [], aal2)).toMatchObject({ reason: "no-owners-configured" });
    expect(decideOwnerAccess(confirmed, ["", "  ", "not-an-email"], aal2)).toMatchObject({ reason: "no-owners-configured" });
  });
  it("matches case- and whitespace-insensitively", () => {
    expect(decideOwnerAccess({ ...confirmed, email: " Owner@PRFKT.test " }, ["OWNER@prfkt.test"], aal2)).toMatchObject({ allowed: true });
  });
  it("does not fold plus-addressing or dots", () => {
    expect(decideOwnerAccess({ ...confirmed, email: "owner+x@prfkt.test" }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "not-owner" });
    expect(decideOwnerAccess({ ...confirmed, email: "o.wner@prfkt.test" }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "not-owner" });
  });
  it("denies look-alike domains and substrings", () => {
    for (const email of ["owner@prfkt.test.evil", "xowner@prfkt.test", "owner@evil-prfkt.test"]) {
      expect(decideOwnerAccess({ ...confirmed, email }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "not-owner" });
    }
  });
  it("revocation: removing the email denies on the next decision", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], aal2).allowed).toBe(true);
    expect(decideOwnerAccess(confirmed, ["someone@prfkt.test"], aal2).allowed).toBe(false);
  });
});

describe("decideOwnerAccess: owner MFA (AAL2)", () => {
  it("sends an owner without a verified factor to enrolment", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], { aal: "aal1", verifiedFactors: 0 })).toMatchObject({ reason: "mfa-enrollment-required" });
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], { aal: "aal2", verifiedFactors: 0 })).toMatchObject({ reason: "mfa-enrollment-required" });
  });
  it("requires the factor to have been used in this session", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], { aal: "aal1", verifiedFactors: 1 })).toMatchObject({ reason: "mfa-challenge-required" });
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], { aal: null, verifiedFactors: 2 })).toMatchObject({ reason: "mfa-challenge-required" });
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], { aal: "AAL2", verifiedFactors: 1 })).toMatchObject({ reason: "mfa-challenge-required" });
  });
  it("fails closed when assurance is unknown", () => {
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], null)).toMatchObject({ allowed: false });
    expect(decideOwnerAccess(confirmed, ["owner@prfkt.test"], undefined)).toMatchObject({ allowed: false });
  });
  it("MFA never widens access for non-owners", () => {
    expect(decideOwnerAccess({ ...confirmed, email: "x@prfkt.test" }, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "not-owner" });
    expect(decideOwnerAccess(null, ["owner@prfkt.test"], aal2)).toMatchObject({ reason: "unauthenticated" });
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
