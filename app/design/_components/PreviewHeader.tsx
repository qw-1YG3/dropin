import Link from "next/link";

type PreviewHeaderProps = {
  pageName: string;
  stage: string;
  version: string;
};

export function PreviewHeader({ pageName, stage, version }: PreviewHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-dashed border-gray-200 bg-gray-50 px-4 py-1.5 text-center text-[11px] uppercase tracking-wide text-gray-500">
      <Link href="/design" className="text-gray-500 hover:text-gray-700 hover:underline">
        &larr; All Previews
      </Link>
      <span className="text-gray-300">|</span>
      <span>{pageName}</span>
      <span className="text-gray-300">&middot;</span>
      <span>{stage}</span>
      <span className="text-gray-300">&middot;</span>
      <span>{version}</span>
    </div>
  );
}
