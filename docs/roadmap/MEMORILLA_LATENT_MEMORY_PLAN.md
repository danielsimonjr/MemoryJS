# Memorilla — latent semantic memory: research note and plan

**Status**: E1, E2, E4 and E5 have shipped. E3 has not shipped; it waits for a caller. Of E4, the `retrieval.summarizeExcluded` setting has not shipped. Soft tokens and GRPO are dropped.
**Added**: 2026-10-18
**Revised**: 2026-10-21 (paper figures re-checked; gap review, E4, E5 and mixing map added to Section 4; E2 extended; two audit rows added to Section 3)
**Paper**: Fallahpour, Idehpour, Kothapalli, Mounier, Wu, Pardis, and Leskovec. *Memorilla: Latent Semantic Memory for LLMs*. arXiv:2610.21375, posted 15 Oct 2026. HTML full text including Appendices A–G: <https://arxiv.org/html/2610.21375>. Abstract: <https://arxiv.org/abs/2610.21375>. Workshop citation on the project site: COLM Workshop on Context Beyond the Window, 2026, <https://openreview.net/forum?id=VV0vvzL783>.
**Project site**: <https://memory.stanford.edu/>

This note records what the paper and its public artifacts actually say, then audits MemoryJS module by module. A Memorilla idea becomes a roadmap item only when no current module already does that job. Where a module is close, the item is an enhancement of that module, with the classes, schema, and search APIs it must call. Effort labels (S / M) are estimates. Nothing here claims that those enhancements will reproduce the paper’s scores.

Sources read for this note:

- The arXiv HTML paper, including Appendices A (related work), B (data and training), C (baselines), D (benchmarks and token budgets), E (ablations), F (serving cost; the latency table is Appendix F’s Table 14), and G (TextWorld).
- The project website, for the mean score, the release links, and the “current limits” paragraph.
- The code repository README and training configs at <https://github.com/snap-stanford/memorilla> (Apache-2.0).
- The checkpoint card <https://huggingface.co/memorilla/Memorilla-Qwen3-8B> (Apache-2.0) and the dataset card <https://huggingface.co/datasets/memorilla/Memorilla-Data> (`memorilla/Memorilla` redirects there). PersonalizationV4: <https://huggingface.co/datasets/memorilla/PersonalizationV4>.

Figure images are not re-measured. Numbers below are the ones written in the prose, tables, or website. Where a figure’s per-bar values are not printed, this note says so.

---

## Recommendation

Do not add a document-collection store, a readout type, a latent-token adapter, or an eval harness. Those jobs already have owners. Two small enhancements are worth doing, in this order:

1. **E1.** Point the existing `semanticSearch` getter at the existing SQLite `embeddings` table, and make `SemanticSearch.indexAll` re-embed an entity when `contentHash` changes. Estimate: S.
2. **E2.** On the existing `ContextPackage`, report how many candidate tokens were considered versus how many were packed, and let `retrieveForContext` rank those candidates with the existing `HybridSearchManager` when the caller passes `queryText`. The caller can also turn on the one-hop neighbor expansion that `HybridSearchManager` already has, so a question that composes facts reaches the connected facts (Section 4, "Mixing map"). Estimate: S.

A third change, **E3**, finishes the stub inside `SummarizationService` so a query can shorten the entities that missed the budget. Build it only if a caller asks. Estimate: S.

Two further items come from the gap review in Section 4. **E4** sets a retrieval style from the question type, through the profile system that already exists, and stays an experiment until a measurement supports it. **E5** counts repeated turns per session, as a cheap proxy for the loops that Section 6 of the paper reports. Build E4 and E5 only after E2 lands.

Soft-token injection, a new Perceiver module, and GRPO training are dropped. No class in `src/` can host them, and they would be new code beside SQLite, FTS, and the context packer.

---

## 1. Paper summary

### 1.1 Problem and claim

A frozen LLM can use information outside its parameters only through its context (Section 1). Memorilla encodes a document collection once, then, per query, reads **every** stored embedding and emits a fixed number of soft tokens in that LLM’s input-embedding space (Section 2, Figure 2). The default budget is K = 16. Documents do not re-enter the decoder as text.

The HTML abstract says Memorilla “achieves the best average performance against baselines including Mem0 and MemoRAG”. Section 4 is more precise: it leads on five of eight benchmarks and is second on NarrativeQA and PersonalizationV4. The project site states a mean score of **49.68** on the eight primary metrics. That mean mixes accuracy, exact match, and ROUGE-L; the site says so. Recomputing the eight primary metrics in Table 11 gives (44.60 + 66.65 + 59.00 + 84.33 + 19.31 + 57.00 + 18.15 + 48.37) / 8 = 49.68.

### 1.2 Architecture

Three operations: encode, store, retrieve (Section 2).

**Encoding and storage (Section 2.1, Equation 1).** A frozen document encoder maps each chunk d_i to a vector z_i of dimension h_e. Stacking them gives a matrix Z_D of shape N × h_e. That matrix is query-independent, computed once, and reused. Only added or changed documents are re-encoded. A frozen query encoder maps the current query to z_q, which is not stored as long-term memory. In the experiments both encoders are **Qwen3-Embedding-4B**, mean-pooled per document, h_e = 2560 (Section 2.5, Table 3). The dataset card says vectors are unit-normalized, computed in vLLM without an instruction prefix, and stored as float16.

**Query-conditioned readout f_mem (Section 2.2, Equations 2–5).** A trainable module maps (Z_D, z_q) to K rows in the decoder’s input dimension h_L. Four stages:

1. **Slot init.** K learned vectors Q_0, Xavier uniform, shared across collections and queries (Table 3).
2. **Query conditioning (Equation 3).** Slots cross-attend to the single query vector, then a residual add and LayerNorm. The query is a shared update; the residual keeps the slots distinct.
3. **Document read (Equation 4).** L_ref = 2 Perceiver-style blocks (Jaegle et al., 2021). Each block is cross-attention from the slots onto **all** document embeddings, plus a two-layer GELU feed-forward. Eight heads. Dropout 0.1. Softmax over documents (Table 3). This is a continuous read, not a discrete top-k cut. The module does **not** use self-attention; the checkpoint card repeats “no document self-attention”.
4. **Projection (Equation 5).** LayerNorm then a learned linear map h_e → h_L. h_L = 4096 for the 8B decoder and 2560 for the 4B decoder (Table 3).

**Injection (Section 2.3, Equation 6).** The K soft tokens are prepended to the query’s token embeddings. No decoder layer is modified. Rotary position embeddings run over the combined sequence in the usual way. The decoder attends to the memory through its existing self-attention.

**Objective (Section 2.4, Equation 7).** Negative log-likelihood of the **answer** tokens only. θ_mem is the memory module and the projection. Encoder and decoder stay frozen. Trainable size: **194,123,776** parameters with the 8B decoder, **190,190,080** with the 4B decoder (Table 3).

### 1.3 Training data and recipe

Three stages (Section 2.6, Tables 1, 4, and 5). All supervised runs: AdamW, weight decay 10^-2, bf16, seed 23, 4× H100 80GB. Document embeddings are precomputed.

