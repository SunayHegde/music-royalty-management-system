import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../auth';

const NAV = {
  ADMIN: [
    { section: 'Overview' },
    { to: '/admin', label: 'Dashboard', icon: '▦', end: true },
    { section: 'Catalogue' },
    { to: '/admin/tracks', label: 'Tracks', icon: '♫' },
    { to: '/admin/contributors', label: 'Contributors', icon: '☺' },
    { to: '/admin/splits', label: 'Split Agreements', icon: '◔' },
    { to: '/admin/sampling', label: 'Sampling', icon: '⇄' },
    { section: 'Revenue' },
    { to: '/admin/reports', label: 'Report Upload', icon: '⇪' },
    { to: '/admin/unmatched', label: 'Unmatched Rows', icon: '?' },
    { to: '/admin/advances', label: 'Advances', icon: '₹' },
    { to: '/admin/royalties', label: 'Royalty Runs', icon: '∑' },
    { to: '/statements', label: 'Statements', icon: '☰' },
  ],
  FINANCE: [
    { section: 'Finance' },
    { to: '/finance', label: 'Run Approvals', icon: '✓', end: true },
    { to: '/finance/payments', label: 'Payment History', icon: '₹' },
    { to: '/statements', label: 'Statements', icon: '☰' },
  ],
  CONTRIBUTOR: [
    { section: 'My Royalties' },
    { to: '/me', label: 'My Dashboard', icon: '▦', end: true },
    { to: '/me/statement', label: 'My Statement', icon: '☰' },
  ],
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // `end` items match only their exact path; others also match their sub-pages
  const isActive = (it) => pathname === it.to || (!it.end && pathname.startsWith(`${it.to}/`));
  const [open, setOpen] = useState(false);
  const items = NAV[user.role] || [];

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">♪</span>
          <div>
            <div className="brand-name">RoyaltyDesk</div>
            <div className="brand-sub">Music Royalty Management</div>
          </div>
        </div>
        <nav onClick={() => setOpen(false)}>
          {items.map((it) => (it.section
            ? <div key={it.section} className="nav-section">{it.section}</div>
            : (
              <Link key={it.to} href={it.to} className={`nav-link ${isActive(it) ? 'active' : ''}`}>
                <span className="nav-icon" aria-hidden="true">{it.icon}</span>{it.label}
              </Link>
            )))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">{user.fullName?.[0] || '?'}</div>
          <div className="grow">
            <div className="user-name">{user.fullName}</div>
            <div className="user-role">{user.role.toLowerCase()} · {user.username}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { logout(); router.push('/login'); }}>Log out</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button type="button" className="btn btn-ghost menu-btn" onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button>
          <span className="brand-name">RoyaltyDesk</span>
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
