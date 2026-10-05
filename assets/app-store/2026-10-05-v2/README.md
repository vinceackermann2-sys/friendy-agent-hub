# Belna App Store screenshots, revision 2

Created on 5 October 2026 at the owner's request to replace the unframed native
QA captures with a polished App Store presentation. Original Belna branding;
competitor app listings were visual references, not copied artwork.

## Deliverables

| File | Display | Dimensions | Copy |
| --- | --- | --- | --- |
| iphone-01-meet-belna.png | iPhone 6.9-inch | 1320 x 2868 | Meet Belna. Your personal AI agent. |
| iphone-02-your-permission.png | iPhone 6.9-inch | 1320 x 2868 | Your apps. Your permission. |
| ipad-01-meet-belna.png | iPad 13-inch | 2064 x 2752 | Meet Belna. Your personal AI agent. |
| ipad-02-your-permission.png | iPad 13-inch | 2064 x 2752 | Your apps. Your permission. |

All exports are opaque RGB PNGs. They were inspected for visible text, clipping,
realistic device framing and consistency with the actual screen states. These
are AI-generated marketing composites based on real native captures, not raw
pixel-identical QA evidence. No conversations or extra product capabilities were
invented. Reviewer account identity was omitted from the iPad composites.

## Source Evidence

- iPhone 17 Pro Max: native workflow run 37294435331, signed-in chat and optional
  Apple connections captures. The phone capture tests passed; the run's older
  iPad attempt failed and is not used.
- iPad Pro 13-inch: successful native workflow run 37296743090, reviewer login,
  working chat and enabled optional Apple connections.
- The original evidence remains under the ignored `supabase/.temp` directory.

## Generation Prompts

Built-in `image_gen` edit/compositing mode was used, one call per asset. Original
captures were edit targets; the first completed design was the subsequent style
reference. Sharp performed only final dimension/color-format normalization.

Shared prompt constraints: one full-bleed portrait poster, small lowercase belna
wordmark, large left-aligned near-black sans-serif headlines, clean margins,
straight-on thin-bezel black device, subtle grounded shadow, intact real screen
state and controls. No fictional messages, new features, rating/pricing claims,
competitor marks, gradients or decorative orbs.

1. iPhone introduction: pale icy mint `#eef7f5`; exact headline "Meet Belna. Your
   personal AI agent." and support "Think it through. Get it done." The full
   signed-in empty chat screen is inside a realistic iPhone.
2. iPhone permissions: pale blush `#fff0f1`; exact headline "Your apps. Your
   permission." and support "Connect only what you choose." The native Apple
   apps screen shows Calendar, Reminders, Contacts and Health as optional.
3. iPad introduction: same mint introduction treatment, portrait iPad and the
   actual sidebar/chat layout. Omit the reviewer identity block.
4. iPad permissions: same blush permissions treatment, portrait iPad with the
   actual centered Apple apps sheet and dimmed workspace. Preserve its scroll
   position: Calendar, Reminders and Contacts are visible; do not invent a
   visible Health row. Omit the reviewer identity block.

## Review Submission

The owner approved removing version 1.0.0 from Apple's review queue, replacing
both screenshot sets and resubmitting the same build 46.1. This changes marketing
assets only, not the production app, privacy label or binary.

Both new image sets were uploaded and verified in App Store Connect, ordered
introduction first and permissions second. The 6.9-inch phone set is inherited
by smaller iPhones; the 13-inch iPad set is used for the other iPad displays.

Version 1.0.0 (46.1) was resubmitted on 5 October 2026 at 13:11 Europe/Stockholm.
Submission ID: `fb862201-84cf-495c-aa00-846d0ea0fe83`. Both the UI and read API
confirm `WAITING_FOR_REVIEW`, with `MANUAL` release preserved. The earlier 12:46
submission was voluntarily removed to permit this screenshot revision.
