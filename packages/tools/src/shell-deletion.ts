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
 * `xargs`, `find -exec`, `wsl`, a package runner such as `npx`, and inline
 * Python or Node code. A heredoc, here-string or `<(…)` is the input of the
 * command it is given to, and of the next one down a pipe. It is read as
 * commands unless that command only reads text from it, as `cat`, `git` or
 * `grep` do, or runs a script that is named; what an unquoted heredoc
 * substitutes runs as it is read. A program or script that deletes on its own
 * is not seen; the shell approval, which says a command can do anything the
 * account can, still governs it.
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
  "wsl",
  "npx",
  "bunx",
]);

/** A wrapper's options that take the next word as their value. */
const wrapperValueOptions: Record<string, readonly string[]> = {
  sudo: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T"],
  doas: ["-u", "-C"],
  env: ["-u", "-C", "--unset", "--chdir"],
  nice: ["-n", "--adjustment"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  stdbuf: ["-i", "-o", "-e"],
  wsl: ["-d", "-u", "--cd", "--distribution", "--user"],
  npx: ["-p", "--package"],
};

/** Package managers whose subcommands here run the program after them. */
const runners = new Set(["npm", "pnpm", "yarn", "bun"]);
const runnerSubcommands = new Set(["exec", "dlx", "x"]);

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

/**
 * Programs that read their input only as text: a heredoc given to them is
 * data, whatever its lines say.
 */
const textReaders = new Set([
  ":",
  "true",
  "cat",
  "tac",
  "tee",
  "git",
  "gh",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "sed",
  "awk",
  "gawk",
  "sort",
  "uniq",
  "wc",
  "head",
  "tail",
  "tr",
  "cut",
  "paste",
  "column",
  "fold",
  "fmt",
  "nl",
  "diff",
  "cmp",
  "comm",
  "jq",
  "yq",
  "base64",
  "xxd",
  "od",
  "iconv",
  "envsubst",
  "clip",
  "read",
  "mapfile",
  "readarray",
  "curl",
  "less",
  "more",
  "md5sum",
  "sha1sum",
  "sha256sum",
]);

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;
const shells = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
/** Python by any of its names: `python3.12`, `pythonw`, or the launcher `py`. */
const python = /^(python(\d+(\.\d+)?)?|py)w?$/;
const powershells = new Set(["powershell", "pwsh"]);
/** Files that are a program's own input, named as its script. */
const inputFiles = new Set(["/dev/stdin", "/dev/fd/0", "/proc/self/fd/0"]);
/** git's own options that take the next word as their value. */
const gitValueOptions = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
]);

