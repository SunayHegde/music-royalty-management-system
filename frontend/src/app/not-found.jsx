'use client';

import Home from './page';

// Unknown URLs behave like "/": go to the user's home page or the login page.
export default function NotFound() {
  return <Home />;
}
