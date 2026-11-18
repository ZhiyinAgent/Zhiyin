# Vocabulary

The words Zhiyin's code, docs and window use, one sentence each. Where the
code and the window use different words for one thing, **Window** says which
one a person sees. Where one word means two things today, the meaning to keep
is defined and the other is marked as being renamed.

## Working with Zhiyin

- **Conversation**: one exchange with the model, with its messages, its
  folder, its actions and their results. Window: "conversation", and the
  button that starts one says **New conversation**; the code's type for it is
  `Task`.
- **Turn**: everything Zhiyin does between a person's message and the moment
  it has nothing left to do: requests to the model, actions, approvals and
  answers.
- **Folder**: the folder on the person's computer that a conversation works
  in, which its file tools read and change freely. Window: "folder". The code
  calls it the workspace (below).
- **Workspace**: in the code, two things. The tools' workspace is the
  conversation's folder; the core's workspace is the app's state outside a
  turn (the conversations, which is open, the person's choices). In text a
  person reads, "folder" is the word for the first.
- **Step**: one request to the model and the actions it asks for; a turn is
  made of steps. Window: "step", as in the limit on long tasks. The code
  calls it a round.
- **Action**: one thing the model asked to do, a call to a tool, shown in the
  conversation with what it was for and how it ended.
- **Approval**: the question Zhiyin asks before an action it can neither
  prevent nor undo. Window: **Allow once**, **Deny**, and **Allow for this
  conversation** where one answer can stand.
- **Going back**: editing an earlier message and sending it again, with the
  files changed since put back if the person chooses. Window: **Go back**.
  The code calls it rewind.
- **Undo**: putting back the file changes of one turn while keeping the
  conversation. Window: **Undo these changes**.
- **Memory**: what Zhiyin keeps across conversations, as files the person can
  read and change on the **Memory** page.
- **Project**: a piece of work with a memory of its own, which a
  conversation joins when the person puts it there or when its folder is
  linked to the project.
- **Context budget**: how much of a conversation is sent with each request
  (Low, Medium or Ultra); **Compact** summarises older messages to fit it.
  The code also calls compacting condensing.
- **Usage**: the record of what each request used and cost, on the **Usage**
  page: the provider's own figure, or an estimate from the model list.

## Models

- **Provider**: where the model's requests go: OpenRouter, or a lab's own
  platform. Window: **Provider**, on the **Model** page.
- **Lab**: the company that makes a model, such as Anthropic or DeepSeek.
- **Platform**: one of a lab's two services, **International** or
  **Mainland China**, each with its own accounts, keys and currency.
- **Upstream**: on OpenRouter, the company that serves a request for a
  model; a person may pin which ones.
- **Key**: the API key that lets Zhiyin use a person's account at a
  provider or a service, kept in Windows Credential Manager.
- **Model list**: the signed file of the labs' models and prices that each
  release ships and installed copies update from GitHub.

## What the model can call

- **Tool**: one function the model can call, with a name, a description and
  its parameters.
- **Workspace tools**: the tools every conversation has, which read, search,
  write and delete files in its folder, run shell commands, and show charts,
  diagrams, quizzes and questions. The code calls them built-in tools; they
  are being renamed workspace tools, so "built-in" no longer means three
  things.
- **Plugin**: a bundle of skills, specialists and connectors for one kind of
  work, switched on or off as one. Window: "plugin". The code also calls it a
  package, from the folder it is read from; "plugin" is the word to use.
- **Shipped plugin**: a plugin that comes with Zhiyin, as against one a
  person imported or made. Window: the plugin's origin reads **Comes with
  Zhiyin**; the code's `built-in` source and the built-in plugin catalog mean
  the same.
- **Skill**: written guidance Zhiyin reads when a conversation needs it for
  one kind of work. Window: "skill".
- **Specialist**: a helper Zhiyin hands part of a task to, which runs as a
  separate run in the background under the same rules. Window: "specialist".
  The code calls its run a child run.
- **Connector**: a service or program a plugin declares that it uses, such as
  GitHub, Tavily or the Python environment. Window: "connector", under
  **Connectors** on a plugin's page.
- **Connection**: a connector as it runs: Zhiyin reaching it, signed in or
  not, and offering its tools to a conversation. Some connections are
  served by Zhiyin itself (the browser, Git, the document compiler, the
  Python environment and the studios) rather than by a remote server; the
  code calls these built-in connections. The window says "connector" for
  what a plugin declares or a person adds, and "connection" only for
  reaching it, as in **Test connection**. The code still calls a declared
  connector a connection in places; those uses are being renamed "connector".
- **MCP**: the Model Context Protocol, which connectors speak; Zhiyin reaches
  remote ones over Streamable HTTP.
- **Toolkit**: a named group of at most ten of a plugin's tools for one kind
  of work, which the model opens from the catalog when it needs them. The
  catalog also lists a whole remote connector as a toolkit; that use is
  being renamed.
- **Core tools**: the tools of a plugin that no toolkit names, offered as soon
  as a conversation activates the plugin.
- **Activating**: a conversation starting to use a plugin, which adds the
  plugin's core tools and connections to its requests.
- **Catalog**: what the model searches to find skills, toolkits, connectors,
  reference pages, library functions and known API changes of the plugins
  that are on. Other lists are not called the catalog: the plugins that ship
  with Zhiyin are the shipped plugins, and a provider's list of models is its
  model list.
- **Toolchain**: an outside program a connector needs, such as Typst,
  Tectonic, Blender or uv, which Zhiyin installs when the person asks.
  Window: **Set up**, then **Install**, beside the connector.
- **Studio**: one of the two places Zhiyin builds in 3D: the **3D studio**,
  a Blender of its own per conversation, and the **CAD studio**, which builds
  exact parts from code.
- **Permission engine**: the one part of Zhiyin that decides whether an
  action runs without asking.

## The window

- **Look**: the pictures and the drawn style the window wears: Ink, Dots or
  Neutral. Window: **Look**, under **Settings**; [brand.md](brand.md)
  describes each.
- **Strength**: how strongly a look's pictures show: Subtle, Default or
  Vivid.
- **Appearance**: whether the window is dark or light, or follows Windows.
- **Beside the conversation**: the panel that shows the conversation's
  browser, document or 3D scene. Window: in a narrow window, its tab is named
  by what it shows: **Browser**, **Document** or **3D view**.
- **Picture**: an image a person attaches, a model reads or Zhiyin draws.
  Window: "picture", as in a model that reads **Pictures**.
