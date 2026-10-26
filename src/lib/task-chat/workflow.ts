/**
 * How Claude is told to hand its work back, per client.
 *
 *   off       edit files only; git is left alone
 *   pr        a branch and a pull request per task, stop there
 *   pr_merge  the same, then merge once tests and checks pass
 *
 * The instructions are text; what actually limits Claude is the list of
 * commands it may run (extraAllowedTools) and the ones it may never run
 * (alwaysDenied). The repo and branch were validated when saved and are
 * checked again here before they go anywhere near a command rule.
 */

import { isSafeBranch, normalizeGithubRepo } from "@/lib/github-repo";

export type Workflow = {
  githubRepo: string | null;
  baseBranch: string;
  prMode: "off" | "pr" | "pr_merge";
};

/** Null when the client is set to edit files only, or the saved values are unusable. */
export function usableWorkflow(w: Workflow): (Workflow & { githubRepo: string }) | null {
  if (w.prMode === "off" || !w.githubRepo) return null;
  const repo = normalizeGithubRepo(w.githubRepo);
  if (!repo || !isSafeBranch(w.baseBranch)) return null;
  return { ...w, githubRepo: repo };
}

const GIT_WRITE = [
  "Bash(git fetch:*)",
  "Bash(git pull:*)",
  "Bash(git switch:*)",
  "Bash(git branch:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(gh pr create:*)",
  "Bash(gh pr view:*)",
  "Bash(gh pr checks:*)",
  "Bash(gh pr diff:*)",
  "Bash(gh pr list:*)",
];

export function extraAllowedTools(w: Workflow): string[] {
  const u = usableWorkflow(w);
  if (!u) return [];
  return u.prMode === "pr_merge" ? [...GIT_WRITE, "Bash(gh pr merge:*)"] : GIT_WRITE;
}

/** Refused even though `git push` is allowed: rewriting history, or pushing to the main branch directly. */
export function alwaysDenied(w: Workflow): string[] {
  const u = usableWorkflow(w);
  if (!u) return [];
  const b = u.baseBranch;
  return [
    "Bash(git push --force:*)",
    "Bash(git push -f:*)",
    "Bash(git push --force-with-lease:*)",
    "Bash(git push --delete:*)",
    `Bash(git push origin ${b}:*)`,
    `Bash(git push origin HEAD:${b}:*)`,
    "Bash(git reset:*)",
    "Bash(git clean:*)",
    "Bash(git branch -D:*)",
    "Bash(git branch -d:*)",
    "Bash(git branch --delete:*)",
  ];
}

export function workflowNote(w: Workflow, taskId: number): string {
  const u = usableWorkflow(w);
  if (!u) return "";
  const b = u.baseBranch;
  const steps = [
    `This project is the GitHub repository ${u.githubRepo}. Do the work through a pull request, never by committing to ${b}.`,
    `1. Start clean: run git status. If there are uncommitted changes that are not yours, stop and say so. Otherwise git fetch origin and git switch ${b}, then git pull.`,
    `2. Create a branch from ${b} named seo/task-${taskId}-<two or three words>.`,
    `3. Make the change. If package.json has build, lint or test scripts, run the ones that exist and fix what you broke.`,
    `4. Commit with a short message that names the task, git push -u origin <branch>, then open the pull request with gh pr create --base ${b}. In the body say what changed and why, and how you checked it.`,
  ];
  if (u.prMode === "pr") {
    steps.push(
      `5. Leave the pull request open for a person to review and merge. Do not merge it. Then call update_task to mark the task done and put the pull request link in the note.`,
    );
  } else {
    steps.push(
      `5. Wait for the checks with gh pr checks --watch. If a check fails, fix it on the same branch, push, and wait again; give up after two attempts and leave the pull request open, saying why.`,
      `6. Only when the local checks passed and every check on the pull request is green, merge with gh pr merge --squash --delete-branch. Never merge a pull request with a failing or pending check.`,
      `7. Then git switch ${b}, git pull, and call update_task to mark the task done with the pull request link in the note.`,
    );
  }
  steps.push(`Never force-push, never push to ${b} directly, and never rewrite history.`);
  return steps.join("\n");
}
