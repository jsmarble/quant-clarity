import { describe, expect, it } from "vitest";

import type { DatasetMetadata } from "@quant-clarity/contracts";

import type { PublicationState } from "./dataset-metadata.js";
import {
  exactModelMatchLabel,
  exactModelSearchPageHref,
  planExactModelSearchPage,
} from "./exact-model-search-page.js";

const metadata: DatasetMetadata = {
  api_version: "1",
  counts: { active_models: 2, active_offerings: 3, active_providers: 1 },
  degradation_notices: [],
  generated_at: "2026-08-01T00:30:00.000Z",
  methodology_effective_at: "2026-08-01T00:00:00.000Z",
  methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
  methodology_version: "1.0.0",
  next_refresh_window: {
    ends_at: "2026-08-02T01:00:00.000Z",
    starts_at: "2026-08-02T00:00:00.000Z",
  },
  precision_display_order_version: "precision-display-order@1",
  precision_normalization_version: "precision-normalization@1",
  price_policy_version: "price-policy@1",
  publication_id: "pub_11111111-1111-4111-8111-111111111111",
  published_at: "2026-08-01T01:00:00.000Z",
  schema_version: "1.13.0",
};
const published: PublicationState = { kind: "published", metadata };
const nextPublication = "pub_22222222-2222-4222-8222-222222222222";

describe("exact Model discovery page planning (FE-013, FE-015, FE-016, PRIV-006)", () => {
  it("keeps an empty query in the browse placeholder without a read", () => {
    expect(planExactModelSearchPage("", "local", published)).toEqual({
      kind: "idle",
    });
    expect(planExactModelSearchPage("?q=", "local", published)).toEqual({
      kind: "idle",
    });
    expect(planExactModelSearchPage("?q=+++", "local", published)).toEqual({
      kind: "idle",
    });
  });

  it("normalizes q and rebuilds the fixed API-only filter and limit", () => {
    expect(
      planExactModelSearchPage("?q=%20Cafe%CC%81%20", "local", published),
    ).toEqual({
      apiQuery: "q=Caf%C3%A9&record_type=model&limit=20",
      expectedPublicationId: metadata.publication_id,
      kind: "read",
      search: { cursor: null, query: "Café" },
    });
  });

  it("preserves an opaque cursor only after q in public and signed URL state", () => {
    expect(
      planExactModelSearchPage(
        `?q=Fixture+Model&cursor=opaque_cursor-1&publication=${metadata.publication_id}`,
        "local",
        published,
      ),
    ).toMatchObject({
      apiQuery:
        "q=Fixture+Model&record_type=model&limit=20&cursor=opaque_cursor-1",
      expectedPublicationId: metadata.publication_id,
      kind: "read",
      search: { cursor: "opaque_cursor-1", query: "Fixture Model" },
    });
    expect(
      exactModelSearchPageHref(
        " Fixture Model ",
        "opaque_cursor-1",
        metadata.publication_id,
      ),
    ).toBe(
      `/models?q=Fixture+Model&cursor=opaque_cursor-1&publication=${metadata.publication_id}`,
    );
  });

  it("keeps a continuation on its public publication when the metadata head rolls over", () => {
    expect(
      planExactModelSearchPage(
        `?q=Fixture&cursor=opaque&publication=${metadata.publication_id}`,
        "local",
        {
          kind: "published",
          metadata: { ...metadata, publication_id: nextPublication },
        },
      ),
    ).toMatchObject({
      expectedPublicationId: metadata.publication_id,
      kind: "read",
      search: { cursor: "opaque", query: "Fixture" },
    });
  });

  it.each([
    "?q=&cursor=opaque",
    "?cursor=opaque",
    "?q=model&cursor=opaque",
    `?q=model&publication=${metadata.publication_id}`,
    "?q=model&cursor=opaque&publication=not-a-publication",
    `?q=model&publication=${metadata.publication_id}&cursor=opaque`,
    "?q=model&q=other",
    "?cursor=opaque&q=model",
    "?q=model&cursor=one&cursor=two",
    "?q=model&provider=prv_11111111-1111-4111-8111-111111111111",
    "?q=model&record_type=model&limit=20",
  ])(
    "rejects invalid or expanded public URL state without a read: %s",
    (raw) => {
      expect(planExactModelSearchPage(raw, "local", published)).toEqual({
        kind: "invalid",
      });
    },
  );

  it.each(["test", "preview", "production"] as const)(
    "keeps valid %s discovery closed without a read",
    (environment) => {
      expect(
        planExactModelSearchPage("?q=fixture", environment, published),
      ).toEqual({
        kind: "closed",
        search: { cursor: null, query: "fixture" },
      });
    },
  );

  it("distinguishes an unpublished dataset from publication dependency failure", () => {
    expect(
      planExactModelSearchPage("?q=fixture", "local", {
        kind: "not_published",
      }),
    ).toEqual({
      kind: "not_published",
      search: { cursor: null, query: "fixture" },
    });
    expect(
      planExactModelSearchPage("?q=fixture", "local", {
        kind: "unavailable",
      }),
    ).toEqual({
      kind: "unavailable",
      search: { cursor: null, query: "fixture" },
    });
  });

  it("fails closed when a pagination href cannot fit the signed query bound", () => {
    expect(
      exactModelSearchPageHref(
        "fixture",
        "x".repeat(4096),
        metadata.publication_id,
      ),
    ).toBeNull();
    expect(exactModelSearchPageHref("", null)).toBeNull();
    expect(exactModelSearchPageHref("fixture", "opaque")).toBeNull();
    expect(
      exactModelSearchPageHref("fixture", null, metadata.publication_id),
    ).toBeNull();
  });

  it("exposes both exact match classes without a Provider name", () => {
    expect(exactModelMatchLabel("canonical_name")).toBe(
      "Exact canonical Model name",
    );
    expect(exactModelMatchLabel("provider_model_id")).toBe(
      "Exact provider model ID",
    );
  });
});