| Stage | Data | Init | Epochs | Peak LR | Effective batch | Max decoder length |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1,979,809 English Wikipedia paraphrase rows (chunked near 128 tokens, mean 1.73 documents per row) | random | 1 | 3×10^-4 | 128 | 1024 |
| 2 | 1,343,993 queries: SQuAD v2, DROP, CoQA, PubMedQA (900 train), QuAIL, PwC, CNN/DailyMail, SAMSum, DialogSum, MS MARCO | Stage 1 | 1 | 3×10^-4 | 128 | 1024 |
| 3 | Unified training splits of the eight eval benchmarks | Stage 2 | up to 5 | 1×10^-4 | 64 | 2048 |

Stage 3 warmup ratio is 0.1; Stages 1–2 use 0.03. One multi-task checkpoint is used directly for FactKG, TriviaQA, NarrativeQA, PubMedQA, LaMP-4, and LaMP-7. PersonaMem-v2 and PersonalizationV4 are each fine-tuned for 5 further epochs because their validation loss had not plateaued (Section 2.6, Table 5). The released training configs match that recipe: `configs/personalization_pv4.yaml` and `configs/personalization_pmv2.yaml` set `init_memory: runs/stage3/epoch-04`. The GitHub README checkpoint table and the Hugging Face model card instead label the released `pv4/` and `pmv2/` folders as “from Stage 1” via `configs/single_task.yaml` (that file inits from Stage 2 and defaults to LaMP-7). The weights were not downloaded for this note, so which description the files on disk follow is unresolved. The paper’s reported personalization numbers are the Stage-3-then-specialized recipe.

Chunk units (Table 2, Qwen3 tokenizer, mean / median tokens): PersonaMem-v2 one session 280 / 262; PersonalizationV4 one dialogue 252 / 224; PubMedQA one abstract section 84 / 78; TriviaQA sentence-greedy passages at 128 tokens, 70 / 77; NarrativeQA paragraphs split above ~256 tokens, 94 / 35; FactKG one triple 13 / 13; LaMP-4 one profile item 47 / 44; LaMP-7 one tweet 25 / 25.

Decoding for the supervised evals is greedy, temperature 0 (Section 3.3, Table 3). Short-answer generation is capped at 8 tokens for classification and 64 for QA and fact verification; LaMP-4 and LaMP-7 at 128.

### 1.4 Benchmarks and baselines

Eight supervised benchmarks in three groups (Section 3.2, Appendix D, Table 7). Means below are documents per query and source tokens per query on the evaluated split.

| Benchmark | Task | Docs / q | Source tokens / q | Evaluated split |
| --- | --- | --- | --- | --- |
| PersonaMem-v2 | Personalization, short answer | 116 | 31,618 | test, n = 5,000 |
| PersonalizationV4 | Personalization, short answer | 200 | 50,476 | test, n = 4,237 (30 held-out users) |
| LaMP-4 | Personalized headline | 172 | 7,638 | development, n = 1,925 |
| LaMP-7 | Personalized tweet paraphrase | 18 | 465 | development, n = 1,500 |
| NarrativeQA | Long-document generative QA | 1,420 | 76,225 | test, n = 10,557 |
| TriviaQA | Factoid QA | 164 | 11,861 | seed-23 subsample of validation, n = 500 (of 17,944) |
| FactKG | Claim supported / refuted from DBpedia triples | 129 | 1,665 | test, n = 9,041 |
| PubMedQA | Yes / no / maybe from an abstract | 4 | 324 | 100-example test portion of a 900/100 split of PQA-L |

Personalization users are disjoint between train and test (Appendix D). PersonalizationV4 is synthetic: GPT-5 personas and questions, GPT-5-mini dialogues, no real users (ethics statement, Appendix D.1). Short-answer accuracy embeds the generation with the frozen encoder and marks it correct when the gold answer is the nearest of the predefined choices (Section 3.3). FactKG choices are `True` / `False`.

Every baseline the authors ran uses frozen Qwen3-Embedding-4B and frozen Qwen3-8B, greedy (Section 3.1, Appendix C).

- **Closed book.** Query only.
- **RAG-k.** Cosine top-k chunks, most similar first. Reported at k ∈ 1, 5, 50.
- **Full context.** Every chunk in stored order. The server enforces 32,768 decoder tokens and turns on YaRN (scale 4, window 131,072) past that. That covers part of PersonaMem-v2, TriviaQA, and NarrativeQA, and all of PersonalizationV4 (Table 10). For the 10.8% of evaluated NarrativeQA questions whose books still exceed the extended window, the earliest chunks are dropped.
- **LLMLingua-2.** Query-agnostic token deletion with the released XLM-RoBERTa-large classifier. The collection is compressed once. Absolute budgets 32, 64, 128, and 350; the best budget per metric is reported.
- **xRAG.** Reimplemented bridge: LayerNorm plus a two-layer GELU MLP, 27,276,288 parameters, mapping the **single** top chunk’s embedding to one soft token. Trained from scratch on each benchmark’s training split.
- **ComMer.** Not re-run. Table 12 quotes published LaMP-4 / LaMP-7 numbers from a Gemma-2b setup.
- **Mem0** (`mem0ai` 0.1.118) and **MemoRAG** (official repo). Both write memory with frozen Qwen3-4B-Instruct-2507. Retrieval depth is swept and the best depth per metric is reported (Table 6).

### 1.5 Main results

Table 11 is the full 8B comparison. Compression is full-context document tokens divided by 16 (Table 10). Document-token counts exclude the question, the answer-format instruction, the system prompt, and the chat template. Primary metric per benchmark:

| Benchmark | Metric | Closed book | RAG-50 | Full context | Strongest other | Memorilla | Vs full context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PersonaMem-v2 | short-answer acc. | 25.64 | 26.72 | 27.92 | xRAG 30.90 | **44.60** | 1,974× |
| PersonalizationV4 | short-answer acc. | 58.30 | 65.78 | 59.12 | MemoRAG **67.88** | 66.65 | 3,153× |
| PersonalizationV4 hard (n = 629) | short-answer acc. | 31.96 | 41.97 | 36.57 | MemoRAG **45.95** | 41.97 | — |
| PubMedQA | acc. | 21.00 | 67.00 | 67.00 | LLMLingua-2 **69.00** | 59.00 | 20× |
| NarrativeQA | ROUGE-L | 10.71 | 17.23 | 17.99 | MemoRAG **20.51** | 19.31 | 4,212× |
| TriviaQA | exact match | 36.00 | 55.60 | 52.60 | MemoRAG 56.60 | **57.00** | 743× |
| FactKG | acc. | 65.97 | 78.39 | 80.43 | MemoRAG 80.38 | **84.33** | 108× |
| LaMP-4 | ROUGE-L | 12.24 | 15.09 | 14.21 | xRAG 16.10 | **18.15** | 474× |
| LaMP-7 | ROUGE-L | 43.13 | 43.77 | 43.71 | xRAG 46.84 | **48.37** | 29× |

FactKG 84.33 against full context 80.43 at 108× fewer document tokens is Table 11, and it matches the abstract. The same row is 36× fewer tokens than MemoRAG (Table 10: full context 1,727 tokens, MemoRAG 573, Memorilla 16). On NarrativeQA, MemoRAG leads ROUGE-1 (21.80) and ROUGE-L (20.51); Memorilla leads F1 (16.56 against MemoRAG 15.03). On TriviaQA, Memorilla also leads F1 (60.60) and BLEU-1 (58.66).

Section 4: full context trails Memorilla on every benchmark except PubMedQA, and on 20 of the 21 metrics in Table 11. RAG-50 beats full context on 15 of those 21 metrics. The authors’ reading is that giving the decoder the entire collection often hurts.

