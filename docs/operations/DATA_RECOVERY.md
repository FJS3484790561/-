# Data backup and recovery

This runbook applies to the single-instance SQLite persistence foundation. It does not authorize access to production data or deployment.

## Backup

Run the application backup command against the configured database and write the result to a protected directory outside the repository. The command uses SQLite's online backup API and verifies the resulting file before reporting success.

```text
npm run data:backup -- <database-path> <backup-path>
```

## Isolated restore check

Never overwrite the active database for a routine recovery test. Copy a verified backup to a new destination and run the isolated restore check:

```text
npm run data:restore-check -- <backup-path> <new-database-path>
```

The command refuses to overwrite an existing destination and checks SQLite integrity, foreign keys and required tables. Application-level account, order, credit and object-reference checks remain part of release QA.

## Production boundary

Database files, WAL files, object bytes and backup artifacts are ignored by Git. Production credentials belong only in the deployment secret store. Off-site retention, COS versioning and scheduled recovery drills are completed by the later Tencent Cloud operations Change.
