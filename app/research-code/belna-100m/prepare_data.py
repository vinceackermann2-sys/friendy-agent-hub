# Documented mix: FineWeb-Edu 45, FineMath 17.5, StackV2 15,
# Cosmopedia 15, ArXiv 7.5. Point DATASETS at your local mirrors.
import argparse
import numpy as np
from datasets import load_dataset, interleave_datasets
from transformers import GPT2TokenizerFast

CTX = 512
MIX = [
    ("fineweb-edu", 0.450),
    ("finemath", 0.175),
    ("stack-v2", 0.150),
    ("cosmopedia", 0.150),
    ("arxiv", 0.075),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--tokens", type=int, default=2_000_000_000)
    ap.add_argument("--seed", type=int, default=8100)
    args = ap.parse_args()

    tok = GPT2TokenizerFast.from_pretrained("gpt2")
    streams = [load_dataset(name, split="train", streaming=True) for name, _ in MIX]
    probs = [w for _, w in MIX]
    data = interleave_datasets(streams, probabilities=probs, seed=args.seed)

    buf, written, shard = [], 0, 0
    for row in data:
        buf.extend(tok(row["text"])["input_ids"])
        while len(buf) >= CTX + 1:
            seq = np.array(buf[: CTX + 1], dtype=np.uint16)
            seq.tofile(f"{args.out}/shard_{shard:05d}.bin")
            buf = buf[CTX + 1 :]
            written += CTX + 1
            shard += 1
        if written >= args.tokens:
            break
    print(f"wrote {written} tokens in {shard} shards")


if __name__ == "__main__":
    main()
