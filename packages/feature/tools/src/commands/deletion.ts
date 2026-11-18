/**
 * Recognises a shell command that plainly deletes, so the model is pointed to
 * `delete_file`, which shows the person each item and whether it can be
 * restored. It steers and does not guard: any program can delete, and a
 * command that deletes another way reaches the person's approval like any
 * other.
 *
 * Only the program at the start of each simple command is looked at, outside
 * quotes, comments and heredocs: `rm`, `rmdir`, `del`, `Remove-Item`, `find`
 * with `-delete`, and `git clean`.
 */

const deleting = new Map([
  ["rm", "rm"],
  ["rmdir", "rmdir"],
  ["del", "del"],
  ["remove-item", "Remove-Item"],
]);

/** What in the command deletes, as the list names it, or nothing. */
export function deletionIn(command: string): string | undefined {
  for (const words of simpleCommands(command)) {
    const at = words.findIndex((word) => !/^[A-Za-z_]\w*=/.test(word));
    if (at < 0) continue;
    const program = (words[at]!.split(/[\\/]/).pop() ?? "")
      .toLowerCase()
      .replace(/\.exe$/, "");
    const args = words.slice(at + 1);
    const named = deleting.get(program);
    if (named) return named;
    if (program === "find" && args.includes("-delete")) return "find -delete";
    if (program === "git" && args[0] === "clean") return "git clean";
  }
  return undefined;
}

/**
 * The words of each simple command, split where bash ends one: at `;`, `&`,
 * `|`, a line break, a bracket or a backtick outside quotes. Quotes are taken
 * off, a backslash before a line break joins the lines, and a heredoc's lines
 * are its command's input.
 */
function simpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  let heredocs: string[] = [];
  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at]!;
    if (char === "'" || char === '"') {
      let close = at + 1;
      while (close < command.length && command[close] !== char)
        close += char === '"' && command[close] === "\\" ? 2 : 1;
      word = (word ?? "") + command.slice(at + 1, close);
      at = close;
    } else if (char === "\\") {
      if (command[at + 1] !== "\n") word = (word ?? "") + command[at + 1];
      at += 1;
    } else if (char === "#" && word === undefined) {
      const end = command.indexOf("\n", at);
      at = (end < 0 ? command.length : end) - 1;
    } else if (/[;&|()`\n]/.test(char)) {
      endWord();
      if (words.length) commands.push(words);
      words = [];
      if (char !== "\n") continue;
      for (const delimiter of heredocs) {
        const end = command
          .slice(at + 1)
          .search(new RegExp(`^[\\t ]*${delimiter}[\\t ]*$`, "m"));
        const line = end < 0 ? -1 : command.indexOf("\n", at + 1 + end);
        at = end < 0 || line < 0 ? command.length : line;
      }
      heredocs = [];
    } else if (/\s/.test(char)) endWord();
    else {
      const heredoc = /^<<-?[\t ]*(['"]?)([A-Za-z_][\w.-]*)\1/.exec(
        command.slice(at),
      );
      if (heredoc) {
        heredocs.push(heredoc[2]!.replace(/\./g, "\\."));
        endWord();
        at += heredoc[0].length - 1;
      } else word = (word ?? "") + char;
    }
  }
  endWord();
  if (words.length) commands.push(words);
  return commands;
}
