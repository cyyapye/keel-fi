# Incident response

## Severity

- **SEV-1:** confirmed public financial data, active credential theft,
  cross-household disclosure, unauthorized distributions/record changes, or
  compromised Cloudflare administrative access.
- **SEV-2:** exploitable authentication, document-access, injection, backup, or
  connector flaw without confirmed disclosure.
- **SEV-3:** contained dependency or configuration weakness with no sensitive
  exposure.

## Immediate response

1. Preserve evidence without copying sensitive content into issues, chat, or
   ordinary logs.
2. Stop the affected connector, Worker route, deployment, or account session.
3. Restrict GitHub and Cloudflare administrative access to the incident lead.
4. Rotate or revoke exposed credentials using the sequence below.
5. Record timestamps, affected resources, and actions in a private incident log.
6. Assess whether financial facts, document objects, forecast integrity, or
   backups were accessed or changed.

For a public Git leak, make the repository private if safe and available, revoke
the exposed material first, then remove the data from all Git objects,
forks/caches within reach, CI artifacts, and local clones. A follow-up deletion
commit is not remediation.

## Key and token rotation

Rotate one credential class at a time:

1. create a replacement with narrower or equal scope;
2. update the Worker secret binding or provider configuration;
3. deploy and verify authentication, connector, and document-read behavior;
4. revoke the old credential;
5. verify old-token failure and review provider audit logs; and
6. record owner, time, affected deployment, and next scheduled rotation.

Recommended order during a broad compromise:

1. GitHub sessions, recovery methods, SSH keys, and personal/access tokens;
2. Cloudflare sessions and API tokens;
3. Access service tokens and application audience configuration;
4. connector provider tokens;
5. document signing/encryption material; and
6. backup credentials and encryption keys.

Never paste secret values into the incident log.

## Investigation

- Compare GitHub audit activity, workflow changes, releases, and branch history.
- Compare Cloudflare Access, Worker deployment, account audit, D1, R2, Queue,
  DNS, and token activity.
- Verify D1 immutable records and input hashes against the last known-good
  encrypted export.
- Identify every log sink, CI artifact, cache, export, and backup that may
  contain exposed data.
- Use synthetic reproduction for debugging whenever possible.

## Recovery and closure

Restore only from a verified pre-incident export into a clean environment.
Reapply migrations, validate counts and hashes, and perform application and
Access smoke tests before traffic resumes.

Closure requires a documented root cause, affected-data decision, completed
rotations, remediation tests, retention cleanup, and follow-up owners. Notify
affected users and regulators when applicable professional advice determines it
is required.
