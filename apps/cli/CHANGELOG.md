# spiko-cli

## 0.4.1

### Patch Changes

- [#16](https://github.com/wewelll/spiko-ai-toolkit/pull/16) [`7b3fcc4`](https://github.com/wewelll/spiko-ai-toolkit/commit/7b3fcc43b22cea77de5cbc31005708f8425c46d1) Thanks [@wewelll](https://github.com/wewelll)! - Preserve configured HTTP client transformations for generated binary stream operations.

## 0.4.0

### Minor Changes

- [#14](https://github.com/wewelll/spiko-ai-toolkit/pull/14) [`21bffbf`](https://github.com/wewelll/spiko-ai-toolkit/commit/21bffbfd61126a5f0d47a1b97e35fd1fa30ff8a8) Thanks [@wewelll](https://github.com/wewelll)! - Upgrade Effect and its platform and OpenAPI generator packages to 4.0.0-rc.112.

## 0.3.0

### Minor Changes

- [#10](https://github.com/wewelll/spiko-ai-toolkit/pull/10) [`3ce80f0`](https://github.com/wewelll/spiko-ai-toolkit/commit/3ce80f09cb93464a181efd6eed058f2b447740cf) Thanks [@wewelll](https://github.com/wewelll)! - Replace the interpreted CLI with generated, typed Operation Definitions for all Public, Investor, and Distributor Operations.

  Correct the generated Distributor `accountingPositionsDownloadAccountStatement` client: a successful download now returns the PDF bytes as a `Uint8Array` instead of failing with an unexpected status.

## 0.2.0

### Minor Changes

- [#4](https://github.com/wewelll/spiko-ai-toolkit/pull/4) [`155cf49`](https://github.com/wewelll/spiko-ai-toolkit/commit/155cf49eb28d2f39ea7571fb86a151f654812115) Thanks [@wewelll](https://github.com/wewelll)! - Upgrade Effect to 4.0.0-beta.107 (`Schema.TaggedError`, explicit MCP `protocols`) and refresh OpenAPI specs: stablecoin deposits/withdrawals, swap orders, external account registration, deposit-order subscription forms, SPKCC allocation weights, and instant withdrawals.
