# Warehouse screen — guide

## For the warehouse person (print this page)

Open **oakbridge.in/warehouse** on your phone and sign in. You see five big buttons.

### 1. 📥 Books arrived from printer
1. Tap **Books arrived from printer** → **Take a photo** of the printer's bill (or **Choose PDF or photo** if it came on WhatsApp/email).
2. Wait a few seconds while it reads the bill.
3. For **each card**: read the **big title** — is it the right book? Is the **number of copies** right?
   - Wrong book → pick the right one from the list.
   - Wrong number → type the right number.
   - "Box Charge" and other non-book lines are already unticked. Leave them.
   - A book is missing → **+ Add a book**.
4. Tap **Sync — add N to stock**.

### 2. 📤 Pack an invoice (carton out)
1. Tap **Pack an invoice** → open the invoice PDF from WhatsApp/email with **Choose PDF or photo** (or take a photo of the printed invoice).
2. Check **Sent to**. If it is an author, tap **Author copy**; otherwise leave **Sale / shop**.
3. **Scan each book with the barcode scanner** as you put it in the carton. The screen counts: "12 of 43 copies packed". It warns you if a book is not on the invoice or you scan too many.
   - No scanner? Tap **All packed** on each line instead.
4. When everything is in the carton, tap **Packed**. If something is short, it asks you first.
5. **Do not ship yet.** The office checks the carton first. The copies are already taken off stock.
6. Watch the top of the home screen (🔔). It checks every minute:
   - **✅ Approved — ready to ship** → ship it, then tap **Shipped**.
   - **↩️ Sent back** → read the note, tap **Pack again**, fix the carton, tap **Packed** again.
   - **✖ Cancelled** → don't ship. Put the books back on the shelf and tap **Unpacked**.

### 3. 🚚 Courier sheet (parcels out)
The courier sheet lists several parcels — website orders and free copies.
1. Tap **Courier sheet** → **Choose PDF or photo** (or take a photo of the printed sheet).
2. Each parcel shows as a card: who it goes to, and the books inside.
   - **Website order (paid)** — chosen automatically when the parcel matches a paid order (same phone, or same name + pin code). Stock is **not** taken off again: it was already taken off when the customer paid.
   - **Free copy** — anything that does not match an order. These copies **are** taken off stock.
   - **Skip** — the parcel is not going today.
3. Check each book and number of copies; fix the book from the list if it is wrong. A title you fix once is remembered next time.
4. Tap **Done**.

### 4. 📦 One book in or out
For returns, damaged copies, samples, a single author copy, or correcting a count: scan the book → **IN** or **OUT** → reason → number of copies → **Save**.

### 5. 🔍 Check stock
Scan a book to see its count and the last 10 things that happened to it.

### Good to know
- **Practice** (top right): try anything — nothing changes stock. Use it to learn.
- **Something wrong?** Tap **Report it** at the bottom of the bill screen and write what happened.
- **Made a mistake after syncing?** Tell your manager — they can undo it for 24 hours.
- **The automatic reading is a helper, not the boss.** You always check and can change everything before you press Sync / Packed. If it can't read a bill, tap **Enter by hand instead**.

---

## For managers — setup (one time)

1. **AWS permission for bill reading.** AWS console → IAM → Users → the app's user (the one whose key is in Render) → Add permissions → Create inline policy → JSON:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{ "Effect": "Allow", "Action": "textract:AnalyzeDocument", "Resource": "*" }]
   }
   ```
   Name it `oakbridge-textract`. Textract runs in the same region as the bucket (us-east-1); set `TEXTRACT_REGION` in Render only if that ever changes. Without this permission everything still works — documents just have to be entered by hand.
2. **A login for the warehouse person.** Admin → Users → New → role **Warehouse**. That login sees only the warehouse screen.
3. **Start the trial** (superadmin): Admin → Warehouse → **Start trial**. Every book's warehouse count starts from today's website stock. Website stock is **not** changed and the Google-sheet sync keeps running.

## Approving cartons (order-management team)
Admin → Warehouse → **To approve** lists every carton the warehouse has packed. Open one, compare **On invoice** with **Packed** (short lines are red), view the invoice file if needed, then:
- **Approve — ready to ship**: the warehouse phone shows it as ready to ship.
- **Send back** (with a note): he repacks it; the copies go back into stock until he packs again.
- **Cancel carton** (with a note): it is not going; the copies go back into stock.

Who can approve: anyone with **Orders** and **Warehouse** access (e.g. the Fulfilment role) — but not the person who packed the carton. A superadmin always can. The Warehouse login never can.

## The trial week
- Admin → Warehouse → **Trial & comparison** shows every book where the warehouse count and the website (sheet) count differ, and by how much.
- **Bills & invoices** shows each document with its photo/PDF, what was read vs what was confirmed, **Undo** (24 h), and **Use as test case**.
- **Accuracy** shows how often the automatic reading was right, by document type and by printer, with the corrections people had to make and the problems they reported. **Run test cases** re-reads the marked documents to check an improvement does not break anything.

## Going live
When the comparison shows the two counts agree (or every difference is explained), a superadmin clicks **Go live**:
- website stock is replaced by the warehouse counts;
- the Google-sheet sync stops (its button and cron stand down);
- stock then changes only through the warehouse screen and website orders; a stock number typed in Admin is logged as a correction;
- a pre-order becomes a normal listed book the moment copies are booked in.

**Stop** (superadmin) hands stock back to the sheet. Nothing recorded is deleted.
