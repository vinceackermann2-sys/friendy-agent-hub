# Belna 100M programme

Reference code for the TAM v3 / Cortex-S / Transformer comparison.

```bash
pip install torch==2.3.* datasets transformers tqdm numpy

python prepare_data.py --out ./shards --tokens 2000000000
python train_hybrid.py --arch tam          --shards ./shards
python train_hybrid.py --arch transformer  --shards ./shards
python compare_runs.py --a ./out/tam --b ./out/transformer
```

Swap the block for Cortex-S with `cortex_s.py` (same protocol otherwise).

The 2B-token paper runs used a fused associative-scan kernel. The loop in `train_hybrid.py` is mathematically identical.

Seed 8100. Context 512. Effective batch 128 (micro 64 × accum 2). AdamW 3e-4 cosine, weight decay 0.1, clip 1.0, bfloat16.
