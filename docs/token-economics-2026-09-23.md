# Raw token pricing review — 23 September 2026

## Rates and assumptions

- GPT-6 Luna Global Standard short context: $0.10/M input, $0.01/M cached input, $0.50/M output. Azure EU Data Zone and long context cost more. The deployment is currently configured with the Global Standard rates. [Microsoft Foundry pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/)
- GPT Image 2: $4/M image input, $1/M cached image input, $15/M image output, $2.50/M text input. A high quality 1024×1024 output is about $0.211 and a medium output about $0.053, before prompt input. [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [image guide](https://developers.openai.com/api/docs/guides/image-generation)
- GPT-4o Transcribe: $2.50/M audio input, $10/M text output, about $0.006 per minute. [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- "Normal" below is an **illustrative full-use scenario**, not a forecast from observed customers: 80% regular Luna input and 20% Luna output, five high-quality 1024×1024 images and ten one-minute transcriptions in a month. Image output is approximated as 14,067 tokens per image and audio as 3,000 tokens per minute. These tokens are subtracted from the plan allowance before calculating Luna use. Image prompt input, hosting, and other tools are excluded. There is not enough production usage to derive a reliable customer distribution.
- Card fees are modeled as 2.9% + $0.30 per payment. This is a planning assumption, not a verified Stripe contract rate. Profit excludes Azure VMs, hosting, support, tax, disputes, and other tools.

## Plans (30-day month)

The base monthly tokens reset; image and transcription counts reset at midnight UTC. Packs add tokens without raising these daily counts.

| Plan | Price | Monthly tokens | Daily image / transcription limit | Normal model cost | Normal profit after assumed card fee | 30-day stress model cost* | Stress profit after fee |
|---|---:|---:|---:|---:|---:|---:|---:|
| Free | $0 | 50M | 5 / 10 | ~$10.10 | -$10.10 | ~$56.94 | -$56.94 |
| Pro | $50 | 100M | 10 / 15 | ~$19.10 | ~$29.15 | ~$113.22 | ~-$64.97 |
| Max | $100 | 200M | 15 / 20 | ~$37.10 | ~$59.70 | ~$194.48 | ~-$97.68 |

*Stress scenario: all remaining Luna tokens at the $0.50/M output rate, every daily image slot used for a high-quality 1024×1024 image, and every transcription slot used for one minute over 30 days. Estimated image/audio tokens are subtracted from the monthly allowance. Image prompts, longer audio, and any larger image produced by `auto` can add cost. This is **not** a mathematical upper bound. The rate-only ceiling if every allowance token could be $15/M image output is $750 Free, $1,500 Pro, and $3,000 Max, yielding -$750, -$1,451.75, and -$2,903.20 after the assumed fees. Daily caps make those amounts unrealistic within one month, but demonstrate why raw tokens alone cannot guarantee plan margin.

At the retained $50/$100 plan prices, **plan margin is not protected** against heavy image use. The Free plan can generate a meaningful acquisition cost. Existing grandfathered promo subscriptions may pay $30/$50, making their margin worse. `low` or `xhigh` Luna reasoning effort does not change the published per-token rate, but xhigh may consume more output tokens for the same user-visible answer.

## Token packs — revised local prices

The seven packs below replace the former 1M–500M catalog; 1M and 5M packs are removed. All columns assume the whole pack is eventually used. "Text" is 80% regular Luna input and 20% Luna output ($0.18/M). "Mixed" is 94% of tokens in that Luna text mix, 1% GPT-4o Transcribe tokens at 90% audio input / 10% text output, and 5% GPT Image 2 image output ($0.9517/M combined). This is an illustration, not an observed customer mix. "All image" prices every token at $15/M, the highest listed token rate; daily image limits slow this case, but packs do not expire. Profit subtracts the assumed 2.9% + $0.30 card fee and excludes other operating costs.

| Pack | Price | Text cost | Text profit | Mixed cost | Mixed profit | All-image cost | All-image profit |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10M | $15 | $1.80 | $12.47 | $9.52 | $4.75 | $150 | -$135.74 |
| 20M | $25 | $3.60 | $20.38 | $19.03 | $4.94 | $300 | -$276.02 |
| 30M | $35 | $5.40 | $28.29 | $28.55 | $5.13 | $450 | -$416.31 |
| 50M | $55 | $9.00 | $44.11 | $47.59 | $5.52 | $750 | -$696.89 |
| 75M | $85 | $13.50 | $68.74 | $71.38 | $10.86 | $1,125 | -$1,042.77 |
| 100M | $105 | $18.00 | $83.66 | $95.17 | $6.49 | $1,500 | -$1,398.34 |
| 500M | $500 | $90.00 | $395.20 | $475.85 | $9.35 | $7,500 | -$7,014.80 |

The new prices are attractive for text-heavy use but do **not** protect margin against image-heavy use. For the 500M pack, approximately 5.13% of tokens spent on image output breaks even in the mixed model above. Actual Azure contract pricing and VM bills can change this threshold.

## Gift and referral exposure

- $50 gift card → 1M tokens; worst provider cost $15, contribution after assumed fee $33.25 (66.5% of sale). $100 gift card → 2M tokens; worst provider cost $30, contribution after fee $66.80 (66.8%).
- Referral redemption grants 500,000 tokens to each person. At the $15/M rate the total provider liability is up to $15 per successful referral, before fraud and operating costs.
- VM time is converted to tokens at 300,000 tokens per hour for the configured $0.06/hour rate. At the $0.50/M paid plan revenue rate, that is $0.15 of plan token value per hour against $0.06 estimated VM cost. The actual Azure bill may differ from the configured VM rate.
