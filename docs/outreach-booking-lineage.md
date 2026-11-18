# Booking attribution for account outreach

Apply `supabase/outreach-consultation-links.sql` after both `outreach-requests.sql` and `consultation-bookings.sql` (and the existing consultation upgrades in their documented order). This migration adds attribution, without changing booking confirmation or callback authority.

A family explicitly choosing to book for an account outreach request sends its UUID as optional `outreachRequestId` to the normal `POST /api/consultations` request. The server checks the signed-in owner and exact provider before scheduler activity. The initial booking claim stores the link atomically; a composite foreign key verifies account, request, and office again in PostgreSQL. The link and its owner/provider cannot be changed after insertion. Legacy callers omit the field and remain unlinked. Replaying a booking UUID with different attribution returns 409. A linked submission cannot silently borrow a different open booking; the family must review that existing booking.

`GET /api/outreach-bookings?requestId=<uuid>` verifies account ownership and returns at most ten bookings for that exact request and provider, newest first. Its `bookings` entries expose `bookingId`, `providerId`, `status`, `source`, `startsAt`, `endsAt`, `timezone`, `createdAt`, and `nextAction`. It exposes no phone numbers, email, call identifiers, scheduler URIs, transcripts, or rehearsal data. Unknown or unauthorized request IDs return the same 404.

`source` is `phone`, `calendly`, or `highlevel`. `nextAction` is `wait_for_receipt` for searching, submitting, and unknown states; `review_confirmation` for confirmed/past; `choose_another_window` for unavailable; and `contact_office` for expired/failed. Starts/ends are null unless the booking is confirmed or past. A tentative slot or submitted call is never a confirmation. Existing scheduler receipt checks and authenticated Twilio callbacks remain the only sources of booking confirmation.

The generic office consultation history remains available to legacy callers. Only this request-scoped endpoint proves attribution to a particular outreach request. Simulation receipts must be rendered separately and cannot establish this link.

Verification uses PGlite and stubbed route dependencies; tests never call live schedulers or phone providers:

```sh
node --import tsx --test tests/outreach-bookings-api.test.ts tests/outreach-bookings.test.ts tests/consultation-ledger.test.ts
```
