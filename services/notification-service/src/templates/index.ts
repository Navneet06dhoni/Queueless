import { DateTime } from 'luxon';
import { config } from '../config';

export const escapeHtml = (unsafe: string | null | undefined): string => {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const formatInTimezone = (
  date: Date | string,
  format: string = 'cccc, dd LLL yyyy, hh:mm a'
): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return DateTime.fromJSDate(d, { zone: config.BUSINESS_TIMEZONE }).toFormat(format);
};

export interface TemplateResult {
  subject: string;
  text: string;
  html: string;
}

// 1. Booking Confirmed
export const bookingConfirmedCustomer = (data: {
  customerName: string;
  businessName: string;
  serviceName: string;
  slotStartTime: Date | string;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);
  const safeService = escapeHtml(data.serviceName);
  const formattedTime = formatInTimezone(data.slotStartTime);

  const subject = `Booking Confirmed: ${data.serviceName} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYour appointment for ${data.serviceName} at ${data.businessName} has been confirmed for ${formattedTime}.\n\nThank you for choosing QueueLess!`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #4f46e5;">Booking Confirmed!</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Your appointment has been successfully scheduled:</p>
      <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>Business:</strong> ${safeBusiness}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${safeService}</p>
        <p style="margin: 5px 0;"><strong>Scheduled Time:</strong> ${formattedTime} (IST)</p>
      </div>
      <p>Please arrive 10-15 minutes prior to your slot time.</p>
      <p>Best regards,<br/><strong>${safeBusiness}</strong> via QueueLess</p>
    </div>
  `;
  return { subject, text, html };
};

export const bookingConfirmedOwner = (data: {
  ownerName: string;
  customerName: string;
  businessName: string;
  serviceName: string;
  slotStartTime: Date | string;
}): { title: string; message: string } => {
  const formattedTime = formatInTimezone(data.slotStartTime);
  return {
    title: 'New Booking',
    message: `${data.customerName} booked ${data.serviceName} for ${formattedTime} at ${data.businessName}.`,
  };
};

// 2. Booking Cancelled
export const bookingCancelledCustomer = (data: {
  customerName: string;
  businessName: string;
  serviceName: string;
  slotStartTime: Date | string;
  cancelledByOwner: boolean;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);
  const safeService = escapeHtml(data.serviceName);
  const formattedTime = formatInTimezone(data.slotStartTime);

  const subject = `Booking Cancelled: ${data.serviceName} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYour appointment for ${data.serviceName} at ${data.businessName} scheduled for ${formattedTime} has been cancelled.\n\nWe apologize for any inconvenience.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #ef4444;">Booking Cancelled</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Your appointment for <strong>${safeService}</strong> at <strong>${safeBusiness}</strong> scheduled for <strong>${formattedTime}</strong> has been cancelled.</p>
      <p>If you did not request this cancellation or would like to rebook, please visit our booking portal.</p>
      <p>Best regards,<br/><strong>${safeBusiness}</strong> via QueueLess</p>
    </div>
  `;
  return { subject, text, html };
};

export const bookingCancelledOwner = (data: {
  customerName: string;
  businessName: string;
  serviceName: string;
  slotStartTime: Date | string;
}): { title: string; message: string } => {
  const formattedTime = formatInTimezone(data.slotStartTime);
  return {
    title: 'Booking Cancelled',
    message: `${data.customerName} cancelled their appointment for ${data.serviceName} on ${formattedTime}.`,
  };
};

// 3. Booking Rescheduled
export const bookingRescheduledCustomer = (data: {
  customerName: string;
  businessName: string;
  serviceName: string;
  newSlotStartTime: Date | string;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);
  const safeService = escapeHtml(data.serviceName);
  const formattedTime = formatInTimezone(data.newSlotStartTime);

  const subject = `Appointment Rescheduled: ${data.serviceName} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYour appointment for ${data.serviceName} at ${data.businessName} has been rescheduled to ${formattedTime}.\n\nThank you for choosing QueueLess!`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #4f46e5;">Appointment Rescheduled</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Your appointment has been successfully moved to the new slot:</p>
      <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>Business:</strong> ${safeBusiness}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${safeService}</p>
        <p style="margin: 5px 0;"><strong>New Time:</strong> ${formattedTime} (IST)</p>
      </div>
      <p>Best regards,<br/><strong>${safeBusiness}</strong> via QueueLess</p>
    </div>
  `;
  return { subject, text, html };
};

