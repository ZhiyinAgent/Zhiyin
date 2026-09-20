import { useState } from "react";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpToolSummary,
} from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

export type SkillDraft = {
  readonly kind: "skill";
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
};

export type SpecialistDraft = {
  readonly kind: "specialist";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
};

export type ConnectorDraft = {
  readonly kind: "connection";
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly access: string;
  readonly dataDestination: string;
};

export type ComponentDraft = SkillDraft | SpecialistDraft | ConnectorDraft;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const kindLabel: Record<ComponentDraft["kind"], string> = {
  skill: "skill",
  specialist: "specialist",
  connection: "connector",
};

/**
 * One component's edit form in a plugin made in the app, shaped to its kind.
 * Saving hands back the component's full content; the caller folds it into
 * the plugin's complete component list, which is saved as a new version.
 */
export function ComponentEditor({
  draft,
  connectionState,
  onSave,
  onSaveToken,
  onRemove,
  onTest,
  onSetToolEnabled,
  onClose,
}: {
  /** `undefined` id means this is a new component being created. */
  draft: ComponentDraft;
  /** Live status and discovered tools, for an existing connector. */
  connectionState?: {
    readonly status: "connected" | "disconnected" | "failed" | "unauthorized";
    readonly tools: readonly McpToolSummary[];
    readonly tokenSaved: boolean;
  };
  onSave: (draft: ComponentDraft) => Promise<void>;
  /** Saves a token for the connector with this local id, once it is saved. */
  onSaveToken?: (localId: string, token: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  onTest?: (
    server: McpServerDefinition,
    token?: string,
  ) => Promise<McpConnectionTestOutcome>;
  onSetToolEnabled?: (toolName: string, enabled: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = draft.id === "";
  const [form, setForm] = useState<ComponentDraft>(draft);
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<McpConnectionTestOutcome | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const [pending, setPending] = useState<"save" | "remove" | "token" | null>(
    null,
  );
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const name = form.kind === "skill" ? form.id : form.name;
  const nameInvalid = attempted && !name.trim();
  const descriptionInvalid =
    (form.kind === "skill" || form.kind === "specialist") &&
    attempted &&
    !form.description.trim();
  const instructionsInvalid =
    (form.kind === "skill" || form.kind === "specialist") &&
    attempted &&
    !form.instructions.trim();
  const urlInvalid =
    form.kind === "connection" && attempted && !isHttpUrl(form.url);

  const verifiedWorking =
    form.kind === "connection" &&
    (testResult?.ok === true ||
      (!isNew && connectionState?.status === "connected"));
  const canSave = form.kind !== "connection" || verifiedWorking;
  const tools = testResult?.ok
    ? testResult.tools
    : (connectionState?.tools ?? []);

  function isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function test() {
    if (form.kind !== "connection" || !onTest || testing) return;
    setTesting(true);
    setError(null);
    try {
      const result = await onTest(
        {
          id: form.id || slugify(form.name),
          name: form.name,
          url: form.url,
          enabled: true,
        },
        token || undefined,
      );
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setAttempted(true);
    if (form.kind === "skill" || form.kind === "specialist") {
      if (!name.trim() || !form.description.trim() || !form.instructions.trim())
        return;
    } else {
      if (!form.name.trim() || !isHttpUrl(form.url) || !canSave) return;
    }
    setPending("save");
    setError(null);
    try {
      const saved: ComponentDraft =
        form.kind === "skill"
          ? { ...form, id: form.id || slugify(form.id) }
          : { ...form, id: form.id || slugify(form.name) };
      await onSave(saved);
      if (saved.kind === "connection" && token.trim() && onSaveToken)
        await onSaveToken(saved.id, token.trim());
      onClose();
    } catch {
      setError(`Could not save this ${kindLabel[form.kind]}.`);
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!onRemove) return;
    setPending("remove");
    setError(null);
    try {
      await onRemove();
      onClose();
    } catch {
      setError(`Could not remove this ${kindLabel[form.kind]}.`);
      setPending(null);
    }
  }

  const title = isNew
    ? `New ${kindLabel[form.kind]}`
    : `Edit ${kindLabel[form.kind]}`;

  return (
    <Dialog
      title={title}
      onClose={onClose}
      className={styles["component-editor"] ?? ""}
      footer={
        confirmingRemoval ? (
          <>
            <span role="alert">Remove this {kindLabel[form.kind]}?</span>
            <button
              className="button"
              type="button"
              disabled={pending !== null}
              onClick={() => setConfirmingRemoval(false)}
            >
              Keep it
            </button>
            <button
              className="button button--accent"
              type="button"
              disabled={pending !== null}
              onClick={() => void remove()}
            >
              {pending === "remove" ? "Removing…" : "Remove"}
            </button>
          </>
        ) : (
          <>
            {!isNew && onRemove && (
              <button
                className="button button--quiet"
                type="button"
                disabled={pending !== null}
                onClick={() => setConfirmingRemoval(true)}
              >
                Remove
              </button>
            )}
            <button
              className="button button--accent"
              type="submit"
              form="component-editor-form"
              disabled={
                pending !== null || (form.kind === "connection" && !canSave)
              }
              title={
                form.kind === "connection" && !canSave
                  ? "Test the connection before saving"
                  : undefined
              }
            >
              {pending === "save" ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <form
        id="component-editor-form"
        className={styles["component-editor__form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {form.kind === "skill" && (
          <>
            <label>
              <span>Name</span>
              <input
                aria-label="Name"
                aria-invalid={nameInvalid || undefined}
                value={form.id}
                disabled={!isNew}
                onChange={(event) =>
                  setForm({ ...form, id: slugify(event.target.value) })
                }
              />
              {nameInvalid && <small role="alert">Enter a name.</small>}
            </label>
            <label>
              <span>When should Zhiyin use it?</span>
              <textarea
                aria-label="When should Zhiyin use it?"
                aria-invalid={descriptionInvalid || undefined}
                rows={3}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
              {descriptionInvalid && (
                <small role="alert">Describe when to use it.</small>
              )}
            </label>
            <label>
              <span>Instructions</span>
              <textarea
                aria-label="Instructions"
                aria-invalid={instructionsInvalid || undefined}
                rows={8}
                value={form.instructions}
                onChange={(event) =>
                  setForm({ ...form, instructions: event.target.value })
                }
              />
              {instructionsInvalid && (
                <small role="alert">Add instructions.</small>
              )}
            </label>
          </>
        )}

        {form.kind === "specialist" && (
          <>
            <label>
              <span>Name</span>
              <input
                aria-label="Name"
                aria-invalid={nameInvalid || undefined}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
              {nameInvalid && <small role="alert">Enter a name.</small>}
            </label>
            <label>
              <span>What should it handle?</span>
              <textarea
                aria-label="What should it handle?"
                aria-invalid={descriptionInvalid || undefined}
                rows={3}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
              {descriptionInvalid && (
                <small role="alert">Describe what it handles.</small>
              )}
            </label>
            <label>
              <span>Instructions</span>
              <textarea
                aria-label="Instructions"
                aria-invalid={instructionsInvalid || undefined}
                rows={8}
                value={form.instructions}
                onChange={(event) =>
                  setForm({ ...form, instructions: event.target.value })
                }
              />
              {instructionsInvalid && (
                <small role="alert">Add instructions.</small>
              )}
            </label>
          </>
        )}

        {form.kind === "connection" && (
          <>
            <label>
              <span>Name</span>
              <input
                aria-label="Name"
                aria-invalid={nameInvalid || undefined}
                value={form.name}
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value });
                  setTestResult(null);
                }}
              />
              {nameInvalid && <small role="alert">Enter a name.</small>}
            </label>
            <label>
              <span>MCP endpoint</span>
              <input
                aria-label="MCP endpoint"
                aria-invalid={urlInvalid || undefined}
                type="url"
                placeholder="https://example.com/mcp"
                value={form.url}
                onChange={(event) => {
                  setForm({ ...form, url: event.target.value });
                  setTestResult(null);
                }}
              />
              {urlInvalid && (
                <small role="alert">Enter an HTTP or HTTPS MCP endpoint.</small>
              )}
            </label>
            <label>
              <span>
                {connectionState?.tokenSaved
                  ? "Replace access token"
                  : "Access token"}
              </span>
              <input
                aria-label="Access token"
                type="password"
                autoComplete="off"
                placeholder={
                  connectionState?.tokenSaved
                    ? "Saved — paste a new one to replace it"
                    : "Paste the token from the service, if it needs one"
                }
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <div className={styles["component-editor__test"]}>
              <button
                className="button"
                type="button"
                disabled={testing || !form.name.trim() || !isHttpUrl(form.url)}
                onClick={() => void test()}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              {testResult?.ok === true && (
                <span
                  className={`${styles["component-editor__test-status"]} ${styles["component-editor__test-status--ok"]}`}
                  role="status"
                >
                  <Icon name="check" />
                  Connected · {testResult.tools.length}{" "}
                  {testResult.tools.length === 1 ? "tool" : "tools"} found
                </span>
              )}
              {testResult?.ok === false && (
                <span
                  className={styles["component-editor__test-status--failed"]}
                  role="alert"
                >
                  {testResult.reason}
                </span>
              )}
            </div>
            <label>
              <span>What can it access? (optional)</span>
              <textarea
                aria-label="What can it access?"
                rows={2}
                value={form.access}
                onChange={(event) =>
                  setForm({ ...form, access: event.target.value })
                }
              />
            </label>
            <label>
              <span>Where does data go? (optional)</span>
              <textarea
                aria-label="Where does data go?"
                rows={2}
                value={form.dataDestination}
                onChange={(event) =>
                  setForm({ ...form, dataDestination: event.target.value })
                }
              />
            </label>
            {!isNew && connectionState && onSetToolEnabled && (
              <fieldset className={styles["component-editor__tools"]}>
                <legend>Tools</legend>
                {tools.length === 0 ? (
                  <p className={styles["component-editor__tools-empty"]}>
                    {connectionState.status === "connected" || testResult?.ok
                      ? "This server does not advertise any tools."
                      : "Tools will appear once this server connects."}
                  </p>
                ) : (
                  <ul>
                    {tools.map((tool) => (
                      <li key={tool.name}>
                        <label>
                          <input
                            type="checkbox"
                            checked={tool.enabled}
                            onChange={(event) =>
                              void onSetToolEnabled(
                                tool.name,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            <strong>{tool.name}</strong>
                            {tool.description && (
                              <small>{tool.description}</small>
                            )}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            )}
          </>
        )}

        {error && (
          <p className={styles["component-editor__error"]} role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
