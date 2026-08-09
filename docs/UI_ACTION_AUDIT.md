# UI Action Audit

Every visible action below is wired to a real route or a local navigation/state operation. Disabled actions explain their prerequisite in the UI; there are no decorative success controls.

| Surface | Visible action | Implementation | Failure behavior |
| --- | --- | --- | --- |
| Operator login | Continue | Saves bearer token in `sessionStorage`; calls `/api/admin/status` | Inline authentication error |
| Navigation | Overview, Availability, Schedules, Bookings, Exceptions, Audit, Settings | React route state | Selected section is explicit |
| Availability | Create schedule | Opens the real schedule form | Validation stays visible |
| Schedules | Save schedule | `POST /api/admin/schedules` | API error shown; no optimistic success |
| Schedules | Activate, pause, archive | `PATCH /api/admin/schedules/:id/status` | Activation reports provider verification failure |
| Schedule card | Copy booking link | Clipboard API | Browser clipboard failure is surfaced |
| Settings | Connect Google | `POST /api/admin/google/start`, then explicit OAuth navigation | Missing credentials returned as error |
| Settings | Disconnect Google | `POST /api/admin/google/disconnect` | Revoke/disconnect failure is surfaced |
| Settings | Pause/resume all booking | `POST /api/admin/emergency-stop` | State only changes after server response |
| Settings | Export data | `GET /api/admin/export` and browser download | Download error is surfaced |
| Settings | Reconcile uncertain bookings | `POST /api/admin/reconcile` | Found/missing/unresolved counts shown after bounded read-only lookup |
| Settings | Delete local data | Explicit phrase plus Google-event acknowledgement, then `DELETE /api/admin/data` | Fails closed if acknowledgement is absent |
| Requester | Choose duration/date | Fetches live `/slots` | Unavailable/provider error shown |
| Requester | Choose time | Selects one chronological server slot | Cannot continue without selection |
| Requester | Confirm booking | `POST /book` with a stable idempotency key | No confirmation until provider mutation completes |
| Booking success | Open manage link | Fragment-held secret, never query string | Invalid token returns generic not-found |
| Manage booking | Cancel | `POST /cancel` with token in JSON body | No local success before provider result |
| Manage booking | Reschedule | Fetches slots and calls `POST /reschedule` | Conflict returns user-selectable retry path |
