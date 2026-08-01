import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, expectTypeOf, it } from "vitest";

import { Type, type Static } from "@sinclair/typebox";

import {
  EvidenceIdSchema,
  FactSchema,
  type FactState,
  type IdPrefix,
} from "./index.js";

const UUID = "00000000-0000-4000-8000-000000000001";
const StringFactSchema = FactSchema(
  Type.String({ $id: "StringValue" }),
  "StringFact",
);
type StringFact = Static<typeof StringFactSchema>;

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(EvidenceIdSchema);
  return ajv.compile(StringFactSchema);
}

describe("public fact contract (API-005, DATA-060)", () => {
  it("preserves literal state and prefix types", () => {
    expectTypeOf<FactState>().toEqualTypeOf<
      "known" | "unknown" | "not_applicable" | "unavailable"
    >();
    expectTypeOf<IdPrefix>().not.toEqualTypeOf<string>();
    expectTypeOf<StringFact["state"]>().toEqualTypeOf<FactState>();
  });

  it("requires an explicit stable schema identifier", () => {
    expect(() => FactSchema(Type.String(), "invalid fact id")).toThrow(
      TypeError,
    );
    expect(FactSchema(Type.String(), "AnotherStringFact").$id).toBe(
      "AnotherStringFact",
    );
  });

  it("requires value, timestamp, and evidence for known facts", () => {
    const validate = validator();
    expect(
      validate({
        state: "known",
        value: "FP8",
        observed_at: "2026-08-01T00:00:00.000Z",
        evidence_ids: [`evd_${UUID}`],
      }),
    ).toBe(true);
    expect(
      validate({
        state: "known",
        value: null,
        observed_at: null,
        evidence_ids: [],
      }),
    ).toBe(false);
    expect(
      validate({
        state: "known",
        value: "FP8",
        observed_at: "2026-08-01T00:00:00.000Z",
        evidence_ids: [`mdl_${UUID}`],
      }),
    ).toBe(false);
  });

  it("requires null values for non-known facts while retaining optional provenance", () => {
    const validate = validator();
    expect(
      validate({
        state: "unknown",
        value: null,
        observed_at: "2026-08-01T00:00:00.000Z",
        evidence_ids: [`evd_${UUID}`],
      }),
    ).toBe(true);
    expect(
      validate({
        state: "unavailable",
        value: "guessed",
        observed_at: null,
        evidence_ids: [],
      }),
    ).toBe(false);
  });
});
