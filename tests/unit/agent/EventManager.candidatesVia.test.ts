/**
 * EventManager candidate selection (CL-23 candidatesVia)
 *
 * Uses stub managers and records which event names are looked up, so the
 * test sees the candidate set directly: the opposite endpoint of each relation
 * of the right type whose anchor sits on the right side.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventManager } from '../../../src/agent/events/EventManager.js';
import type { EntityManager } from '../../../src/core/EntityManager.js';
import type { RelationManager } from '../../../src/core/RelationManager.js';
import type { Relation } from '../../../src/types/types.js';

function rel(from: string, to: string, relationType: string): Relation {
  return { from, to, relationType } as Relation;
}

function setup(relations: Relation[]) {
  const getEntity = vi.fn(async () => null);
  const listEntities = vi.fn(async () => []);
  const getRelations = vi.fn(async () => relations);
  const entityManager = { getEntity, listEntities } as unknown as EntityManager;
  const relationManager = { getRelations } as unknown as RelationManager;
  const manager = new EventManager(entityManager, relationManager);
  const looked = () => getEntity.mock.calls.map((c) => c[0]);
  return { manager, getRelations, looked };
}

const NOISE = [
  rel('alice', 'ev-actor-1', 'actor_of'),
  rel('ev-actor-2', 'alice', 'actor_of'), // anchor on the wrong side
  rel('alice', 'ev-other', 'targeted'), // wrong relation type
  rel('alice', 'ev-actor-1', 'actor_of'), // duplicate candidate (deduped downstream)
  rel('alice', 'ev-actor-3', 'actor_of'),
];

describe('EventManager candidate selection', () => {
  it('actor filter takes the `to` end of actor_of relations anchored on `from`', async () => {
    const { manager, getRelations, looked } = setup(NOISE);
    await manager.queryEvents({ actor: 'alice' });
    expect(getRelations).toHaveBeenCalledWith('alice');
    expect(looked()).toEqual(['ev-actor-1', 'ev-actor-3']);
  });

  it('target filter takes the `from` end of targeted relations anchored on `to`', async () => {
    const { manager, getRelations, looked } = setup([
      rel('ev-1', 'svc', 'targeted'),
      rel('svc', 'ev-2', 'targeted'), // anchor on the wrong side
      rel('ev-3', 'svc', 'actor_of'), // wrong relation type
      rel('ev-4', 'svc', 'targeted'),
    ]);
    await manager.queryEvents({ target: 'svc' });
    expect(getRelations).toHaveBeenCalledWith('svc');
    expect(looked()).toEqual(['ev-1', 'ev-4']);
  });

  it('whoDidWhat context filter takes occurred_in relations anchored on `to`', async () => {
    const { manager, looked } = setup([
      rel('ev-a', 'room', 'occurred_in'),
      rel('ev-b', 'room', 'targeted'),
      rel('room', 'ev-c', 'occurred_in'),
    ]);
    await manager.whoDidWhat({ context: 'room' });
    expect(looked()).toEqual(['ev-a']);
  });

  it('returns no candidates when no relation matches', async () => {
    const { manager, looked } = setup([rel('x', 'y', 'actor_of')]);
    await manager.queryEvents({ actor: 'nobody' });
    expect(looked()).toEqual([]);
  });
});
