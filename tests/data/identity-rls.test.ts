import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, type TestDb } from "../support/db";
import { withAnon, withUser } from "@/server/db/sql";

describe("identity & tenancy RLS", () => {
  let t: TestDb;
  let a: { userId: string; tenantId: string };
  let b: { userId: string; tenantId: string };

  beforeAll(async () => {
    t = await createTestDb();
    a = await createUser(t.sql, "a@customer-a.test");
    b = await createUser(t.sql, "b@customer-b.test");
  });
  afterAll(() => t.close());

  it("signup creates a personal tenant per user", () => {
    expect(a.tenantId).not.toEqual(b.tenantId);
  });

  it("a user sees only their own tenant and profile", async () => {
    const tenants = await withUser(t.sql, a.userId, (tx) => tx.query<{ id: string }>("select id from public.tenants"));
    expect(tenants.map((r) => r.id)).toEqual([a.tenantId]);
    const profiles = await withUser(t.sql, a.userId, (tx) => tx.query<{ id: string }>("select id from public.profiles"));
    expect(profiles.map((r) => r.id)).toEqual([a.userId]);
  });

  it("a user cannot add themselves to another tenant", async () => {
    await expect(
      withUser(t.sql, a.userId, (tx) =>
        tx.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [b.tenantId, a.userId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("anon sees nothing", async () => {
    await expect(withAnon(t.sql, (tx) => tx.query("select * from public.tenants"))).rejects.toThrow(/permission denied/);
  });
});
