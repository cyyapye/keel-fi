# GitHub verification workflows

`ci.yml` runs before merge for pull requests and merge-queue candidates. Its
four jobs are intentionally independent so failures are targeted and the slow
browser path can run in parallel:

- `Quality`
- `D1 migration and synthetic seed`
- `Critical browser flows`
- `Secret scan`

Configure the `main` branch ruleset to require all four jobs and require the
branch to be up to date before merge.

`post-merge.yml` runs `make verify` plus a full-history secret scan on the exact
commit pushed to `main`. It can also be dispatched manually. This workflow is a
verification backstop only; it does not publish or deploy Keel.
