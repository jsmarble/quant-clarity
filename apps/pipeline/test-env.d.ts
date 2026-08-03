declare namespace Cloudflare {
  interface Env {
    CANONICAL_DB: D1Database;
    MODEL_SLUG_ARCHIVE_BUCKET: R2Bucket;
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
