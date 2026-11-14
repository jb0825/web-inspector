import type { MetadataRoute } from 'next';

// T13: 검사 대상 테스트 페이지(Fixture, 데모)와 API는 크롤링하지 않는다.
// 공유 리포트(/report/[id])와 진행 화면은 페이지 metadata의 noindex로 막는다(DOMAIN_MODEL 8장).
// robots.txt로 막으면 크롤러가 noindex를 읽지 못해 링크만으로 색인될 수 있기 때문이다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/fixtures/', '/demo/', '/api/'],
    },
  };
}