const pythonDeletion =
  /\b(os\.remove|os\.unlink|os\.rmdir|os\.removedirs|shutil\.rmtree|\.unlink|\.rmdir)\s*\(/;
const nodeDeletion =
  /\b(rmSync|unlinkSync|rmdirSync|rimraf|fs\.rm|fs\.unlink|fs\.rmdir|fs\.promises\.rm|fs\.promises\.unlink)\s*\(/;
/** PowerShell's own command that deletes, by its name or alias, its module's before it or not. */
const powershellRemoval = /^(?:[\w.]+\\)?(?:Remove-Item|ri)$/i;
/** .NET's deletion, called from PowerShell. */
const dotnetDeletion =
  /\[(?:System\.)?IO\.(?:File|Directory)\]::Delete(?=\s*\()/i;

/** One simple command: its words, and the text heredocs give it as input. */
type SimpleCommand = { readonly words: string[]; readonly input: string[] };

/** What in the command deletes, as it is written there, or nothing. */
export function deletionIn(command: string): string | undefined {
  for (const simple of simpleCommands(command)) {
    const found = deletionBy(simple.words) ?? inputDeletion(simple);
    if (found) return found;
  }
  return undefined;
}

/**
 * A program as it is named, whatever runs it: without its folder, a Windows
 * program's or shim's extension, or a package's pinned version (`rimraf@5`).
 */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word)
    .toLowerCase()
    .replace(/(?<=.)@[^@]*$/, "")
    .replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}

/** Where a simple command's program stands: past keywords, assignments and wrappers. */
function programAt(words: readonly string[]): number {
  let index = 0;
  while (
    index < words.length &&
    (keywords.has(words[index]!) || assignment.test(words[index]!))
  )
    index += 1;
  for (;;) {
    const name = programName(words[index] ?? "");
    if (wrappers.has(name)) index += 1;
    else if (runners.has(name) && runnerSubcommands.has(words[index + 1]!))
      index += 2;
    else return index;
    const valued = wrapperValueOptions[name] ?? [];
    while (
      index < words.length &&
      (words[index]!.startsWith("-") ||
        assignment.test(words[index]!) ||
        /^\d+[smhd]?$/.test(words[index]!))
    )
      index += valued.includes(words[index]!) ? 2 : 1;
  }
}

function deletionBy(words: readonly string[]): string | undefined {
  const index = programAt(words);
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
    // The subcommand comes after git's own options, some of which take the
    // next word as their value.
    let at = 0;
    while (at < args.length && args[at]!.startsWith("-"))
      at += gitValueOptions.has(args[at]!) ? 2 : 1;
    const sub = args[at];
    if (sub === "clean") return "git clean";
    if (sub === "rm" && !args.includes("--cached")) return "git rm";
    return undefined;
  }
  if (shells.has(name)) {
    const code = shellArguments(args).code;
    return code ? deletionIn(code) : undefined;
  }
  if (name === "eval") return deletionIn(args.join(" "));
  if (name === "cmd") {
    // Git Bash would turn `/c` into a drive, so it is written `//c` there.
    const at = args.findIndex((arg) => /^\/\/?[ck]$/i.test(arg));
    return at >= 0 ? cmdDeletion(args.slice(at + 1)) : undefined;
  }
  if (powershells.has(name)) return powershellArgumentsDeletion(args);
  if (python.test(name)) {
    const code = pythonCode(args);
    return code ? pythonDeletion.exec(code)?.[1] : undefined;
  }
  if (name === "node") {
    const at = args.findIndex((arg) => ["-e", "--eval", "-p"].includes(arg));
    const code = at >= 0 ? args[at + 1] : undefined;
    return code ? nodeDeletion.exec(code)?.[1] : undefined;
  }
  return undefined;
}

/**
 * What PowerShell given these arguments deletes. Its options are not told
 * apart from the words they are given, as PowerShell takes many spellings of
 * each: the words from each one on are read as code, which covers code after
 * `-Command`, a script after `-File` and either after its options. An
 * encoded command is decoded first.
 */
function powershellArgumentsDeletion(
  args: readonly string[],
): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const option = args[at]!.toLowerCase().replace(/^[-/]+/, "");
    const encoded = args[at + 1];
    if (
      /^[-/]/.test(args[at]!) &&
      encoded !== undefined &&
      (option === "ec" ||
        (option.startsWith("e") && "encodedcommand".startsWith(option)))
    ) {
      const found = powershellCodeDeletion(
        Buffer.from(encoded, "base64").toString("utf16le"),
      );
      if (found) return found;
    }
    const found = powershellCodeDeletion(args.slice(at).join(" "));
    if (found) return found;
  }
  return undefined;
}

/**
 * What PowerShell code deletes: .NET's deletion, PowerShell's own, or any
 * program a statement runs, called by name, by path or with `&` or `.`, and
 * the same in the code a double-quoted `$(…)` runs. A quoted word standing
 * first without `&` is a value, as is a key given a value with `=`.
 */
