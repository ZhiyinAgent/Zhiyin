import type { PluginState } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

/**
 * What a directory row says about its plugin. A fully ready plugin says
 * nothing, so the rows that need a look are the ones that stand out.
 */
function pluginBadge(plugin: PluginState): string | undefined {
  if (plugin.status === "ready") return undefined;
  if (plugin.status === "off") return "Off";
  if (plugin.status === "failed") return "Needs attention";
  return "Needs setup";
}

/**
 * The installed plugins, as a list to pick one from, with the search that
 * narrows it. It is given the plugins the search left.
 */
export function PluginDirectory({
  plugins,
  selectedId,
  query,
  loading,
  onQuery,
  onSelect,
}: {
  plugins: readonly PluginState[];
  selectedId: string | undefined;
  query: string;
  loading: boolean;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className={styles["plugin-directory"]}>
      <label className={styles["plugin-search"]}>
        <Icon name="search" />
        <input
          type="search"
          aria-label="Find plugins"
          placeholder="Find a plugin"
          value={query}
          disabled={loading}
          onChange={(event) => onQuery(event.currentTarget.value)}
        />
      </label>
      <div className={styles["plugin-directory__count"]}>
        <span>Installed</span>
        {!loading && <span>{plugins.length}</span>}
      </div>
      <nav aria-label="Installed plugins">
        {plugins.map((plugin) => {
          const badge = pluginBadge(plugin);
          const isSelected = selectedId === plugin.id;
          return (
            <button
              type="button"
              key={plugin.id}
              aria-pressed={isSelected}
              className={`${styles["plugin-row"]}${isSelected ? ` ${styles["plugin-row--selected"]}` : ""}${plugin.enabled ? "" : ` ${styles["plugin-row--off"]}`}`}
              onClick={() => onSelect(plugin.id)}
            >
              <span className={styles["plugin-row__copy"]}>
                <strong>{plugin.name}</strong>
                <span>{plugin.category}</span>
              </span>
              {badge && plugin.status === "partial" ? (
                <span
                  className={`${styles["plugin-status"]} ${styles["plugin-status--partial"]} ${styles["plugin-status--icon"]}`}
                  role="img"
                  aria-label={badge}
                  data-tip={badge}
                >
                  <Icon name="settings" />
                </span>
              ) : (
                badge && (
                  <span
                    className={`${styles["plugin-status"]} ${styles[`plugin-status--${plugin.status}`]}`}
                  >
                    {badge}
                  </span>
                )
              )}
            </button>
          );
        })}
      </nav>
      {loading && (
        <p className={styles["plugin-empty"]}>Loading installed plugins…</p>
      )}
      {!loading && !plugins.length && (
        <p className={styles["plugin-empty"]}>
          {query.trim()
            ? `No installed plugin matches “${query.trim()}”.`
            : "No plugins installed yet."}
        </p>
      )}
    </aside>
  );
}
