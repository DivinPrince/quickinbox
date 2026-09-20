# Mail, contacts, and calendar

The first release focuses on a built-in address book and calendar. The user's
priority is invitations, scheduling, and reminders; connecting Google accounts
comes later. This release is a step toward Gmail parity, not a claim of full
Google Workspace equivalence.

## Included

| Workflow              | Behavior                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Address book          | Create, edit, delete, search, favorite; multiple emails, company, phone, notes; account isolation and optimistic edits                  |
| Compose               | Contact suggestions in To/Cc/Bcc and forwarding; arrow keys/Enter select, Tab retains normal field order                                |
| Mail to people/events | Save sender, compose to contact, schedule with contact, create an event from email subject/body/participants                            |
| Calendar              | Month, week, agenda; timed/all-day events; explicit IANA zones and DST validation; overlap warning against the visible calendar range   |
| Invitations           | Individual `.ics` REQUEST/REPLY/CANCEL; stable UID and sequence; organizer sends guest additions/updates/cancellations                  |
| RSVP                  | Accept/Maybe/Decline from mail; organizer applies incoming guest replies; attendee applies incoming cancellation                        |
| Delivery              | Event and immutable notices commit together; idempotent handoff to durable Outbox, with delivery status and retry controls              |
| Reminders             | One per event, up to a week before; in-app notice and optional browser push using existing settings; cancellation invalidates reminders |
| Portability           | Download individual events as `.ics`                                                                                                    |
| Interfaces            | Classic, Zero, light/dark, and mobile navigation                                                                                        |

Incoming calendar messages are never acted on just by opening the message.
Mutations require a matching sender/organizer or invited guest, an owned source
message, matching event UID and revision, and an explicit user action. This
matching does not replace the mail provider's sender-authentication checks.
Embedded calendar alarms and external attachment URLs are not executed or fetched.
Existing mail API tokens receive no new contacts/calendar privileges.

## Next milestones

1. **Scheduling depth:** recurring series, exceptions and edits to this/future/all
   occurrences; a timed weekly grid, drag/reschedule, multiple reminders, snooze,
   additional calendars, and configurable calendar time zone. Cover DST changes
   and recurrence expansion with bounded queries before accepting recurring ICS.
2. **People and portability:** contact groups, merge duplicates, birthdays,
   vCard/Google CSV import/export, full ICS import/export, invitations from the
   calendar details panel, and event search. Translate new organizer screens into
   the app's other supported languages.
3. **Collaboration:** shared calendars, explicit permissions, free/busy, proposed
   new times, delegated organizers, room resources, and appointment booking.
4. **Mail parity audit:** prioritize scheduled send, filters/rules, advanced search,
   vacation responses, keyboard shortcuts, and offline behavior against the
   existing implementation. Treat each as a separately tested increment.
5. **Optional synchronization:** Google Contacts/Calendar OAuth, scoped consent,
   incremental sync, conflict handling, revocation, and token storage. Keep the
   built-in tools usable without Google.

## Validation and rollout

Run `bun run check`, `bun run test`, and `bun run build`. The organizer tests use
real SQLite migrations and mock delivery; no test sends real email. They cover
ownership, concurrent versions, transactional rollback, timezone/DST handling,
ICS parsing/roundtrips, sender/guest mismatches, stale messages, cancellation,
outbox recovery, and reminder invalidation. Browser checks cover both interfaces,
keyboard flow, event editing, email integration, and mobile layouts.

Apply migration `0029_contacts_calendar.sql` before deploying. It creates only
new tables and indexes. Existing mail data and configuration are unchanged.
The existing minute cron hands off at most 20 calendar notices and processes at
most 50 due reminders per run. Push delivery is best effort; the database-backed
in-app notice is the durable reminder surface. Failed handoffs remain visible on
the event, while provider delivery failures use the existing Outbox workflow.

## Product references

- [Google: invite people to events](https://support.google.com/calendar/answer/37161?hl=en-GB)
- [Google: respond to event invitations](https://support.google.com/calendar/answer/37135?hl=en-GB)
- [Google: use calendar time zones](https://support.google.com/calendar/answer/37064?hl=en-GB)
- [Google: recurring events](https://support.google.com/calendar/answer/37115?hl=en-uk)
- [Google: add, move, or import contacts](https://support.google.com/contacts/answer/1069522?hl=en)
- [IETF: iCalendar scheduling interoperability (RFC 5546)](https://www.rfc-editor.org/info/rfc5546/)
