---
title: '一篇论文烧掉 4.6 万思考 token 之后：我们为什么关掉了评委模型的“思考”'
description: '从一次结构化输出被截断的线上故障说起：评分规则已经拆成原子项之后，评委模型的自由思考不再有用，管用的是可被代码核对的原文引文。本文列出我们的六个判断，以及 13 篇 2023–2026 年的 LLM-as-a-Judge 论文分别验证了其中哪一个。'
pubDate: 2026-11-10
tags: ['LLM-as-a-Judge', 'Chain-of-Thought', '自动评分', 'Rubric', '评测']
author: 'liuzhne'
draft: false
---

> **导读**：评分规则已经拆得很细了，还要不要给评委模型开思考？我们在线上踩了一次坑之后，结论是不要：**规则一旦原子化，自由思考帮不上忙，还会添乱；管用的是让模型交出一段能被代码核对的原文引文。**
>
> 这篇文章先交代那次故障，然后把我们的六个判断逐条列出来，每条后面是验证它的论文。

---

## 一、一次不起眼的线上故障

论文评分系统上线后不久，我们碰到一个小故障：部分评分调用返回的 JSON 不完整，解析失败，对应规则的判定直接丢了。

原因很快就查到了。系统给一篇论文打分要调用 48 次模型，每次只判一条规则。把这 48 次调用的用量加起来一看，光思考 token 就有约 4.6 万个。输出预算全被思考吃掉了，等到真正要输出结构化判定时，`max_tokens` 已经见底。

调大 `max_tokens` 可以让故障消失，但我们更想知道的是：平均每条规则将近一千个 token 的思考，到底换来了什么？

要回答这个问题，得先看我们的架构。一条评分规则送到模型手上之前，已经过了三道工序：

- **拆解**：评分标准在编译期就拆成了原子规则，每条只描述一种可以独立核对的情形；
- **定位**：检索层按规则指定的章节范围筛出几段候选证据，编号 E1 到 En；
- **算分**：每条规则的判定结果，由代码按一份冻结的评分政策汇总，不经过模型。

留给模型的只剩一步：读一条规则，读几段证据，回答“触发、未触发、不适用、证据不足”四选一。

在这样的架构下，我们的判断是：思考什么也没换来，应该关掉。这个判断可以拆成六条，下面逐条给出依据。

## 二、判断一：思考在评分里的作用是“规划”，而我们的规划已经做完了

