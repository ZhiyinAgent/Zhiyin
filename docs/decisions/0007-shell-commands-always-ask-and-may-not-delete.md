# 0007. A shell command always asks, runs contained, and may not delete

Status: accepted

## Decision

- **One bash command per action, starting in the workspace folder, always
  asked about.** No conversation grant covers a shell command. Bash is the one
  Git for Windows installs, or another found on the `PATH`. Where there is
  none, or processes cannot be contained, the tool is not offered.
- **The model's sentence is a claim, labelled as one.** The model must say in
  plain words what the command does. That sentence travels as the action's
  `claim`, shown beside the exact command and marked as the assistant's
  description. The command is the only authority on what runs. A command is
  not confined to the workspace; the tool's description and the security policy
  say so once, rather than on every approval.
- **Recognised deletions are refused before anyone is asked.** Before approval
  and again before running, the command is split into the simple commands bash
  would run, following quotes, separators, pipes, `$(…)`, backticks,
  `bash -c`, `eval`, `cmd /c`, PowerShell's `-Command`, `xargs` and
  `find -exec`. One that deletes (`rm`, `rmdir`, `del`, `rd`, `Remove-Item`,
  `git clean`, `git rm`, `find -delete`, inline Python or Node file removal,
  and the like) is refused as something the model can correct, pointing it to
  `delete_file` (ADR 0008). This recognises; it does not prove.
- **A command runs contained (ADR 0004), and its output is bounded.** The model
  is shown the start and end of each stream; the whole output is kept with the
  conversation to read again. The workspace is listed before and after the
  command, and the files it created, changed or removed are named on its
  action. Nothing is backed up first.
- **A long command becomes a job of its conversation.** A command still running
  after 30 seconds answers at once with what it printed so far and carries on
  as `J1`, `J2`…, within the time limit the model gave it (30 minutes by
  default, two hours at most). A conversation runs at most three jobs; a
  further command runs to its end within its call. The model follows a job
  with `job_output` and stops it with `stop_job`, and a job that ends on its
  own reaches the conversation as a notice. The person sees a conversation's
  running jobs with their latest output, and can stop any of them. Jobs end
  when the person stops the conversation or closes Zhiyin; after a restart the
  model is told which commands stopped with the app.

## Why

Building, testing, version control and most real tools need a shell. It is
the widest capability Zhiyin has and the only one whose effect cannot be read
from its arguments. On Windows a shell deletion skips the Recycle Bin, and its
approval shows a command, not which files go.

So the safety of a shell command rests on one mechanism: a person reads the
command and decides. Zhiyin does not establish what a command does; the
sentence beside it is the model's, and is shown as such. Deriving a command's
effects in code is the work that would narrow this.

## Rejected

- A classifier of shell effects presented as authoritative: an incomplete
  classification shown as fact is worse than none. Refusing the deletions it
  recognises claims nothing about the rest.
- Allowing commands by prefix, or by the model's description.
- Steering the model away from shell deletion by the delete tool's description
  alone: one deletion through the shell skips everything `delete_file` shows.
- Ending every command at a fixed timeout: an install or a build that takes
  longer is thrown away.
- Streaming a job's output into the conversation: output is read when someone
  asks for it, fenced as a tool's answer.

## Assumptions

- The person approving can read a command with its claim beside it.
- A model told "still running as job J1" follows the job rather than starting
  the command again.
- A model refused a deletion uses `delete_file` rather than disguising the
  command.