Geometric-mean document tokens (Table 10): RAG-1 55, RAG-5 273, RAG-50 1,808, full context 6,301, LLMLingua-2 278, xRAG 1, Mem0 212, MemoRAG 784, Memorilla 16. Section 4 converts that to 394×, 113×, and 49× fewer document tokens than full context, RAG-50, and MemoRAG. Figure 1 puts Memorilla on the Pareto frontier of mean score against that geometric mean. Section 4 also quotes average scores of 41.92 (xRAG), 40.75 (LLMLingua-2), and 38.02 (Mem0) against 49.68.

Table 12, cross-paper and cross-model: ComMer at 128 tokens reports LaMP-4 ROUGE-L 17.50 and LaMP-7 45.00 on Gemma-2b. Memorilla at 16 tokens reports 17.72 / 47.04 with the 4B decoder and 18.15 / 48.37 with the 8B decoder.

**What the readout seems to learn (Section 5, Figure 4).** On NarrativeQA, Memorilla beats RAG-50 by 4.91 ROUGE-L on “why” and 7.02 on “how”. RAG-50 leads by 3.45 on “who” and 2.93 on “which”. On FactKG, the margin over RAG-50 grows from +4.23 points at one entity to +7.59 points at four or more. RAG-50 falls from 78.73 to 51.75 as composed facts go from 1 to 4; Memorilla stays in the 80–89 range. 73.5% of FactKG claims have more than 50 chunks, so part of the RAG-50 gap is evidence it never sees. Full context still trails Memorilla (80.43 against 84.33).

**Complementarity (Section 5, Figure 5).** On FactKG, 15.9% of questions are answered by Memorilla alone and 10.0% by RAG-50 alone. On PersonaMem-v2 short-answer the split is 27.1% against 9.2%. The union is an oracle upper bound, not a trained hybrid. The site plots that union (FactKG 94.3, PersonalizationV4 80.4, PubMedQA 80.0, TriviaQA 74.2, and lower on the ROUGE tasks). Those union percentages are website figures; the paper states the “alone” shares and that the union exceeds either method on every benchmark. For ROUGE tasks a question counts as answered at ROUGE-L at least max(0.20, m), where m is Memorilla’s median.

Questions both methods miss: on PersonalizationV4 they often require linking facts that each appear somewhere, so the residual error is combination. On FactKG both methods lean toward “false”: true claims are 89.5% of the claims both get wrong and 28.7% of the claims both get right (Section 5).

### 1.6 Ablations

All of Appendix E’s from-scratch numbers use Qwen3-4B-Instruct-2507 unless noted, and **are not comparable** to Table 11.

**Architecture (Table 13, PersonaMem-v2 short-answer, trained from scratch).** Query-independent pooling is weakest: global mean-pool 28.94 (6.6M params), segmented mean-pool 29.68, segmented at a matched budget 31.10 (190.1M). Cosine top-16 at a matched budget is 33.86. A documents-only Q-Former (no question) is 34.72 at 268.9M. A query-aware Q-Former is 43.34 at 268.9M. Memorilla is 44.04 at 190.2M. On FactKG the same from-scratch comparison is Memorilla 82.56, Q-Former 80.48, documents-only 78.72. Replacing document embeddings with Gaussian noise changes the documents-only FactKG score by +0.04 and drops Memorilla by 5.93 and the Q-Former by 5.11. The paper’s conclusion: the gain comes from conditioning the slots **before** they read the collection.

**Capacity (Section E.2, Figure 9).** Training at K = 128 instead of K = 16, from scratch, moves four of eight benchmarks by less than a point, and PersonaMem-v2 and PersonalizationV4 drop. Per-benchmark deltas are in the figure and are not printed. The paper fixes K = 16 for the supervised experiments.

**Inference budget (Section E.3, Figure 10).** Using the first K tokens of a checkpoint trained at 16, without retraining. PersonaMem-v2 stays near closed-book through K = 4 (26.58 against 25.64) and reaches 44.60 at K = 16. PersonalizationV4 starts at 57.66 against a closed-book 58.30, dips at K = 2 and K = 4, and reaches 66.65 at 16. FactKG, TriviaQA, and NarrativeQA rise at every doubling. PubMedQA and LaMP-4 improve from K = 8; LaMP-7 only from K = 16. The paper reads this as “required capacity tracks how much cross-document integration the task needs.” The curves are not saturation curves: training at 128 did not help.

**Frozen decoder vs LoRA (Section E.4, Figure 11).** Rank-130 LoRA on Qwen3-4B-Instruct-2507, 268.4M parameters, same per-task rows, **no documents**. Memorilla (8B decoder, 194.1M trainable) leads every primary metric. The PubMedQA and LaMP-7 gaps are described as within noise. Exact per-metric LoRA scores are in the figure and are not printed.

**Encoder size (Section E.5, Figure 12).** Swapping Qwen3-Embedding-4B for Qwen3-Embedding-8B, training from scratch, moves every score by at most 1.3 except PubMedQA (+3.00, three of 100 questions).

### 1.7 Cost and latency

Appendix F, Table 14. One H100 80GB, batch size 1, bf16, greedy, `max_new_tokens = 32`, 250-token documents, median of 5 timings after 2 warmups. Hugging Face `generate` **without** a paged KV cache. The paper says full-context latency therefore depends on the serving stack.

| Path | N = 1 | N = 512 |
| --- | --- | --- |
| Document encoding (once) | 22.92 ms | 2,588.84 ms |
| Storage per document | 5 KB | 5 KB |
| Memory-module forward | 2.01 ms | 1.96 ms |
| CPU → GPU transfer | 0.014 ms | 0.060 ms |
| Decoder context tokens | 16 | 16 |
| Memorilla end to end | 740 ms | 739 ms |
| Full context end to end | 749 ms | 19,932 ms |

At N = 512 the full-context prompt is 128,064 tokens, past 32,768, so it uses YaRN. The introduction’s “0.74 s against 19.9 s” and “27×” match 739 ms against 19,932 ms. Encoding cost is linear in N and is the same cost a dense index would pay. Read-path time stays flat. A 200-document collection is 1 MB. On PersonalizationV4 the embedding store is 7,266× smaller than the corresponding KV cache: 50,455 document tokens at 144 KiB per token for Qwen3-8B in bf16 is 6.9 GiB, against 200 embeddings of 2,560 bf16 values (Appendix F).

The code README says the three training stages take about 19 hours on 4× H100 and download about 310 GiB, and that evaluating one checkpoint on all eight benchmarks takes about 15 minutes on one GPU. Those are repository statements, not paper tables.

### 1.8 TextWorld: memory trained by reward

Section 6 and Appendix G. A frozen **Qwen3-4B-Instruct-2507** agent, frozen Qwen3-Embedding-4B encoder, memory module trained **from random initialization** with GRPO. The supervised checkpoint is not loaded (Table 15). K = 8, not 16. Eight heads, one self-attention layer over the trajectory documents, then the same two cross-attention layers.

The memory **supplements** the text history. Every condition keeps the full history under the same budget: 16,000 tokens in training, 4,096 in evaluation (Section 6.1, Equation 10). From the second turn, each completed turn is one document (observation truncated to 200 characters plus the action; 74 tokens on average). The query is the current observation. The 20 extreme / huge / long / mega test games instead embed one document per five turns, keep the last four documents, and use the mean document embedding as the query.

