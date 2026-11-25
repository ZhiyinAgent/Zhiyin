<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.webp">
    <img alt="Zhiyin: an AI agent for your PC. Free and open source, for Windows." src=".github/assets/banner-light.webp" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://zhiyinagent.app"><img alt="Website: zhiyinagent.app" src="https://img.shields.io/badge/website-zhiyinagent.app-e01f13"></a>
  <a href="https://github.com/ZhiyinAgent/Zhiyin/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ZhiyinAgent/Zhiyin/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078D4">
  <img alt="Status: developer preview" src="https://img.shields.io/badge/status-developer%20preview-orange">
</p>

**Zhiyin** is an AI agent for your PC. Tell it what you need in plain words,
and it does the work in a folder you choose: plans a trip, quizzes you before
an exam, finds where the money went, builds a website, checks the numbers on a
big purchase. It is a free, open-source Windows app for people who want to use
AI agents, made to be easy to read and easy to use. It runs on your own key
with the model provider you choose, and shows what each conversation cost.

New to AI agents? [Start here](docs/getting-started.md): setting Zhiyin up
takes a few minutes.

https://github.com/user-attachments/assets/67128e82-6adc-4bcb-ac21-25ad92e0f016

<p align="center">
  <a href="https://github.com/ZhiyinAgent/Zhiyin/releases/download/v0.1.0-alpha.2/Zhiyin-Setup-0.1.0-alpha.2.exe"><img alt="Download for Windows: developer preview" src="https://img.shields.io/badge/Download_for_Windows-Developer_preview-0078D4?style=for-the-badge&labelColor=24292f"></a>
</p>

