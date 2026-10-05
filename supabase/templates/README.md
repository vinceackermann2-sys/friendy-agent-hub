# Belna authentication email

Belna sends its own sign-in and sign-up codes. `/api/auth/otp` and
`/api/auth/signup` ask Supabase Auth for a one-time code with admin
`generateLink`, which sends no email, and deliver it through Resend from
`Belna <hej@mail.belna.se>` with Belna's template (`server/auth-email.js`).
Users enter the code in the Belna sign-in window, and `/api/auth/verify`
checks it. No email links point at Supabase.

The server falls back to Supabase's own mailer (`signInWithOtp` / `signUp`)
only when `RESEND_API_KEY` is missing, which should only happen in local
development. [`magic_link.html`](magic_link.html) is the same design for that
case, and for any email someone triggers from the Supabase dashboard. To brand
those as well, in the project's Authentication → Emails settings:

1. Enable custom SMTP with Resend (`smtp.resend.com`, port 465, user `resend`,
   the Resend API key as password, sender `hej@mail.belna.se`, name `Belna`).
2. Open Templates → Magic Link / OTP, set the subject `Your Belna sign-in code`,
   and paste the contents of `magic_link.html`.

Do not replace the OTP placeholder with a static code, and do not configure an
automatic sign-in link: the app asks users to enter the code.

Docs: https://supabase.com/docs/guides/auth/auth-email-templates