Reward is the TextWorld game score with no shaping. Most medium and hard games return 1 for a win and 0 otherwise. GRPO group size G = 16, PPO clip 0.2, token-mean loss, no critic, no KL, no entropy bonus. AdamW at 5×10^-4, no warmup (Table 15, Equations 8–9). Training: 800 prompts (202 medium, 558 hard, 10 from each longer tier), 4 prompts per step, up to 50 turns, up to 128 new tokens per turn, SkyRL. Eval: 40 held-out prompts (30 distinct games), three samples at temperature 0.6.

Results (Section 6.1, Figure 8): avg@3 rises from **0.186 to 0.242**, pass@3 from **0.250 to 0.375**, relative to full-history in-context learning. An untrained module of the same shape falls to avg@3 0.153 and pass@3 0.225, so the extra tokens alone do not explain the gain. In-context learning exhausts the 4,096-token budget on 71% of rollouts, Memorilla on 58%. The site restates the complement: episodes that end before the turn limit are 29% and 42%. History in medium and hard games grows from about 800 tokens to about 3,200 and then levels off; the median rollout ends at turn 33, and 5 of 40 reach turn 50. Remaining failures concentrate in the longest quests.

The RL code lives in `rl/` and depends on <https://github.com/Adibvafa/SkyRL-Memorilla>.

### 1.9 Limitations the authors state

Section 7, plus the website’s “Current limits” paragraph:

- Fine-grained facts, especially exact names, are dropped. The document encoder was never trained for compression. “Who” / “which” questions favor RAG; “why” / “how” favor the memory (Section 5).
- Short sources do not benefit. PubMedQA’s four abstracts are 324 tokens; LLMLingua-2 scores 69.00 and Memorilla 59.00 (Table 11).
- The readout writes into one LLM’s input embeddings, so it needs open weights and a module trained for that LLM. h_L differs between the 4B and 8B decoders (Table 3). The website states this limit directly.
- Experiments pair a Qwen encoder with a Qwen decoder. Cross-family transfer is untested. Coding is untested. Modalities other than text are untested. Science beyond the PubMedQA abstracts is untested.
- TextWorld is one game suite, episodes of at most 50 turns. The website says learning across environments and over long deployments is not shown.
- Embeddings can still carry sensitive user information. Deleting a user’s store does not require retraining the LLM, and the authors still require consent and protection (ethics statement).
- PersonalizationV4 is synthetic and follows one template.

Two further limits follow from the experimental design, even though they are not in the limitations paragraph:

- The headline numbers are **in-domain**: Stage 3 trains on the eight benchmarks’ training splits, and the two personalization sets are specialized further (Section 2.6). This is not a zero-shot memory module.
- TriviaQA is a 500-question validation subsample, LaMP-4 and LaMP-7 are development splits, and PubMedQA has 100 test questions (Table 5). ComMer is a different model family (Table 12). The 49.68 mean mixes metrics (project site).

### 1.10 What was released

Verified on 2026-10-18:

| Artifact | Where | License / note |
| --- | --- | --- |
| Training and eval code | <https://github.com/snap-stanford/memorilla> | Apache-2.0. Linux, CUDA, Python 3.11, uv. FlashAttention-2 is optional. |
| Memory-module checkpoints | <https://huggingface.co/memorilla/Memorilla-Qwen3-8B> | Apache-2.0. Folders `stage1/`, `stage2/`, `stage3/`, `pv4/`, `pmv2/`. Each has `memory.pt` (bfloat16, 194M) and `config.json`. The frozen Qwen3-8B and Qwen3-Embedding-4B weights are **not** in this repo; the card says to use the original Qwen checkpoints. The Hugging Face models API for org `memorilla` listed this as the only model. |
| Training and eval rows, plus precomputed Qwen3-Embedding-4B vectors | <https://huggingface.co/datasets/memorilla/Memorilla-Data> | Per-config license of the source dataset. Several are non-commercial (QuAIL, SAMSum, DialogSum, MS MARCO). FactKG’s own license is stated as “no license stated”; DBpedia triples are CC BY-SA 3.0. Embedding shards are large: FactKG 69.4 GiB, TriviaQA 124.6 GiB, MS MARCO 30.7 GiB, English Wikipedia 26.0 GiB (dataset card). |
| PersonalizationV4 | <https://huggingface.co/datasets/memorilla/PersonalizationV4> | CC BY 4.0. 149 fictional users. |
| TextWorld RL fork | <https://github.com/Adibvafa/SkyRL-Memorilla> | Linked from the Memorilla README. Not audited line by line for this note. |

The reproducibility statement says code, data with precomputed embeddings, and PersonalizationV4 are released on the project website. The website links the GitHub repository and the Hugging Face org.

---

## 2. Strengths and weaknesses

**Strengths, as evidenced.**

- The comparison holds the encoder and the decoder fixed, so method differences are in the memory interface (Section 3.1). Closed book, three RAG depths, full context, a text compressor, a one-token latent bridge, Mem0, and MemoRAG are all in Table 11.
- Beating full context on FactKG (84.33 vs 80.43) cannot be explained by dropping irrelevant documents, because full context receives every triple (Section 4). The multi-entity and multi-fact breakdowns (Figure 4) are the most useful result for a graph library: top-50 cosine retrieval degrades as facts are composed, and a read of the whole collection does not.
- The ablations separate “more parameters” and “query awareness” from the actual design. Matched-budget pooling and cosine top-16 do not close the gap; conditioning the slots before the read does (Table 13 and the noise test).
- Write-once embeddings make the store the same object as a dense index, so encoding is not an extra cost (Section 2.1, Appendix F). Serving cost stays flat from 1 to 512 documents in their stack, while full-context prefill does not (Table 14).
- On TextWorld the control is unusually tight: same history, same token budget, and an untrained module that gets worse (Section 6.1). The gain is learning a compact state, and the measured behavior change is fewer navigation loops.
- The store is per collection and external to the LLM, so a user’s embeddings can be deleted without a gradient step (Section 7, ethics statement). That matches how MemoryJS already treats storage.

**Weaknesses and limits on what we should copy.**

- The supervised module is trained on the evaluation domains. Treating 84.33 or 44.60 as a target for an untrained library feature would misread Section 2.6.
- Exact entity strings are the failure mode (Section 5). Any plan that replaces verbatim graph edges with a summary will lose the questions MemoryJS is already good at.
- PubMedQA shows a floor: when the source already fits, compression lowers accuracy (Table 11, 59.00 vs 67–69). A fixed budget should be allowed to fall back to the raw text when the raw text is smaller.
- The 27× latency claim is one stack, one GPU, 32 new tokens, no paged cache, and a 128k-token YaRN baseline (Table 14). It is not a general serving law. The memory forward itself is about 2 ms; decoding dominates.
- Soft tokens are tied to one decoder’s h_L (Table 3). The embedding store is portable across queries; the readout is not portable across model families, and the paper does not test that transfer (Section 7).
- TextWorld uses K = 8, a different architecture (an added self-attention layer), a smaller decoder, and reward training from scratch. It does not show that the FactKG checkpoint is an agent memory.
- Untrained memory tokens hurt (avg@3 0.153 vs 0.186). Shipping a random or heuristic “latent” channel and expecting the TextWorld lift would contradict Section 6.1.
- The mean 49.68 averages different metrics, and several splits are development sets or subsamples (Table 5, project site). ComMer is not a controlled comparison (Table 12).

