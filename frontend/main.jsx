import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './src/AdminApp';
import { BookingPage } from './src/BookingPage';
import './src/styles.css';
import './src/booking.css';
import './src/manage.css';

const bookingMatch = window.location.pathname.match(/^\/book\/([^/]+)/);
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {bookingMatch ? <BookingPage slug={decodeURIComponent(bookingMatch[1])} /> : <AdminApp />}
  </React.StrictMode>
);
