# Belna small-scale programme

Reference code for STLM and Mini-SLA versus a matched Transformer baseline.

```bash
pip install torch numpy tqdm datasets

python train_and_probe.py --model stlm
python train_and_probe.py --model sla
```

Seed 42. AdamW 2e-4, batch 32, context 96, gradient clip 1.0.
STLM joint loss: `lm + 0.4 * topology + seed-coordinate`.
Mini-SLA uses plain LM loss only.
