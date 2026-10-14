/**
 * The fields of the component editor, a group for each thing they describe.
 * Each group shows a draft and hands back the draft as changed; the editor
 * holds the draft, and decides what a change means.
 */

import type { McpConnectionTestOutcome } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import type { AccessMode } from "./ConnectorAccess.js";
import {
  slugAsTyped,
  type ConnectorDraft,
  type SkillDraft,
  type SpecialistDraft,
} from "./componentDrafts.js";
import styles from "./capabilities.module.css";

/** Which of a skill's or a specialist's fields were left empty on saving. */
type Missing = {
  readonly name: boolean;
  readonly description: boolean;
  readonly instructions: boolean;
};

/** A skill: its name, which is its id and is set once, and what it says. */
export function SkillFields({
  form,
  isNew,
  invalid,
  onChange,
}: {
  form: SkillDraft;
  isNew: boolean;
  invalid: Missing;
  onChange: (form: SkillDraft) => void;
}) {
  return (
    <>
      <label>
        <span>Name</span>
        <input
          aria-label="Name"
          aria-invalid={invalid.name || undefined}
          value={form.id}
          disabled={!isNew}
          onChange={(event) =>
            onChange({ ...form, id: slugAsTyped(event.target.value) })
          }
        />
        {invalid.name && <small role="alert">Enter a name.</small>}
      </label>
      <label>
        <span>When should Zhiyin use it?</span>
        <textarea
          aria-label="When should Zhiyin use it?"
          aria-invalid={invalid.description || undefined}
          rows={3}
          value={form.description}
          onChange={(event) =>
            onChange({ ...form, description: event.target.value })
          }
        />
        {invalid.description && (
          <small role="alert">Describe when to use it.</small>
        )}
      </label>
      <label>
        <span>Instructions</span>
        <textarea
          aria-label="Instructions"
          aria-invalid={invalid.instructions || undefined}
          rows={8}
          value={form.instructions}
          onChange={(event) =>
            onChange({ ...form, instructions: event.target.value })
          }
        />
        {invalid.instructions && <small role="alert">Add instructions.</small>}
      </label>
    </>
  );
}

/** A specialist: its name, what it handles and how it works. */
export function SpecialistFields({
  form,
  invalid,
  onChange,
}: {
  form: SpecialistDraft;
  invalid: Missing;
  onChange: (form: SpecialistDraft) => void;
}) {
  return (
    <>
      <label>
        <span>Name</span>
        <input
          aria-label="Name"
          aria-invalid={invalid.name || undefined}
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
        {invalid.name && <small role="alert">Enter a name.</small>}
      </label>
      <label>
        <span>What should it handle?</span>
        <textarea
          aria-label="What should it handle?"
          aria-invalid={invalid.description || undefined}
          rows={3}
          value={form.description}
          onChange={(event) =>
            onChange({ ...form, description: event.target.value })
          }
        />
        {invalid.description && (
          <small role="alert">Describe what it handles.</small>
        )}
      </label>
      <label>
        <span>Instructions</span>
        <textarea
          aria-label="Instructions"
          aria-invalid={invalid.instructions || undefined}
          rows={8}
          value={form.instructions}
          onChange={(event) =>
            onChange({ ...form, instructions: event.target.value })
          }
        />
        {invalid.instructions && <small role="alert">Add instructions.</small>}
      </label>
    </>
  );
}

/** Where a connector is reached: the name it goes by and its endpoint. */
export function ConnectorAddressFields({
  form,
  invalid,
  onChange,
}: {
  form: ConnectorDraft;
  invalid: { readonly name: boolean; readonly url: boolean };
  onChange: (form: ConnectorDraft) => void;
}) {
  return (
    <>
      <label>
        <span>Name</span>
        <input
          aria-label="Name"
          aria-invalid={invalid.name || undefined}
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
        {invalid.name && <small role="alert">Enter a name.</small>}
      </label>
      <label>
        <span>MCP endpoint</span>
        <input
          aria-label="MCP endpoint"
          aria-invalid={invalid.url || undefined}
          type="url"
          placeholder="https://example.com/mcp"
          value={form.url}
          onChange={(event) => onChange({ ...form, url: event.target.value })}
        />
        {invalid.url && (
          <small role="alert">Enter an HTTP or HTTPS MCP endpoint.</small>
        )}
      </label>
    </>
  );
}

/** The token a connector is reached with; one already saved is never shown. */
export function ConnectorTokenField({
  token,
  saved,
  onChange,
}: {
  token: string;
  saved: boolean;
  onChange: (token: string) => void;
}) {
  return (
    <label>
      <span>{saved ? "Replace access token" : "Access token"}</span>
      <input
        aria-label="Access token"
        type="password"
        autoComplete="off"
        placeholder={
          saved
            ? "Saved — paste a new one to replace it"
            : "Paste the token from the service, if it needs one"
        }
        value={token}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * What testing a connector found. A service that only wants its own sign-in,
 * where signing in is what the form offers, is a note and not a failure.
 */
export function ConnectorTestNote({
  result,
  mode,
}: {
  result: McpConnectionTestOutcome | null;
  mode: AccessMode;
}) {
  if (!result) return null;
  if (result.ok)
    return (
      <p className={styles["connector-test-note"]} role="status">
        <span
          className={`${styles["component-editor__test-status"]} ${styles["component-editor__test-status--ok"]}`}
        >
          <Icon name="check" />
          Connected · {result.tools.length}{" "}
          {result.tools.length === 1 ? "tool" : "tools"} found
        </span>
      </p>
    );
  const needs = result.needs;
  return (
    <p
      className={`${styles["connector-test-note"]} ${
        mode === "sign-in" && needs === "sign-in"
          ? ""
          : styles["component-editor__test-status--failed"]
      }`}
      role={mode === "sign-in" && needs === "sign-in" ? "status" : "alert"}
    >
      {mode === "sign-in" && needs === "sign-in"
        ? "This service has its own sign-in."
        : mode === "sign-in" && needs === "token"
          ? "This service has no sign-in Zhiyin can use. Choose Paste an access token."
          : result.reason}
    </p>
  );
}

/** What the person says a connector reaches, and where its data goes. */
export function ConnectorDisclosureFields({
  form,
  onChange,
}: {
  form: ConnectorDraft;
  onChange: (form: ConnectorDraft) => void;
}) {
  return (
    <>
      <label>
        <span>What can it access? (optional)</span>
        <textarea
          aria-label="What can it access?"
          rows={2}
          value={form.access}
          onChange={(event) =>
            onChange({ ...form, access: event.target.value })
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
            onChange({ ...form, dataDestination: event.target.value })
          }
        />
      </label>
    </>
  );
}
