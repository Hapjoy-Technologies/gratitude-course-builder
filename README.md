# Gratitude Courses Admin

Internal course operations tool for the Gratitude backend.

## What it edits

- Course metadata in DynamoDB
- Days in `days[]`
- Video and prompt/text items in `days[].items[]`
- Bunny Stream uploads into the selected course collection

## Auth model

- Clerk signs in the admin user.
- The UI only allows users whose email ends in `@gratefulness.me`.
- Backend write requests still send the existing backend admin bearer token, so this does not change the production mobile auth flow.

## Setup

Copy `.env.example` to `.env.local` and fill the Clerk and Bunny values.

Set `NEXT_PUBLIC_COURSES_PROD_API_BASE_URL` to the production API base URL to enable the guarded **Promote** action. Promotion always performs a dry run first, requires the exact course ID as confirmation, copies the selected course assets from the dev bucket, and only then saves the production course record.

```bash
npm run dev
```

## Backend routes used

- `GET /v1/courses`
- `GET /v1/courses/{courseId}/admin`
- `POST /v1/courses`
- `PUT /v1/courses/{courseId}`
- `DELETE /v1/courses/{courseId}`
- `POST /v1/courses/sync-bunny`
- `PUT /v1/courses/{courseId}/days/{dayId}`
- `DELETE /v1/courses/{courseId}/days/{dayId}`
- `PUT /v1/courses/{courseId}/items`
- `DELETE /v1/courses/{courseId}/days/{dayId}/items/{itemId}`
- `PUT /v1/courses/{courseId}/days/{dayId}/prompt`
- `POST /v1/courses/{courseId}/promote` (production API only)
