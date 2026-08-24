---
"spiko-cli": minor
"@spiko/distributor-api-client": minor
---

Replace the interpreted CLI with generated, typed Operation Definitions for all Public, Investor, and Distributor Operations.

Correct the generated Distributor `accountingPositionsDownloadAccountStatement` client: a successful download now returns the PDF bytes as a `Uint8Array` instead of failing with an unexpected status.
