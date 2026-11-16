-- Run after consultation-bookings.sql. Safe to reapply with existing phone and Calendly receipts.
begin;
alter table public.consultation_bookings add column if not exists invite_delivery text not null default 'agency' check (invite_delivery in ('agency','harbor'));
update public.consultation_bookings set invite_delivery='harbor' where source='phone' and invite_delivery <> 'harbor';
alter table public.consultation_bookings
  drop constraint if exists consultation_bookings_source_check,
  drop constraint if exists consultation_bookings_check1,
  drop constraint if exists consultation_bookings_receipt_check;
alter table public.consultation_bookings
  add constraint consultation_bookings_source_check check (source in ('phone','calendly','highlevel')),
  add constraint consultation_bookings_receipt_check check (
    status not in ('confirmed','past') or
    (starts_at is not null and (
      (source in ('calendly','highlevel') and event_uri is not null and invitee_uri is not null)
      or (source='phone' and call_sid is not null)
    ))
  );
commit;
