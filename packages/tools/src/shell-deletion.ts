/**
 * Recognises a shell command that deletes files, so it can be sent to the
 * delete tool instead.
 *
 * Deleting through the shell skips the Recycle Bin and tells the person
 * approving it nothing about what goes; `delete_file` shows each item and
 * whether it can be restored. So a command that deletes is refused before
 * anyone is asked, with the way to do it properly.
 *
 * This recognises, it does not prove. The command is split into the simple
 * commands it runs, the way bash would split it, including commands
 * substituted inside it and those handed to `bash -c`, `cmd /c`, PowerShell,
 * `xargs`, `find -exec`, and inline Python or Node code. A program or script
 * that deletes on its own is not seen; the shell approval, which says a
 * command can do anything the account can, still governs it.
 */

const deleting = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "rimraf",
  "del",
  "erase",
  "rd",
]);

/** Programs that run the command after them, possibly after options. */
const wrappers = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "builtin",
  "exec",
  "nohup",
  "time",
  "nice",
  "timeout",
  "stdbuf",
]);

/** Words that can stand before a command without being one. */
const keywords = new Set([
  "{",
  "}",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
]);

const shells = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const pythons = new Set(["python", "python3", "py"]);
const powershells = new Set(["powershell", "pwsh"]);

const pythonDeletion =
  /\b(os\.remove|os\.unlink|os\.rmdir|os\.removedirs|shutil\.rmtree|\.unlink|\.rmdir)\s*\(/;
const nodeDeletion =
  /\b(rmSync|unlinkSync|rmdirSync|rimraf|fs\.rm|fs\.unlink|fs\.rmdir|fs\.promises\.rm|fs\.promises\.unlink)\s*\(/;
const powershellDeletion =
  /(?:^|[;&|({]\s*)(Remove-Item|ri|rm|rmdir|del|erase|rd)(?=\s|$)/i;

/** What in the command deletes, as it is written there, or nothing. */
export function deletionIn(command: string): string | undefined {
  for (const words of simpleCommands(command)) {
    const found = deletionBy(words);
    if (found) return found;
  }
  return undefined;
}

function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word)
    .toLowerCase()
    .replace(/\.exe$/, "");
}

function deletionBy(words: readonly string[]): string | undefined {
  let index = 0;
  while (
    index < words.length &&
    (keywords.has(words[index]!) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!))
  )
    index += 1;
  while (index < words.length && wrappers.has(programName(words[index]!))) {
    index += 1;
    while (
      index < words.length &&
      (words[index]!.startsWith("-") ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!) ||
        /^\d+[smhd]?$/.test(words[index]!))
    )
      index += 1;
  }
  const first = words[index];
  if (first === undefined) return undefined;
  const name = programName(first);
  const args = words.slice(index + 1);
  if (deleting.has(name)) return name;
  if (name === "find") {
    if (args.includes("-delete")) return "find -delete";
    const exec = args.findIndex((arg) =>
      ["-exec", "-execdir", "-ok", "-okdir"].includes(arg),
    );
    if (exec >= 0) {
      const end = args.findIndex(
        (arg, at) => at > exec && (arg === ";" || arg === "+"),
      );
      return deletionBy(args.slice(exec + 1, end < 0 ? undefined : end));
    }
    return undefined;
  }
  if (name === "xargs") {
    let at = 0;
    while (at < args.length && args[at]!.startsWith("-")) {
      at += /^-[IndPLs]$/.test(args[at]!) ? 2 : 1;
    }
    return deletionBy(args.slice(at));
  }
  if (name === "git") {
    const sub = args.find((arg) => !arg.startsWith("-"));
    if (sub === "clean") return "git clean";
    if (sub === "rm" && !args.includes("--cached")) return "git rm";
    return undefined;
  }
  if (shells.has(name)) {
    const code = args[args.indexOf("-c") + 1];
    return args.includes("-c") && code ? deletionIn(code) : undefined;
  }
  if (name === "eval") return deletionIn(args.join(" "));
  if (name === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return at >= 0 ? cmdDeletion(args.slice(at + 1).join(" ")) : undefined;
  }
  if (powershells.has(name)) {
    const at = args.findIndex((arg) => /^-(c|command)$/i.test(arg));
    const code = (at >= 0 ? args.slice(at + 1) : args).join(" ");
    return powershellDeletion.exec(code.trim())?.[1];
  }
  if (pythons.has(name)) {
    const code = args[args.indexOf("-c") + 1];
    return args.includes("-c") && code
      ? pythonDeletion.exec(code)?.[1]
      : undefined;
  }
  if (name === "node") {
    const at = args.findIndex((arg) => ["-e", "--eval", "-p"].includes(arg));
    const code = at >= 0 ? args[at + 1] : undefined;
    return code ? nodeDeletion.exec(code)?.[1] : undefined;
  }
  return undefined;
}

/** A `cmd /c` line: each command between its separators, by its first word. */
function cmdDeletion(line: string): string | undefined {
  for (const segment of line.split(/&&|\|\||[&|]/)) {
    const word = segment.trim().replace(/^@/, "").split(/\s+/)[0] ?? "";
    const name = programName(word.replace(/^"|"$/g, ""));
    if (["del", "erase", "rd", "rmdir"].includes(name)) return name;
    if (powershells.has(name) || name === "cmd")
      return deletionBy(segment.trim().split(/\s+/));
  }
  return undefined;
}

/**
 * The simple commands a bash line runs, each as its words with quoting
 * removed, including those inside `$(…)` and backticks.
 */
function simpleCommands(text: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  /** The text up to the parenthesis closing one opened just before `from`. */
  const substitution = (from: number): [string, number] => {
    let depth = 1;
    let quote: string | undefined;
    for (let at = from; at < text.length; at += 1) {
      const character = text[at]!;
      if (quote) {
        if (character === quote) quote = undefined;
        else if (character === "\\" && quote === '"') at += 1;
      } else if (character === "'" || character === '"') quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")" && --depth === 0)
        return [text.slice(from, at), at];
    }
    return [text.slice(from), text.length];
  };
  const backticks = (from: number): [string, number] => {
    const end = text.indexOf("`", from);
    return end < 0
      ? [text.slice(from), text.length]
      : [text.slice(from, end), end];
  };

  let at = 0;
  let quote: "'" | '"' | undefined;
  for (; at < text.length; at += 1) {
    const character = text[at]!;
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else word += character;
      continue;
    }
    if (character === "\\") {
      word += text[at + 1] ?? "";
      inWord = true;
      at += 1;
      continue;
    }
    if (character === "$" && text[at + 1] === "(") {
      const [inner, end] = substitution(at + 2);
      commands.push(...simpleCommands(inner));
      inWord = true;
      at = end;
      continue;
    }
    if (character === "`") {
      const [inner, end] = backticks(at + 1);
      commands.push(...simpleCommands(inner));
      inWord = true;
      at = end;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      inWord = true;
      continue;
    }
    if (character === "#" && !inWord) {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end - 1;
      continue;
    }
    if (/\s/.test(character) && character !== "\n") {
      endWord();
      continue;
    }
    // A redirection's `&`, as in `2>&1`, belongs to its word.
    if (character === "&" && (text[at - 1] === ">" || text[at - 1] === "<")) {
      word += character;
      continue;
    }
    if (";&|\n()".includes(character)) {
      endCommand();
      continue;
    }
    word += character;
    inWord = true;
  }
  endCommand();
  return commands;
}
