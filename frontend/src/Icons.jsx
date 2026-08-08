export function Icon({ name, size = 20 }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    overview: <><path d="M4 10 12 3l8 7v10H4Z"/><path d="M9 20v-6h6v6"/></>,
    schedules: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 2v4M16 2v4M4 9h16"/></>,
    bookings: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M15 15c4 0 6 2 6 5"/></>,
    exceptions: <><path d="M12 3 2.5 20h19Z"/><path d="M12 9v4M12 17h.01"/></>,
    audit: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1A7 7 0 0 0 15 6l-.3-2.5h-4L10.4 6A7 7 0 0 0 8 7L5.6 6 3.6 9.5 5.8 11a7 7 0 0 0 0 2l-2.2 1.5 2 3.5L8 17a7 7 0 0 0 2.4 1l.3 2.5h4L15 18a7 7 0 0 0 2-1l2.4 1 2-3.5-2.3-1.5a7 7 0 0 0 0-1Z"/></>,
    copy: <><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
    chevronLeft: <path d="m15 18-6-6 6-6"/>,
    chevronRight: <path d="m9 18 6-6-6-6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
