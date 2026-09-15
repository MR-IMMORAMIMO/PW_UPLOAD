# Contact email migration 1.0.0 — schema 29 to 30

The approved Contacts form requires only a name. Version 29 incorrectly treats every blank email in a project as the same unique value. Version 30 preserves every contact UUID and field, replaces that unconditional constraint with a partial unique index for nonempty emails, and keeps case-insensitive uniqueness for actual email addresses.

Production upgrades use the existing SchemaMigrationRunner verified-backup gate and transaction, including structural fingerprint and foreign-key checks. No live database is modified by development tests. Legacy self-managed test/mock initialization uses the same migration function after contact columns exist. Both paths are idempotent; failures roll back the table rebuild and index together.

The explicit rollback preserves all data and restores the previous constraint. It refuses downgrade when a project has multiple contacts with blank email; those values must be resolved explicitly before downgrade. It never removes contacts to make a downgrade succeed. New group/notes/archive metadata remains in the existing app_state store and is not deleted by this migration.

Validation: migration tests cover preserved identity, repeated upgrade, duplicate real-email rejection, multiple blank emails, blocked lossy downgrade, exact-schema rollback, and foreign-key integrity. Store tests cover group-specific Primary replacement and archive/restore.
