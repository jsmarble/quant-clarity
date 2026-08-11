import { describe, expect, it } from "vitest";

import type { DatasetMetadata } from "@quant-clarity/contracts";

import type { PublicationState } from "./dataset-metadata.js";
import {
  exactVariantMatchLabel,
  exactVariantSearchPageHref,
  planExactVariantSearchPage,
} from "./exact-variant-search-page.js";

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

describe("exact Variant discovery page planning (FE-015, FE-016, FE-024, PRIV-006)", () => {
  it("keeps an empty query idle without a read", () => {
    expect(planExactVariantSearchPage("", "local", published)).toEqual({
      kind: "idle",
    });
    expect(planExactVariantSearchPage("?q=", "local", published)).toEqual({
      kind: "idle",
    });
    expect(planExactVariantSearchPage("?q=+++", "local", published)).toEqual({
      kind: "idle",
    });
  });

  it("normalizes q and rebuilds the fixed Variant filter and limit", () => {
    expect(
      planExactVariantSearchPage("?q=%20Cafe%CC%81-FP8%20", "local", published),
    ).toEqual({
      apiQuery: "q=Caf%C3%A9-FP8&record_type=variant&limit=20",
      expectedPublicationId: metadata.publication_id,
      kind: "read",
      search: { cursor: null, query: "Café-FP8" },
    });
  });

  it("keeps a continuation pinned to its public publication", () => {
    const href = exactVariantSearchPageHref(
      " Fixture Variant ",
      "opaque_cursor-1",
      metadata.publication_id,
    );
    expect(href).toBe(
      "/variants?q=Fixture+Variant&cursor=opaque_cursor-1&publication=" +
        metadata.publication_id,
    );
    expect(
      planExactVariantSearchPage(
        "?q=Fixture+Variant&cursor=opaque_cursor-1&publication=" +
          metadata.publication_id,
        "local",
        {
          kind: "published",
          metadata: { ...metadata, publication_id: nextPublication },
        },
      ),
    ).toMatchObject({
      apiQuery:
        "q=Fixture+Variant&record_type=variant&limit=20&cursor=opaque_cursor-1",
      expectedPublicationId: metadata.publication_id,
      kind: "read",
      search: { cursor: "opaque_cursor-1", query: "Fixture Variant" },
    });
  });

  it.each([
    "?q=&cursor=opaque",
    "?cursor=opaque",
    "?q=variant&cursor=opaque",
    "?q=variant&publication=" + metadata.publication_id,
    "?q=variant&cursor=opaque&publication=not-a-publication",
    "?q=variant&publication=" + metadata.publication_id + "&cursor=opaque",
    "?q=variant&q=other",
    "?cursor=opaque&q=variant",
    "?q=variant&cursor=one&cursor=two",
    "?q=variant&provider=prv_11111111-1111-4111-8111-111111111111",
    "?q=variant&record_type=variant&limit=20",
  ])("rejects expanded or malformed public URL state: %s", (raw) => {
    expect(planExactVariantSearchPage(raw, "local", published)).toEqual({
      kind: "invalid",
    });
  });

  it.each(["test", "preview", "production"] as const)(
    "keeps valid %s discovery closed without a read",
    (environment) => {
      expect(
        planExactVariantSearchPage("?q=fixture-fp8", environment, published),
      ).toEqual({
        kind: "closed",
        search: { cursor: null, query: "fixture-fp8" },
      });
    },
  );

  it("distinguishes unpublished and unavailable publication state", () => {
    expect(
      planExactVariantSearchPage("?q=fixture", "local", {
        kind: "not_published",
      }),
    ).toEqual({
      kind: "not_published",
      search: { cursor: null, query: "fixture" },
    });
    expect(
      planExactVariantSearchPage("?q=fixture", "local", {
        kind: "unavailable",
      }),
    ).toEqual({
      kind: "unavailable",
      search: { cursor: null, query: "fixture" },
    });
  });

  it("fails closed on invalid href inputs and labels both exact classes", () => {
    expect(
      exactVariantSearchPageHref(
        "fixture",
        "x".repeat(4096),
        metadata.publication_id,
      ),
    ).toBeNull();
    expect(exactVariantSearchPageHref("", null)).toBeNull();
    expect(exactVariantSearchPageHref("fixture", "opaque")).toBeNull();
    expect(
      exactVariantSearchPageHref("fixture", null, metadata.publication_id),
    ).toBeNull();
    expect(exactVariantMatchLabel("canonical_name")).toBe(
      "Exact explicit Variant name",
    );
    expect(exactVariantMatchLabel("provider_model_id")).toBe(
      "Exact provider model ID",
    );
  });
});
