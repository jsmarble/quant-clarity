declare namespace Cloudflare {
  interface Env {
    CANONICAL_DB: D1Database;
    CANONICAL_MIGRATIONS: {
      name: string;
      queries: string[];
    }[];
    SERVING_DB: D1Database;
    TEST_MIGRATIONS: {
      name: string;
      queries: string[];
    }[];
  }
}
