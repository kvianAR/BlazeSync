const BILLING_URL = "https://secure.backblaze.com/billing.htm";

function validatePaymentDay(day) {
  if (!Number.isInteger(day) || day < 0 || day > 31)
    throw new Error(
      "Choose a monthly payment day from 1 to 31, or 0 to disable reminders.",
    );
  return day;
}
function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
function calendarDay(date) {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}
function paymentReminder(day, now = new Date(), lastNotification = null) {
  validatePaymentDay(day);
  if (!day) return null;
  const dueInMonth = (month) => {
    const lastDay = new Date(now.getFullYear(), month + 1, 0).getDate();
    return new Date(now.getFullYear(), month, Math.min(day, lastDay));
  };
  let due = dueInMonth(now.getMonth());
  if (calendarDay(due) < calendarDay(now)) due = dueInMonth(now.getMonth() + 1);
  const daysRemaining = calendarDay(due) - calendarDay(now);
  const notificationKey = dateKey(due) + "/" + dateKey(now);
  return {
    dueDate: dateKey(due),
    daysRemaining,
    active: daysRemaining <= 7,
    ready:
      daysRemaining <= 7 &&
      now.getHours() >= 9 &&
      lastNotification !== notificationKey,
    notificationKey,
  };
}
module.exports = { BILLING_URL, validatePaymentDay, paymentReminder };
