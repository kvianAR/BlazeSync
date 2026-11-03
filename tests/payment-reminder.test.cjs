const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  paymentReminder,
  validatePaymentDay,
  BILLING_URL,
} = require("../electron/payment-reminder.cjs");

test("payment link points to official Backblaze billing", () => {
  assert.equal(BILLING_URL, "https://secure.backblaze.com/billing.htm");
});
test("reminders default off and reject invalid payment days", () => {
  assert.equal(paymentReminder(0), null);
  for (const day of [-1, 32, 2.5, NaN, "5", null])
    assert.throws(() => validatePaymentDay(day));
});
test("seven-day window starts at 9 AM and includes payment day", () => {
  assert.equal(paymentReminder(20, new Date(2026, 10, 12, 10)).active, false);
  assert.equal(paymentReminder(20, new Date(2026, 10, 13, 8, 59)).ready, false);
  const first = paymentReminder(20, new Date(2026, 10, 13, 9));
  assert.equal(first.ready, true);
  assert.equal(first.daysRemaining, 7);
  assert.equal(paymentReminder(20, new Date(2026, 10, 20, 9)).daysRemaining, 0);
  assert.equal(
    paymentReminder(20, new Date(2026, 10, 21, 9)).dueDate,
    "2026-12-20",
  );
});
test("reminder key is stable per day and changes on following days", () => {
  const first = paymentReminder(20, new Date(2026, 10, 13, 9));
  assert.equal(
    first.notificationKey,
    paymentReminder(20, new Date(2026, 10, 13, 22)).notificationKey,
  );
  assert.notEqual(
    first.notificationKey,
    paymentReminder(20, new Date(2026, 10, 14, 9)).notificationKey,
  );
});
test("short months clamp to final day, including leap years", () => {
  assert.equal(
    paymentReminder(31, new Date(2027, 1, 21, 9)).dueDate,
    "2027-02-28",
  );
  assert.equal(
    paymentReminder(31, new Date(2028, 1, 22, 9)).dueDate,
    "2028-02-29",
  );
  const nextYear = paymentReminder(1, new Date(2026, 11, 26, 9));
  assert.equal(nextYear.dueDate, "2027-01-01");
  assert.equal(nextYear.daysRemaining, 6);
});

test("persisted delivery key prevents duplicate reminders after restart", () => {
  const morning = new Date(2026, 10, 13, 9);
  const sent = paymentReminder(20, morning);
  assert.equal(
    paymentReminder(20, new Date(2026, 10, 13, 22), sent.notificationKey).ready,
    false,
  );
  assert.equal(
    paymentReminder(20, new Date(2026, 10, 14, 9), sent.notificationKey).ready,
    true,
  );
});