// 4. Appointment Reminder
export const appointmentReminder = (data: {
  customerName: string;
  businessName: string;
  serviceName: string;
  slotStartTime: Date | string;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);
  const safeService = escapeHtml(data.serviceName);
  const formattedTime = formatInTimezone(data.slotStartTime);

  const subject = `Reminder: Upcoming appointment at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nThis is a friendly reminder for your appointment (${data.serviceName}) at ${data.businessName} scheduled for ${formattedTime}.\n\nSee you soon!`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #4f46e5;">Appointment Reminder</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>This is a quick reminder about your scheduled appointment today:</p>
      <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>Business:</strong> ${safeBusiness}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${safeService}</p>
        <p style="margin: 5px 0;"><strong>Time:</strong> ${formattedTime} (IST)</p>
      </div>
      <p>Please arrive 10-15 minutes early. If you need to cancel or modify, please do so ahead of the cancellation cutoff.</p>
      <p>Best regards,<br/><strong>${safeBusiness}</strong> via QueueLess</p>
    </div>
  `;
  return { subject, text, html };
};

// 5. Business Status Changed
export const businessStatusChanged = (data: {
  ownerName: string;
  businessName: string;
  status: 'approved' | 'rejected';
  rejectionReason?: string;
}): TemplateResult => {
  const safeOwner = escapeHtml(data.ownerName);
  const safeBusiness = escapeHtml(data.businessName);
  const safeReason = escapeHtml(data.rejectionReason || 'No specific reason provided.');
  const isApproved = data.status === 'approved';

  const subject = isApproved
    ? `Congratulations! ${data.businessName} has been approved`
    : `Update on your registration for ${data.businessName}`;

  const text = isApproved
    ? `Hello ${data.ownerName},\n\nWe are pleased to inform you that ${data.businessName} has been approved! You can now manage services, slots, and live virtual queues.\n\nWelcome aboard!`
    : `Hello ${data.ownerName},\n\nYour registration for ${data.businessName} was not approved.\nReason: ${data.rejectionReason || 'No specific reason provided.'}\n\nPlease contact support for more details.`;

  const html = isApproved
    ? `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #10b981;">Business Registration Approved!</h2>
        <p>Hello <strong>${safeOwner}</strong>,</p>
        <p>Great news! Your business <strong>${safeBusiness}</strong> has been reviewed and approved by the QueueLess administration team.</p>
        <p>You can now log in to configure services, configure business hours, open virtual queues, and start accepting online bookings.</p>
        <p>Best regards,<br/><strong>The QueueLess Team</strong></p>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #ef4444;">Business Registration Status Update</h2>
        <p>Hello <strong>${safeOwner}</strong>,</p>
        <p>Your registration application for <strong>${safeBusiness}</strong> was reviewed and could not be approved at this time.</p>
        <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 12px; margin: 15px 0;">
          <p style="margin: 0; color: #991b1b;"><strong>Reason:</strong> ${safeReason}</p>
        </div>
        <p>Best regards,<br/><strong>The QueueLess Team</strong></p>
      </div>
    `;

  return { subject, text, html };
};

// 6. Queue Stage Notifications
export const queueStageNear = (data: { businessName: string; position: number; ticketNumber: number }) => ({
  title: 'Your turn is coming up soon!',
  message: `Ticket #${data.ticketNumber}: You are at position ${data.position} in the queue at ${data.businessName}. Please make your way toward the counter.`,
});

export const queueStageNext = (data: { businessName: string; ticketNumber: number }) => ({
  title: "You're next in line!",
  message: `Ticket #${data.ticketNumber}: You are position 1 in the queue at ${data.businessName}. Please be ready to be called!`,
});

export const queueStageCalled = (data: { businessName: string; ticketNumber: number }) => ({
  title: 'Now Serving You!',
  message: `Ticket #${data.ticketNumber}: You have been called at ${data.businessName}! Please proceed to the service desk immediately.`,
});
