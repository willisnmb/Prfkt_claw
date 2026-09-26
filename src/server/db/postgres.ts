import "server-only";
import type { Sql } from "./sql";
import { createPostgresSql } from "./postgres-core";
import { serverEnv } from "../env";

let pool: Sql | undefined;

/** Server-only control-plane connection. Throws when DATABASE_URL is not configured. */
export function getSql(): Sql {
  if (pool) return pool;
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  pool = createPostgresSql(url).sql;
  return pool;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
    this.name = "DatabaseNotConfiguredError";
  }
}