---

## 3. Codebase audit

Audit date 2026-10-18, against `src/`. Each row is one Memorilla idea. "Already covered" means a caller can do the job with the modules named, so it is not a new feature.

| Memorilla idea | Paper | What already exists | Verdict |
| --- | --- | --- | --- |
| Write a chunk once, skip unchanged text, keep the vector | §2.1, Appendix F | `IOManager.ingest` (`src/features/IOManager.ts`) splits input (`chunkBy`: `exchange` / `paragraph` / `fixed`), SHA-256s the chunk, stores it on `Entity.contentHash`, and increments `skippedDuplicates` when the hash is already present. The same hash is written into an `ingest-manifest` entity (`INGEST_CHUNK_PREFIX` lines with `id`, `source`, `offset`, `length`, `hash`) and each observation gets `observationMeta.sourceRef`. A `derived_from` relation points at the manifest. `Entity.contentHash` is a persisted field (`src/core/GraphStorage.ts` allow-list) and a SQLite column with `idx_entities_content_hash` (`src/core/SQLiteStorage.ts`, `getEntitiesByContentHash`). | **Covered at write time.** Do not add a collection store or a second chunk table. |
| Persist embeddings and reuse them on the next query | §2.1, Table 14 | `SQLiteStorage` already has `embeddings (entityName TEXT PRIMARY KEY REFERENCES entities(name) ON DELETE CASCADE, embedding BLOB, embeddingModel TEXT, embeddingUpdatedAt TEXT, dimensions INTEGER)` plus `idx_embedding_model`, and methods `storeEmbedding`, `getEmbedding`, `hasEmbedding`, `loadAllEmbeddings`, `removeEmbedding`. `SQLiteVectorStore` and `createVectorStore('sqlite', storage, model)` wrap that table (`src/search/VectorStore.ts`). `SemanticSearch.indexAll` (`src/search/SemanticSearch.ts`) already skips names for which `vectorStore.has` is true. `EmbeddingCache.get(key, text)` (`src/search/EmbeddingCache.ts`) already misses when the text hash changes. `IncrementalIndexer` (`src/search/IncrementalIndexer.ts`) already batches create/update/delete embeds through `EmbeddingService`. | **Module exists, not wired.** `ManagerContext.semanticSearch` calls `createVectorStore('jsonl')` (`src/core/ManagerContext.ts`), so the live store is `InMemoryVectorStore` and the SQLite table stays empty. `indexAll` also skips by name only, so a changed `contentHash` keeps a stale vector. Enhancement E1. |
| Delete one user's memory without touching the model | §7 ethics | `embeddings.entityName` is `ON DELETE CASCADE`. Entity delete already goes through `EntityManager` / `SemanticForget`, and governance audit already records deletions when enabled. | **Covered.** No new delete API. |
| Rank a query across the whole graph, then keep a fixed token budget | §2.2–2.3, Table 10 | `ContextWindowManager.retrieveForContext` (`src/agent/ContextWindowManager.ts`) already takes `ContextRetrievalOptions.maxTokens` (`src/types/agent-memory.ts`), subtracts `reserveBuffer`, scores with `SalienceEngine`, drops near-duplicates in `enforceDiversity` (threshold `diversityThreshold`, default 0.8), and returns `ContextPackage` with `totalTokens`, `TokenBreakdown` (working / episodic / semantic / procedural / mustInclude), and `excluded[]` (`reason`, `tokens`, `salience`). `AgentMemoryManager.retrieveForContext` forwards to it. `compressForContext` already returns `originalTokens`, `compressedTokens`, `savedTokens`, `savedPercent`. `MemoryFormatter.formatWithSalienceBudget` (`src/agent/MemoryFormatter.ts`) already splits a token budget across entities. `wakeUp` already caps L0 / L1 / L1.5 / project-context tokens. `CognitiveLoadAnalyzer` already reports density and redundancy. | **Budget packing is covered.** Missing: the ratio of candidate tokens to packed tokens (Table 10's compression column), and a query ranker in front of the packer. Today `retrieveForContext` loads every agent entity and prefilters by recency (`maxEntitiesToConsider`). `SalienceContext.queryText` does reach the ranking, but only through `SalienceEngine.calculateQueryRelevance` (TF-IDF cosine from `SummarizationService.calculateSimilarity`, or substring matching) as one averaged factor, and as `queryKeywords` for `IDistillationPolicy`. The prefilter that runs first (`prefilterCandidates`, only above `maxEntitiesToConsider`) sorts by recency and ignores the query. No embedding or graph signal reaches the ranking. Enhancement E2. |
| Query-conditioned shortening of what was retrieved | §2.2, §5 | Write-time shortening exists: `ingest` calls `MemoryDistiller.distill` (`src/agent/reconstruction/MemoryDistiller.ts`) when `IngestOptions.llmProvider` is set, and `IngestResult.tokenUsage` sums that provider's tokens. `DefaultDistillationPolicy.distill` (`src/agent/DistillationPolicy.ts`) already filters a `HybridSearchResult[]` with `queryKeywords`, recency, importance, and near-duplicate names. `TrajectoryCompressor.distill` and `foldContext` already wrap `compressForContext`. | **Read-time query summary is the stub, not a new subsystem.** `SummarizationService` (`src/agent/SummarizationService.ts`) has `summarize(texts)`, `maxTokens` (default 150), and `ISummarizationProvider`, but `initProvider` never constructs a provider ("fallback summarization only") and `summarize` has no query argument. Enhancement E3, and only on that class. |
| Hybrid of verbatim hits and a compressed view | §5, Figure 5 | `HybridSearchManager` (`src/search/HybridSearchManager.ts`) already mixes `SemanticSearch`, `RankedSearch` (TF-IDF lexical channel), `SymbolicSearch`, and optional `GraphRankPrior`. `explain: true` already attaches `EvidencePathBuilder` paths (`src/search/EvidencePathBuilder.ts`). `GraphTraversal.findPathWithin` (`src/core/GraphTraversal.ts`) already returns a bounded path. On SQLite, `RankedSearch.getFtsCandidateNames` already calls `SQLiteStorage.fullTextSearch`, whose SQL ranks with FTS5 `bm25(entities_fts, 10, 5, 3, 1)`; `RankedSearch` then TF-IDF-scores that candidate set. | **Covered.** Do not add a second hybrid. `BM25Search` (`src/search/BM25Search.ts`) also calls `fullTextSearch`, is exported, and has no constructor call site in `src/`. Leave it unwired. |
| Condition the read on the query, not only on the documents | §2.2, Table 13, noise test | Query conditioning exists in four places. `ContextWindowManager.applyProfile` resolves `profile: 'auto'` from `context.queryText` through `ContextProfileManager.inferProfile`. `ActiveRetrievalController` (`src/agent/retrieval/ActiveRetrievalController.ts`, `ctx.activeRetrieval`) runs rounds of ranked search and rewrites the query from the previous round, with no LLM. `LLMQueryPlanner` turns a question into a `StructuredQuery`. `MemoryReconstructor` (`ctx.reconstructiveMemory()`) runs the MRAgent active-reconstruction loop: select an action, traverse the Cue–Tag–Content graph, prune, repeat. | **Covered for planning, missing for packing.** None of these feed the candidate list of `retrieveForContext`. In that method `queryText` reaches only the lexical factor in `SalienceEngine.calculateQueryRelevance` and the `queryKeywords` of the distillation policy, after a recency prefilter that ignores the query. Enhancement E2 closes that gap. Do not add a fifth query-conditioning path. |
| Compose several facts for one answer (multi-entity, multi-fact) | §4–5, Figure 4 | `HybridSearchManager.search(graph, query, options)` already takes `expandNeighbors: { hops: 1, topK, damping }` (neighbors of the top results join the list with a damped score) and `lookFor` (free text that ranks those neighbors). `explain: true` attaches `EvidencePathBuilder` paths. `GraphRankPrior` supplies the PageRank prior and the neighbor lookup. All of these options default off. | **Covered, but only for direct callers of `HybridSearchManager`.** The paper finds that top-50 cosine retrieval degrades as the number of composed facts grows. `retrieveForContext` has no way to ask for neighbor expansion. E2 adds that pass-through. No new graph code. |
| Append each agent turn and still show recent history | §6, Eq. 10 | `MemoryEngine.addTurn` already writes the turn, with four-tier dedup keyed by `contentHash`. `retrieveForContext` already accepts `mustInclude` for the turns the caller wants kept verbatim, which is the paper's "memory supplements the history" control. | **Covered.** No trajectory store. |
| FactKG-style multi-hop over triples | §4–5, Figure 4, Table 2 | Relations are first-class. FactKG chunks are single triples. `GraphTraversal` and `CausalReasoner` already walk them. `ingest` already stores a chunk as an entity with observations. | **Covered.** A claim that composes facts is a graph walk plus the existing context packer. No fact-verification type. |
| Inject K soft tokens into a frozen LLM, train the module by answer NLL or GRPO | §2.3–2.6, §6, Appendix G | No decoder, no input-embedding table, no training loop. `LLMProvider` is a text API used by `MemoryDistiller` and `LLMQueryPlanner`. | **Dropped.** Nothing to extend. Hosted APIs cannot take the vectors in Equation 6, and the released `memory.pt` is a Qwen3-8B module. |
| Benchmark harness on FactKG and TextWorld | Tables 7, 10, 11, §6 | Tests already cover the pieces: `tests/unit/search/SemanticSearch.test.ts`, `tests/unit/search/VectorStore.test.ts`, `tests/unit/agent/ContextWindowManager.test.ts`, `tests/unit/agent/SummarizationService.test.ts`, `tests/unit/features/IOManager.test.ts`. | **No new harness.** E1 and E2 add cases to those files. Do not download `memorilla/Memorilla-Data` (FactKG embeddings alone are 69.4 GiB on the dataset card). |

---

## 4. What to build

### E1. Use the SQLite embedding table the context already owns

**Goal.** A second process reuses vectors for unchanged entities, and re-embeds an entity whose `contentHash` changed. Same behavior `EmbeddingCache` already has inside one process.

**Builds on.**

- `ManagerContext.semanticSearch` (`src/core/ManagerContext.ts`). When `this.storage` is `SQLiteStorage`, call `createVectorStore('sqlite', this.storage, embeddingService.model)` instead of `createVectorStore('jsonl')`. JSONL keeps `InMemoryVectorStore`, because `GraphStorage` has no `embeddings` table.
- `SemanticSearch.indexAll` / `indexEntity`. The skip branch (`forceReindex || !vectorStore.has(name)`) gains one check: if the store can report the hash it embedded, and `entity.contentHash` differs, treat the entity as not indexed. `EmbeddingService.embed` / `embedBatch` stay the only encoders. `IncrementalIndexer` stays the batch queue for callers who already use it; `indexAll` does not grow a second queue.
- `SQLiteStorage.embeddings`. One nullable column, `contentHash TEXT`, written by `storeEmbedding` from the entity hash the caller passes. No new table. `ON DELETE CASCADE` stays the delete path.
- `SQLiteVectorStore.add` already calls `storeEmbedding`. Extend that signature with an optional hash rather than adding a store class.

**New code.** A branch in the existing getter, an optional argument on `storeEmbedding` / `SQLiteVectorStore.add`, and the hash compare inside `indexAll`. No new module, no new dependency.

**Done when.** `tests/unit/search/SemanticSearch.test.ts` and `tests/unit/search/VectorStore.test.ts` show: a second `indexAll` on an unchanged entity makes zero `embed` calls; changing `contentHash` makes one; deleting the entity removes the `embeddings` row through the existing foreign key. JSONL tests still pass with the in-memory store.

**Risk.** `indexAll` today skips by name on purpose. The hash check must no-op when the column is null (rows written before the column existed) by re-embedding once and then storing the hash. Estimate: S.

### E2. Report the budget cut, and rank with the hybrid search that already exists

**Goal.** `retrieveForContext` tells the caller how many tokens it considered and how many it packed, and, when the caller passed a query, the candidate order comes from hybrid search.

**Builds on.**

- `ContextRetrievalOptions` and `ContextPackage` in `src/types/agent-memory.ts`. Add `sourceTokens: number` and `compressionRatio: number` (`sourceTokens / totalTokens`, or `1` when `sourceTokens <= maxTokens`). Both are sums of the `estimateTokens` values `retrieveForContext` already computes for selected and `excluded` entities. `ExcludedEntity.tokens` is the unused side of that sum.
- `ContextRetrievalOptions.maxSlots?: number`, applied inside the existing `prioritize` loop next to `maxTokens`. Default unset, so current callers keep today's packing. This is the fixed-K idea, expressed as a count of entities the packer already returns, not as hidden vectors. Figure 10 of the paper does not justify a small default: it cuts a module that was trained at K=16, and quality stays near the closed-book level up to K=4 on PMv2. Add a test that packs the same fixture at `maxSlots` 1, 2, 4, 8 and 16 and checks that the packed list only grows.
- `SalienceContext.queryText`. When it is set, build the candidate list with `HybridSearchManager` (`semanticSearch` + `rankedSearch` + optional `graphRankPrior`) scoped to those entities, then run the existing salience cut, `IDistillationPolicy`, and `enforceDiversity` on that order. When it is unset, keep the current recency prefilter. The lexical half is `RankedSearch`: TF-IDF scoring, and on SQLite a candidate filter through `SQLiteStorage.fullTextSearch` (FTS5 `bm25()`). Do not construct `BM25Search`.
- `HybridSearchManager.search` takes a `ReadonlyKnowledgeGraph`, not a list of names. To scope the search to the agent entities, pass a graph that holds only those entities and their relations. `SymbolicFilters` (`entityType`, tags, `projectId`) can narrow it further.
- `ContextRetrievalOptions.composeHops?: 0 | 1` (default 0). When it is `1` and `queryText` is set, pass `expandNeighbors: { hops: 1, topK, damping }` to the same `search` call. This needs a `GraphRankPrior` on the `HybridSearchManager`; the existing `lookFor` option can carry the query text so that the neighbors rank by it. The semantic channel matters here: Figure 6 of the paper shows a question with no words in common with the history that answers it, and the lexical factor in `SalienceEngine` cannot rank that history. This is the graph analogue of Figure 4: the connected facts enter the candidate list before the token budget cuts it. Follow the pattern of the other graph signals: an option plus an environment knob (for example `MEMORY_CONTEXT_COMPOSE_HOPS`), where `0` keeps today's behavior.
- `mustInclude` stays the way a caller pins the latest turns, matching Section 6.1's "same history in every condition".
- Passthrough is the current behavior: entities that fit are returned whole. The new ratio is `1` in that case, which is the PubMedQA lesson (Table 11: compression lowered accuracy when the source was 324 tokens).

**New code.** Two fields, one optional cap, and a call into `HybridSearchManager` from `retrieveForContext`. `MemoryFormatter.formatWithSalienceBudget` is unchanged and is how a caller renders the package.

**Done when.** `tests/unit/agent/ContextWindowManager.test.ts` shows a package whose `sourceTokens` is greater than `totalTokens` under a tight `maxTokens`, a ratio of `1` when the budget fits, `maxSlots` truncating the list, and a `queryText` run whose first entity is the hybrid-search top hit (search stubbed with the existing `HybridSearchResult` shape). A second case uses a chain of three entities (A relates to B relates to C) where only A matches the query: with `composeHops: 1` B joins the package, and with `composeHops: 0` it does not. No network, no new fixture corpus.

**Risk.** Hybrid search over every agent entity can be heavier than the recency prefilter. Gate it on `queryText` so the no-query path stays as it is. Neighbor expansion can pull in weakly related entities; the damping factor, `topK`, and the salience cut that follows bound that, and the default stays off. Measure the extra time on a graph of 10,000 entities before the knob gets a non-zero default. Estimate: S.

### E3. Finish the summarizer that is already stubbed — only if a caller asks

**Goal.** Entities that `excluded` already lists can be shortened with the query, using the LLM client the process already has.

**Builds on.** `SummarizationService.summarize` and `SummarizationConfig.maxTokens`. Add an optional `query` argument. Construct `ISummarizationProvider` from the same `LLMProvider` object `MemoryDistiller` already accepts on `IngestOptions.llmProvider`. `ContextWindowManager` calls it only when a provider is configured and only on `excluded` entities, then the caller appends that string with `MemoryFormatter`. No provider means today's extractive pack, unchanged.

**New code.** The provider body inside `SummarizationService` (the file already says the OpenAI provider would be initialized there) and one optional call from `retrieveForContext`. No new policy interface: `IDistillationPolicy` keeps filtering; it does not rewrite text.

**Done when.** `tests/unit/agent/SummarizationService.test.ts` passes a stub `LLMProvider` and a query, and the summary string is the stub's text, clipped by `maxTokens`. A missing provider still returns `fallbackSummarize`.

**Risk.** The provider can invent a sentence the entities do not contain. Keep the fallback path as the default until a caller opts in. This does not train Equation 7. Estimate: S. Do not start E3 in the same change as E1.

### Gap review: paper findings that the first version of this plan did not carry into a build decision

Method: the paper text (main body and Appendices A–G) was compared with Sections 1 to 4 of this plan, finding by finding. The rows below are the findings that the plan either did not mention or mentioned without a decision. Numbers are the ones printed in the paper.

| Paper finding | Evidence in the paper | Code that can use it | Decision |
| --- | --- | --- | --- |
| Compression helps "why" and "how" questions; retrieval helps "who" and "which" questions. | NarrativeQA: Memorilla leads RAG-50 by 4.91 ROUGE-L on "why" and 7.02 on "how"; RAG-50 leads by 3.45 on "who" and 2.93 on "which" (Figure 4a). The authors note that question type also varies with answer length and entity frequency. | `ContextProfileManager.inferProfile` (regex rules, five profiles), `applyProfile` in `ContextWindowManager`. | **E4**, experiment, default unchanged. |
| The advantage grows with the number of composed facts. | FactKG: RAG-50 falls from 78.73 to 51.75 as composed facts go from 1 to 4; Memorilla stays between 80 and 89; the lead over RAG-50 grows from 4.23 to 7.59 points (Figure 4b, 4c). 73.5% of FactKG claims have more than 50 chunks, so part of the gap is evidence that RAG-50 never retrieves. | `HybridSearchManager.expandNeighbors`, `lookFor`, `GraphRankPrior`. | Folded into **E2** (`composeHops`). |
| The relevant history can share no words with the question. | Figure 6: the question has no lexical overlap with the iron-deficiency history that answers it. | `SalienceEngine.calculateQueryRelevance` is lexical today (TF-IDF cosine). The semantic channel of `HybridSearchManager` and the vectors of E1 are not. | Folded into **E2** (`queryText` ranking with the semantic channel) and **E1** (stored vectors). |
| The errors that remain need facts to be linked, not found. | Section 5, "What neither method solves": on PersonalizationV4 many shared errors need facts that each appear somewhere in the history. | `composeHops`, `explain: true` evidence paths. | Folded into **E2**. No separate item. |
| FactKG errors lean toward "false". | True claims are 89.5% of the claims that both methods get wrong and 28.7% of those both get right (Section 5). The authors read this as a decision threshold problem. | None. This is a property of a claim-verification task, not of memory. | **Dropped.** |
| A global memory writes clue queries that guide retrieval (MemoRAG). | MemoRAG is the best baseline on PersonalizationV4 (67.88 against 66.65 for Memorilla) and scores 80.38 on FactKG (Table 11; Appendix C). The paper does not ablate the clue step. | `ActiveRetrievalController` (query rewriting rounds), `LLMQueryPlanner`, `wakeUp` (L0 and L1 summary text). | **Caller pattern only.** A caller can run `ActiveRetrievalController` with the `wakeUp` text as context and pass the final query to `retrieveForContext`. No evidence yet that justifies a built-in clue step. |
| Write-time extraction and consolidation (Mem0). | Appendix C; Mem0 is a baseline in Table 11. | `MemoryDistiller` through `IOManager.ingest`, `ConsolidationPipeline`, `MemoryEngine` dedup. | **Covered.** |
| Fewer navigation loops with learned memory. | Section 6 and Figure 7: the in-context agent loops between explored rooms; the memory agent reaches the goal. The paper measures loops on game states. | `MemoryEngine` already detects a repeated turn (`checkDuplicate`, event `memoryEngine:duplicateDetected`). | **E5**, optional. A repeat count is a proxy, not the paper's measure. |
| A smaller slot count at inference loses quality without retraining. | Figure 10: slots are the first K of a module trained at K=16. PMv2 is 26.58 at K=4 (closed book 25.64) and 44.60 at K=16. PV4 starts at 57.66 (closed book 58.30), dips at K=2 and 4, and reaches 66.65 at K=16. | `maxSlots` in E2. | **Note on E2.** This truncates a trained module. It is no evidence for a good small default. Leave `maxSlots` unset. |
| The best slot count depends on the task. | Figure 9: FactKG, TriviaQA and NarrativeQA rise with every doubling of K; PubMedQA and LaMP-4 stay flat at low K; training at K=128 does not help. | `ProfileConfig` and `ContextRetrievalOptions.maxTokens`. | **Note.** A caller or a profile sets `maxTokens` per task. No global default changes. |
| A larger encoder changes little. | Figure 12 (Appendix E.5): Qwen3-Embedding-4B to 8B moves every score by 1.3 or less, except PubMedQA at +3.00, which is 3 of 100 questions. | `EmbeddingService`, `MEMORY_EMBEDDING_PROVIDER` (default `local`). | **Config note.** Do not buy a larger embedding model for the hybrid channel on this evidence. |
| A synthetic persona benchmark (PersonalizationV4). | Appendix D.1 gives the data pipeline. | `IOManager.ingest` (`chunkBy: 'exchange'`). | **Dropped for now.** E2 uses small hand-made fixtures. Revisit if a recall benchmark is needed. |

#### E4. Question-type profiles (experiment)

**Goal.** A question that asks "why" or "how" gets a context that favors connected facts and, when a provider exists, summaries of the entities that missed the budget. A question that asks "who", "which", "when" or "where" gets verbatim entities. Today the profile system infers only incident, planning, handoff and review from the query.

**Builds on.**

- `ContextProfileManager.inferProfile` (`src/agent/ContextProfileManager.ts`). Add two rules after the four existing ones, so a query that matches an existing profile keeps it: a lookup rule and a synthesis rule, both anchored at the start of the question.
- `ContextProfile` (`src/types/agent-memory.ts`) gains `'lookup'` and `'synthesis'`. Adding members to a string union does not break callers.
- `ProfileConfig` gains an optional `retrieval?: { composeHops?: 0 | 1; summarizeExcluded?: boolean }`. The two new profiles copy the salience weights, temporal focus and budget split of `default`. Only `retrieval` differs.
- `ContextWindowManager.applyProfile` already merges profile values into the options and lets an explicit option win. It copies `retrieval` into `composeHops` (E2) and into the E3 switch.

**New code.** Two regular expressions, two preset entries, one optional field, and a copy in `applyProfile`. No new class.

**Done when.** `tests/unit/agent/ContextProfileManager.test.ts` shows: "why did the build fail" resolves to `synthesis`; "who owns the build" resolves to `lookup`; the four existing profiles resolve as before; a query that matches both an existing rule and a question word keeps the existing profile. A `ContextWindowManager` test shows that `profile: 'auto'` with a "why" question sets `composeHops` to 1 and that an explicit `composeHops: 0` wins.

**Risk.** The paper's own caveat applies: question type is confounded with answer length and entity frequency. Ship the profiles with `retrieval` empty, and fill it only after a measurement on this library's own data shows a gain. Estimate: S. Start after E2.

#### E5. Repeat count per session (optional)

**Goal.** A caller can ask how many turns of a session were repeats, as a cheap signal that an agent is looping.

**Builds on.** `MemoryEngine.addTurn` already returns `duplicateDetected` and emits `memoryEngine:duplicateDetected`. Keep a per-session counter next to the existing session state and expose it through the existing `getSessionTurns` result or one getter. `PatternDetector` and `FailureDistillation` stay the place for deeper analysis.

**New code.** One counter and one getter. No new module.

**Done when.** `tests/unit/agent/MemoryEngine.test.ts` shows the counter rising for an exact repeat and a Jaccard repeat, staying at 0 for distinct turns, and resetting with `deleteSession`.

**Risk.** A repeat of text is not a loop in the world. Name the getter for what it counts. Do not present it as the measure in Section 6 of the paper. Build it only if a caller asks. Estimate: S.

### Mixing map: Memorilla idea, existing module, how they combine

Each row joins a Memorilla idea to a module that already ships. The "Default" column is what a caller gets without any new option. Every new option defaults to today's behavior.

| Memorilla idea | Existing module | How they combine | Default | Item |
| --- | --- | --- | --- | --- |
| Write once, reuse the vector | `IOManager.ingest` hash, `SQLiteStorage.embeddings`, `SemanticSearch.indexAll` | The entity `contentHash` also keys the stored vector, so a changed chunk re-embeds and an unchanged chunk does not. | JSONL keeps the in-memory store. | E1 |
| Fixed number of memory slots (K) | `ContextWindowManager` token budget, `MemoryFormatter.formatWithSalienceBudget` | `maxSlots` caps the entity count next to `maxTokens`; `sourceTokens` and `compressionRatio` report the cut. | `maxSlots` unset. | E2 |
| Query-aware read of the whole collection | `HybridSearchManager` (semantic, lexical, symbolic, graph channels) | `queryText` ranks the candidates before the salience cut. The recency prefilter stays for calls without a query. | No `queryText`: recency prefilter. | E2 |
| Compose facts for one answer | `HybridSearchManager.expandNeighbors`, `lookFor`, `GraphRankPrior` | `composeHops: 1` adds one hop of neighbors before the budget cut. | `composeHops` 0. | E2 |
| Keep verbatim text when it fits | `retrieveForContext` passthrough, `mustInclude` | The ratio is `1` when the source fits. Pinned turns stay verbatim, as in Section 6.1 of the paper. | Unchanged. | E2 |
| Hybrid of verbatim hits and a compressed view | `excluded[]` of `ContextPackage`, `SummarizationService`, `LLMProvider` | The package keeps the verbatim winners. Only the entities that missed the budget get a query-aware summary, appended after the winners. | No provider: extractive pack. | E3 |
| Show why an item was chosen | `explain: true`, `EvidencePathBuilder`, `matchedLayers` | A caller that wants provenance calls `HybridSearchManager.search` with `explain: true`. No change to `ContextPackage`. | Off. | none |
| Adapt the read to the task | `ContextProfileManager` (`profile: 'auto'`), `RoleProfiles` | Profile and role presets already set salience weights and budget splits from the query and the agent role. They run before E2's ranking and stay as they are. E4 adds two question-type profiles to the same mechanism. | Unchanged until E4. | E4 |
| Multi-step recall for hard questions | `ActiveRetrievalController`, `MemoryReconstructor` | A caller runs these first and passes the final query text to `retrieveForContext`. The packer stays single-pass. | Unchanged. | none |
| Spot a looping agent | `MemoryEngine` duplicate detection | A per-session repeat count, read by the caller. | Not built unless asked. | E5 |

Order of the pipeline after E1 to E3, for a call with `queryText`: profile resolution, then hybrid ranking over the agent entities (with optional neighbor expansion), then `SalienceEngine`, `IDistillationPolicy` and `enforceDiversity`, then the budget cut, then (only with a provider) a summary of the `excluded[]` entities, then `MemoryFormatter`. A call without `queryText` follows today's path.

### Dropped

- A `DocumentCollectionStore`, `DocumentMemory`, `ctx.documentMemory`, or any new SQLite table. Chunks are entities; vectors are `embeddings` rows.
- A latent readout adapter, a port of `f_mem`, and GRPO. No existing class accepts hidden states.
- A FactKG or TextWorld harness, and any download of `memorilla/Memorilla-Data`.
- Wiring `BM25Search` into hybrid search. `RankedSearch` and `SQLiteStorage.fullTextSearch` already rank lexically.
- Replacing `compressForContext`, `MemoryEngine`, or `HybridSearchManager`.
- A fifth query-conditioning path beside `applyProfile`, `ActiveRetrievalController`, `LLMQueryPlanner` and `MemoryReconstructor`.
- A "union" evaluator for verbatim versus latent answers (Figure 5). The paper treats the union as an oracle upper bound, and memoryjs has no latent channel to compare against.

### Sequencing

E1 first: it is a wiring fix plus a hash column, and E2's query path is only as good as the vectors it reads. E2 next, in the existing context-window tests, in two commits: the report fields and `maxSlots` first, then the `queryText` ranking and `composeHops`. E3 waits for a caller. E4 follows E2 and starts with empty `retrieval` settings. E5 waits for a caller. Paper scores (84.33, 44.60, 24.2%, 27×) stay in Section 1 as Qwen results, not as acceptance thresholds.
