-- Apply after consultation-recovery.sql. Additive evidence; does not confirm a booking.
begin;
alter table public.consultation_bookings
  add column if not exists office_callback_pending boolean not null default false;
alter table public.consultation_bookings
  drop constraint if exists consultation_office_callback_evidence;
alter table public.consultation_bookings
  add constraint consultation_office_callback_evidence check (
    not office_callback_pending or (source = 'phone' and status in ('unknown', 'expired')
      and starts_at is null and ends_at is null)
  );
commit;
