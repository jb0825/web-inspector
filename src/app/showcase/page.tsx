import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { IssueTypeLabel, PriorityBadge, ViewportTagBadge } from '@/components/inspection/badges';
import { Badge } from '@/components/ui/Badge';
import { buttonClassName } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { formatDateTime } from '@/lib/format';
import { compareIssues, countRows, type CountRow } from '@/server/compare/beforeAfter';
import { loadShowcase, type ShowcaseName } from '@/server/showcase';
import type { Inspection, Issue } from '@/types/inspection';

// T14: Before/After 비교 화면. public/showcase/{before,after}/inspection.json을 빌드할 때 읽어 정적으로 만든다.
// 매칭은 scripts/compare-inspections.ts와 같은 함수(src/server/compare/beforeAfter.ts)를 쓴다.
// 검사 대상 URL은 문자열로만 보여 준다. 정적 화면이라 SSRF 판정을 거치지 않는다(localhost 대상도 그대로 표시).
// 두 파일 중 하나라도 없으면 "준비 중"을 보여 준다(빌드가 깨지지 않게).

export const metadata: Metadata = {
  title: 'Before / After 비교',
  description: '검사 결과의 프롬프트로 사이트를 고치기 전과 후의 이슈를 비교합니다.',
};

/** 빌드 서버의 시간대와 관계없이 같은 문자열이 나오도록 UTC로 표시한다 */
function utc(iso: string): string {
  return `${formatDateTime(iso, { timeZone: 'UTC' }) ?? iso} UTC`;
}

function issueHref(name: ShowcaseName, issue: Issue): string {
  return `/report/${name}?issue=${encodeURIComponent(issue.id)}`;
}

function Overview({ before, after }: { before: Inspection; after: Inspection }) {
  const rows: { label: string; inspection: Inspection; name: ShowcaseName }[] = [
    { label: 'Before', inspection: before, name: 'before' },
    { label: 'After', inspection: after, name: 'after' },
  ];
  return (
    <section aria-label="검사 정보" className="grid gap-3 sm:grid-cols-2">
      {rows.map(({ label, inspection, name }) => (
        <div key={name} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-body font-semibold">{label}</p>
            <Link href={`/report/${name}`} className="inline-flex min-h-11 items-center gap-1 text-body-sm font-medium text-accent hover:underline sm:min-h-0">
              리포트 보기
              <ChevronRight aria-hidden size={14} strokeWidth={1.75} />
            </Link>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body-sm">
            <dt className="text-text-secondary">검사 대상</dt>
            <dd className="min-w-0 font-mono wrap-anywhere">{inspection.finalUrl ?? inspection.url}</dd>
            <dt className="text-text-secondary">검사 시각</dt>
            <dd className="tabular-nums">{utc(inspection.createdAt)}</dd>
          </dl>
        </div>
      ))}
    </section>
  );
}

function Change({ row }: { row: CountRow }) {
  const diff = row.after - row.before;
  const text = diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : '0';
  return <span className={diff < 0 ? 'text-success-text' : diff > 0 ? 'text-error-text' : 'text-text-secondary'}>{text}</span>;
}

function CountTable({ before, after }: { before: Inspection; after: Inspection }) {
  const counts = countRows(before.issues, after.issues);
  const rows = [...counts.priority, counts.total[1]!];
  return (
    <section aria-labelledby="showcase-counts" className="flex flex-col gap-2">
      <h2 id="showcase-counts" className="text-h3 font-semibold">
        이슈 수
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-body-sm text-text-secondary">
              <th scope="col" className="py-2 pr-4 font-medium">
                구분
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Before
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                After
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                변화
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {row.label === 'Needs Review' ? <Badge tone="neutral">Needs Review</Badge> : <PriorityBadge priority={row.label as Issue['priority']} />}
                </th>
                <td className="py-2 pr-4 text-right">{row.before}</td>
                <td className="py-2 pr-4 text-right">{row.after}</td>
                <td className="py-2 text-right">
                  <Change row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-text-secondary">P0~P3은 확정 이슈(Needs Review가 아닌 이슈)만 셉니다.</p>
    </section>
  );
}

