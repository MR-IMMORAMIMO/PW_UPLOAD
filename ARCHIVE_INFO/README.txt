PERSONAL WORKSPACE V4 - SOURCE AND COMPLETE LOCAL GIT REPOSITORY

Extract the ZIP into a new empty directory. The PERSONAL-WORKSPACE-V4 folder
contains the current source files AND .git history, branches, index and reflogs.
Uncommitted tracked changes and nonignored new files are preserved. Existing
deletions remain absent; git status should show the original dirty checkout.
Do not run git reset or clean if you want to retain those changes.

This is a SOURCE archive, not a portable executable or a production-data backup.
Ignored untracked node_modules, local .env files, databases, build/cache/log
files are excluded. Tracked generated/release files are retained so the local
repository is faithfully preserved. Example environment files are included.
Git history is preserved verbatim, including historical content.

Use the repository README for setup. package.json currently requires Node 24
and pnpm 11 (packageManager pnpm@11.9.0). Install dependencies with
pnpm install --frozen-lockfile. Local credentials/data are configured separately.
No fresh build or release validation was performed for this archival task.

ARCHIVE_INFO contains origin, branch, HEAD, Git status and a SHA256 manifest.
Source files were read only; nothing was staged, committed or pushed.
