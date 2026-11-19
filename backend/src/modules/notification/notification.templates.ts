import { DateTime } from 'luxon';
import { config } from '../../config';

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

  const reason = data.cancelledByOwner ? 'by the business owner' : 'at your request';
  const subject = `Booking Cancelled: ${data.serviceName} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYour appointment for ${data.serviceName} at ${data.businessName} on ${formattedTime} has been cancelled ${reason}.\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #ef4444;">Booking Cancelled</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Your appointment for <strong>${safeService}</strong> at <strong>${safeBusiness}</strong> on <strong>${formattedTime}</strong> has been cancelled ${reason}.</p>
      <p>You can book another slot anytime on QueueLess.</p>
    </div>
  `;
  return { subject, text, html };
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

  const subject = `Booking Rescheduled: ${data.serviceName} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYour appointment for ${data.serviceName} at ${data.businessName} has been rescheduled to ${formattedTime}.\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #4f46e5;">Appointment Rescheduled</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Your appointment for <strong>${safeService}</strong> at <strong>${safeBusiness}</strong> has been moved to a new time:</p>
      <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>New Time:</strong> ${formattedTime} (IST)</p>
      </div>
      <p>See you then!</p>
    </div>
  `;
  return { subject, text, html };
};

// 4. Business Status Changed
export const businessStatusChanged = (data: {
  ownerName: string;
  businessName: string;
  status: 'approved' | 'rejected';
}): TemplateResult => {
  const safeOwner = escapeHtml(data.ownerName);
  const safeBusiness = escapeHtml(data.businessName);
  const isApproved = data.status === 'approved';

  const subject = isApproved
    ? `Congratulations! "${data.businessName}" is now Approved`
    : `Update on your business registration: "${data.businessName}"`;
  const text = isApproved
    ? `Hello ${data.ownerName},\n\nYour business "${data.businessName}" has been approved! It is now live for customers to view and book.\n\nQueueLess`
    : `Hello ${data.ownerName},\n\nYour business registration for "${data.businessName}" was not approved at this time. Please contact support.\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: ${isApproved ? '#10b981' : '#ef4444'};">
        ${isApproved ? 'Business Approved!' : 'Registration Update'}
      </h2>
      <p>Hello <strong>${safeOwner}</strong>,</p>
      <p>
        ${
          isApproved
            ? `Your business <strong>${safeBusiness}</strong> has been verified and approved by the platform administrators. It is now publicly listed and customers can book appointments and join your live queue.`
            : `Your registration for <strong>${safeBusiness}</strong> has been rejected. If you believe this is in error, please reach out to admin support.`
        }
      </p>
    </div>
  `;
  return { subject, text, html };
};

// 5. Queue Stage Notifications
export const queueStageNear = (data: {
  customerName: string;
  businessName: string;
  position: number;
  estimatedWaitMinutes: number;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);

  const subject = `Queue Update: You are #${data.position} in line at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYou are #${data.position} in line at ${data.businessName}. Estimated wait time: ${data.estimatedWaitMinutes} minutes. Please get ready!\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #f59e0b;">Get Ready!</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>You are now <strong>#${data.position}</strong> in line at <strong>${safeBusiness}</strong>.</p>
      <p>Estimated wait: <strong>${data.estimatedWaitMinutes} min</strong>. Please stay nearby.</p>
    </div>
  `;
  return { subject, text, html };
};

export const queueStageNext = (data: {
  customerName: string;
  businessName: string;
  ticketNumber: number;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);

  const subject = `You are Next! Ticket #${data.ticketNumber} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nYou are next in line (Ticket #${data.ticketNumber}) at ${data.businessName}. Please wait right at the counter.\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #6366f1;">You are Next!</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Ticket <strong>#${data.ticketNumber}</strong> is up next at <strong>${safeBusiness}</strong>.</p>
      <p>Please stand near the service counter.</p>
    </div>
  `;
  return { subject, text, html };
};

export const queueStageCalled = (data: {
  customerName: string;
  businessName: string;
  ticketNumber: number;
}): TemplateResult => {
  const safeName = escapeHtml(data.customerName);
  const safeBusiness = escapeHtml(data.businessName);

  const subject = `It is Your Turn! Ticket #${data.ticketNumber} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nTicket #${data.ticketNumber}: It is your turn at ${data.businessName}! Please proceed to the service desk.\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #10b981;">It is Your Turn!</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Ticket <strong>#${data.ticketNumber}</strong> is currently being called at <strong>${safeBusiness}</strong>.</p>
      <p>Please proceed directly to the counter.</p>
    </div>
  `;
  return { subject, text, html };
};

// 6. Appointment Reminder (Job)
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

  const subject = `Appointment Reminder: ${data.serviceName} at ${data.businessName}`;
  const text = `Hello ${data.customerName},\n\nThis is a friendly reminder that your appointment for ${data.serviceName} at ${data.businessName} starts at ${formattedTime}.\n\nQueueLess`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #4f46e5;">Appointment Reminder</h2>
      <p>Hello <strong>${safeName}</strong>,</p>
      <p>Your upcoming appointment is starting soon:</p>
      <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>Business:</strong> ${safeBusiness}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${safeService}</p>
        <p style="margin: 5px 0;"><strong>Time:</strong> ${formattedTime} (IST)</p>
      </div>
      <p>Have a great experience!</p>
    </div>
  `;
  return { subject, text, html };
};
