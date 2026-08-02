declare namespace Cloudflare {
  interface Env {
    SERVING_DB: D1Database;
    TEST_MIGRATIONS: {
      name: string;
      queries: string[];
    }[];
  }
}
