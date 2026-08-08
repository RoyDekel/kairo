# KAIRO Product Decisions

> Append-only. Newest at the top. Maintained by the `product-manager` agent.
>
> **Rejections are the most valuable entries here.** They exist so the same idea is not
> re-argued from scratch in two months. Every rejection records what would change the answer.

## Format

```markdown
### YYYY-MM-DD — Title
**Decision**: what was decided
**Context**: what prompted it
**Reasoning**: why, against the product lens
**Alternatives considered**: and why they lost
**What would change this**: the evidence that would reverse the call
```

---

### 2026-08-08 — Product docs established as the source of truth
**Decision**: `docs/product/{roadmap,backlog,decisions}.md` are the single source of truth
for what KAIRO builds. Specs written here are the input contract for the `feature-dev` agent.
**Context**: Three agents (`feature-dev`, `bug-fixer`, `product-manager`) were introduced and
needed a shared, version-controlled place for product intent.
**Reasoning**: Markdown in-repo means specs are versioned alongside the code they describe,
diffable in review, and readable by the engineering agents without a connector or API.
**Alternatives considered**: GitHub Issues — better public trail, but adds a dependency and
a sync cost for a solo project, and agents would need `gh` on every read.
**What would change this**: More than one human contributor, or outside stakeholders who
need visibility without repo access.
