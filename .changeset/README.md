# Changesets

Each pull request that changes a published package should include a changeset:

```sh
pnpm changeset
```

Select `spiko-cli`, `spiko-mcp`, or both, choose the semantic version bump, and describe the user-facing change. Commit the generated Markdown file with the code change.

After changes land on `main`, the release workflow maintains a version pull request. Merging that pull request publishes the updated packages to npm and creates GitHub releases.
