-- Tracks whether the sandbox's repo has any commits at all, alongside
-- uncommittedFilesCount, so the no-linked-repo warning banner can tell
-- "nothing to lose" apart from "commits that only live in the sandbox".
ALTER TABLE "Chat" ADD COLUMN "hasCommits" BOOLEAN NOT NULL DEFAULT false;
