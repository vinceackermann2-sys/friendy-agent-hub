# Belna authentication email

The passwordless sign-in route calls `signInWithOtp`, which uses Supabase Auth's **Magic Link / OTP** email template. The approved HTML is in [`magic_link.html`](magic_link.html); the recommended subject is `Your Belna sign-in code`.

This repository file does not change a hosted Supabase project automatically. In the project's Authentication → Emails settings:

1. Confirm that custom SMTP is enabled. Supabase Free projects created after June 3, 2026 cannot customize auth templates while using Supabase's default email provider.
2. Open Templates → Magic Link / OTP, set the subject above, and paste the contents of `magic_link.html`.
3. Save and verify with a sign-in code sent to an approved test inbox. The rendered code must replace `{{ .Token }}` and the six-digit code must work in Belna's sign-in form.

Do not replace the OTP placeholder with a static code. Do not configure an automatic sign-in link: the app asks users to enter the code.

Docs: https://supabase.com/docs/guides/auth/auth-email-templates
