# Booking a first home-care consultation in North Jersey

Checked November 16, 2026. Six offices are matched to Harbor’s NJ provider catalog by name and street address or license. Each link below goes to the office’s own public route. The appointment being investigated is a first conversation or assessment. Care shifts have a separate schedule.

| Harbor office | What a family encounters | What Harbor can report |
|---|---|---|
| Elderly Savior Homecare, Orange · HP0265900 | The [office booking page](https://elderlysaviorhc.com/book-now) embeds an active HighLevel calendar for a free 30-minute home-care consultation. It also has a separate contact form. The widget uses a 15-minute start interval. | A live browser displayed 9:00, 9:15 and 9:30 a.m. Eastern on Tuesday, Nov 17, among the available starts. Harbor can refresh openings before reserving. |
| FirstLight of Piscataway, Somerset · HP0361900 | [Local intake](https://www.firstlighthomecare.com/home-healthcare-piscataway/contact-us/) asks for first and last name, phone, email and care category. It tells families staff will respond. The office publishes (732) 412-7342 and license HP0361900. | A submitted inquiry can start a conversation. A staff reply is needed for the appointment time. |
| HomeWell, Union · HP0249500 | [The Union office](https://homewellcares.com/in-home-care-nj-union-nj1112/contact-us/) accepts an assessment inquiry by phone or form. It asks for name, email, care ZIP and phone. Use (908) 302-0200 for Union. Two other offices share the footer. | Staff can offer a time for the assessment. Preserve the care ZIP and exact office when following up. |
| Home Instead Morris County, Parsippany · HP0397500 | [Four-step intake](https://www.homeinstead.com/home-care/usa/nj/morris-county/322/) asks who needs care, what help they need, how soon and how to reach them. The final screen says a care consultant will reach out. Office line (973) 970-9250. | The timing question describes when care is needed. Log the family’s answer separately from a consultation date. |
| J.A.I.Z Quality Home Health Care, East Brunswick · HP0433600 | [Assessment request](https://jaizqualityhomehealthcare.com/book-online) collects service, name, phone, email, town, preferred date and preferred time window. It offers a complimentary safety assessment and publishes (732) 231-5455. | Save the requested date and window as preferences while waiting for the coordinator. |
| A Helping Hand Senior Services, Metuchen · HP0401800 | The [consultation link](https://www.helpingservicess.com/book-online) returns to a list of services. Its “Book Now” belongs to live-in care. The office lists (732) 790-2616 and info@helpingservicess.com. | Ask the Metuchen office directly about consultation availability. |

The full Harbor ID for each row is `north-jersey-hp-` followed by the lowercase license, e.g. `north-jersey-hp-hp0265900`. Office identifiers were checked against the dashboard’s `research/north-jersey/runtime/providers.json`.

## First integration candidate

On November 16 a live Chrome browser opened the office booking page in the New York timezone, waited for its embedded calendar and read the offerings. The calendar defaulted to **Tuesday, November 17, 2026**. The same view showed a 30-minute consultation in **GMT−05:00 America/New_York (EST)**, including **9:00 a.m., 9:15 a.m. and 9:30 a.m.**, with 4:30 p.m. also offered. These are time-stamped observations that can change. [Calendar screenshot](./Elderly%20Savior%20public%20availability.png)

Elderly Savior’s rendered page can appear to carry only contact fields in a search index. Its first-party HTML includes a separate HighLevel calendar named **Client Booking**, ID `QnvoAQkNH8HYRfrJk8Ri`. The office address on the page is 202 Wallace Street, Orange. Its published calendar configuration uses `America/Cancun`. Display the actual returned instant in the family’s chosen timezone. In summer, New Jersey and Cancún can differ by an hour. Refresh immediately before reserving and retain the returned appointment ID and status.

The same configuration enables auto-confirmation, but the thank-you copy says staff will contact the requester to confirm. Treat the booking-specific response as decisive. Persist an unconfirmed request for follow-up and only send the meeting invite once its date and confirmation status are known. The contact form also includes marketing language. The separate booking form and any required consent should be checked on their own terms.

HighLevel documents agency-authorized operations for [listing free slots](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-slots/), [creating an appointment](https://marketplace.gohighlevel.com/docs/ghl/calendars/create-appointment/) and [retrieving its status](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-appointment/). A live integration test needs the agency’s authorized connection plus a designated test booking or a real family acting within its booking brief.

## Two misleading signals found during discovery

- At Care For Less in Fairfield, the online form offers a date and time, and its response copy says a specialist will follow up. A selectable time alone does not establish that the agency checked a shared calendar. [Office form](https://www.careforlesshc.com/)
- Easy Help at Home in Toms River describes a Calendly call in its copy. Its actual button opens a Jotform consultation request. This is an out-of-area comparison and was excluded from the six offices. [Agency button](https://www.easyhelpathome.com/) · [Actual destination](https://form.jotform.com/232745601195052)

Research was read-only. No family data was transmitted, appointment reserved, or provider contacted.
