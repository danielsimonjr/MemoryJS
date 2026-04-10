/**
 * Synthetic Memory Benchmark for MemoryJS
 *
 * Measures recall accuracy (R@5, R@10) and latency across different
 * search strategies. Uses generated conversation data to simulate
 * a real memory workload.
 */

import { ManagerContext } from '../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface BenchmarkResult {
  mode: string;
  recallAt5: number;
  recallAt10: number;
  avgLatencyMs: number;
  questionsTotal: number;
  questionsCorrect: number;
}

// Generate N conversation pairs with known answers
function generateTestData(n: number): Array<{
  question: string;
  answer: string;
  context: string;
}> {
  const topics = [
    'database', 'authentication', 'deployment', 'testing', 'performance',
    'security', 'API design', 'caching', 'monitoring', 'scaling',
    'CI/CD', 'Docker', 'Kubernetes', 'GraphQL', 'REST',
    'TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Redis',
  ];
  const decisions = [
    'chose', 'decided to use', 'switched to', 'migrated from', 'adopted',
    'rejected', 'replaced', 'upgraded', 'deprecated', 'implemented',
  ];

  const data = [];
  for (let i = 0; i < n; i++) {
    const topic = topics[i % topics.length];
    const decision = decisions[i % decisions.length];
    const detail = `option-${i}-${topic.replace(/\s/g, '-')}`;

    data.push({
      question: `What did we decide about ${topic}?`,
      answer: detail,
      context: `We ${decision} ${detail} for ${topic} because it offered better performance and developer experience. This was discussed in sprint ${Math.floor(i / 5) + 1}.`,
    });
  }
  return data;
}

async function runBenchmark(mode: string, questionCount: number = 100): Promise<BenchmarkResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-bench-'));
  const storagePath = path.join(tmpDir, 'bench.jsonl');

  try {
    const ctx = new ManagerContext(storagePath);
    const testData = generateTestData(questionCount);

    // Ingest all contexts as entities
    for (let i = 0; i < testData.length; i++) {
      const d = testData[i];
      await ctx.entityManager.createEntities([{
        name: `memory-${String(i).padStart(4, '0')}`,
        entityType: 'decision',
        observations: [d.context],
        tags: ['benchmark'],
      }]);
    }

    // Query each question and check if answer is in top results
    let correctAt5 = 0;
    let correctAt10 = 0;
    let totalLatency = 0;

    for (const d of testData) {
      const start = performance.now();

      let results;
      if (mode === 'basic') {
        results = await ctx.searchManager.searchNodes(d.question);
      } else if (mode === 'fuzzy') {
        results = await ctx.searchManager.fuzzySearch(d.question);
      } else if (mode === 'boolean') {
        // Extract key terms for boolean search
        const terms = d.question.split(' ').filter(w => w.length > 3).slice(0, 3);
        results = await ctx.searchManager.booleanSearch(terms.join(' AND '));
      } else {
        results = await ctx.searchManager.searchNodes(d.question);
      }

      const elapsed = performance.now() - start;
      totalLatency += elapsed;

      const entities = results.entities || [];
      const top5 = entities.slice(0, 5);
      const top10 = entities.slice(0, 10);

      const matchesAnswer = (e: any) =>
        e.observations?.some((obs: string) => obs.includes(d.answer));

      if (top5.some(matchesAnswer)) correctAt5++;
      if (top10.some(matchesAnswer)) correctAt10++;
    }

    return {
      mode,
      recallAt5: Math.round((correctAt5 / testData.length) * 1000) / 10,
      recallAt10: Math.round((correctAt10 / testData.length) * 1000) / 10,
      avgLatencyMs: Math.round(totalLatency / testData.length * 100) / 100,
      questionsTotal: testData.length,
      questionsCorrect: correctAt5,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const questionCount = parseInt(process.argv[2] || '100');
  const modes = ['basic', 'fuzzy', 'boolean'];

  console.log(`\n  MemoryJS Synthetic Benchmark (${questionCount} questions)\n`);
  console.log('  Mode      | R@5     | R@10    | Avg Latency | Correct/Total');
  console.log('  ----------|---------|---------|-------------|---------------');

  for (const mode of modes) {
    const result = await runBenchmark(mode, questionCount);
    console.log(
      `  ${result.mode.padEnd(10)}| ${String(result.recallAt5 + '%').padEnd(8)}| ${String(result.recallAt10 + '%').padEnd(8)}| ${String(result.avgLatencyMs + 'ms').padEnd(12)}| ${result.questionsCorrect}/${result.questionsTotal}`
    );
  }

  console.log('\n  Note: These are synthetic benchmarks. For LongMemEval comparison,');
  console.log('  see docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md\n');
}

main().catch(console.error);
