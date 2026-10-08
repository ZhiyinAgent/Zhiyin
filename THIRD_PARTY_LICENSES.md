# Third-party licenses

Zhiyin includes third-party software under licenses compatible with its
Apache-2.0 distribution. This file records attributions that must accompany the
source and packaged developer previews. Package metadata and the lockfile remain
the inventory of exact dependency versions.

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

The packaged application also carries the existing detailed notice and license
copy under `third-party-licenses/`.
