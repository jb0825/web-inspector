import { ShowcaseReportPage, showcaseMetadata } from '../ShowcaseReport';

// T14: Before/After 사례 리포트 (public/showcase/after/). 파일이 없으면 404
export const metadata = showcaseMetadata('after');

export default function Page() {
  return <ShowcaseReportPage name="after" />;
}
