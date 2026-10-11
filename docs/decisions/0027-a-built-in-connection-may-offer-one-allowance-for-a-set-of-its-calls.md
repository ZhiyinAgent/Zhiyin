# 0027. A built-in connection may offer one allowance for a set of its calls

Status: accepted

## Decision

- **A built-in connection may say which set of its calls a call belongs to.**
  Its inspection carries an allowance: a key every call in the set carries,
  and a label naming the set in words. Only a connection Zhiyin ships can say
  this; a remote connection's inspection never reaches the field (ADR 0006).
- **Allowing such a call for the conversation allows the set.** Any later call
  of the same connection that carries the same key runs without asking, until
  the person revokes it or the conversation ends. A call with another key, or
  none, asks as before.
- **The 3D studio offers one set: changes to the open scene.** Every 3D call on
  the scene that writes only new files shares a key made of the workspace and
  the scene. Opening another scene, replacing an existing file and running a
  script carry no key: the first two ask again, and a script is asked for every
  time.
- **The grant is saved as a connector rule for every tool of the connection.**
  Its tool name is the connection's prefix followed by `__*`, a name no tool
  has, and its identity is the key. Saved history keeps its format.

## Why

Making one object in the 3D studio takes many calls: adding parts, materials,
lighting, the camera, previews and a render. Allowing each exact call for the
conversation covered nothing, because no two calls are the same, so a person
approved more than twenty prompts that all said "change this scene". The cost
is that one approval now covers calls the person has not seen, limited to the
scene they approved and to files that do not exist yet.

## Rejected

- A new kind of saved rule: clearer, but a saved-history format step under
  ADR 0022 for one field, and alpha.1 could not read conversations that hold
  it.
- Allowing the whole 3D studio for the conversation: it would also cover
  replacing existing files and working on other scenes, which the person never
  saw asked.
- Keeping one approval per exact call: safe, and unusable for real 3D work.

## Assumptions

- Only built-in connections write an inspection's presentation fields, so a
  remote connection cannot claim an allowance.
- A saved rule whose tool name ends in `__*` matches no tool in a version that
  does not know allowances, so an older Zhiyin asks instead of allowing.
- Each call declares the scene file and the files it writes, so they are
  backed up as any built-in change is (ADR 0008) and going back can restore
  them. A scene past the backup limits is changed unprotected without asking,
  as an edit is under a folder grant.
