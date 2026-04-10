/**
 * Profile Manager
 *
 * Manages user profiles stored as Entity instances with entityType 'profile'.
 * Observations are tagged [static] or [dynamic] to classify facts.
 *
 * @module agent/ProfileManager
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { SessionManager } from './SessionManager.js';
import type { SalienceEngine } from './SalienceEngine.js';

const STATIC_PREFIX = '[static] ';
const DYNAMIC_PREFIX = '[dynamic] ';

export interface ProfileResponse {
  /** Long-lived stable facts (parsed from [static] observations). */
  static: string[];
  /** Recent session-derived context (parsed from [dynamic] observations). */
  dynamic: string[];
  /** The backing Entity name. */
  entityName: string;
}

export interface ProfileManagerConfig {
  staticThreshold?: number;
  dynamicRecencyThreshold?: number;
  maxDynamicFacts?: number;
  autoExtract?: boolean;
}

export interface ProfileOptions {
  projectId?: string;
  agentId?: string;
}

export class ProfileManager {
  constructor(
    _storage: GraphStorage,
    private entityManager: EntityManager,
    private observationManager: ObservationManager,
    _sessionManager?: SessionManager,
    _salienceEngine?: SalienceEngine,
    private config: ProfileManagerConfig = {}
  ) {}

  /**
   * Compute the profile entity name for a given scope.
   * Sanitizes projectId: non-alphanumeric characters become '-', lowercased.
   */
  getProfileEntityName(projectId?: string): string {
    if (!projectId) return 'profile-global';
    const sanitized = projectId.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `profile-${sanitized}`;
  }

  async getProfile(options: ProfileOptions = {}): Promise<ProfileResponse> {
    const entityName = this.getProfileEntityName(options.projectId);
    const entity = await this.entityManager.getEntity(entityName);

    if (!entity) {
      return { static: [], dynamic: [], entityName };
    }

    const staticFacts: string[] = [];
    const dynamicFacts: string[] = [];

    for (const obs of entity.observations) {
      if (obs.startsWith(STATIC_PREFIX)) {
        staticFacts.push(obs.slice(STATIC_PREFIX.length));
      } else if (obs.startsWith(DYNAMIC_PREFIX)) {
        dynamicFacts.push(obs.slice(DYNAMIC_PREFIX.length));
      }
    }

    return { static: staticFacts, dynamic: dynamicFacts, entityName };
  }

  async addFact(
    content: string,
    type: 'static' | 'dynamic',
    options: ProfileOptions = {}
  ): Promise<void> {
    const entityName = this.getProfileEntityName(options.projectId);
    const prefix = type === 'static' ? STATIC_PREFIX : DYNAMIC_PREFIX;
    const prefixed = prefix + content;

    const existing = await this.entityManager.getEntity(entityName);
    if (!existing) {
      await this.entityManager.createEntities([
        {
          name: entityName,
          entityType: 'profile',
          observations: [prefixed],
          importance: 10,
          projectId: options.projectId,
        },
      ]);
      return;
    }

    if (existing.observations.includes(prefixed)) return;

    await this.observationManager.addObservations([
      { entityName, contents: [prefixed] },
    ]);

    if (type === 'dynamic') {
      await this.trimDynamicFacts(entityName);
    }
  }

  async promoteFact(content: string, options: ProfileOptions = {}): Promise<void> {
    const entityName = this.getProfileEntityName(options.projectId);
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return;

    const dynamicTagged = DYNAMIC_PREFIX + content;
    if (!entity.observations.includes(dynamicTagged)) return;

    await this.observationManager.deleteObservations([
      { entityName, observations: [dynamicTagged] },
    ]);
    await this.observationManager.addObservations([
      { entityName, contents: [STATIC_PREFIX + content] },
    ]);
  }

  private async trimDynamicFacts(entityName: string): Promise<void> {
    const max = this.config.maxDynamicFacts ?? 20;
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return;

    const dynamicFacts = entity.observations.filter(o => o.startsWith(DYNAMIC_PREFIX));
    if (dynamicFacts.length <= max) return;

    const toRemove = dynamicFacts.slice(0, dynamicFacts.length - max);
    await this.observationManager.deleteObservations([
      { entityName, observations: toRemove },
    ]);
  }
}
