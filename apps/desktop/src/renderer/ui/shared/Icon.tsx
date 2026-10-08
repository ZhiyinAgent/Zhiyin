import type { SVGProps } from "react";

type IconName =
  | "alert"
  | "arrow-up"
  | "check"
  | "chevron"
  | "clock"
  | "code"
  | "file"
  | "folder"
  | "globe"
  | "image"
  | "info"
  | "lock"
  | "lightbulb"
  | "menu"
  | "pause"
  | "pencil"
  | "plug"
  | "plus"
  | "rewind"
  | "search"
  | "settings"
  | "sliders"
  | "spark"
  | "square"
  | "trash"
  | "usage"
  | "user"
  | "users"
  | "x";

const paths: Record<IconName, React.ReactNode> = {
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
  "arrow-up": <path d="m6 12 6-6 6 6M12 6v12" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  code: <path d="m8 9-3 3 3 3m8-6 3 3-3 3m-2-9-4 12" />,
  file: <path d="M7 3h7l4 4v14H7V3Zm7 0v5h5" />,
  folder: <path d="M3 7h7l2 2h9v10H3V7Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  lightbulb: (
    <path d="M9 17h6m-5 3h4M9 17v-2a5 5 0 1 1 6 0v2M12 2V1M4.2 4.2l-1-1M2 10H1m21 0h1m-3.2-5.8 1-1" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  pause: <path d="M9 7v10m6-10v10" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4" />,
  plug: (
    <>
      <path d="M9 2v6M15 2v6" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0V8Z" />
      <path d="M12 16v6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  rewind: <path d="M9 8H4V3m0 5a9 9 0 1 1-1 7" />,
  search: <path d="m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  sliders: <path d="M4 7h10m4 0h2M4 17h4m4 0h8M16 5v4M10 15v4" />,
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5 17 4.5-4.5 3 3 2.5-2.5L19 17" />
    </>
  ),
  spark: (
    <path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Zm7 13 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />
  ),
  square: <rect x="6" y="6" width="12" height="12" rx="2" />,
  trash: <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v6m4-6v6" />,
  usage: <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19M15 5.3a3 3 0 0 1 0 5.4M17 13a4.5 4.5 0 0 1 3.5 4.4V19" />
    </>
  ),
  x: <path d="m7 7 10 10M17 7 7 17" />,
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
