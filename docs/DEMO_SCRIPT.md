# Demo script

Restaurant Table Reservation Management System, SDLC Team 5.

This is a five-minute live path. It shows customer registration, a booking, a conflict, staff sign-in, seating, and cancellation. It does not cover every edge case.

## Before the demo

Use a clean database, or choose a future date with no existing bookings.

```bash
npm install
cp server/.env.example server/.env
```

Set these values in `server/.env`:

```bash
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>
JWT_SECRET=<at least 32 random characters>
SEED_STAFF_PASSWORD=<a password you can type during the demo>
```

Then prepare the data and start both apps:

```bash
npm run seed
npm run dev
```

Open http://localhost:5173. The page opens at sign-in. The API runs at http://localhost:4000.

The seed creates six tables: T1 and T2 seat 2, T3 and T4 seat 4, T5 seats 6, and T6 seats 8. The staff username is `staff`. Use the password from `SEED_STAFF_PASSWORD`.

Choose one future date and use it for every step. The examples below use `4 guests` and `2 guests`, but any valid sizes work as long as the expected table fits.

## 1. Register and book the first table (45 seconds)

1. Click **Create an account** and register with username `ada`, full name `Ada Lovelace`, a password, and phone `4165550134`.
2. On **Table Reservation**, choose the demo date.
2. Set **Party size** to `4 guests`.
3. Under **Pick a time**, choose `6:00 PM`.
4. Enter:
   - **Full name:** `Ada Lovelace`
   - **Phone:** `4165550134`
   - **Email (optional):** `ada@example.com`
5. Submit the booking.

Expected result:

- The page says `RESERVATION CONFIRMED`.
- The assigned table is `T3 (seats 4)`, the smallest table that fits 4 guests.
- The time is `6:00 PM to 7:30 PM`.
- A reference such as `R7KMYKSQ` is shown. Write it down.

Say: "The system assigns the smallest suitable table. This booking holds three 30-minute slots."

Click **Book another table**.

## 2. Show the next booking and the conflict (90 seconds)

1. Keep the same date and choose `4 guests` again.
2. Point out that `4:30 PM`, `5:00 PM`, `5:30 PM`, and `6:00 PM` are unavailable. Each overlaps the 6:00 PM to 7:30 PM booking.
3. Choose `7:00 PM`. Its first slot is 7:00 PM, so it does not overlap the first booking.
4. Enter:
   - **Full name:** `Grace Hopper`
   - **Phone:** `4165550199`
5. Submit the booking.

Expected result:

- The booking is confirmed on `T4 (seats 4)`.
- T3 remains occupied by the first reservation, so the system chooses the next suitable table.

Click **Book another table**. Then show the conflict:

1. Keep the date and set **Party size** to `6 guests`.
2. Book `6:00 PM` successfully. It should use T5.
3. Click **Book another table**.
4. Set **Party size** to `6 guests` again and book `6:00 PM` once more. This uses T6.
5. Return and select `6 guests` again.

Expected result:

- `4:30 PM` through `7:30 PM` are disabled. Those are the starts whose 90-minute windows overlap a fully booked 6:00 PM to 7:30 PM period.
- There is no third table that seats 6 guests, so the interface prevents the conflicting booking before submission.

Say: "The interface hides times that cannot be seated. The database also rejects a direct conflicting request with HTTP 409."

The direct API check is optional. If asked, show the existing automated concurrency test rather than typing a request during the presentation.

## 3. Sign in as staff (30 seconds)

1. Click **Sign Out**.
2. Enter username `staff` and the seeded password.
3. Click **Sign in**.

Expected result:

- The greeting says `Hello, staff`.
- **Bookings** opens on today's date.
- Change the date to the demo date. Each row shows the time, customer, party size, table, phone, and reference.
- A confirmed reservation has **Seat**, **Cancel**, and **No-show** buttons.

Say: "The token stays in browser memory. Refreshing the page signs the staff member out."

## 4. Seat a guest (30 seconds)

1. Find Ada's reservation.
2. Click **Seat**.

Expected result:

- The status changes from `CONFIRMED` to `SEATED`.
- The available action changes to **Complete**.
- The table remains occupied. Seating does not make the time available to another customer.

## 5. Cancel and release the table (60 seconds)

1. Find Grace's reservation.
2. Click **Cancel**.

Expected result:

- The status changes to `CANCELLED`.
- Its action buttons disappear because a cancelled reservation is terminal.

Now prove that the slots were released:

1. Click **Sign Out**, then sign in again as `ada`.
2. Open **Table Reservation**.
3. Select the same date and `4 guests`.

Expected result:

- The time released by Grace's cancellation is available again.
- Ada's seated reservation still blocks its own time.

Say: "Only confirmed and seated reservations hold tables. Cancelling deletes that booking's slot rows, so another customer can use the table."

## If something goes wrong

| What happens | What to do |
| --- | --- |
| Sign-in says `AUTH_NOT_CONFIGURED` | `JWT_SECRET` is missing or shorter than 32 characters. Set it in `server/.env` and restart. |
| Sign-in says the username or password is incorrect | Run `npm run seed` again with `SEED_STAFF_PASSWORD` set, then use that password. |
| The expected time is already unavailable | Pick another future date and restart at step 1. |
| No reservations appear after sign-in | Check that the dashboard date matches the booking date. |

## Out of scope for this demo

- Email or SMS confirmation. Customer cancellation is covered under My Bookings.
- Parties larger than 8. They appear in the selector but cannot be seated because the largest table seats 8.
- Combining two tables for one party.
- Deployment and production credentials.
