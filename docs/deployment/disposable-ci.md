# Migrate CI while keeping the repository private

Keep repository visibility private during this procedure. The workflow patch
does not remove legacy runner access by itself. Complete each proof before
removing the current execution path.

## Verify the candidate

1. Run the workflow contract tests, setup safety tests, and local verification.
2. Read the account's remaining included compute and confirm the existing $0
   Actions and Packages hard stops. Keep paid overages, paid caches, and larger
   runners disabled.
3. After approval to push, publish the reviewed candidate branch.
4. Dispatch `tugling-pilot.yml` on that branch without diagnostic flags.
5. Match the run's `headSha` to the candidate commit. Require a complete native
   receipt within the existing 900-second active and 300-second browser limits.
6. Require all registered cases, real D1 cost and preservation checks, unchanged
   canonical Linux screenshots, and real PDF containment probes.

The standard private Linux VM has less CPU and memory than the public VM.
Neither a successful setup command nor a public capacity specification proves
that this private run passes. If it fails, diagnose the failure while keeping
the repository private. Preserve assertions, budgets, and baselines.

The manual pilot has a 120-minute job ceiling. Reserve that complete included
compute envelope before dispatch. A full ready PR has a conservative
95-runner-minute ceiling across native, scan, contract, and receipt jobs. Setup
is outside the native execution clock but consumes billed job time. Main
verification and deployment consume additional minutes. Ongoing private use
needs a measured monthly allowance. Do not assume that included compute supports
an unlimited run rate. See
[GitHub-hosted runner capacity](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Preserve protected operations

1. Retain the preview environment's server-side main-only branch restriction.
2. Preserve the exact-SHA verification dependencies and deployment concurrency.
3. Prove hosted connectivity with the existing main-only storage preflight after
   the reviewed workflow reaches main and the operator authorizes the canary.
4. Under release authorization, require the normal encrypted recovery point and
   complete private read-back before migrations. Require exact Worker versions,
   protected smokes, and durable release evidence.
5. Preserve the private-document backup activation flag and environment. Do not
   enable a disabled backup or trigger an extra export for this migration.

Keep the document backup cron at `23 10 * * *` and the Tugling signal at
`17 15 * * 1`. Preserve backup locks, retention, recovery objects, artifact
limits, and `KEEL_PAUSE_ARTIFACT_UPLOADS`. A skipped private backup does not
prove an active backup works. Do not broaden Cloudflare Access or network
policies to make a hosted check pass.

## Remove persistent runner access

1. Choose a maintenance window outside any due enabled operation. Inspect
   active, queued, and delayed scheduled runs. Do not cancel an in-flight
   deployment or backup.
2. Confirm that main contains the reviewed hosted workflows. Actions enablement
   cannot select a workflow revision for you.
3. Drain jobs and briefly disable repository Actions to prevent dispatch races.
4. Identify the two legacy repository runner IDs and their exact host services.
5. Stop only those Actions runner services and unregister those exact IDs.
   Preserve provider agents, browser services, provider rootless daemons,
   scanner timers, private data, and backup objects.
6. Read back the repository runner inventory. Require zero available runners. An
   offline registration still permits future host access.
7. Re-enable Actions only after main contains the verified hosted revision.
8. Recheck private visibility, main SHA, environment policy, read-only token
   defaults, backup activation, schedules, and queued work.

Use these read-only checks and retain their results privately.

```sh
gh api repos/cyyapye/keel-fi --jq '{visibility,default_branch}'
gh api --paginate repos/cyyapye/keel-fi/actions/runners
gh api repos/cyyapye/keel-fi/actions/permissions/workflow
gh api repos/cyyapye/keel-fi/environments/preview/deployment-branch-policies
```

Use the administrator's actual runner IDs with the
[runner removal API](https://docs.github.com/en/rest/actions/self-hosted-runners).
Do not use name wildcards or retain an offline registration as a fallback. If
repository ownership moves to an organization, also exclude inherited persistent
runner-group access.

Keep the repository private when a proof fails. Do not restore persistent
public-PR execution as a convenience fallback. Public visibility and API-doc
publication remain separate operator decisions.