function IssueRow({ issue, name, extra }: { issue: Issue; name: ShowcaseName; extra?: ReactNode }) {
  return (
    <li className="border-b border-border">
      <Link
        href={issueHref(name, issue)}
        className="flex min-h-11 flex-col gap-1 py-2 hover:bg-background-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid sm:flex-row sm:items-center sm:gap-3"
      >
        <span className="flex shrink-0 items-center gap-2">
          <PriorityBadge priority={issue.priority} />
          <span className="font-mono text-body-sm text-text-secondary">{issue.id}</span>
          <ViewportTagBadge tag={issue.viewportTag} hideWhenNull />
          {issue.needsReview ? <Badge tone="neutral">Needs Review</Badge> : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-body wrap-anywhere">{issue.title}</span>
          <IssueTypeLabel type={issue.type} subtype={issue.subtype} className="text-caption text-text-secondary" />
        </span>
        {extra ? <span className="text-body-sm text-text-secondary sm:ml-auto sm:shrink-0">{extra}</span> : null}
      </Link>
    </li>
  );
}

function IssueSection({ id, title, description, children, count }: { id: string; title: string; description: string; children: ReactNode; count: number }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-h3 font-semibold">
          {title} <span className="tabular-nums text-text-secondary">{count}</span>
        </h2>
        <p className="text-body-sm text-text-secondary">{description}</p>
      </div>
      {count === 0 ? <p className="text-body-sm text-text-secondary">없습니다.</p> : <ul className="flex flex-col border-t border-border">{children}</ul>}
    </section>
  );
}

function NotReady() {
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" title="Before/After 사례를 준비하고 있습니다">
        수정 전과 후의 검사 결과를 가져오면 이 화면에서 비교할 수 있습니다.
      </Notice>
      <Link href="/report/sample" className={buttonClassName('secondary', 'md', 'min-h-11 self-start')}>
        샘플 리포트 보기
      </Link>
    </div>
  );
}

export default function ShowcasePage() {
  const before = loadShowcase('before');
  const after = loadShowcase('after');
  const comparison = before && after ? compareIssues(before.issues, after.issues) : null;

  return (
    <>
      <Header />
      <PageContainer size="wide" className="flex flex-col gap-8 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-semibold">Before / After 비교</h1>
          {comparison ? (
            <p className="text-body text-text-secondary">
              Before 리포트의 개발 태스크 프롬프트로 사이트를 고친 뒤 같은 주소를 다시 검사했습니다. 같은 유형이고 대상 요소가 같은 이슈를 같은 이슈로
              봅니다.
            </p>
          ) : null}
        </div>
        {before && after && comparison ? (
          <>
            <Overview before={before} after={after} />
            <CountTable before={before} after={after} />
            <IssueSection id="showcase-resolved" title="해결된 이슈" description="Before에만 있고 After에서는 사라진 이슈입니다." count={comparison.resolved.length}>
              {comparison.resolved.map((issue) => (
                <IssueRow key={issue.id} issue={issue} name="before" />
              ))}
            </IssueSection>
            <IssueSection id="showcase-remaining" title="남은 이슈" description="Before와 After에 모두 있는 이슈입니다. After 리포트로 연결됩니다." count={comparison.remaining.length}>
              {comparison.remaining.map(({ before: b, after: a }) => (
                <IssueRow key={a.id} issue={a} name="after" extra={b.priority === a.priority ? `Before ${b.id}` : `Before ${b.id} · ${b.priority} → ${a.priority}`} />
              ))}
            </IssueSection>
            <IssueSection id="showcase-added" title="새로 생긴 이슈" description="After에서 처음 나온 이슈입니다." count={comparison.added.length}>
              {comparison.added.map((issue) => (
                <IssueRow key={issue.id} issue={issue} name="after" />
              ))}
            </IssueSection>
          </>
        ) : (
          <NotReady />
        )}
      </PageContainer>
    </>
  );
}
