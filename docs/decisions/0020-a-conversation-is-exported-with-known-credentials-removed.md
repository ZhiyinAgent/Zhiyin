# 0020. A conversation is exported as a page or a record, with known credentials removed

Status: accepted

## Decision

- **Two exports, chosen from a conversation's menu.** Its Export item asks
  which, describing each, and the person chooses where the file goes.
  - "A page to read" (HTML) is one page that opens offline in any browser,
    with no scripts and nothing fetched: the messages, and each action with
    who allowed it, what it changed as a diff, and what it answered.
  - "Data to analyse" (JSON) is the saved record close to raw and never
    shortened, model requests and responses included, under a header naming
    the format and the app version.
- **Known credentials are removed from both files.** One remover, in the
  contract package, blanks fields named like credentials and removes
  recognised formats from text: `Authorization` headers, `Bearer` tokens,
  `--password=` and similar flags, a password in a URL, and common key
  prefixes. The agent loop uses the same remover for the evidence it gives the
  model. The saved conversation is left as it was (ADR 0019).
- **Both files say what they leave out**: that removal recognises known
  formats and cannot prove none remain, and that pictures and attachments are
  named rather than included. The page also says that whole file contents and
  model requests are not in it, and that it is a copy Zhiyin cannot delete.

## Why

A record that cannot leave the app is only half auditable: the reviewer is
often someone else, and a bug report needs the real record. A person reads a
page; another program or model analyses a record. Neither should carry the
keys the assistant used, but pattern matching cannot promise that, so the files
say exactly what was done.

## Rejected

- One file for both readers: a page holding the raw record is long for a person
  and awkward for a program.
- Saying "credentials were removed": a format nobody listed passes through.
- Rendering the page in the window: the core would ask the window a second
  kind of question (ADR 0003), and the window does not hold the model
  requests.

## Assumptions

- A file the person saves is theirs to send; Zhiyin cannot delete it, and the
  page says so.
