---
status: accepted
---

# Generate typed CLI Operation Definitions

The CLI will be rebuilt around generated, typed Operation Definitions rather than interpreting shallow metadata or dynamically indexing generated clients. The committed OpenAPI documents are the sole source; generation emits definitions under `apps/cli/src/generated/`, and a deep CLI module exposes only `defineOperation` and `makeCli`. Each definition combines serializable discovery data, Effect-validated flags, safety classification, local input preparation, and a statically typed invocation closure that uses the existing Public, Investor, or Distributor client tag. Routes are resolved during generation, and generation fails on ambiguous definitions. This gives callers one shell interface, concentrates CLI policy in one module, keeps authentication and client composition in their owning packages, and makes the command interface the test surface.

## Considered options

- **Runtime semantic catalog plus generic invoker:** strong depth, but generated method alignment would remain dynamic.
- **Client-owned operation adapters:** strong schema locality, but CLI help, wizard, discovery, confirmation, and file concerns would leak into client packages.
- **Directly generated command leaves:** strongest static alignment, but CLI policy would be repeated across a large generated implementation.
- **Separate ports for invocation, output, terminal, validation, and routing:** highly substitutable, but most seams would be hypothetical and shallow because Effect already makes Console and Terminal local-substitutable.

## Consequences

- Generated definitions and their route policy become part of `generate:check`; generated files remain replaceable implementation and are never hand-edited.
- The shell grammar and JSON envelopes are designed greenfield; no compatibility path or dual dispatch is maintained.
- Existing client tags provide the remote seam: production layers and focused test layers are the two adapters. Layers are keyed by family and provided only around invocation closures, so confirmation and local input preparation precede client acquisition while discovery and help acquire no clients or credentials.
- Help, the built-in wizard, local Effect Schema validation, operation discovery, mutation confirmation, and JSON rendering share one definition and one deep module.
- Tests move from `prepareInvocation` and runtime routing helpers to `Command.runWith`, generator invariants, and the shell interface.
- Effect and its OpenAPI generator are beta dependencies; implementation must consult pinned source, compile generated invocation closures, and fail generation for unsupported source shapes.