让评委模型“先想再打分”，源头是 2023 年的 **G-Eval**（[arXiv:2303.16634](https://arxiv.org/abs/2303.16634)）。它把链式思考（CoT）和表单填写结合起来，用 GPT-4 在摘要评估上拿到了当时最好的人机一致性。G-Eval 拿到的评分标准只有一句话，比如“评估这篇摘要的连贯性”，怎么拆维度、看哪些段落、怎么汇总成分数，都要靠模型在推理中自己补上。CoT 在这里干的活是生成评估步骤。

**EvalPlanner**（ICML 2025，[arXiv:2501.18099](https://arxiv.org/abs/2501.18099)）把这一点讲得更明确：它让模型先生成一份评估计划，再执行，最后下判定，在 RewardBench 上取得了当时最好的成绩（93.9）。它的收益来自“规划”这一步。

这两篇论文说明，思考的价值在于把笼统的标准展开成可执行的方案。而在我们的系统里，拆解、定位、算分都已经挪到了模型之外，模型面前没有规划可做。

## 三、判断二：在评委任务上，自由思考会让判定变差

**Wang、Zhang 和 Choi**（EMNLP 2025 Findings，[arXiv:2503.03064](https://arxiv.org/abs/2503.03064)）直接对比了评委模型“先写一小段解释再判定”和“直接判定”两种设置。结论是 CoT 会让判定分布坍缩，并且经常拖累表现：在逐点打分和成对打分、用分布均值做推断的 16 组对比中，不带 CoT 的有 14 组更好。

模型直接下判定时，输出的概率分布里带着“有几成把握”的信息；一旦先写下一句带倾向的话，后面的判定基本就被定死了。而“明显违反”和“勉强算违反”之间的差别，正是评分校准的依据。

**Liu 等人**（[arXiv:2410.21333](https://arxiv.org/abs/2410.21333)，2024）从另一个角度验证了“多想不一定更好”：在隐式统计学习、人脸识别、带例外的分类三类任务上，CoT 明显拉低了模型表现，其中一项上 o1-preview 比 GPT-4o 低了 36.3 个百分点。

## 四、判断三：思考写出来的理由，不能当作判分依据

**Turpin 等人**（NeurIPS 2023，[arXiv:2305.04388](https://arxiv.org/abs/2305.04388)）在输入里掺入带偏的表面特征，比如让示例的正确答案全是 A。模型会被带偏，然后在 CoT 里给错误答案编出一套头头是道的论证，却只字不提真正影响它的那个特征，准确率最多掉了 36%。

**Bagaria 等人**（EMNLP 2026，[arXiv:2609.02942](https://arxiv.org/abs/2609.02942)）在评分场景里验证了同类现象：训练一个分类器，完全不看被评内容，只看评分标准的文字，就能相当准地猜中评委模型会打出什么结果；把被评回答或者规则条目反转过来，评委也常常不改判。评委有一部分“推理”是顺着规则的措辞走的，跟被评的文章关系不大。

这两篇论文对应的是自由思考的两种典型错判：对规则里某个字眼先有了印象，接着不断给自己找理由，把作者已经交代清楚的写法判成缺陷；或者替一处明显的缺失找到“可以理解”的说法，放了过去。两种情况下，思考过程读起来都很有说服力。

## 五、判断四：思考会让同一条规则每次都被重新理解一遍

**RULERS**（EMNLP 2026 主会，[arXiv:2601.08654](https://arxiv.org/abs/2601.08654)）把这个现象叫作“评分标准执行漂移”（rubric execution drift）：同一份标准，每次推理都被重新解读，准则的含义和分数的边界会随着提示词措辞、准则顺序、输出格式而变。

我们在编译期把规则锁死，就是为了避免这种漂移。让模型在每次调用里重新琢磨规则的边界，等于把锁打开。

## 六、判断五：换成推理模型，评委的偏见也不会消失

**Huang 等人**（ACL 2026 EvalEval Workshop，[arXiv:2601.03630](https://arxiv.org/abs/2601.03630)）系统对比了推理模型与非推理模型当评委的表现，发现推理模型仍然有很强的评估偏见。他们给出的缓解办法 PlanJudge，是让模型在判定前先写出一份明确的评估计划，也就是用显式的结构去约束推理。

**Liu 等人**（[arXiv:2603.12246](https://arxiv.org/abs/2603.12246)，2026）则发现，拿推理评委当奖励信号训练出来的模型，会学会专门讨好评委的对抗性输出，还能骗过别的评委，在 Arena-Hard 这样的公开基准上拿高分。

两篇论文都说明，“想得更久”并不等于“判得更可靠”。

## 七、判断六：管用的是原子判定、逐字引文、允许弃权和代码算分

关掉思考之后，我们让模型在判定某条规则触发时，必须从候选证据里一字不差地摘出一段原文，再用一句话说明理由：

```json
{
  "rule_id": "R-3.2-07",
  "verdict": "triggered",
  "quote": "本文未对样本量的确定依据作出说明",
  "rationale": "方法章节未给出样本量的计算依据，符合该条规则描述的情形。"
}
```

`quote` 由代码做子串校验，在原文里找不到就直接作废；`rationale` 限制在一句话、80 字以内；判定选项里保留“证据不足”。这套设计的每个部分都有论文验证。

**原子化的二元判定提高一致性。** **CheckEval**（EMNLP 2025，[arXiv:2403.18771](https://arxiv.org/abs/2403.18771)）把笼统的量表打分改成一组“是/否”检查项，在 12 个评委模型上，模型之间的平均一致性提高了 0.45，分数方差下降。

**锁定标准加证据绑定，QWK 大幅提升。** **RULERS** 把标准锁定、证据绑定的结构化判定和校准合在一起，在 ASAP 2.0 作文数据集上把 GPT-4o-mini 的 QWK 从 0.46 提到了 0.71，换用其他三个骨干模型，结果也都在 0.68 到 0.72 之间。

**逐条独立判定，并允许模型弃权。** **Autorubric**（[arXiv:2603.00077](https://arxiv.org/abs/2603.00077)，2026）让每条准则单独调用一次模型，以减少准则之间的相互干扰；用显式的 `CANNOT_ASSESS` 选项，避免模型在证据不够时被迫二选一。

**长文档评审同样适用。** **SAGE**（[arXiv:2609.20829](https://arxiv.org/abs/2609.20829)，2026）把基金评审标准写成带类型的 schema，逐项关联到申请材料里的证据，与专家的一致性（κ = 0.58）高于“一条准则一个提示词”的基线（κ = 0.33）。

**不让模型决定查哪些规则，算分用简单的代码。** **Qian 等人**（[arXiv:2610.13375](https://arxiv.org/abs/2610.13375)，2026 年 10 月）比较了三种使用规则层级的方式：每条规则独立判定（Flat）；先自上而下筛出可疑分支再判定（Tree）；不做筛选，只把规则所在的完整层级路径作为上下文交给模型（Path）。在两个评委模型、三类测试样本共 6 组对比中，Tree 全部不如 Flat，最差的一组低了 7.48 个百分点；Path 全部好于 Flat。论文还发现，判定内容不变时，换用更复杂的分数汇总方式，提升很有限。这对应我们的两个做法：把完整的章节路径交给模型当上下文，但规则查不查由架构决定；汇总分数用确定性的代码。

## 八、总结

回到开头的问题：那些思考 token 什么也没换来。评分里的思考是用来做规划的，而我们的规划已经由规则编译、证据检索和代码算分完成；继续开着思考，只会让判定失去分寸、理由无从核对、规则被反复重新解读。

六个判断和对应的论文汇总如下：

| 我们的判断 | 验证它的论文 |
| --- | --- |
| 思考在评分里的作用是规划，规划做完后它就没有用武之地 | G-Eval；EvalPlanner |
| 在评委任务上，自由思考会让判定变差 | Wang et al. 2025；Liu et al. 2024 |
| 思考写出来的理由不能当作判分依据 | Turpin et al. 2023；Bagaria et al. 2026 |
| 思考会让同一条规则被反复重新理解 | RULERS |
| 换成推理模型，评委的偏见也不会消失 | Huang et al. 2026；Liu et al. 2026 |
| 管用的是原子判定、逐字引文、允许弃权和代码算分 | CheckEval；RULERS；Autorubric；SAGE；Qian et al. 2026 |

落到工程上就是三条：

1. **能在模型之外定下来的事，不留给模型临场决定。**
2. **需要模型判断的地方，让它交出代码能核对的东西。**
3. **保留“证据不足”这个出口，不逼模型在没有依据时表态。**

---

## 参考文献

1. Qian et al. [From Structure to Validity: Mechanism-Guided Generation and Refinement of LLM Rubrics](https://arxiv.org/abs/2610.13375). arXiv:2610.13375, 2026.
2. Varapaev et al. [SAGE: Schema-Guided LLMs for Grant Review](https://arxiv.org/abs/2609.20829). arXiv:2609.20829, 2026.
3. Bagaria et al. [Judging LLM-as-a-Judge: Concerning Rubric Artifacts in LLM-based Automated Text Generation Evaluation](https://arxiv.org/abs/2609.02942). EMNLP 2026.
4. Liu et al. [Examining Reasoning LLMs-as-Judges in Non-Verifiable LLM Post-Training](https://arxiv.org/abs/2603.12246). arXiv:2603.12246, 2026.
5. Rao & Callison-Burch. [Autorubric: A Unifying Framework for Rubric-Based LLM Evaluation on Non-Verifiable Tasks](https://arxiv.org/abs/2603.00077). arXiv:2603.00077, 2026.
6. Hong et al. [From Rubrics to Reliable Scores: Evidence-Grounded Text Evaluation with LLM Judges](https://arxiv.org/abs/2601.08654). EMNLP 2026.
7. Huang et al. [Reasoning Model Is Superior LLM-Judge, Yet Suffers from Biases](https://arxiv.org/abs/2601.03630). ACL 2026 EvalEval Workshop.
8. Wang, Zhang & Choi. [Improving LLM-as-a-Judge Inference with the Judgment Distribution](https://arxiv.org/abs/2503.03064). EMNLP 2025 Findings.
9. Saha et al. [Learning to Plan & Reason for Evaluation with Thinking-LLM-as-a-Judge](https://arxiv.org/abs/2501.18099). ICML 2025.
10. Liu et al. [Mind Your Step (by Step): Chain-of-Thought can Reduce Performance on Tasks where Thinking Makes Humans Worse](https://arxiv.org/abs/2410.21333). arXiv:2410.21333, 2024.
11. Lee et al. [CheckEval: A reliable LLM-as-a-Judge framework for evaluating text generation using checklists](https://arxiv.org/abs/2403.18771). EMNLP 2025.
12. Turpin et al. [Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting](https://arxiv.org/abs/2305.04388). NeurIPS 2023.
13. Liu et al. [G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment](https://arxiv.org/abs/2303.16634). arXiv:2303.16634, 2023.
