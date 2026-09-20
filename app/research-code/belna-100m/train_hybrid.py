import argparse
import glob
import math
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from tqdm import tqdm

D_MODEL, N_LAYERS, N_HEADS, CTX = 768, 12, 12, 512
VOCAB, SEED = 50257, 8100  # GPT-2 vocab, paper seed


class CausalAttention(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.qkv = nn.Linear(d, 3 * d, bias=False)
        self.proj = nn.Linear(d, d, bias=False)
        self.heads = heads

    def forward(self, x):
        B, T, D = x.shape
        q, k, v = self.qkv(x).chunk(3, dim=-1)

        def split(t):
            r = t.view(B, T, self.heads, D // self.heads)
            return r.transpose(1, 2)

        q, k, v = split(q), split(k), split(v)
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        y = y.transpose(1, 2).reshape(B, T, D)
        return self.proj(y)


class TAMBlock(nn.Module):
    """Reduced-width attention in parallel with a diagonal
    affine scan (the world-state), mixed by a learned gate:
    out = 2 * ((1 - g) * attn + g * state)."""

    def __init__(self, d, heads):
        super().__init__()
        self.attn = CausalAttention(d, heads)
        self.decay = nn.Parameter(torch.zeros(d))
        self.in_proj = nn.Linear(d, d, bias=False)
        self.gate = nn.Parameter(torch.zeros(()))
        self.norm = nn.LayerNorm(d)

    def scan(self, u):
        """Diagonal recurrence s = alpha * s + u, one step per token.
        Paper runs use a fused associative-scan kernel; this loop
        is mathematically identical and easier to audit."""
        alpha = torch.exp(-F.softplus(self.decay))
        s = torch.zeros_like(u[:, :1])
        outs = []
        for t in range(u.size(1)):
            s = alpha * s + u[:, t : t + 1]
            outs.append(s)
        return torch.cat(outs, dim=1)

    def forward(self, x):
        h = self.norm(x)
        a = self.attn(h)
        s = self.scan(self.in_proj(h))
        g = torch.sigmoid(self.gate)
        return x + 2 * ((1 - g) * a + g * s)


class TransformerBlock(nn.Module):
    """Matched baseline: full-width causal attention plus MLP."""

    def __init__(self, d, heads):
        super().__init__()
        self.attn = CausalAttention(d, heads)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))
        self.n1 = nn.LayerNorm(d)
        self.n2 = nn.LayerNorm(d)

    def forward(self, x):
        x = x + self.attn(self.n1(x))
        return x + self.mlp(self.n2(x))


class LM(nn.Module):
    def __init__(self, arch):
        super().__init__()
        Block = TAMBlock if arch == "tam" else TransformerBlock
        self.emb = nn.Embedding(VOCAB, D_MODEL)
        self.pos = nn.Embedding(CTX, D_MODEL)
        self.blocks = nn.ModuleList([Block(D_MODEL, N_HEADS) for _ in range(N_LAYERS)])
        self.norm = nn.LayerNorm(D_MODEL)
        self.head = nn.Linear(D_MODEL, VOCAB, bias=False)

    def forward(self, idx):
        B, T = idx.shape
        pos = torch.arange(T, device=idx.device).unsqueeze(0)
        x = self.emb(idx) + self.pos(pos)
        for blk in self.blocks:
            x = blk(x)
        return self.head(self.norm(x))


def shard_stream(path):
    for f in sorted(glob.glob(path + "/*.bin")):
        raw = np.fromfile(f, dtype=np.uint16).astype(np.int64)
        for i in range(0, len(raw) - CTX, CTX + 1):
            yield raw[i : i + CTX + 1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", choices=["tam", "transformer"])
    ap.add_argument("--shards", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = args.out or f"./out/{args.arch}"

    torch.manual_seed(SEED)
    torch.set_float32_matmul_precision("high")
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = torch.compile(LM(args.arch).to(dev, dtype=torch.bfloat16))
    opt = torch.optim.AdamW(
        model.parameters(), lr=3e-4, betas=(0.9, 0.95), weight_decay=0.1
    )
    MICRO, ACCUM = 64, 2
    total_steps = 2_000_000_000 // (MICRO * ACCUM * CTX)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: 0.5 * (1 + math.cos(math.pi * s / total_steps))
    )

    stream, step, running = shard_stream(args.shards), 0, 0.0
    model.train()
    for seq in tqdm(stream, total=total_steps * ACCUM):
        idx = torch.tensor(seq, dtype=torch.long, device=dev)
        idx = idx.unsqueeze(0).expand(MICRO, CTX + 1)
        with torch.autocast(dev, dtype=torch.bfloat16):
            loss = F.cross_entropy(
                model(idx[:, :CTX]).reshape(-1, VOCAB), idx[:, 1:].reshape(-1)
            ) / ACCUM
        loss.backward()
        running += loss.item()
        if (step + 1) % ACCUM == 0:
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            nll = running
            print(
                f"opt-step {(step + 1) // ACCUM} NLL {nll:.4f} PPL {math.exp(nll):.2f}",
                flush=True,
            )
            running = 0.0
        step += 1
    torch.save(model.state_dict(), out + "/final.pt")


if __name__ == "__main__":
    main()
