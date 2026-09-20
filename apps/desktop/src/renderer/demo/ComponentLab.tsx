import { componentCatalog } from "./componentCatalog.js";

export function ComponentLab() {
  return (
    <main className="lab">
      <header className="lab__header">
        <div>
          <p className="eyebrow">Production component library</p>
          <h1>Zhiyin component lab</h1>
          <p>
            The same React components used by the application, isolated for
            interaction and visual review.
          </p>
        </div>
        <a href="./zhiyin-demo.html">Open composed workspace →</a>
      </header>

      {componentCatalog.map((entry, index) => (
        <section
          id={entry.id}
          className={`lab-section${entry.className ? ` ${entry.className}` : ""}`}
          key={entry.id}
        >
          <div className="lab-section__intro">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h2>{entry.title}</h2>
              <p>{entry.description}</p>
            </div>
          </div>
          {entry.render()}
        </section>
      ))}
    </main>
  );
}
