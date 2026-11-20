# Changelog

What changed for people using Zhiyin, newest release first.

## Unreleased

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
