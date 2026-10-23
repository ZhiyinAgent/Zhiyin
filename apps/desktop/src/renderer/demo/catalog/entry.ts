export type ComponentCatalogEntry = {
  id: string;
  title: string;
  description: string;
  className?: string;
  render: () => React.ReactNode;
};
