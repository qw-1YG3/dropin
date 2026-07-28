type PreviewMetaProps = {
  pageName: string;
  stage: string;
  version: string;
};

export function PreviewMeta({ pageName, stage, version }: PreviewMetaProps) {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-dashed border-gray-200 bg-gray-50 px-4 py-1.5 text-center text-[11px] uppercase tracking-wide text-gray-500">
      <span>{pageName}</span>
      <span className="text-gray-300">&middot;</span>
      <span>{stage}</span>
      <span className="text-gray-300">&middot;</span>
      <span>{version}</span>
    </div>
  );
}
