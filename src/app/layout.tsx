import type { Metadata } from 'next';
import { Google_Sans_Code, Noto_Sans_KR } from 'next/font/google';
import './globals.css';

// DESIGN_GUIDE 3.1: family 이름을 직접 쓰지 않고 variable로 만든 CSS 변수를 쓴다
const notoSansKr = Noto_Sans_KR({
  variable: '--font-noto-sans-kr',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const googleSansCode = Google_Sans_Code({
  variable: '--font-google-sans-code',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Website Inspector',
  description: 'Desktop과 Mobile에서 웹사이트의 UI 문제를 찾아 개발 태스크와 코딩 에이전트용 프롬프트로 정리합니다.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} ${googleSansCode.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
