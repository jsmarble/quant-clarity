import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_FIELD_CORPUS,
} from "./provenance-v2-registration.js";
import {
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  validateProvenanceV2ConnectedRegistrationGraph,
} from "./provenance-v2-connected-registration-graph.js";

const graph = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH;
type EnumDomain = keyof typeof PROVENANCE_V2_FIELD_CORPUS.enum_domains;
type TestCorpusField = Readonly<{
  ordinal: number;
  field_path: string;
  enum_domain: EnumDomain | null;
}>;
const corpusFields =
  PROVENANCE_V2_FIELD_CORPUS.fields as unknown as readonly TestCorpusField[];

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("fixture expectation is missing");
  return value;
};

const fieldValue = (
  row: (typeof graph.rows)[number],
  name: string,
): string | boolean | null => {
  const field = row.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`fixture row lacks ${name}`);
  return field.value;
};
const rowsFor = (table: string) =>
  graph.rows.filter((row) => row.table === table);
const integerField = (row: (typeof graph.rows)[number], name: string): number =>
  Number(fieldValue(row, name));

describe("provenance v2 connected registration graph", () => {
  it("freezes one complete 371-row preimage graph across all root families", () => {
    expect(validateProvenanceV2ConnectedRegistrationGraph(graph)).toEqual([]);
    expect(graph.rows).toHaveLength(371);
    expect(graph.table_counts).toHaveLength(33);
    expect(
      graph.table_counts.reduce((sum, entry) => sum + entry.count, 0),
    ).toBe(371);
    expect(new Set(graph.rows.map((row) => row.row_id)).size).toBe(371);

    const rootEntries = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.filter(
      (entry) => entry.disposition === "root_member",
    );
    expect(rootEntries).toHaveLength(33);
    for (const entry of rootEntries) {
      const rows = graph.rows.filter((row) => row.table === entry.table);
      expect(rows).toHaveLength(
        required(
          graph.table_counts.find((count) => count.table === entry.table),
        ).count,
      );
      const expectedFields = entry.fields
        .filter((field) => field.name !== entry.digest_output)
        .map((field) => field.name);
      for (const row of rows)
        expect(row.fields.map((field) => field.name)).toEqual(expectedFields);
    }
  });

  it("expands enum domains per field identity rather than once per shared domain", () => {
    const expectedEnumRows = corpusFields.reduce(
      (count, field) =>
        count +
        (field.enum_domain === null
          ? 0
          : PROVENANCE_V2_FIELD_CORPUS.enum_domains[field.enum_domain].length),
      0,
    );
    const uniqueDomainValues = Object.values(
      PROVENANCE_V2_FIELD_CORPUS.enum_domains,
    ).reduce((count, values) => count + values.length, 0);
    const enumRows = graph.rows.filter(
      (row) => row.table === "provenance_v2_field_path_enum_value",
    );
    expect(expectedEnumRows).toBe(68);
    expect(uniqueDomainValues).toBe(46);
    expect(enumRows).toHaveLength(expectedEnumRows);

    const exact = new Set(
      enumRows.map((row) =>
        [
          fieldValue(row, "field_path"),
          fieldValue(row, "ordinal"),
          fieldValue(row, "enum_value"),
        ]
          .map(String)
          .join("|"),
      ),
    );
    for (const field of corpusFields) {
      if (field.enum_domain === null) continue;
      PROVENANCE_V2_FIELD_CORPUS.enum_domains[field.enum_domain].forEach(
        (value, ordinal) => {
          expect(exact).toContain(
            [field.field_path, String(ordinal), value].join("|"),
          );
        },
      );
    }
  });

  it("keeps collection-member counts separate from authority entity counts", () => {
    expect(graph.collection_member_counts).toEqual({
      adapter_manifest_set_root: 17,
      endpoint_set_root: 73,
      verifier_policy_set_root: 3,
      field_policy_set_root: 278,
    });
    expect(graph.authority_entity_counts).toEqual({
      adapter_manifest_count: 1,
      endpoint_count: 1,
      verifier_policy_count: 1,
      field_policy_count: 4,
    });
  });

  it("independently reconciles every declared child count", () => {
    const only = (table: string) => required(rowsFor(table)[0]);
    expect(
      integerField(
        only("provenance_v2_source_register_receipt"),
        "member_count",
      ),
    ).toBe(rowsFor("provenance_v2_source_register_member").length);

    const adapter = only("provenance_v2_adapter_manifest_receipt");
    expect(integerField(adapter, "source_count")).toBe(
      rowsFor("provenance_v2_adapter_manifest_source").length,
    );
    expect(integerField(adapter, "environment_count")).toBe(
      rowsFor("provenance_v2_adapter_manifest_environment").length,
    );
    expect(integerField(adapter, "credential_count")).toBe(
      rowsFor("provenance_v2_adapter_manifest_credential").length,
    );

    const request = only("provenance_v2_source_endpoint_request");
    const requestCounts = [
      ["parameter_count", "provenance_v2_source_endpoint_parameter"],
      ["allowed_header_count", "provenance_v2_source_endpoint_allowed_header"],
      ["redirect_host_count", "provenance_v2_source_endpoint_redirect_host"],
      ["content_type_count", "provenance_v2_source_endpoint_content_type"],
      ["expected_field_count", "provenance_v2_source_endpoint_expected_field"],
      [
        "raw_field_mapping_count",
        "provenance_v2_source_endpoint_raw_field_mapping",
      ],
    ] as const;
    for (const [countField, table] of requestCounts)
      expect(integerField(request, countField)).toBe(rowsFor(table).length);
    expect(
      integerField(
        only("provenance_v2_source_endpoint_parameter"),
        "enum_count",
      ),
    ).toBe(rowsFor("provenance_v2_source_endpoint_parameter_enum").length);
    expect(
      integerField(only("provenance_v2_verifier_policy"), "member_count"),
    ).toBe(rowsFor("provenance_v2_verifier_policy_member").length);

    for (const groupRow of rowsFor("provenance_v2_field_record_group")) {
      const group = fieldValue(groupRow, "record_group");
      const members = rowsFor("provenance_v2_field_record_group_member").filter(
        (row) => fieldValue(row, "record_group") === group,
      );
      expect(integerField(groupRow, "member_count")).toBe(members.length);
    }

    for (const policy of rowsFor("provenance_v2_field_policy")) {
      const group = fieldValue(policy, "record_group");
      const count = (table: string) =>
        rowsFor(table).filter(
          (row) => fieldValue(row, "record_group") === group,
        ).length;
      expect(integerField(policy, "field_count")).toBe(
        count("provenance_v2_field_policy_member"),
      );
      expect(integerField(policy, "precedence_class_count")).toBe(
        count("provenance_v2_field_policy_precedence_class"),
      );
      expect(integerField(policy, "precedence_edge_count")).toBe(
        count("provenance_v2_field_policy_precedence_edge"),
      );
      expect(integerField(policy, "endpoint_disposition_count")).toBe(
        count("provenance_v2_field_policy_endpoint_admission") +
          count("provenance_v2_field_policy_endpoint_exclusion"),
      );
    }

    for (const precedenceClass of rowsFor(
      "provenance_v2_field_policy_precedence_class",
    )) {
      const sources = rowsFor(
        "provenance_v2_field_policy_precedence_class_source",
      ).filter(
        (row) =>
          fieldValue(row, "record_group") ===
            fieldValue(precedenceClass, "record_group") &&
          fieldValue(row, "class_key") ===
            fieldValue(precedenceClass, "class_key"),
      );
      expect(integerField(precedenceClass, "source_class_count")).toBe(
        sources.length,
      );
    }
  });

  it("connects all corpus fields to endpoint declarations, mappings, and policies", () => {
    const expectedRows = graph.rows.filter(
      (row) => row.table === "provenance_v2_source_endpoint_expected_field",
    );
    const mappingRows = graph.rows.filter(
      (row) => row.table === "provenance_v2_source_endpoint_raw_field_mapping",
    );
    const policyMemberRows = graph.rows.filter(
      (row) => row.table === "provenance_v2_field_policy_member",
    );
    const corpusPaths = corpusFields.map((field) => field.field_path);
    expect(expectedRows.map((row) => fieldValue(row, "field_path"))).toEqual(
      corpusPaths,
    );
    expect(
      mappingRows.map((row) => fieldValue(row, "canonical_field_path")),
    ).toEqual(corpusPaths);
    expect(
      policyMemberRows.map((row) => fieldValue(row, "field_path")),
    ).toEqual(
      PROVENANCE_V2_FIELD_CORPUS.record_groups.flatMap(
        (group) => group.field_paths,
      ),
    );
    expect(
      expectedRows.filter(
        (row) => fieldValue(row, "disposition") === "excluded",
      ),
    ).toHaveLength(8);
  });

  it("uses only the closed registration identity and vocabulary shapes", () => {
    expect(graph.selected_scope.authority_plan_id).toMatch(/^vpa_/u);
    expect(graph.selected_scope.provider_id).toMatch(/^prv_/u);
    expect(graph.selected_scope.endpoint_id).toMatch(/^sep_/u);

    const owner = required(rowsFor("provenance_v2_source_owner_receipt")[0]);
    expect(fieldValue(owner, "owner_kind")).toBe("provider_operator");
    expect(fieldValue(owner, "provider_owner_relationship")).toBe(
      "provider_controlled",
    );
    expect(fieldValue(owner, "provider_organization_id")).toMatch(/^org_/u);
    expect(fieldValue(owner, "owner_organization_id")).toBe(
      fieldValue(owner, "provider_organization_id"),
    );

    const credentials = rowsFor("provenance_v2_adapter_manifest_credential");
    expect(credentials).toHaveLength(11);
    expect(
      new Set(credentials.map((row) => fieldValue(row, "binding_name"))).size,
    ).toBe(11);
    for (const credential of credentials)
      expect(fieldValue(credential, "binding_name")).toMatch(
        /^[A-Z][A-Z0-9_]*$/u,
      );

    const sourceClasses = graph.rows.flatMap((row) =>
      row.fields
        .filter((field) => field.name === "authority_source_class")
        .map((field) => field.value),
    );
    expect(new Set(sourceClasses)).toEqual(
      new Set([
        "provider_exact_api",
        "provider_exact_authenticated_catalog",
        "provider_controlled_public",
      ]),
    );

    const mappings = rowsFor("provenance_v2_source_endpoint_raw_field_mapping");
    expect(
      new Set(mappings.map((row) => fieldValue(row, "declaration_kind"))),
    ).toEqual(new Set(["applicability", "price", "precision"]));
    expect(
      new Set(mappings.map((row) => fieldValue(row, "raw_locator_kind"))),
    ).toEqual(new Set(["json_pointer_pattern@1"]));
    const registeredMappings = mappings.filter(
      (row) => fieldValue(row, "value_source") === "registered_literal",
    );
    expect(registeredMappings.length).toBeGreaterThan(0);
    for (const mapping of mappings)
      expect(fieldValue(mapping, "registered_value") !== null).toBe(
        fieldValue(mapping, "value_source") === "registered_literal",
      );

    expect(
      fieldValue(
        required(rowsFor("provenance_v2_verifier_implementation")[0]),
        "implementation_kind",
      ),
    ).toBe("deterministic_parser");
    expect(
      fieldValue(
        required(rowsFor("provenance_v2_verifier_policy_member")[0]),
        "member_role",
      ),
    ).toBe("primary");
    for (const policy of rowsFor("provenance_v2_field_policy"))
      expect(fieldValue(policy, "order_kind")).toBe("total");
    expect(
      fieldValue(
        required(rowsFor("provenance_v2_field_policy_endpoint_exclusion")[0]),
        "reason_code",
      ),
    ).toBe("not_launch_corpus");
  });

  it("uses admissible positive bounds, permissions, and half-open intervals", () => {
    const only = (table: string) => required(rowsFor(table)[0]);
    const register = only("provenance_v2_source_register_receipt");
    expect(integerField(register, "reviewed_at_ms")).toBeLessThan(
      integerField(register, "next_review_at_ms"),
    );

    const adapter = only("provenance_v2_adapter_manifest_receipt");
    expect(fieldValue(adapter, "adapter_contract_version")).toMatch(
      /^[0-9]+\.[0-9]+\.[0-9]+$/u,
    );
    expect(fieldValue(adapter, "adapter_version")).toMatch(
      /^[0-9]+\.[0-9]+\.[0-9]+\+sha256\.[0-9a-f]{64}$/u,
    );
    for (const name of [
      "request_ceiling",
      "byte_ceiling",
      "elapsed_millisecond_ceiling",
      "manifest_requests_per_run",
      "pages_per_source",
      "manifest_bytes_per_run",
      "manifest_duration_ms",
      "items_per_run",
    ])
      expect(integerField(adapter, name)).toBeGreaterThan(0);
    expect(
      integerField(adapter, "manifest_requests_per_run"),
    ).toBeLessThanOrEqual(integerField(adapter, "request_ceiling"));
    expect(integerField(adapter, "manifest_bytes_per_run")).toBeLessThanOrEqual(
      integerField(adapter, "byte_ceiling"),
    );
    expect(integerField(adapter, "manifest_duration_ms")).toBeLessThanOrEqual(
      integerField(adapter, "elapsed_millisecond_ceiling"),
    );

    const request = only("provenance_v2_source_endpoint_request");
    expect(integerField(request, "compressed_byte_limit")).toBeGreaterThan(0);
    expect(
      integerField(request, "uncompressed_byte_limit"),
    ).toBeGreaterThanOrEqual(integerField(request, "compressed_byte_limit"));
    expect(integerField(request, "timeout_ms")).toBeGreaterThan(0);
    expect(fieldValue(request, "retention_permitted")).toBe(true);
    expect(fieldValue(request, "publication_permitted")).toBe(true);

    const intervalRows = [
      only("provenance_v2_source_endpoint_approval"),
      only("provenance_v2_verifier_policy"),
      ...rowsFor("provenance_v2_field_policy"),
    ];
    for (const row of intervalRows)
      expect(integerField(row, "effective_from_ms")).toBeLessThan(
        integerField(row, "effective_to_ms"),
      );
  });

  it("records numeric row-order evidence and labels Unicode as comparator-only", () => {
    expect(graph.ordering_probes.connected_integer_ordinals).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(graph.ordering_probes.comparator_only_utf8_binary).toEqual([
      "z",
      "é",
    ]);
  });

  it("keeps synthetic unresolved digest inputs globally distinct", () => {
    const digests = graph.rows.flatMap((row) =>
      row.fields
        .filter((field) => field.tag === "digest")
        .map((field) => field.value),
    );
    expect(new Set(digests).size).toBe(digests.length);
  });

  it("fails closed for mutations, accessors, proxies, and oversized arrays", () => {
    const mutation = structuredClone(graph) as unknown as {
      rows: { table: string }[];
    };
    mutation.rows[0]!.table = "provenance_v2_source_endpoint";
    expect(validateProvenanceV2ConnectedRegistrationGraph(mutation)).toEqual([
      "connected registration graph must equal the reviewed singleton",
    ]);

    let getterHits = 0;
    const accessor = structuredClone(graph) as Record<string, unknown>;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "review_candidate";
      },
    });
    expect(validateProvenanceV2ConnectedRegistrationGraph(accessor)).toEqual([
      "connected registration graph does not match its closed schema",
    ]);
    expect(getterHits).toBe(0);

    const throwing = new Proxy(structuredClone(graph), {
      get() {
        throw new Error("must not escape");
      },
    });
    expect(() =>
      validateProvenanceV2ConnectedRegistrationGraph(throwing),
    ).not.toThrow();

    let lengthHits = 0;
    const lengthTrap = <T extends readonly unknown[]>(value: T): T =>
      new Proxy(value, {
        get(target, key, receiver) {
          if (key === "length") {
            lengthHits += 1;
            throw new Error("array length must come from its descriptor");
          }
          return Reflect.get(target, key, receiver);
        },
      });
    const proxiedRows = structuredClone(graph) as unknown as {
      rows: readonly unknown[];
    };
    proxiedRows.rows = lengthTrap(proxiedRows.rows);
    expect(validateProvenanceV2ConnectedRegistrationGraph(proxiedRows)).toEqual(
      [],
    );
    const proxiedFields = structuredClone(graph) as unknown as {
      rows: { fields: readonly unknown[] }[];
    };
    proxiedFields.rows[0]!.fields = lengthTrap(proxiedFields.rows[0]!.fields);
    expect(
      validateProvenanceV2ConnectedRegistrationGraph(proxiedFields),
    ).toEqual([]);
    expect(lengthHits).toBe(0);

    const rootPrototypeKey = structuredClone(graph) as Record<string, unknown>;
    Object.defineProperty(rootPrototypeKey, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: { smuggled: true },
    });
    expect(
      validateProvenanceV2ConnectedRegistrationGraph(rootPrototypeKey),
    ).toEqual([
      "connected registration graph does not match its closed schema",
    ]);
    const nestedPrototypeKey = structuredClone(graph) as unknown as {
      selected_scope: Record<string, unknown>;
    };
    Object.defineProperty(nestedPrototypeKey.selected_scope, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: { smuggled: true },
    });
    expect(
      validateProvenanceV2ConnectedRegistrationGraph(nestedPrototypeKey),
    ).toEqual([
      "connected registration graph does not match its closed schema",
    ]);

    const oversizedString = structuredClone(graph) as unknown as {
      selected_scope: { authority_plan_id: string };
    };
    oversizedString.selected_scope.authority_plan_id = "x".repeat(1_000_001);
    expect(
      validateProvenanceV2ConnectedRegistrationGraph(oversizedString),
    ).toEqual([
      "connected registration graph does not match its closed schema",
    ]);
    oversizedString.selected_scope.authority_plan_id = "é".repeat(500_001);
    expect(
      validateProvenanceV2ConnectedRegistrationGraph(oversizedString),
    ).toEqual([
      "connected registration graph does not match its closed schema",
    ]);

    const unsafeInteger = structuredClone(graph) as unknown as {
      rows: { fields: { tag: string; value: string | boolean | null }[] }[];
    };
    const integer = unsafeInteger.rows
      .flatMap((row) => row.fields)
      .find((field) => field.tag === "integer");
    required(integer).value = "9007199254740992";
    expect(
      validateProvenanceV2ConnectedRegistrationGraph(unsafeInteger),
    ).toEqual(["connected registration graph contains an unsafe integer"]);

    expect(
      validateProvenanceV2ConnectedRegistrationGraph(new Array(513)),
    ).toEqual([
      "connected registration graph does not match its closed schema",
    ]);
  });
});
