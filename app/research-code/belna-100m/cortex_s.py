import torch
import torch.nn as nn
import torch.nn.functional as F
from train_hybrid import CausalAttention

N_EXPERTS, TOP_K, STATE = 8, 2, 128


class SparseMoE(nn.Module):
    """8 feed-forward experts, top-2 routing per token."""

    def __init__(self, d):
        super().__init__()
        self.gate = nn.Linear(d, N_EXPERTS, bias=False)
        self.experts = nn.ModuleList(
            [
                nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))
                for _ in range(N_EXPERTS)
            ]
        )

    def forward(self, x):
        w = F.softmax(self.gate(x), dim=-1)
        topw, topi = w.topk(TOP_K, dim=-1)
        topw = topw / topw.sum(dim=-1, keepdim=True)
        out = torch.zeros_like(x)
        for k in range(TOP_K):
            for j, expert in enumerate(self.experts):
                pick = (topi[..., k] == j).unsqueeze(-1)
                if pick.any():
                    out = out + pick * topw[..., k : k + 1] * expert(x)
        return out


class CortexSBlock(nn.Module):
    """MoE plus a persistent recurrent state. Full attention
    only when layer_id % 6 == 0; other layers ride the state.
    The state update is bounded, so every step is auditable."""

    def __init__(self, d, heads, layer_id):
        super().__init__()
        self.layer_id = layer_id
        self.attn = CausalAttention(d, heads) if layer_id % 6 == 0 else None
        self.moe = SparseMoE(d)
        self.to_state = nn.Linear(d, STATE, bias=False)
        self.from_state = nn.Linear(STATE, d, bias=False)
        self.norm = nn.LayerNorm(d)

    def forward(self, x, state):
        """state: (B, STATE) carried across the sequence."""
        h = self.norm(x)
        if self.attn is not None:
            h = h + self.attn(h)
        h = h + self.moe(h)
        write = torch.tanh(self.to_state(h).mean(dim=1))
        state = 0.9 * state + 0.1 * write
        read = self.from_state(state).unsqueeze(1)
        return x + h + read, state