function powershellCodeDeletion(code: string): string | undefined {
  const read = readPowerShell(code);
  const dotnet = dotnetDeletion.exec(read.bare);
  if (dotnet) return dotnet[0];
  for (const inner of read.inner) {
    const found = powershellCodeDeletion(inner);
    if (found) return found;
  }
  for (const statement of read.statements) {
    const words = [...statement];
    const called = words[0]?.text === "&" || words[0]?.text === ".";
    if (called) words.shift();
    const first = words[0];
    if (!first || (first.quoted && !called) || words[1]?.text === "=") continue;
    if (powershellRemoval.test(first.text)) return first.text;
    const named = deletionBy(words.map((word) => word.text));
    if (named) return named;
  }
  return undefined;
}

type PowerShellWord = { readonly text: string; readonly quoted: boolean };

/**
 * PowerShell code as its statements' words, split at `;`, `|`, `&&`, a `&`
 * after a command, parentheses, braces and line breaks outside its quotes; a
 * `&` before a command is a word of its own. A backtick keeps the character
 * after it. Also the code with what its quotes hold blanked out, and the code
 * each double-quoted `$(…)` runs.
 */
function readPowerShell(code: string): {
  readonly statements: readonly (readonly PowerShellWord[])[];
  readonly bare: string;
  readonly inner: readonly string[];
} {
  const statements: PowerShellWord[][] = [];
  const inner: string[] = [];
  let bare = "";
  let words: PowerShellWord[] = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  let quote: "'" | '"' | undefined;
  const endWord = () => {
    if (inWord) words.push({ text: word, quoted });
    word = "";
    inWord = false;
    quoted = false;
  };
  const endStatement = () => {
    endWord();
    if (words.length) statements.push(words);
    words = [];
  };
  for (let at = 0; at < code.length; at += 1) {
    const character = code[at]!;
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else word += character;
      bare += " ";
      continue;
    }
    if (character === "`") {
      word += code[at + 1] ?? "";
      inWord = true;
      at += 1;
      bare += "  ";
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else if (character === "$" && code[at + 1] === "(") {
        const end = closingParenthesis(code, at + 1);
        inner.push(code.slice(at + 2, end));
        word += code.slice(at, end + 1);
        at = end;
      } else word += character;
      bare += " ";
      continue;
    }
    bare += character;
    if (character === "'" || character === '"') {
      quote = character;
      quoted = true;
      inWord = true;
    } else if (character === "&") {
      // After a command it ends it, as `&` and `&&` do; before one it runs it.
      if (words.length || inWord) endStatement();
      else words.push({ text: "&", quoted: false });
    } else if (";|(){}\n".includes(character)) endStatement();
    else if (/\s/.test(character)) endWord();
    else {
      word += character;
      inWord = true;
    }
  }
  endStatement();
  return { statements, bare, inner };
}

/** Where the parenthesis opened at `open` closes, or the end of the code. */
function closingParenthesis(code: string, open: number): number {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === "(") depth += 1;
    else if (code[at] === ")" && --depth === 0) return at;
  }
  return code.length;
}

/**
 * What the input given to a command deletes. A shell, Python or Node runs it
 * as code unless given code or a script of its own to run; a
 * program that only reads text takes it as data; anything else is assumed to
 * run it, since a program that hands its input to a shell, such as `ssh`,
 * cannot be told from the outside.
 */
function inputDeletion(simple: SimpleCommand): string | undefined {
  if (!simple.input.length) return undefined;
  const index = programAt(simple.words);
  const first = simple.words[index];
  const body = simple.input.join("\n");
  // A wrapper given no command, such as `wsl`, reads its input itself.
  if (first === undefined)
    return simple.words.some((word) => wrappers.has(programName(word)))
      ? deletionIn(body)
      : undefined;
  const name = programName(first);
  const args = simple.words.slice(index + 1);
  // Given to a loop or block, input goes to the commands inside it, which are
  // read on their own.
  if (["done", "fi", "esac"].includes(name)) return undefined;
  if (shells.has(name)) {
    const shell = shellArguments(args);
    return shell.code === undefined &&
      (shell.readsInput ||
        shell.script === undefined ||
        inputFiles.has(shell.script))
      ? deletionIn(body)
      : undefined;
  }
  if (python.test(name))
    return pythonCode(args) === undefined && readsCodeInput(args)
      ? pythonDeletion.exec(body)?.[1]
      : undefined;
  if (name === "node") {
    const script = args.find((arg) => arg === "-" || !arg.startsWith("-"));
    return !args.some((arg) =>
      ["-e", "--eval", "-p", "--print"].includes(arg),
    ) &&
      (!script || script === "-" || inputFiles.has(script))
      ? nodeDeletion.exec(body)?.[1]
      : undefined;
  }
  return textReaders.has(name) ? undefined : deletionIn(body);
}

