// ============================================================
// SMS-sending utility - PROVIDER NOT YET CONNECTED.
//
// This is a swappable structure: sendSms() below is the only
// function that needs to change once you've picked a provider.
// Everything else in the app (auth routes, etc.) just calls
// sendSms(phone, message) and doesn't care how it's implemented.
//
// Until SMS_API_KEY/SMS_API_URL are set in your .env, codes are
// logged to the server console instead of actually being sent -
// so you can keep testing signup/login/reset locally without
// needing a provider account yet.
// ============================================================

export async function sendSms(phone, message) {
  const apiKey = process.env.SMS_API_KEY;
  const apiUrl = process.env.SMS_API_URL;

  if (!apiKey || !apiUrl) {
    console.warn(
      `[SMS not configured] Would have sent to ${phone}: "${message}"`
    );
    return { skipped: true };
  }

  // ----------------------------------------------------------
  // REPLACE THIS BLOCK once you've picked a provider. Each one
  // has a slightly different request shape - a few real examples
  // to adapt from (check their current docs for exact fields):
  //
  // --- StartMessaging / Message Central (no-DLT OTP APIs) ---
  //   POST to their OTP-send endpoint with { phone, message }
  //   or their own templated OTP request, per their dashboard's
  //   generated code snippet after you create an API key.
  //
  // --- Fast2SMS ---
  //   POST https://www.fast2sms.com/dev/bulkV2
  //   headers: { authorization: apiKey }
  //   body: { route: 'otp', variables_values: code, numbers: phone }
  //
  // --- MSG91 ---
  //   POST https://control.msg91.com/api/v5/otp
  //   headers: { authkey: apiKey }
  //   query/body: { mobile: phone, otp: code, template_id: ... }
  //
  // The generic placeholder below assumes a simple REST API that
  // accepts { to, message } and an Authorization bearer header -
  // swap this for whatever your chosen provider actually expects.
  // ----------------------------------------------------------
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to: phone, message })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('SMS send error:', data);
    throw new Error(data.message || 'Failed to send SMS');
  }
  return data;
}

export function generateOtp() {
  // 6-digit numeric code, zero-padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function otpSmsText(code, purpose) {
  const action = purpose === 'reset_password' ? 'reset your password' : 'verify your phone number';
  return `Your code to ${action} on Fantasy League is ${code}. It expires in 15 minutes. Do not share this code with anyone.`;
}