> [!NOTE]
> Zhiyin is in **developer preview**. The installer has no Windows code
> signature, so Windows shows a warning before it runs. Once installed, Zhiyin
> updates itself: it downloads a newer version only when the maintainers'
> release key signed it, and installs it when you restart into it. Every
> version is also published on
> [Releases](https://github.com/ZhiyinAgent/Zhiyin/releases).

**The name.** 知音 (*zhīyīn*) comes from an old Chinese story. Bo Ya played
the qin, and his friend Zhong Ziqi understood every piece: when Bo Ya's music
turned to high mountains, Zhong Ziqi heard the mountains, and when it turned
to flowing water, he heard the river. The word, literally "one who knows the
tune", came to mean a friend who understands what you mean. That is what
Zhiyin is for.

## What it does

- **Works in the folder you choose**, through a model you choose, on
  OpenRouter or on its lab's own platform: Anthropic, OpenAI, Mistral,
  DeepSeek, Kimi, Qwen, Z.ai, MiniMax or Xiaomi MiMo, international or
  mainland China. Your own key is kept in Windows Credential Manager.
- **Lets you undo what it changes.** Changes in your folder run without
  stopping you: each file is saved the moment something first writes to it,
  whatever its size, and every change is shown in the conversation, line by
  line, with a way back. It asks only for what it can neither prevent nor
  undo, such as a command that needs your full access, deleting for good, a
  change outside your folder, or acting as you on an account. Where one
  answer can stand, you can allow it for the rest of the conversation: a
  website or folder its commands may reach, a file or folder outside your
  folder, one place on an account, one tool of a connector you added, or a
  file too large to back up.
- **Lets you go back.** Edit an earlier message and send it again, and the
  files it changed can go back too, with what it remembered in between, or
  only one of the two. Each turn's changes can also be undone on their own.
- **Remembers.** From one conversation to the next, it keeps what you tell it
  about yourself and how you want it to work, where each piece of work
  stands, and what it learned along the way, as files on your computer. The
  Memory page shows every entry, to open, edit or delete, and memory can be
  switched off.
- **Shows its work.** Every action is listed with what it was for and how it
  ended. It browses in its own headless browser, which you can watch, reads
  PDFs and pictures and shows them beside the conversation, and draws charts
  and diagrams.
- **Builds and renders in 3D.** In a Blender of its own, which it installs
  when you ask, it builds scenes and renders them: product pictures, rooms
  from a floor plan, parts to 3D print. The scene is a `.blend` file in your
  folder, drawn beside the conversation after every change. Its CAD studio
  builds exact parts from code, exports them as STEP, STL, 3MF or glTF, and
  makes dimensioned drawings of them.
- **Asks you, and quizzes you.** When a choice would change the work, it asks
  a few short questions instead of guessing. When you are learning, it builds
  scored quizzes with an explanation for every question.
- **Grows with plugins** that bundle skills, specialists and connectors,
  including remote MCP servers you reach with a pasted key or the service's
  own sign-in. Five come built in, for software engineering, technical
  publishing, data analysis, research and 3D, and you can make your own.
- **Shows what it cost**, conversation by conversation: the provider's own
  figure, or an estimate from the lab's price list, in the lab's currency.
- **Exports a conversation** as a page to read, or as an ATIF trajectory with its pictures for a program to analyse.
- **Checks your spelling** as you type, in the languages you choose from 47,
  with every dictionary included.

Shell commands run sealed off in a Windows app container, in Zhiyin's own
shell. They reach your folder, the folders and websites you allowed for the
conversation, and package registries and Git hosts, so they run without
asking, and what they change in your folder can be undone. A command that
needs your full access, such as installing for the whole computer or pushing
with your credentials, asks every time. Commands stop when the app closes.
Python scripts, CAD builds, Blender and LaTeX run in app containers too. The [security policy](.github/SECURITY.md) says what each
boundary covers.

## Get Zhiyin

### Install the developer preview

Download
[`Zhiyin-Setup-0.1.0-alpha.2.exe`](https://github.com/ZhiyinAgent/Zhiyin/releases/download/v0.1.0-alpha.2/Zhiyin-Setup-0.1.0-alpha.2.exe)
from the
[`v0.1.0-alpha.2`](https://github.com/ZhiyinAgent/Zhiyin/releases/tag/v0.1.0-alpha.2)
prerelease. Microsoft Defender SmartScreen warns before it runs: choose **More
info**, then **Run anyway**.

You also need:

- an API key, from [OpenRouter](https://openrouter.ai) or from the platform
  of the lab that makes the model; whoever issued the key bills your account
  for the models you use;
- Edge or Chrome, for browser work;
- [Git for Windows](https://git-scm.com/download/win), for git: Zhiyin runs
  it for the Git connector and for git in shell commands.

To check the installer before running it, compare
`Get-FileHash .\Zhiyin-Setup-0.1.0-alpha.2.exe` with the SHA-256 in the
release notes, and confirm its origin with
`gh attestation verify .\Zhiyin-Setup-0.1.0-alpha.2.exe --repo ZhiyinAgent/Zhiyin`.
The release workflow builds only an alpha tag that matches the app's
version, after the full gate passes, with `SHA256SUMS.txt` and a
build-provenance attestation. A maintainer then checks the installer against
both, signs it with the release key and publishes the release.

### Run from source

Install Git, Node.js (22.22.2 or a later 22, 24.15 or a later 24, or 26 and
later), and Edge or Chrome. Then run:

```powershell
corepack enable
pnpm install
pnpm --filter desktop install:electron
pnpm dev
```

`pnpm install` does not download Electron's runtime; the `install:electron`
step does. Run it again whenever `node_modules` has been deleted. Add a key
on the Model page, OpenRouter's or a lab's. [CONTRIBUTING.md](.github/CONTRIBUTING.md) has
the rest.

## Verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gate.ps1
```

The gate is the one definition of green, locally and in GitHub Actions: lint,
including the rules that hold feature boundaries, theme and formatting
checks, unused-code and dependency audits, strict type checking, unit and
real-browser tests, the production build, and tests against the built app.
Every pull request must pass it. Add `-Full` to build and check the installer
too, as the release workflow does.

## Project guide

- [Getting started](docs/getting-started.md)
- [Architecture overview](docs/architecture/overview.md): the layers, the
  packages, and the path of one message
- [Vocabulary](docs/vocabulary.md): the words the code and the window use
- [Adding a tool or a feature](docs/architecture/adding.md)
- [Architecture decisions](docs/decisions/)
- [Feature boundaries](docs/architecture/features/)
- [Product behavior](docs/product-behavior/)
- [Built-in plugins](docs/built-in-plugin-catalog.md)
- [Testing philosophy](docs/testing-philosophy.md)
- [Tooling and gate](docs/tooling.md)
- [Maintainers' guide](docs/maintainers.md): releases, signing keys, the
  model list and mirrors
- [The app's look](docs/brand.md), and
  [the website's and videos'](docs/brand-motion.md)
- [Contributing](.github/CONTRIBUTING.md)
- [Security policy](.github/SECURITY.md)
- [Third-party licenses](THIRD_PARTY_LICENSES.md)

## License

Copyright 2026 Bastien HOTTELET. Licensed under the
[Apache License 2.0](LICENSE). Required attributions are recorded in
[NOTICE](NOTICE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
