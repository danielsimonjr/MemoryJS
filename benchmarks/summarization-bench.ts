
import { SummarizationService, ISummarizationProvider } from '../src/agent/SummarizationService.js';

async function runBenchmark() {
  const service = new SummarizationService();

  // Mock provider with delay to simulate LLM latency
  const LATENCY_MS = 100;
  const mockProvider: ISummarizationProvider = {
    summarize: async (texts) => {
      await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
      return `Summary of ${texts.length} texts`;
    },
    isAvailable: () => true,
  };
  service.registerProvider(mockProvider);

  const groups = Array.from({ length: 10 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => `Text ${i}-${j}`)
  );

  console.log(`Running benchmark with 10 groups, each having ${LATENCY_MS}ms simulated latency...`);

  const start = Date.now();
  const summaries = await service.summarizeGroups(groups);
  const duration = Date.now() - start;

  console.log(`Duration: ${duration}ms`);
  console.log(`Summaries count: ${summaries.length}`);

  if (duration < LATENCY_MS * 2) {
    console.log("SUCCESS: Summarization seems to be concurrent!");
  } else {
    console.log("FAILURE: Summarization seems to be sequential.");
  }
}

runBenchmark().catch(console.error);
