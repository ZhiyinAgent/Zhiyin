# Changelog

What changed for people using Zhiyin, newest release first.

## Unreleased

### Going back and undo

- Going back to a message, and undoing a turn, now offer "Undo everything",
  with "Undo file changes" and "Undo memory changes" below it, so you can
  keep what the agent learned while trying another answer, or keep the files
  and drop the memory. Everything starts ticked; a file someone changed since
  is still left as it is.
- The dialog lists each memory entry and says whether it will be taken back,
  or stays because you already decided on it or changed it since. It no
  longer lists memory under "Not undone by going back" while taking it back.
- After you undo a turn, the agent is told which memory entries were taken
  back, and recalling one says it was taken back rather than that nothing is
  kept under that number.
- The same goes for one entry undone on its memory card, or removed on the
  Memory page: the agent is told it is no longer kept, so it stops saying it
  remembers it. The card says "Removed on the Memory page".
- Going back takes memory back as part of the same saved operation, so a
  crash in between can't leave entries behind.
- Records that undo memory changes no longer linger after you keep or
  discard a change, or keep memory while going back.
- The agent is asked to keep only what you state as lasting, not to infer
  facts about you, and to date prices and opening hours with their source.

### Plugins and connectors

- The agent knows from the start which connectors can't be used yet, and
  why: a missing key (such as Tavily's), a sign-in, a program to install, one
  that could not start, or one you switched off, in plugins you switched off
  too. When a task needs one, it stops and tells you what is missing and
  where, instead of working around it.
- A card in the conversation now says what a connector needs, with a button
  that opens its plugin's page at Connectors. For a connector you only
  switched off, it says to switch it on, and nothing about its key.
- A connector waiting for its key is no longer described as having refused
  one, or as out of service.

### Models

- New: Claude Fable 5.2, GPT-6.2 Astra, GPT-6.2 Sol, GPT-6.1 Terra, Kimi K3.1
  Pro HighSpeed (international platform) and Qwen4-Max.
- Removed: MiniMax-M2.7, retired on 18 November. Mistral Large 4 now always
  reasons, at low, medium or high.

## 0.1.0-alpha.1

The first public release.
