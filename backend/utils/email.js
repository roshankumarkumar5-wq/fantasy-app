// Sends transactional emails via Resend (https://resend.com) - free tier
// gives 100 emails/day / 3000/month, no credit card needed to start.
//
// IMPORTANT (free tier limitation): until you verify your own domain in
// Resend, you can only send to the email address you signed up to Resend
// with. This is fine for testing but means real users' emails won't
// receive OTPs until you verify a domain. See Resend's dashboard for
// domain verification steps when you're ready to go live.

export async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

  if (!apiKey) {
    console.warn('RESEND_API_KEY not set - skipping email send. OTP would have been sent to:', to);
    return { skipped: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: fromEmail, to, subject, html })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('Resend email error:', data);
    throw new Error(data.message || 'Failed to send email');
  }
  return data;
}

export function generateOtp() {
  // 6-digit numeric code, zero-padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function otpEmailHtml(code, purpose) {
  const heading = purpose === 'reset_password' ? 'Reset your password' : 'Verify your email';
  const body = purpose === 'reset_password'
    ? 'Use the code below to reset your password. It expires in 15 minutes.'
    : 'Use the code below to verify your email address. It expires in 15 minutes.';

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>${heading}</h2>
      <p>${body}</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; background: #f4f6fb; padding: 16px; text-align: center; border-radius: 8px;">
        ${code}
      </p>
      <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
}
