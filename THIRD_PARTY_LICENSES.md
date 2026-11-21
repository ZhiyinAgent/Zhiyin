# Third-party licenses

Zhiyin includes third-party software under licenses compatible with its
Apache-2.0 distribution. This file records attributions that must accompany the
source and packaged developer previews. Package metadata and the lockfile remain
the inventory of exact dependency versions.

The build writes `THIRD_PARTY_NOTICES.txt` beside each part of the app that
bundles npm packages, the main process and the window, with every bundled
package's name, version and licence text. Packages the app loads at run time
ship in their own folders with their licence files.

## khroma 2.1.0

Khroma is included transitively by Mermaid 11.17.2.

- Source: <https://github.com/fabiospampinato/khroma>
- License: MIT
- Copyright: Copyright (c) 2019-present Fabio Spampinato, Andrew Maney

> The MIT License (MIT)
>
> Copyright (c) 2019-present Fabio Spampinato, Andrew Maney
>
> Permission is hereby granted, free of charge, to any person obtaining a
> copy of this software and associated documentation files (the "Software"),
> to deal in the Software without restriction, including without limitation
> the rights to use, copy, modify, merge, publish, distribute, sublicense,
> and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
> FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

## ripgrep 15.0.0

The packaged application runs the `rg.exe` program to search workspace files.
It is installed by `@vscode/ripgrep` 1.18.0, which builds ripgrep with PCRE2
10.45 linked in.

- Source: <https://github.com/BurntSushi/ripgrep>
- License: MIT or the Unlicense, at the user's choice; Zhiyin uses it under MIT
- Copyright: Copyright (c) 2015 Andrew Gallant

> The MIT License (MIT)
>
> Copyright (c) 2015 Andrew Gallant
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

PCRE2 is licensed BSD-3-Clause with the PCRE2 exception, which waives its
notice requirement for a binary that links it as a library. The Rust crates
ripgrep links are not listed one by one here.

## vscode-ripgrep 1.18.0

`@vscode/ripgrep` and `@vscode/ripgrep-win32-x64` locate and install the
program above.

- Source: <https://github.com/microsoft/vscode-ripgrep>
- License: MIT
- Copyright: Copyright (c) Microsoft Corporation

> MIT License
>
> Copyright (c) Microsoft Corporation
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

## Anthropic frontend-design skill

Zhiyin includes an adapted version of Anthropic's frontend-design skill.

- Source: <https://github.com/anthropics/skills/tree/main/skills/frontend-design>
- License: Apache-2.0
- Modification: adapted for Zhiyin's capability model, runtime boundaries, and
  interface-validation requirements
- License copy: `apps/desktop/third-party-licenses/anthropic-frontend-design-LICENSE.txt`

## busybox-w32 FRP-6354-g5f09fb446

Zhiyin ships busybox-w32 as the shell its commands run in (ADR 0029), built
from the commit below with two patches of Zhiyin's, as a program beside the
app's archive. The patches and the script that builds it are in the
repository: `scripts/busybox/null-device.patch` emulates `/dev/null` where an
app container is refused Windows' null device, and
`scripts/busybox/exec-wait.patch` keeps the shell waiting for the command it
runs last when it cannot see its parent; `scripts/busybox.mjs` builds it with
the configuration `mingw64u_defconfig`. The program beside it,
`busybox/git/git.exe`, is Zhiyin's own, under Zhiyin's licence.

The installed app carries the complete source beside the program, in
`resources\busybox\source\` of the folder Zhiyin is installed in:
busybox-w32's source tarball for the commit below, byte for byte as GitHub
serves it (`busybox-w32-5f09fb446adf81d005f0aad9dc47eca19ac3b74c.tar.gz`,
SHA-256 `5fe1444e…4839`), both patches, `git-handoff.c`, and `pins.json`,
which names the toolchain and configuration it is built with. Packaging
checks that it is there and that the tarball has that SHA-256.

- Source: <https://github.com/rmyorston/busybox-w32>, commit
  `5f09fb446adf81d005f0aad9dc47eca19ac3b74c`
- License: GNU General Public License, version 2 only
- Copyright: the BusyBox authors, and Ron Yorston and contributors for the
  Windows port
- License copy: `apps/desktop/third-party-licenses/busybox-w32/LICENSE`

## Chromium hunspell dictionaries

Zhiyin ships the spelling dictionaries Chromium uses, unmodified: each `.bdic`
file is identical to the one at the source commit below, and is placed where
Electron's spellchecker reads it.

- Source: <https://chromium.googlesource.com/chromium/deps/hunspell_dictionaries>,
  commit `cccf64a8acc951afe3f47fee023908e55699bc58`; the `.dic`, `.aff` and
  `.dic_delta` files there are what each `.bdic` is generated from
- License: MPL 1.1, GPL 2.0, LGPL 2.1, GPL 3.0 or LGPL 3.0, at the user's
  choice; Zhiyin distributes them under MPL 1.1. Russian (`ru-RU`) has its own
  BSD-style license, and Tajik (`tg-TG`) the Apache License 2.0
- Copyright: each dictionary's authors, named in its `README_<language>.txt`
- License copies: `apps/desktop/third-party-licenses/hunspell-dictionaries/`,
  holding Chromium's `LICENSE`, its `README.chromium` (what Chromium changed in
  each dictionary), and each dictionary's own README

## Noto Sans CJK SC 2.004

Zhiyin ships the Simplified Chinese face of Noto Sans CJK, unmodified, packed
in the app's archive. Documents are drawn with it for the Chinese, Japanese
and Korean characters a document's own fonts cannot draw (ADR 0019).

- Source: <https://github.com/notofonts/noto-cjk>, commit
  `165c01b46ea533872e002e0785ff17e44f6d97d8`,
  `Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`
- License: SIL Open Font License 1.1
- Copyright: © 2014-2021 Adobe (http://www.adobe.com/)
- License copy: `apps/desktop/third-party-licenses/noto-sans-cjk/LICENSE`

The packaged application also carries the existing detailed notice and license
copy under `third-party-licenses/`.
