import { TaskViewCard } from "../../ui/views/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const viewsEntries: ComponentCatalogEntry[] = [
  {
    id: "diagram-view",
    title: "Diagram tool result",
    description:
      "Validated Mermaid with source review, zoom, keyboard pan, and explicit export.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-diagram",
          callId: "catalog-diagram",
          kind: "diagram",
          title: "Release path",
          source:
            "flowchart LR\n  Draft --> Review\n  Review -->|approved| Publish\n  Review -->|changes| Draft",
        }}
      />
    ),
  },
  {
    id: "chart-view",
    title: "Line chart tool result",
    description:
      "A data-forward chart plate with the exact underlying values one tab away.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-chart",
          callId: "catalog-chart",
          kind: "line-chart",
          title: "Weekly response time",
          source: JSON.stringify({
            kind: "line-chart",
            title: "Weekly response time",
            xLabel: "Week",
            yLabel: "Median response time",
            unit: "ms",
            series: [
              {
                name: "Current",
                points: [
                  { x: "W1", y: 480 },
                  { x: "W2", y: 420 },
                  { x: "W3", y: 355 },
                  { x: "W4", y: 310 },
                ],
              },
              {
                name: "Target",
                points: [
                  { x: "W1", y: 300 },
                  { x: "W2", y: 300 },
                  { x: "W3", y: 300 },
                  { x: "W4", y: 300 },
                ],
              },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "bar-chart-view",
    title: "Bar chart tool result",
    description:
      "Category comparison with a zero baseline and exact values in Data.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-bars",
          callId: "catalog-bars",
          kind: "bar-chart",
          title: "Requests by channel",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests by channel",
            xLabel: "Channel",
            yLabel: "Requests",
            categories: [
              { label: "Desktop", value: 42 },
              { label: "Web", value: 31 },
              { label: "API", value: 19 },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "bar-chart-long-names",
    title: "Bar chart with long category names",
    description:
      "Seven categories named in phrases, as a person names them, in narrow bars.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-bars-long",
          callId: "catalog-bars-long",
          kind: "bar-chart",
          title: "Where the €800 goes, for the two of you",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Where the €800 goes, for the two of you",
            yLabel: "Euros",
            unit: "€",
            categories: [
              { label: "Hotel, 3 nights", value: 220 },
              { label: "Food and drink", value: 220 },
              { label: "Airport, both ways", value: 60 },
              { label: "Tea, tickets, ferry", value: 50 },
              { label: "Gifts to bring home", value: 53 },
              { label: "Metro and taxis", value: 33 },
              { label: "Spare", value: 164 },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "bar-chart-spending",
    title: "Bar chart of a year's spending",
    description:
      "Eight categories from a household's bank export, names that just fit their bars.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-bars-spending",
          callId: "catalog-bars-spending",
          kind: "bar-chart",
          title: "Where the money went, Oct 2025 – Sep 2026",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Where the money went, Oct 2025 – Sep 2026",
            xLabel: "Category",
            yLabel: "Total outgoing",
            unit: "EUR",
            categories: [
              { label: "Housing", value: 15889.15 },
              { label: "Food", value: 8783.65 },
              { label: "Savings", value: 3600 },
              { label: "Transport", value: 3513.97 },
              { label: "Home & shopping", value: 2399.59 },
              { label: "Health", value: 1758.58 },
              { label: "Travel", value: 1552 },
              { label: "Subscriptions", value: 299.76 },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "scatter-chart-view",
    title: "Scatter plot tool result",
    description:
      "Numeric observations use both colour and marker shape to distinguish series.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-scatter",
          callId: "catalog-scatter",
          kind: "scatter-plot",
          title: "Quality and latency",
          source: JSON.stringify({
            kind: "scatter-plot",
            title: "Quality and latency",
            xLabel: "Latency",
            yLabel: "Quality",
            series: [
              {
                name: "Local",
                points: [
                  { x: 1, y: 8 },
                  { x: 2, y: 7 },
                ],
              },
              {
                name: "Remote",
                points: [
                  { x: 3, y: 9 },
                  { x: 4, y: 8 },
                ],
              },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "histogram-view",
    title: "Histogram tool result",
    description:
      "Observed values are binned deterministically and remain inspectable.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-histogram",
          callId: "catalog-histogram",
          kind: "histogram",
          title: "Turn duration",
          source: JSON.stringify({
            kind: "histogram",
            title: "Turn duration",
            xLabel: "Duration",
            unit: "s",
            values: [8, 9, 9, 10, 12, 14, 14, 15, 18, 22],
          }),
        }}
      />
    ),
  },
  {
    id: "box-plot-view",
    title: "Box plot tool result",
    description:
      "Distribution summaries preserve each source observation in Data.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-boxes",
          callId: "catalog-boxes",
          kind: "box-plot",
          title: "Latency by provider",
          source: JSON.stringify({
            kind: "box-plot",
            title: "Latency by provider",
            yLabel: "Latency",
            unit: "ms",
            groups: [
              { label: "A", values: [110, 130, 145, 180, 240] },
              { label: "B", values: [90, 120, 125, 140, 190] },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "diagram-edge-states",
    title: "Diagram edge states",
    description:
      "A rejected restored source and an oversized but scrollable view.",
    render: () => (
      <div className="lab-stack">
        <TaskViewCard
          view={{
            sequence: 1,
            id: "catalog-bad-diagram",
            callId: "catalog-bad-diagram",
            kind: "diagram",
            title: "Damaged diagram",
            source: "flowchart ???",
          }}
        />
        <TaskViewCard
          view={{
            sequence: 1,
            id: "catalog-wide-diagram",
            callId: "catalog-wide-diagram",
            kind: "diagram",
            title: "Long release train",
            source: `flowchart LR\n${Array.from({ length: 18 }, (_, index) => `S${index}[Stage ${index + 1}] --> S${index + 1}[Stage ${index + 2}]`).join("\n")}`,
          }}
        />
      </div>
    ),
  },
  {
    id: "diagram-model-colour",
    title: "Diagram with model-chosen colours",
    description:
      "A diagram whose author picked its own fills, including pale ones. Text has to stay readable on whatever ground it lands on, not on the ground the theme assumed.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-coloured-diagram",
          callId: "catalog-coloured-diagram",
          kind: "diagram",
          title: "Data review",
          source: [
            "flowchart TB",
            "  subgraph S1[1 · Collect & Load]",
            "    A[Raw data source]",
            "    B[First look]",
            "    A --> B",
            "  end",
            "  subgraph S2[2 · Assess Quality]",
            "    C[Missing values]",
            "  end",
            "  B --> C",
            "  D[Pale node]",
            "  C --> D",
            "  subgraph S3[3 · Multi-line labels]",
            "    E[PRÉSIDENT DE LA RÉPUBLIQUE<br/>Arbitre art. 5<br/>Chef des armées art. 15]",
            "    F(Rounded pale node)",
            "  end",
            "  D --> E",
            "  E --> F",
            "  style S1 fill:#eaf2ff,stroke:#5b7fbd",
            "  style E fill:#ffe4e1,stroke:#c0392b",
            "  style F fill:#ffe4e1,stroke:#c0392b",
            "  classDef pale fill:#fdf6e3,stroke:#b58900",
            "  class C pale",
            "  style S2 fill:#fdf1dc,stroke:#e0a13a",
            "  style D fill:#f6f6f2,stroke:#999999",
          ].join("\n"),
        }}
      />
    ),
  },
  {
    id: "diagram-class-styled",
    title: "Diagram with class-styled nodes",
    description:
      "The shape a model actually produces: classDef fills, multi-line labels, and labelled edges. Every label has to stay readable on whatever its author painted behind it.",
    render: () => (
      <TaskViewCard
        view={{
          sequence: 1,
          id: "catalog-class-diagram",
          callId: "catalog-class-diagram",
          kind: "diagram",
          title:
            "Interactions des pouvoirs — Constitution du 4 octobre 1958 (consolidée au 8 mars 2024)",
          source: [
            "flowchart TB",
            'subgraph SOUVER["Souveraineté nationale"]',
            '  PEUPLE["LE PEUPLE<br/>Souveraineté nationale (art. 3)<br/>Suffrage universel, égal, secret (art. 3)"]',
            "end",
            'subgraph EXEC["Pouvoir exécutif (Titres II et III)"]',
            '  PRES["PRÉSIDENT DE LA RÉPUBLIQUE<br/>Arbitre (art. 5) · élu 5 ans au suffrage direct (art. 6)<br/>Chef des armées (art. 15)"]',
            '  GOV["GOUVERNEMENT / PREMIER MINISTRE<br/>Détermine et conduit la politique de la Nation (art. 20)"]',
            "end",
            'subgraph LEG["Pouvoir législatif (Titre IV)"]',
            '  PARL["PARLEMENT<br/>Vote la loi · contrôle le Gouvernement (art. 24)"]',
            '  AN["ASSEMBLÉE NATIONALE<br/>Députés, suffrage direct (art. 24)"]',
            "end",
            'PEUPLE -->|"Élit le Président (arts. 6-7)"| PRES',
            'PRES -->|"Nomme le Premier ministre (art. 8)"| GOV',
            'GOV -->|"Engagement de responsabilité (art. 49)"| AN',
            "classDef people fill:#fff8e1,stroke:#b8860b,stroke-width:2px",
            "classDef exec fill:#ffe3e3,stroke:#c0392b,stroke-width:2px",
            "classDef legis fill:#e3f0ff,stroke:#1f5fa8,stroke-width:2px",
            "class PEUPLE people",
            "class PRES,GOV exec",
            "class PARL,AN legis",
          ].join("\n"),
        }}
      />
    ),
  },
  {
    id: "chart-edge-states",
    title: "Chart edge states",
    description:
      "Single-value data remains honest; malformed empty and oversized inputs stay contained.",
    render: () => (
      <div className="lab-stack">
        <TaskViewCard
          view={{
            sequence: 1,
            id: "catalog-single",
            callId: "catalog-single",
            kind: "histogram",
            title: "One observation",
            source: JSON.stringify({
              kind: "histogram",
              title: "One observation",
              values: [12],
            }),
          }}
        />
        <TaskViewCard
          view={{
            sequence: 1,
            id: "catalog-empty",
            callId: "catalog-empty",
            kind: "histogram",
            title: "Empty data",
            source: JSON.stringify({
              kind: "histogram",
              title: "Empty data",
              values: [],
            }),
          }}
        />
        <TaskViewCard
          view={{
            sequence: 1,
            id: "catalog-too-many",
            callId: "catalog-too-many",
            kind: "line-chart",
            title: "Too many series",
            source: JSON.stringify({
              kind: "line-chart",
              title: "Too many series",
              series: Array.from({ length: 9 }, (_, index) => ({
                name: `S${index}`,
                points: [{ x: 1, y: index }],
              })),
            }),
          }}
        />
      </div>
    ),
  },
];
