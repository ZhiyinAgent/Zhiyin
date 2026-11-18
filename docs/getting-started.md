# Getting started

Zhiyin is an AI agent for your PC: you describe a task in plain words, and it
does the work in a folder you choose, backing up each file there before it
changes it. This page takes you from download to your first task. You need a
Windows PC and, for the AI itself, an account with credit at a model provider
(step 2).

## 1. Install Zhiyin

1. Download the installer from the **Download for Windows** button in the
   [README](../README.md), or from the newest release on the
   [Releases page](https://github.com/ZhiyinAgent/Zhiyin/releases).
2. Open the downloaded file. Microsoft Defender SmartScreen shows "Windows
   protected your PC", because the installer is not code-signed yet. Select
   **More info**, then **Run anyway**.
3. Follow the installer's steps.
4. When Zhiyin first opens, it asks what you plan to use it for. Select the
   cards that fit, then **Continue**. Next it helps you connect an AI model
   (step 2 below); **Set up later** skips that, and the new-task page offers
   it again. Last, choose how Zhiyin looks and select **Start exploring**.

Zhiyin also uses two free programs:

- **Edge or Chrome**, to open web pages. Edge comes with Windows.
- [Git for Windows](https://git-scm.com/download/win), to run shell commands
  (commands typed for Windows to carry out) and to work with Git.

## 2. Connect an AI model

The thinking behind Zhiyin is done by an AI model, which runs on a company's
servers. You can reach one in two ways: through
[OpenRouter](https://openrouter.ai), one account for many companies' models,
or through the platform of the lab that makes the model. Either way you buy
credit in advance, and each request Zhiyin sends uses a little of it,
depending on the model. An **API key** is like a password that lets Zhiyin
use your account.

### Through OpenRouter

1. Create an account at [openrouter.ai](https://openrouter.ai).
2. Add credit on the [Credits page](https://openrouter.ai/settings/credits),
   which gives the amounts you can buy and any fees.
3. In Zhiyin, open the **Model** page: select the model's name at the bottom
   of the sidebar (**Choose a model** until you have one). On first run, and
   on the new-task page until a model is chosen, the same three parts are
   shown in place: Provider, Key and Model.
   Under **Provider**, choose **OpenRouter**.
4. Select **Add a key**. In the window that opens, **Get a key on OpenRouter**
   opens the page where keys are made. Create a key there and copy it. It
   starts with `sk-or-v1-`.
5. Paste it under **Paste your key** and select **Save key**. Zhiyin keeps it
   in Windows Credential Manager, where Windows keeps passwords, and sends it
   only to OpenRouter.
6. Choose a model in the list, then select **Save** in the bar that appears
   at the bottom of the page. Under **Who runs it**, **Any provider** lets
   OpenRouter choose for each request.

Each model shows two prices per million tokens, for what Zhiyin sends ("in")
and what the model writes ("out"); a token is a small piece of a word.
**Order by** and **Show only** filters such as **Lower cost** help compare.

**Free models.** Models whose name ends in "(free)" cost nothing, and the list
shows their price as free. OpenRouter limits how many requests they take a
minute and a day, and raises the daily limit once you have bought some
credit; its [limits page](https://openrouter.ai/docs/api-reference/limits)
gives the numbers. One task can take many requests, so the daily limit runs
out quickly; a little credit is the simplest start.

### Through a lab's own platform

Zhiyin also reaches Anthropic, OpenAI, Mistral, DeepSeek, Kimi, Qwen, Z.ai,
MiniMax and Xiaomi MiMo directly. All but the first three run two platforms:
**International**, billed in US dollars, and **Mainland China**, billed in
yuan. Choose the one your account is on; a key from one usually does not work
on the other.

1. Create an account on the lab's platform and add credit there. Zhiyin uses
   pay-as-you-go credit, not subscription coding plans.
2. On the **Model** page, choose the lab under **Provider**, then its
   platform where it shows two.
3. Select **Add a key**. The window that opens links to the page where that
   lab makes keys. Paste your key and select **Save key**. Zhiyin checks it
   with the lab before keeping it.
4. Choose a model in the list, then select **Save** in the bar that appears
   at the bottom of the page.

Beside the list, the page shows the chosen model's prices on that platform, in
its currency, and when a lab charges more at busy hours, which hours those
are in your own time. Most labs do not say what each request cost, so Zhiyin
estimates it from the lab's price list.

## 3. Choose a folder

Each conversation works in a folder of its own, and reads the files in it
without asking. Conversations in different folders can work at the same time.
For a first try, a new empty folder works well.

1. In the message box at the bottom of the window, select **Choose a folder**.
2. Select **Choose a folder…** and pick the folder in the window that opens.
   The same button later moves the conversation to another folder, and a new
   conversation starts in the folder shown.

## 4. Turn on plugins

A **plugin** adds know-how and tools for one kind of work. Select **Plugins**
at the top of the sidebar, select a plugin in the list, and use the switch
beside its name to turn it **On** or **Off**. The cards you chose on the first
screen turned on the matching plugins, and the others start off. A plugin that
is on is used only when a task needs it.

Zhiyin comes with five:

- **Full-Stack Software Engineering**: designs, builds, tests and reviews
  software, with Git, a browser for testing pages, and GitHub.
- **Technical & Academic Publishing**: writes, designs and typesets documents
  as PDF, from papers and reports to manuals, datasheets and catalogues, and
  designed pieces such as cards, itineraries and posters, with sound
  citations, and finds research papers on alphaXiv.
- **Data Science & Business Intelligence**: explores, cleans and explains
  data, in Python environments of its own.
- **Deep Research & Synthesis**: researches a question across many sources and
  writes a report with citations, using Tavily web search.
- **3D & Rendering**: builds 3D scenes and renders them, such as product
  pictures, rooms from a floor plan, or parts to 3D print, in a Blender that
  Zhiyin installs. The scene appears beside the conversation as it changes.
  Its CAD studio builds exact parts from code, ready to print or machine,
  with dimensioned drawings.

Under **Connectors**, a plugin lists the services and programs it uses. One
that needs a program, such as the Python environment, shows **Set up**:
select it, then **Install**, and Zhiyin downloads what it needs.

## 5. Connect web search and other services

A **connector** to an online service needs its own key, made on that service's
website. Each one is optional.

### Tavily, for web search

Tavily is what lets Zhiyin search the web, through the Deep Research &
Synthesis plugin. Tavily has a free plan with a monthly allowance of
searches; its [pricing page](https://www.tavily.com/pricing) gives the
current plans.

1. Sign up at [tavily.com](https://tavily.com).
2. Copy your API key from your dashboard at
   [app.tavily.com](https://app.tavily.com).
3. In Zhiyin, open **Plugins**, select **Deep Research & Synthesis**, and turn
   it on if it is off.
4. Under **Connectors**, select **Settings** or **Set up** next to Tavily.
5. If the window asks **How Zhiyin gets access**, choose **Paste an API
   key**.
6. Paste the key into the **API key** box and select **Save API key**. Zhiyin
   checks it and shows **Connected**.

The same window offers **Sign in with an account** too, which opens Tavily's
sign-in page in your browser, with nothing to copy.

### GitHub, for software work

In **Full-Stack Software Engineering**, GitHub works with your repositories,
issues and pull requests, using a personal access token: a key with the
permissions you choose. With the plugin on, select **Set up** or **Settings**
next to GitHub, then **Open GitHub** to make one; the window says which
permissions to give it. Paste the token and select **Save personal access
token**.

### alphaXiv, for research papers

In **Technical & Academic Publishing**, alphaXiv finds research papers and
reads their full text. With the plugin on, open alphaXiv's window the same
way. Choose **Sign in with an account** to sign in on alphaXiv's page, or
**Paste an API key** to use an API key made under Settings > API Keys on
[alphaxiv.org](https://www.alphaxiv.org).

## 6. Work with Zhiyin

Type what you need in the message box and press **Enter**. **New
conversation** in the sidebar, or **Ctrl+N**, starts another one.

**Your files, and a way back.** Zhiyin reads, creates and changes files in
your folder without asking, and moves them to the Recycle Bin the same way.
It backs up each file before changing it, and every change appears in the
conversation: select a file to see the change line by line, and **Undo**
beside a turn's files puts them back. Python scripts, CAD builds and the 3D
studio's work run the same way, since Zhiyin copies the folder before each
one. Editing an earlier message and sending it again can put files back too.

**When it asks.** Zhiyin asks only for what it can neither prevent nor undo:
a shell command; deleting for good; reading or changing anything outside your
folder; acting as you on an account, such as opening a pull request on
GitHub; a Git change, which runs the repository's own hooks; installing
packages, or making or rebuilding a Python environment; a tool of a connector
you added; a change to a file too large to back up; and sending something the
AI wrote to a place it chose, such as typing into a web page or a Python
script that reaches the hosts it names, once the conversation holds both content from
outside and something private. The question shows what the action is, why it
asks, and the exact command or the files it changes. **More** beside the
reason explains it in full. **The AI says** marks the AI's own explanation,
which can be wrong, so check what will run. You choose:

- **Allow once**: this action runs.
- **Deny**: it does not run. The pencil beside it denies with a note that
  tells Zhiyin what to do instead.
- Under **For this conversation**, where one answer can stand, a button
  names what it covers: a file or a folder outside your folder, one place on
  an account, such as a GitHub repository, one tool of a connector you added,
  or one file too large to back up. Pointing at it says the whole of what it
  covers. What it covers runs without asking for the rest of the
  conversation. A file allowed this way is asked about again once it is
  changed outside Zhiyin. To take it back, select **•••** next to the
  conversation in the sidebar, then **Permissions**, then **Take back**.

A shell command, deleting for good, a Git change, a Python environment
change, anything that cannot be taken back on an account, such as merging a
pull request, and anything that would run later on its own always ask. Nothing
allowed for the conversation covers a file in a `.git` folder.

**Memory.** Zhiyin keeps what you tell it about yourself and how you want it
to work, and where each piece of work stands, from one conversation to the
next. Select **Memory** in the sidebar to see every entry: open one to edit
or delete it, or switch **Remember** off.

**Cost.** Select **Usage**, the bars icon at the bottom of the sidebar. The
page shows what each request cost, by day and by conversation: the
provider's own figure where it gives one, and otherwise an estimate from the
lab's price list, marked as estimated. Dollars and yuan are shown apart,
never converted.

**Conversation room.** The small ring in the message box shows how much of
the conversation Zhiyin can read at once. Select it to choose **Low**, **Medium** (the
default) or **Ultra**: a larger budget keeps more of a long conversation and
costs more per request. **Compact** summarises older messages to save room.

## What leaves your computer

Your conversations, memory, usage and settings are kept in your Windows
profile, in `%APPDATA%\Zhiyin`, and your keys in Windows Credential Manager.
Zhiyin has no account of its own and collects no usage data. What it sends,
and where:

- **To the model provider you chose**: each request of a conversation, with
  what the conversation holds, such as your messages, the files and pictures
  it read, and what its tools returned. OpenRouter or the lab receives it,
  under its own terms. Saving a key also sends the key to that provider once,
  to check it.
- **To a connector's service**: the key or sign-in, to list its tools once a
  plugin it belongs to is in use, and what each call sends.
- **To websites**: what the browser asks for when Zhiyin opens a page, from
  a temporary profile that holds none of your own browser's sign-ins.
- **To download sites**: requests for a program you asked Zhiyin to install,
  such as Blender or a Python environment, from its own site or a mirror.
- **To GitHub, or Zhiyin's copy of the same files on
  `media.zhiyinagent.app`**: requests for the newest list of models and
  prices, when Zhiyin starts and when the **Model** page opens, and for a
  newer version of Zhiyin. Each can be turned off: the list on the **Model**
  page, new versions under **Settings**. Nothing of yours is in them.

The [security policy](../.github/SECURITY.md) says what each boundary
covers.

## Keeping Zhiyin up to date

Zhiyin looks for a newer version a few seconds after it starts, every six
hours after that, and when you select **Check now** under **Settings**,
**Updates**. It takes one only when the maintainers' release key signed it,
downloads it in the background, and says when it is ready. It installs when
you select **Restart to update**, never while a conversation is working.
**Look for newer versions** stops it looking.

## If something goes wrong

Zhiyin says what happened, with a button for the next step:

- "Add an OpenRouter API key on the Model page", or another provider's name,
  or "… rejected the API key": select **Add API key** (or **Update API key**,
  once one is saved) and paste a key.
- "This DeepSeek account is billed in US dollars" (or yuan): choose the
  platform the message names on the Model page, then add the key there.
- "Choose a model on the Model page": select **Choose a model**.
- "The OpenRouter account is out of credits", or another provider's account
  "has run out of balance": select **Add credits** with the provider's name,
  add credit on its site, then select **Try again**.
- A connector's window says the service refused the saved key: make a new key
  on the service's site and paste it there.
- The Plugins page says "Shell commands are unavailable": select **Get Git for
  Windows**, install it, then select **Check again**.