/**
 * Whether Python, given these options, runs the code on its input: no module
 * or script named, or `-`. `-W`, `-X` and `-Q` take a value of their own.
 */
function readsCodeInput(args: readonly string[]): boolean {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === "-" || inputFiles.has(arg)) return true;
    if (/^-\d[\d.]*(-(32|64))?$/.test(arg) || arg.startsWith("-V:")) continue;
    if (!arg.startsWith("-")) return false;
    if (/^-[A-Za-z]*m/.test(arg)) return false;
    if (/^-[A-Za-z]*[WXQ]$/.test(arg)) at += 1;
  }
  return true;
}

/**
 * What a shell is given to run: the command text after `-c`, which may be
 * combined with other single-letter options (`bash -lc '…'`), or the script
 * named after the options, and whether `-s` has it read commands from its
 * input. Each `o` or `O` among the letters takes the next word as its value
 * (`-euo pipefail`), as do `--rcfile` and `--init-file`; `-` or `--` ends the
 * options.
 */
function shellArguments(args: readonly string[]): {
  readonly code?: string;
  readonly script?: string;
  readonly readsInput: boolean;
} {
  let reads = false;
  let readsInput = false;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === "-" || arg === "--") {
      const next = args[at + 1];
      if (next === undefined) return { readsInput };
      return reads ? { code: next, readsInput } : { script: next, readsInput };
    }
    if (arg === "--rcfile" || arg === "--init-file") at += 1;
    else if (arg.startsWith("--")) continue;
    else if (/^[-+][A-Za-z]+$/.test(arg)) {
      reads ||= arg.startsWith("-") && arg.includes("c");
      readsInput ||= arg.startsWith("-") && arg.includes("s");
      at += arg.replace(/[^oO]/g, "").length;
    } else
      return reads ? { code: arg, readsInput } : { script: arg, readsInput };
  }
  return { readsInput };
}

/**
 * The code Python runs with `-c`, which may follow other single-letter options
 * in the same word (`-Bc`) and may be joined to it (`-c"…"`). Options after a
 * script or module name belong to that script. The Windows launcher `py`
 * takes a version first, such as `-3` or `-3.12`, or `-V:` and a tag.
 */
function pythonCode(args: readonly string[]): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (/^-\d[\d.]*(-(32|64))?$/.test(arg) || arg.startsWith("-V:")) continue;
    if (!/^-[A-Za-z]/.test(arg)) return undefined;
    for (let letter = 1; letter < arg.length; letter += 1) {
      const option = arg[letter]!;
      const rest = arg.slice(letter + 1);
      if (option === "c") return rest || args[at + 1];
      if (option === "m") return undefined;
      // These take a value, joined or as the next word.
      if ("WXQ".includes(option)) {
        if (!rest) at += 1;
        break;
      }
    }
  }
  return undefined;
}

const cmdDeleting = new Set(["del", "erase", "rd", "rmdir"]);

/**
 * A `cmd /c` line, given as the words bash read. Git Bash hands them to cmd
 * as one line, quoting each that holds a space or a quote and writing a quote
 * inside one as `\"`. cmd drops the line's first and last quote when it
 * starts with one, splits it at `&`, `&&`, `|` and `||` outside its quotes,
 * and runs each command.
 */
