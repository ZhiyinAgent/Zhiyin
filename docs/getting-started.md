# Getting started

Zhiyin is an AI agent for your PC: you describe a task in plain words, and it
does the work in a folder you choose, asking before it changes anything. This
page takes you from download to your first task. You need a Windows PC and,
for the AI itself, about $5 of credit (step 2). Web search has a free monthly
allowance (step 5).

## 1. Install Zhiyin

1. Download the installer from the **Download for Windows** button in the
   [README](../README.md), or from the newest release on the
   [Releases page](https://github.com/ZhiyinAgent/Zhiyin/releases).
2. Open the downloaded file. Microsoft Defender SmartScreen shows "Windows
   protected your PC", because the installer is not code-signed yet. Select
   **More info**, then **Run anyway**.
3. Follow the installer's steps.
4. When Zhiyin first opens, it asks what you plan to use it for. Select the
   cards that fit, then **Make it yours**, or **Start exploring** to skip.

Zhiyin also uses two free programs:

- **Edge or Chrome**, to open web pages. Edge comes with Windows.
- [Git for Windows](https://git-scm.com/download/win), to run shell commands
  (commands typed for Windows to carry out) and to work with Git.

## 2. Connect an AI model through OpenRouter

The thinking behind Zhiyin is done by an AI model, which runs on a company's
servers. [OpenRouter](https://openrouter.ai) gives you access to many AI
models from different companies with one account. You buy credit in advance,
and each request Zhiyin sends uses a little of it, depending on the model. An
**API key** is like a password that lets Zhiyin use your OpenRouter account.

1. Create an account at [openrouter.ai](https://openrouter.ai).
2. Add credit on the [Credits page](https://openrouter.ai/settings/credits).
   One purchase is between $5 and $25,000, and $5 is enough to start. Paying
   by card adds a 5.5% fee, at least $0.80. Unused credit may expire 365 days
   after you buy it.
3. In Zhiyin, open the **Model** page: select **•••** next to **Your
   preferences** at the bottom of the sidebar, then **Model** (or press
   **Ctrl+,**).
4. Select **Add a key**. In the window that opens, **Get a key on OpenRouter**
   opens the page where keys are made. Create a key there and copy it. It
   starts with `sk-or-v1-`.
5. Paste it under **Paste your key** and select **Save key**. Zhiyin keeps it
   in Windows Credential Manager, where Windows keeps passwords, and sends it
   only to OpenRouter.
6. Choose a model in the list, then select **Save** at the top of the page.
   Leave **Any provider** ticked, as the page recommends.

Each model shows two prices per million tokens, for what Zhiyin sends ("in")
and what the model writes ("out"); a token is a small piece of a word.
**Order by** and **Show only** filters such as **Lower cost** help compare.

**Free models.** Models whose name ends in "(free)" cost nothing, and the list
shows their price as free. OpenRouter allows them 50 requests a day, or 1,000
a day once you have bought $10 of credit in total, and 20 a minute. One task
can take many requests, so the daily limit runs out quickly. $5 of credit is
the simplest start.

## 3. Choose a folder

Zhiyin works in one folder at a time, and reads the files in it without
asking. For a first try, a new empty folder works well.

1. In the message box at the bottom of the window, select **Choose a folder**.
2. Select **Choose a folder…** and pick the folder in the window that opens.
   The same button later switches folders.

## 4. Turn on plugins

A **plugin** adds know-how and tools for one kind of work. Select **Plugins**
at the top of the sidebar, select a plugin in the list, and use the switch
beside its name to turn it **On** or **Off**. The cards you chose on the first
screen turned on the matching plugins, and the others start off. A plugin that
is on is used only when a task needs it.

Zhiyin comes with four:

- **Full-Stack Software Engineering**: designs, builds, tests and reviews
  software, with Git, a browser for testing pages, and GitHub.
- **Technical & Academic Publishing**: writes and typesets papers and reports
  with sound citations, compiles them to PDF, and finds research papers on
  alphaXiv.
- **Data Science & Business Intelligence**: explores, cleans and explains
  data, in a Python environment of its own.
- **Deep Research & Synthesis**: researches a question across many sources and
  writes a report with citations, using Tavily web search.

Under **Connectors**, a plugin lists the services and programs it uses. One
that needs a program, such as the Python environment, shows **Set up**:
select it, then **Install**, and Zhiyin downloads what it needs.

## 5. Connect web search and other services

A **connector** to an online service needs its own key, made on that service's
website. Each one is optional.

### Tavily, for web search

Tavily is what lets Zhiyin search the web, through the Deep Research &
Synthesis plugin. Its free plan gives 1,000 credits every month, with no
credit card required. A basic search uses 1 credit and an advanced search 2,
so the free plan covers up to 1,000 basic searches a month.

1. Sign up at [tavily.com](https://tavily.com).
2. Copy your API key from your dashboard at
   [app.tavily.com](https://app.tavily.com).
3. In Zhiyin, open **Plugins**, select **Deep Research & Synthesis**, and turn
   it on if it is off.
4. Under **Connectors**, select **Settings** or **Set up** next to Tavily.
5. If the window asks **How Zhiyin gets access**, choose **Paste an access
   token**.
6. Paste the key into the **API key** box and select **Save token**. Zhiyin
   checks it and shows **Connected**.

The same window offers **Sign in with an account** too, which opens Tavily's
sign-in page in your browser, with nothing to copy.

### GitHub, for software work

In **Full-Stack Software Engineering**, GitHub works with your repositories,
issues and pull requests, using a personal access token: a key with the
permissions you choose. With the plugin on, select **Set up** or **Settings**
next to GitHub, then **Open GitHub** to make one; the window says which
permissions to give it. Paste the token and select **Save token**.

### alphaXiv, for research papers

In **Technical & Academic Publishing**, alphaXiv finds research papers and
reads their full text. With the plugin on, open alphaXiv's window the same
way. Choose **Sign in with an account** to sign in on alphaXiv's page, or
**Paste an access token** to use an API key made under Settings > API Keys on
[alphaxiv.org](https://www.alphaxiv.org).

## 6. Work with Zhiyin

Type what you need in the message box and press **Enter**. **New task** in the
sidebar, or **Ctrl+N**, starts another conversation.

**Approvals.** Before Zhiyin changes a file, runs a command or uses a
connector, it asks, showing what the action is, what it can do, and the exact
command or the files that change. Select a file to see the change line by
line. **Zhiyin says** marks the AI's own explanation, which can be wrong, so
check what will run. You choose:

- **Allow once**: this action runs.
- **Deny**: it does not run. You can tell Zhiyin what to do instead, then
  select **Confirm denial**.
- **Allow for this conversation**, offered for changes to files in one
  subfolder and for one connector tool: what it covers runs without asking
  for the rest of the conversation. To take it back, select **•••** next to
  the conversation in the sidebar, then **Permissions**, then **Revoke**.

Deleting a file, running a shell command and running Python always ask.

**Cost.** Select **•••** next to **Your preferences**, then **Usage**. The
page shows what OpenRouter reported each request cost, by day and by
conversation.

**Context budget.** The small ring in the message box shows how much of the
conversation Zhiyin keeps in mind. Select it to choose **Low**, **Medium** (the
default) or **Ultra**: a larger budget keeps more of a long conversation and
costs more per request. **Compact** summarises older messages to save room.

## If something goes wrong

Zhiyin says what happened, with a button for the next step:

- "Add an OpenRouter API key on the Model page" or "OpenRouter rejected the
  API key": select **Update API key** and paste a key.
- "Choose a model on the Model page": select **Choose a model**.
- "The OpenRouter account is out of credits": select **Add OpenRouter
  credits**, add credit, then select **Try again**.
- A connector's window says the service refused the saved key: make a new key
  on the service's site and paste it there.
- The Plugins page says "Shell commands are unavailable": select **Get Git for
  Windows**, install it, then select **Check again**.
