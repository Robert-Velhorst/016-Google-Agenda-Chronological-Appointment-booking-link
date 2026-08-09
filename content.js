/**
 * Appointment Duration Sorter
 *
 * Reorders sibling appointment choices by their advertised duration.  It is
 * deliberately conservative: Google Calendar's week/day grid is not an
 * appointment-choice list, so calendar events and other page controls are
 * never used as a fallback sorting target.
 */
(() => {
  'use strict';

  const DEBOUNCE_MS = 120;
  const ITEM_SELECTOR = [
    '.card',
    '.appointment-option',
    '.appointment-card',
    '.appointment-slot',
    '.booking-slot',
    '.time-slot',
    '.time-slot-item',
    '.gm-appointment-item',
    'button[aria-label*="minute"]',
    'button[aria-label*="Minute"]',
    'button[aria-label*="min"]',
    'button[aria-label*="Min"]',
    '[role="button"][class*="slot"]',
    '[role="button"][class*="time"]',
    '[data-appointment-duration]',
    '[data-duration][data-appointment]'
  ].join(',');
  const DURATION_ATTRIBUTE_NAMES = [
    'data-appointment-duration',
    'data-duration',
    'data-duration-minutes'
  ];

  let debounceTimer = null;
  let observer = null;
  let paused = document.hidden;

  function isSupportedPage() {
    if (globalThis.__APPOINTMENT_SORTER_TEST__ === true) return true;
    const host = location.hostname;
    if (host.endsWith('noodzakelijkonline.nl') || host === 'calendar.app.google') {
      return true;
    }

    // Do not run in the general Calendar UI (week/day/month views). The
    // extension only needs Google Calendar's public appointment pages.
    return host === 'calendar.google.com' && (
      /\/calendar\/(?:selfsched|appointments)(?:\/|$)/.test(location.pathname) ||
      /\/calendar\/.*\/(?:r\/)?appointment/.test(location.pathname)
    );
  }

  function durationFromText(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const noDuration = normalized.match(/\bNO\s*(\d+(?:[.,]\d+)?)\b/i);
    if (noDuration) return Number(noDuration[1].replace(',', '.'));

    const hours = normalized.match(/\b(\d+(?:[.,]\d+)?)\s*(?:hours?|uren|uur|hrs?|hr|h)\b/i);
    const minutes = normalized.match(/\b(\d+(?:[.,]\d+)?)\s*(?:minutes?|minuten|mins?|min)\b/i);
    const compactMinutes = normalized.match(/\b(\d+(?:[.,]\d+)?)m\b/i);
    const minuteValue = minutes || compactMinutes
      ? Number((minutes || compactMinutes)[1].replace(',', '.'))
      : 0;
    if (hours) return Number(hours[1].replace(',', '.')) * 60 + minuteValue;
    if (minutes || compactMinutes) return minuteValue;

    return Number.POSITIVE_INFINITY;
  }

  function extractDuration(item) {
    for (const attribute of DURATION_ATTRIBUTE_NAMES) {
      const value = item.getAttribute(attribute);
      if (value !== null) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
    return durationFromText(`${item.textContent || ''} ${item.getAttribute('aria-label') || ''}`);
  }

  function isCalendarGridElement(element) {
    return element.closest('[role="grid"], [role="gridcell"], [role="columnheader"]') !== null;
  }

  function getSortableItems() {
    return [...document.querySelectorAll(ITEM_SELECTOR)].filter((item) => {
      if (!(item instanceof HTMLElement) || !item.parentElement || isCalendarGridElement(item)) return false;
      return Number.isFinite(extractDuration(item));
    });
  }

  function sortRun(run) {
    if (run.length < 2) return false;

    const sorted = run
      .map((item, index) => ({ item, index, duration: extractDuration(item) }))
      .sort((a, b) => a.duration - b.duration || a.index - b.index);

    if (sorted.every((entry, index) => entry.item === run[index])) return false;

    // Reinsert before the element after the run so non-appointment siblings
    // retain their exact position even though every run item is moved first.
    const parent = run[0].parentElement;
    const afterRun = run[run.length - 1].nextSibling;
    const fragment = document.createDocumentFragment();
    sorted.forEach(({ item }) => fragment.appendChild(item));
    parent.insertBefore(fragment, afterRun);
    return true;
  }

  function sortAppointmentChoices() {
    if (paused || !isSupportedPage()) return;

    const byParent = new Map();
    for (const item of getSortableItems()) {
      const siblings = byParent.get(item.parentElement) || [];
      siblings.push(item);
      byParent.set(item.parentElement, siblings);
    }

    for (const [parent, items] of byParent) {
      // Sort only contiguous runs. This avoids moving appointment items across
      // headings, date separators, consent text, or unrelated controls.
      const itemSet = new Set(items);
      let run = [];
      for (const child of parent.children) {
        if (itemSet.has(child)) {
          run.push(child);
        } else {
          sortRun(run);
          run = [];
        }
      }
      sortRun(run);
    }
  }

  function scheduleSort() {
    if (paused || debounceTimer !== null) return;
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      sortAppointmentChoices();
    }, DEBOUNCE_MS);
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      if (paused) return;
      if (mutations.some((mutation) => mutation.type === 'characterData' || mutation.type === 'attributes' ||
        (mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length)))) {
        scheduleSort();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label', ...DURATION_ATTRIBUTE_NAMES]
    });
  }

  function init() {
    if (!isSupportedPage()) return;
    scheduleSort();
    startObserver();
    document.addEventListener('visibilitychange', () => {
      paused = document.hidden;
      if (!paused) scheduleSort();
    });
  }

  init();
})();
