import './globals.css';
export const metadata = {
  title: 'DBK Recovery Bridge | DBK → Ethereum',
  description: 'Independent, self-custodial OP Stack withdrawal recovery interface for DBK Chain. Verify, prove and finalize.',
  robots: { index: false, follow: false },
};
export default function RootLayout({children}) {
  return <html lang="en"><body>{children}</body></html>;
}
