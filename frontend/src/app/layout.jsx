import Providers from './providers';
import '../styles.css';

export const metadata = {
  title: 'Music Royalty Manager',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='11' fill='%234f46e5'/><path d='M10 16.5a2 2 0 1 1-2-2c.4 0 .7.1 1 .3V7l7-1.5v8a2 2 0 1 1-2-2c.4 0 .7.1 1 .3V8.2l-5 1v7.3z' fill='white'/></svg>",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
