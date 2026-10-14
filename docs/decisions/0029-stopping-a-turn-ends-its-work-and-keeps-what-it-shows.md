# 0029. Stopping a turn ends its work and keeps what it shows

Status: accepted

Supersedes the part of ADR 0017 under which stopping a conversation closed its
browser. The rest of it holds.

## Decision

- **Stop ends the work.** The model request, the running tool, every
  specialist the turn started, and the conversation's commands and jobs end.
  Nothing starts again on its own: a specialist's report, a stopped one's
  included, waits for the next turn the person starts.
- **Stop keeps what the conversation shows.** Its browser, with the page and
  any sign-in, and its 3D scene stay open beside the conversation, and so do
  their connections, so the next turn carries on from them. A 3D command that
  was running when the turn stopped still ends Blender's session; the scene
  file and the preview stay.
- **Deleting a conversation, and closing Zhiyin, close everything it held.**

## Why

A person stops a turn to keep it from going further in a direction they do
not want. What the agent already showed is not the problem: a person who did
not want a browser or a 3D scene declines the call that opens it. Closing them
on every stop lost a page and its sign-in, or a scene's session, that the next
turn needed, and made a stop costly.

The cost: a browser or Blender left open after a stop holds its memory until
the conversation is deleted or Zhiyin closes.

## Rejected

- Closing the browser and the scene on every stop, as 0017 did: it threw away
  what the next turn needed.
- Leaving commands and jobs running after a stop: they are the work the person
  asked to end.

## Assumptions

- A browser or a 3D session that sits idle uses memory and nothing else.
