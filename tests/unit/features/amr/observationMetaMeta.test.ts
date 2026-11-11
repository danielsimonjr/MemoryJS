/**
 * The open `meta` map on `observationMeta[]` survives the public write paths and a disk reload.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ManagerContext } from "../../../../src/core/ManagerContext.js";

// `added` maps to recordedAt, so meta holds only source and other open keys.
const meta = {
  source: ["https://e.test/1", "https://e.test/2"],
  topic: ["billing"],
};

describe.each(["jsonl", "sqlite"] as const)(
  "observationMeta[].meta on %s",
  (backend) => {
    let dir: string;
    let file: string;
    const prev = process.env.MEMORY_STORAGE_TYPE;

    beforeEach(async () => {
      dir = await fs.mkdtemp(join(tmpdir(), "amr-meta-"));
      file = join(dir, backend === "sqlite" ? "m.db" : "m.jsonl");
      process.env.MEMORY_STORAGE_TYPE = backend;
    });

    afterEach(async () => {
      if (prev === undefined) delete process.env.MEMORY_STORAGE_TYPE;
      else process.env.MEMORY_STORAGE_TYPE = prev;
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("keeps meta through createEntities and updateEntity, then a reload", async () => {
      const ctx = new ManagerContext(file);
      try {
        await ctx.entityManager.createEntities([
          {
            name: "team_structure",
            entityType: "note",
            observations: ["Fact one"],
            observationMeta: [
              {
                content: "Fact one",
                recordedAt: "2026-09-03T00:00:00.000Z",
                meta,
              },
            ],
          },
        ]);
        await ctx.entityManager.updateEntity("team_structure", {
          observations: ["Fact one", "Fact two"],
          observationMeta: [
            {
              content: "Fact one",
              recordedAt: "2026-09-03T00:00:00.000Z",
              meta,
            },
            { content: "Fact two", meta: { source: ["https://e.test/3"] } },
          ],
        });
      } finally {
        ctx.close();
      }

      const ctx2 = new ManagerContext(file);
      try {
        const e = await ctx2.entityManager.getEntity("team_structure");
        expect(e?.observationMeta).toEqual([
          { content: "Fact one", recordedAt: "2026-09-03T00:00:00.000Z", meta },
          { content: "Fact two", meta: { source: ["https://e.test/3"] } },
        ]);
      } finally {
        ctx2.close();
      }
    });
  },
);
