# Production rollback plan

This file contains the backend half of the Gate C2 rollback plan. It defines preparation and decision points only; Gate C2 authorizes no deployment or rollback action.

## Rollback unit

Roll back the Render service to the last known-good Git commit and restore its matching environment configuration. Gate C2 has no database migration, so its backend rollback does not run SQL and does not alter Supabase data.

The live schema baseline is revision `0004`. Never downgrade it as part of a Gate C2 application rollback. Any later schema rollback needs a separate owner-approved, data-preserving procedure.

## Triggers

Initiate the owner-approved rollback procedure when one of these conditions is confirmed after deployment:

- readiness remains 503 because the release cannot connect to the approved pooler;
- startup repeatedly fails production configuration validation;
- valid active admins receive 401/403, or revoked sessions remain accepted;
- CORS blocks the approved production origin or allows an unapproved origin;
- error rate, memory use, pool timeouts, or restart frequency exceeds the approved threshold;
- logs expose credentials, tokens, database details, or raw integrity errors.

## Procedure

1. Freeze further releases and record the failing commit, Render event time, health state, and request IDs. Do not copy secrets.
2. Confirm whether the fault is code, configuration, Supabase availability, or an external dependency. `/health/ready` proves only database connectivity.
3. With separate owner approval, select Render's last known-good deploy for the exact service. Do not create a replacement service or database unless separately authorized.
4. Restore the matching environment-variable set from the approved secret manager or Render history. Never paste values into the incident record.
5. Keep schema revision `0004`; run no migration, seed, cleanup harness, or live write.
6. Verify liveness, readiness, one public read, active-admin access, revoked-session rejection, non-admin denial, and exact-origin CORS.
7. Monitor restart count, memory, 5xx responses, pool timeouts, and authentication failures through the agreed observation window.
8. Record the recovered commit and evidence, then open a separate corrective change.

## Configuration-only recovery

If code is healthy and configuration is wrong, correct only the invalid variable after owner approval. A configuration change still restarts the service and must repeat the verification set above.

Do not work around startup validation by weakening required variables, adding wildcard CORS, disabling TLS, removing JWT issuer/audience checks, skipping session revocation, or placing a secret in the repository.

## Data protection

- Do not run Alembic downgrade for Gate C2.
- Do not delete users, sessions, admins, audit rows, media, or catalogue content.
- Do not run the live E2E cleanup harness as a rollback tool.
- If a later release writes incompatible data, stop and obtain a separate owner-approved data repair plan based on a read-only inventory and backup evidence.

## Backend exit criteria

- The selected known-good commit is serving traffic.
- `/health/live` and `/health/ready` return 200 under normal dependency state.
- Active admin access returns 200; revoked access returns 401; non-admin access returns 403.
- CORS allows only the approved origin set.
- No new credential leakage, unexplained 5xx pattern, restart loop, or pool exhaustion is present.
- The schema remains at revision `0004`, and no live data changed during rollback.
