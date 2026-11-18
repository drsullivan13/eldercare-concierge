# Rehearsal receipt API

The voice service calls `POST /api/outreach-receipt` after a simulated run. Apply `supabase/outreach-rehearsal-receipts.sql` after the request and handoff migrations. This endpoint records rehearsal history without changing the parent request state.

Send `Authorization: Bearer <HARBOR_OUTREACH_SERVICE_KEY>` and `Content-Type: application/json`. The body has exactly these fields:

```json
{
  "runId": "aaaabbbb-cccc-4123-8234-abcdefabcd00",
  "runKey": "<64 lowercase hexadecimal characters from the exchange>",
  "outcome": {
    "status": "completed",
    "takeaways": ["Simulated discussion completed."],
    "nextSteps": ["Contact the office to confirm availability."]
  }
}
```

`runId` is a UUID. `outcome` contains exactly `status`, `takeaways`, and `nextSteps`. Status is `completed` or `failed`. Each list has zero to six nonblank strings, each at most 240 Unicode codepoints; NUL characters are rejected. The request body is limited to 12 KiB, and the database limits the stored JSON representation to 8192 bytes. Send a concise summary without transcripts or credentials.

Success is HTTP 200 with exactly `{"recorded":true}`. An identical retry returns the same confirmation while the run credential remains valid. A different outcome for that run returns 409. Expired, unknown, or mismatched run credentials return the same 404 response. The endpoint returns 400 for malformed, oversized, or invalid input; 401 for missing or invalid service authorization; and 503 for backend failures. Responses use `Cache-Control: private, no-store, max-age=0` and never echo receipt contents, credentials, or internal errors. Keep the run credential and service key on the voice service; this endpoint does not accept browser account authorization.