function cmdDeletion(words: readonly string[]): string | undefined {
  const joined = words
    .map((word) =>
      !word || /[\s"]/.test(word) ? `"${word.replace(/"/g, '\\"')}"` : word,
    )
    .join(" ");
  const last = joined.lastIndexOf('"');
  const line =
    joined.startsWith('"') && last > 0
      ? joined.slice(1, last) + joined.slice(last + 1)
      : joined;
  for (const segment of cmdSegments(line)) {
    const found = cmdCommandDeletion(programWords(segment));
    if (found) return found;
  }
  return undefined;
}

/**
 * A cmd line split at `&`, `&&`, `|` and `||`. cmd ignores a backslash, so
 * every quote opens or closes a quoted part; outside one, `^` keeps the
 * character after it.
 */
function cmdSegments(line: string): string[] {
  const segments: string[] = [];
  let segment = "";
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at]!;
    if (character === "^" && !quoted) {
      segment += line[at + 1] ?? "";
      at += 1;
    } else if (character === '"') {
      quoted = !quoted;
      segment += character;
    } else if (!quoted && (character === "&" || character === "|")) {
      if (line[at + 1] === character) at += 1;
      segments.push(segment.trim());
      segment = "";
    } else segment += character;
  }
  segments.push(segment.trim());
  return segments.filter(Boolean);
}

/**
 * A command's words as a Windows program reads its command line: split at
 * spaces outside quotes, with `\"` a quote of the word's own.
 */
function programWords(segment: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  for (let at = 0; at < segment.length; at += 1) {
    const character = segment[at]!;
    if (character === "\\" && segment[at + 1] === '"') {
      word += '"';
      inWord = true;
      at += 1;
    } else if (character === '"') {
      quoted = !quoted;
      inWord = true;
    } else if (/\s/.test(character) && !quoted) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      word += character;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/**
 * What one cmd command deletes: past `@`, an opening parenthesis, the test of
 * an `if` and the head of a `for … do`, a command of cmd's own that deletes,
 * or any other program as it would run anywhere.
 */
function cmdCommandDeletion(given: readonly string[]): string | undefined {
  const words = given.map((word) => word.replace(/^[@(]+/, ""));
  let at = 0;
  while (at < words.length) {
    const word = words[at]!.toLowerCase();
    if (word === "" || word === "else") at += 1;
    else if (word === "if") {
      at += 1;
      if (words[at]?.toLowerCase() === "/i") at += 1;
      if (words[at]?.toLowerCase() === "not") at += 1;
      const test = words[at]?.toLowerCase() ?? "";
      if (["exist", "defined", "errorlevel", "cmdextversion"].includes(test))
        at += 2;
      else if (/^(==|equ|neq|lss|leq|gtr|geq)$/i.test(words[at + 1] ?? ""))
        at += 3;
      else at += 1;
    } else if (word === "for") {
      const body = words.findIndex(
        (each, place) => place > at && each.toLowerCase() === "do",
      );
      if (body < 0) return undefined;
      at = body + 1;
    } else break;
  }
  const command = words.slice(at);
  const name = programName(command[0] ?? "");
  if (cmdDeleting.has(name)) return name;
  return deletionBy(command);
}

/**
 * The simple commands a bash line runs, each as its words with quoting
 * removed, including those inside `$(…)` and backticks.
 */
function simpleCommands(text: string): SimpleCommand[] {
  return parsed(text, 0, false).commands;
}

/**
 * The simple commands in `text` from `start`, and where they end: at the end
 * of the text or, `nested` inside `$(…)`, at the parenthesis closing it. A
 * backslash before a line break joins the lines, and a heredoc's lines are
 * the input of its command, never commands of their own.
 */
function parsed(
  text: string,
  start: number,
  nested: boolean,
): { readonly commands: SimpleCommand[]; readonly end: number } {
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], input: [] };
  let word = "";
  let inWord = false;
  let depth = 0;
  /** Heredocs opened on this line, whose lines follow it. */
  let pending: {
    readonly delimiter: string;
    readonly tabs: boolean;
    readonly quoted: boolean;
    readonly command: SimpleCommand;
  }[] = [];
  /** The next word is a here-string: input, not an argument. */
  let hereString = false;
  const endWord = () => {
    if (inWord) (hereString ? current.input : current.words).push(word);
    if (inWord) hereString = false;
    word = "";
    inWord = false;
  };
  /** Ends the command; `piped`, its input goes on to the next. */
  const endCommand = (piped = false) => {
    endWord();
    hereString = false;
    if (current.words.length) commands.push(current);
    // Shared, not copied: a heredoc on this line is read after the pipe.
    const input = piped ? current.input : [];
    current = { words: [], input };
  };
  /** Reads the pending heredocs' lines from `from`; answers where they end. */
  const heredocs = (from: number): number => {
    let at = from;
    for (const heredoc of pending) {
      const lines: string[] = [];
      while (at < text.length) {
        const newline = text.indexOf("\n", at);
        const end = newline < 0 ? text.length : newline;
        let line = text.slice(at, end).replace(/\r$/, "");
        if (heredoc.tabs) line = line.replace(/^\t+/, "");
        at = end + 1;
        if (line === heredoc.delimiter) break;
        lines.push(line);
      }
      const body = lines.join("\n");
      heredoc.command.input.push(body);
      // Unquoted, its substitutions run as it is read.
      if (!heredoc.quoted) commands.push(...substitutions(body));
    }
    pending = [];
    return at;
  };

  let quote: "'" | '"' | undefined;
  for (let at = start; at < text.length; at += 1) {
    const character = text[at]!;
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else word += character;
      continue;
    }
    if (character === "\\") {
      const next = text[at + 1];
      if (next === "\n") at += 1;
      else if (next === "\r" && text[at + 2] === "\n") at += 2;
      else {
        word += next ?? "";
        inWord = true;
        at += 1;
      }
      continue;
    }
    if (character === "$" && text[at + 1] === "(") {
      const inner = parsed(text, at + 2, true);
      commands.push(...inner.commands);
      // `$(cat <<EOF …)` stands for the heredoc's text, as bash puts it.
      word += printedBy(inner.commands) ?? "";
      inWord = true;
      at = inner.end;
      continue;
    }
    if (character === "`") {
      const end = text.indexOf("`", at + 1);
      const close = end < 0 ? text.length : end;
      const inner = simpleCommands(text.slice(at + 1, close));
      commands.push(...inner);
      word += printedBy(inner) ?? "";
      inWord = true;
      at = close;
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
    if (text.startsWith("<<<", at)) {
      // A here-string: the word after it is the command's input.
      endWord();
      hereString = true;
      at += 2;
      continue;
    }
    if (
      text.startsWith("((", at) &&
      !inWord &&
      current.words.every((each) => keywords.has(each) || each === "for")
    ) {
      // Arithmetic: its `<<` is a shift, and only what it substitutes runs.
      // A `((` whose first closing parenthesis is not `))` opens subshells.
      const end = arithmeticEnd(text, at);
      if (end >= 0) {
        commands.push(...substitutions(text.slice(at + 2, end - 1)));
        at = end;
        continue;
      }
    }
    if (text.startsWith("<<", at)) {
      endWord();
      let from = at + 2;
      const tabs = text[from] === "-";
      if (tabs) from += 1;
      while (text[from] === " " || text[from] === "\t") from += 1;
      const [delimiter, end, quoted] = heredocWord(text, from);
      if (delimiter)
        pending.push({ delimiter, tabs, quoted, command: current });
      at = end - 1;
      continue;
    }
    if (
      (character === "<" || character === ">") &&
      text[at + 1] === "(" &&
      !inWord
    ) {
      // Process substitution: what `<(…)` prints is a file the command
      // reads, taken as its input.
      const inner = parsed(text, at + 2, true);
      commands.push(...inner.commands);
      const printed = printedBy(inner.commands);
      if (character === "<" && printed !== undefined)
        current.input.push(printed);
      at = inner.end;
      continue;
    }
    if (character === "\n") {
      endCommand();
      if (pending.length) at = heredocs(at + 1) - 1;
      continue;
    }
    if (/\s/.test(character)) {
      endWord();
      continue;
    }
    // A redirection's `&`, as in `2>&1`, belongs to its word.
    if (character === "&" && (text[at - 1] === ">" || text[at - 1] === "<")) {
      word += character;
      continue;
    }
    if (nested && character === "(") depth += 1;
    if (nested && character === ")" && depth-- === 0) {
      endCommand();
      return { commands, end: at };
    }
    if (character === "|" && text[at + 1] !== "|" && text[at - 1] !== "|") {
      // `|&` pipes the errors too.
      if (text[at + 1] === "&") at += 1;
      endCommand(true);
      continue;
    }
    if (";&|()".includes(character)) {
      endCommand();
      continue;
    }
    word += character;
    inWord = true;
  }
  endCommand();
  return { commands, end: text.length };
}

/**
 * Where arithmetic opened by the `((` at `at` ends, at its last parenthesis,
 * or -1 when the first parenthesis closing at its level is not followed by
 * another, as in `((cd build && make) || true)`, which is two subshells.
 */
function arithmeticEnd(text: string, at: number): number {
  let depth = 0;
  for (let place = at + 2; place < text.length; place += 1) {
    if (text[place] === "(") depth += 1;
    else if (text[place] === ")") {
      if (depth > 0) depth -= 1;
      else return text[place + 1] === ")" ? place + 1 : -1;
    }
  }
  return -1;
}

/**
 * The commands a heredoc's text runs as bash reads it: those in its `$(…)`
 * and backticks. A backslash keeps the character after it as text.
 */
function substitutions(body: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "\\") at += 1;
    else if (body[at] === "$" && body[at + 1] === "(") {
      const inner = parsed(body, at + 2, true);
      commands.push(...inner.commands);
      at = inner.end;
    } else if (body[at] === "`") {
      const end = body.indexOf("`", at + 1);
      const close = end < 0 ? body.length : end;
      commands.push(...simpleCommands(body.slice(at + 1, close)));
      at = close;
    }
  }
  return commands;
}

