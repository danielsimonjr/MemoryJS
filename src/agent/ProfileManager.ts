/**
 * Profile Manager
 *
 * Manages user profiles stored as Entity instances with entityType 'profile'.
 * Observations are tagged [static] or [dynamic] to classify facts.
 *
 * @module agent/ProfileManager
 */

import type { IGraphStorage } from '../types/types.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { SessionManager } from './SessionManager.js';
import { isSessionEntity } from '../types/agent-memory.js';
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
    private storage: IGraphStorage,
    private entityManager: EntityManager,
    private observationManager: ObservationManager,
    private sessionManager?: SessionManager,
    private salienceEngine?: SalienceEngine,
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

  /**
   * Extract profile-worthy facts from a session's observations and add
   * them to the profile. Uses SalienceEngine to classify facts as
   * static (high baseImportance, low recencyBoost) or dynamic.
   *
   * Requires SessionManager and SalienceEngine to be configured.
   *
   * @returns Array of newly added facts (without prefix)
   */
  async extractFromSession(sessionId: string): Promise<string[]> {
    if (!this.sessionManager || !this.salienceEngine) {
      return [];
    }

    // Prefer active session; fall back to storage for ended sessions.
    let session: { observations?: string[] } | undefined =
      await this.sessionManager.getActiveSession(sessionId);
    if (!session) {
      const stored = this.storage.getEntityByName(sessionId);
      if (stored && isSessionEntity(stored)) {
        session = stored;
      }
    }
    if (!session) return [];

    const observations = (session as any).observations ?? [];
    const staticThreshold = this.config.staticThreshold ?? 0.6;
    const dynamicRecencyThreshold = this.config.dynamicRecencyThreshold ?? 0.5;

    const existing = await this.getProfile();
    const existingSet = new Set([...existing.static, ...existing.dynamic]);

    const added: string[] = [];
    for (const obs of observations) {
      if (existingSet.has(obs)) continue;

      const salience = await this.salienceEngine.calculateSalience(obs, {
        temporalFocus: 'recent' as any,
      });
      const components = (salience as any).components ?? {};
      const baseImportance = components.baseImportance ?? 0;
      const recencyBoost = components.recencyBoost ?? 0;

      let type: 'static' | 'dynamic';
      if (baseImportance >= staticThreshold && recencyBoost < 0.2) {
        type = 'static';
      } else if (recencyBoost >= dynamicRecencyThreshold) {
        type = 'dynamic';
      } else {
        continue;
      }

      await this.addFact(obs, type);
      added.push(obs);
    }

    return added;
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
