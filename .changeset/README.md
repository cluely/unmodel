# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

- Add a changeset for any user-facing change: `bunx changeset`
- The `release.yml` workflow opens a version PR on pushes to `main` and publishes
  to npm when that PR is merged.
- The scheduled `codegen-refresh.yml` workflow writes `models-dev-refresh.md`
  automatically when the models.dev catalog changes.