/**
 * What a substitution's commands may print: the heredocs and here-strings
 * they read, and the words `echo` and `printf` are given. Nothing when they
 * have none.
 */
function printedBy(commands: readonly SimpleCommand[]): string | undefined {
  const parts: string[] = [];
  const inputs = new Set<readonly string[]>();
  for (const simple of commands) {
    if (simple.input.length && !inputs.has(simple.input)) {
      inputs.add(simple.input);
      parts.push(simple.input.join("\n"));
    }
    const index = programAt(simple.words);
    const name = programName(simple.words[index] ?? "");
    if (name === "echo" || name === "printf")
      parts.push(simple.words.slice(index + 1).join(" "));
  }
  return parts.length ? parts.join("\n") : undefined;
}

/**
 * The word naming where a heredoc ends, with its quoting removed, and whether
 * any of it was quoted, which keeps the heredoc's text from being expanded.
 */
function heredocWord(text: string, from: number): [string, number, boolean] {
  let word = "";
  let quote: string | undefined;
  let quoted = false;
  let at = from;
  for (; at < text.length; at += 1) {
    const character = text[at]!;
    if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      quoted = true;
    } else if (character === "\\") {
      word += text[at + 1] ?? "";
      quoted = true;
      at += 1;
    } else if (/\s/.test(character) || ";&|<>()".includes(character)) break;
    else word += character;
  }
  return [word, at, quoted];
}
