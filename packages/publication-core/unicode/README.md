# Unicode 17 exact-search data

This directory records and reproducibly generates the checked-in tables used by
`exact-search-normalization@1`. The runtime does not call host normalization,
case-conversion, locale, or Unicode-category APIs.

The unmodified official Unicode 17.0.0 inputs are checked in under `17.0.0/`.
Their official URLs, local paths, and SHA-256 digests are pinned in
`sources.json`. `LICENSE.txt` contains the Unicode License V3 notice that
applies to the generated data; its official URL and digest are pinned too. The
generator verifies every input and the checked-in notice, and the generated
table header repeats the source and license digests so a built artifact remains
self-identifying.

To regenerate from the checked-in sources:

```sh
node packages/publication-core/unicode/generate-unicode-17.mjs
```

Use `--check` to run the same source-integrity and Unicode conformance checks
and fail unless the generated table is byte-for-byte current. The three source
path options remain available for independently downloaded verification inputs.

Generation fails if any source digest differs. Before writing the table it
also runs the complete Unicode 17 `NormalizationTest.txt` NFC invariants
against the generated canonical-decomposition, combining-class, and
composition data. This matters because Unicode requires NFC after applying
the per-code-point `NFKC_CF` mapping.
