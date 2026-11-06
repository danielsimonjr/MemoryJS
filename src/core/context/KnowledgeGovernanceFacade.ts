/**
 * KnowledgeGovernanceFacade
 *
 * Owns the governance, audit-ledger, skill, instruction-set, RBAC, and
 * knowledge-repository managers that `ManagerContext` used to hold inline.
 * It also exposes the shared governance hook object that the core mutation
 * managers (entity, relation, observation, IO, compression, archive) receive.
 *
 * Every member is lazy and constructed at most once. Env flags are read on the
 * first access of each member, matching the pre-extraction behaviour. The
 * governance hook object is built only when `MEMORY_GOVERNANCE_ENABLED` is the
 * strict literal `'true'`, and the flag is re-read on every call until a hook
 * object exists.
 *
 * @module core/context/KnowledgeGovernanceFacade
 * @internal
 */

import { GovernanceManager } from '../../features/GovernanceManager.js';
import { AuditLog } from '../../features/AuditLog.js';
import { TransitionLedger } from '../TransitionLedger.js';
import { SkillManager } from '../../agent/skills/SkillManager.js';
import { SkillPublisher } from '../../agent/skills/SkillPublisher.js';
import { InstructionSetManager } from '../../agent/knowledge/InstructionSetManager.js';
import { KnowledgeRepository } from '../../agent/knowledge/KnowledgeRepository.js';
import { RbacMiddleware } from '../../agent/rbac/RbacMiddleware.js';
import { RoleAssignmentStore } from '../../agent/rbac/RoleAssignmentStore.js';
import type { SemanticSearch } from '../../search/SemanticSearch.js';
import type { EntityManager, GovernanceHooks } from '../EntityManager.js';
import type { FailureManager } from '../../agent/FailureManager.js';
import type { GraphStorage } from '../GraphStorage.js';
import { readEnvLooseFlag } from '../../utils/envConfig.js';
import { sidecarPath } from '../../utils/sidecarPath.js';

/** Constructor dependencies for {@link KnowledgeGovernanceFacade}. */
export interface KnowledgeGovernanceFacadeDeps {
  /** Storage that the governance, ledger, and knowledge managers persist through. */
  storage: GraphStorage;
  /** Returns the owning context's entity manager (constructed on demand). */
  getEntityManager: () => EntityManager;
  /** Returns the owning context's failure manager (constructed on demand). */
  getFailureManager: () => FailureManager;
  /**
   * Side-effect-free read of the semantic search. Returns `undefined` when it
   * has not been resolved, so that reading it never forces construction.
   */
  peekSemanticSearch: () => SemanticSearch | null | undefined;
  /** Confinement root of the skill publisher. Default `process.cwd()`. */
  skillPublishRoot?: string;
}

/**
 * Lazy governance, knowledge, and RBAC managers. See the module doc for the
 * resolution rules.
 *
 * @internal
 */
export class KnowledgeGovernanceFacade {
  private readonly deps: KnowledgeGovernanceFacadeDeps;

  private _governanceManager?: GovernanceManager;
  /** Shared hooks passed to every context-wired mutation manager. */
  private _governanceHooks?: GovernanceHooks;
  /** `undefined` = unresolved, `null` = env-gated off. */
  private _transitionLedger?: TransitionLedger | null;
  private _skillManager?: SkillManager;
  private _instructionSets?: InstructionSetManager;
  private _knowledgeRepository?: KnowledgeRepository;
  private _skillPublisher?: SkillPublisher;
  private _roleAssignmentStore?: RoleAssignmentStore;
  private _rbacMiddleware?: RbacMiddleware;

  /**
   * @param deps Storage, lazy accessors for sibling managers, and a peek for
   *   the semantic search that skill blending uses when already initialised.
   */
  constructor(deps: KnowledgeGovernanceFacadeDeps) {
    this.deps = deps;
  }

  /**
   * GovernanceManager — policy enforcement, audit logging, and rollback
   * (v1.6.0 Dynamic Memory Governance).
   *
   * The getter always exists for manual use (`withTransaction`, `rollback`,
   * `setPolicy`). **Enforcement wiring is separate**: when
   * `MEMORY_GOVERNANCE_ENABLED=true` (strict literal), the context also injects
   * the shared hooks from {@link KnowledgeGovernanceFacade.getGovernanceHooks}
   * into the entity, relation, observation, import/restore, archive, and
   * compression mutation paths. Policy denial throws `GovernanceError`; allowed
   * entity changes are audited. With the flag unset, this getter still works
   * but ordinary manager mutations bypass governance (manual opt-in).
   *
   * The audit log lives at `MEMORY_AUDIT_LOG_FILE` when set, otherwise at the
   * `<basename>-audit.jsonl` sidecar next to the storage file (same convention
   * as `-saved-searches` / `-ref-index`).
   */
  get governanceManager(): GovernanceManager {
    if (!this._governanceManager) {
      let auditPath = process.env.MEMORY_AUDIT_LOG_FILE;
      if (!auditPath) {
        auditPath = sidecarPath(this.deps.storage.getFilePath(), '-audit');
      }
      this._governanceManager = new GovernanceManager(this.deps.storage, new AuditLog(auditPath));
    }
    return this._governanceManager;
  }

  /**
   * Return the one live-policy hook object shared by every context-wired
   * mutation manager, or `undefined` when `MEMORY_GOVERNANCE_ENABLED` is not
   * the strict literal `'true'`.
   *
   * The env gate is evaluated on each call until a hook object exists, and the
   * hook object is built once. Each manager receives it at its own first
   * construction, matching the existing lazy wiring model.
   *
   * @returns The shared hooks, or `undefined` when governance enforcement is off.
   * @internal
   */
  getGovernanceHooks(): GovernanceHooks | undefined {
    if (process.env.MEMORY_GOVERNANCE_ENABLED !== 'true') return undefined;
    if (!this._governanceHooks) {
      const gov = this.governanceManager;
      this._governanceHooks = {
        canCreate: entity => gov.getPolicy().canCreate?.(entity) ?? true,
        canUpdate: (entity, updates) => gov.getPolicy().canUpdate?.(entity, updates) ?? true,
        canDelete: entity => gov.getPolicy().canDelete?.(entity) ?? true,
        audit: event =>
          gov.appendAudit({
            operation: event.operation,
            entityName: event.entityName,
            before: event.before,
            after: event.after,
            status: 'committed',
          }),
      };
    }
    return this._governanceHooks;
  }

  /**
   * TransitionLedger — append-only audit trail for state changes.
   * Returns `null` if not enabled via the `MEMORY_TRANSITION_LEDGER` env var.
   * Auto-attaches to the storage event emitter when created.
   */
  get transitionLedger(): TransitionLedger | null {
    if (this._transitionLedger === undefined) {
      if (readEnvLooseFlag('MEMORY_TRANSITION_LEDGER', false)) {
        this._transitionLedger = new TransitionLedger(this.deps.storage.getFilePath());
        this._transitionLedger.attachToEmitter(this.deps.storage.events);
      } else {
        this._transitionLedger = null;
      }
    }
    return this._transitionLedger;
  }

  /**
   * SkillManager (Recursa RS-2), lazy. Semantic blending is used when the
   * semantic search has been initialised before the first `skillManager`
   * access (this getter never constructs it); `MEMORY_EMBEDDING_PROVIDER=none`
   * disables it.
   */
  get skillManager(): SkillManager {
    if (!this._skillManager) {
      const manager = new SkillManager(this.deps.storage, this.deps.getEntityManager());
      const semantic = this.deps.peekSemanticSearch();
      if (semantic) manager.setSemanticSearch(semantic);
      this._skillManager = manager;
    }
    return this._skillManager;
  }

  /** InstructionSetManager (Recursa RS-5), lazy; `history()` uses `transitionLedger`. */
  get instructionSets(): InstructionSetManager {
    if (!this._instructionSets) {
      this._instructionSets = new InstructionSetManager(this.deps.storage, {
        ledger: this.transitionLedger,
        entityManager: this.deps.getEntityManager(),
      });
    }
    return this._instructionSets;
  }

  /** KnowledgeRepository (Recursa RS-5), lazy: snapshots, revisions, `loadForContext`. */
  get knowledgeRepository(): KnowledgeRepository {
    if (!this._knowledgeRepository) {
      this._knowledgeRepository = new KnowledgeRepository({
        storage: this.deps.storage,
        instructionSets: this.instructionSets,
        skills: this.skillManager,
        failures: this.deps.getFailureManager(),
        entityManager: this.deps.getEntityManager(),
      });
    }
    return this._knowledgeRepository;
  }

  /** SkillPublisher (Recursa RS-3), lazy: atomic SKILL.md publish and import. */
  get skillPublisher(): SkillPublisher {
    return (this._skillPublisher ??= new SkillPublisher(this.deps.storage, this.skillManager, {
      ...(this.deps.skillPublishRoot !== undefined ? { root: this.deps.skillPublishRoot } : {}),
    }));
  }

  /**
   * RoleAssignmentStore (η.6.1) — registry of role grants per agent.
   * Lazy. In-memory only by default; configure persistence via the direct
   * constructor if a JSONL sidecar is wanted.
   */
  get roleAssignmentStore(): RoleAssignmentStore {
    if (!this._roleAssignmentStore) {
      this._roleAssignmentStore = new RoleAssignmentStore();
    }
    return this._roleAssignmentStore;
  }

  /**
   * RbacMiddleware (η.6.1) — `RbacPolicy` implementation backed by the lazy
   * {@link KnowledgeGovernanceFacade.roleAssignmentStore}. Lazy.
   */
  get rbacMiddleware(): RbacMiddleware {
    if (!this._rbacMiddleware) {
      this._rbacMiddleware = new RbacMiddleware(this.roleAssignmentStore);
    }
    return this._rbacMiddleware;
  }

  /**
   * Side-effect-free read of the skill manager. Never constructs.
   * @returns The cached `SkillManager`, or `undefined`.
   */
  peekSkillManager(): SkillManager | undefined {
    return this._skillManager;
  }

  /**
   * Side-effect-free read of the instruction sets. Never constructs.
   * @returns The cached `InstructionSetManager`, or `undefined`.
   */
  peekInstructionSets(): InstructionSetManager | undefined {
    return this._instructionSets;
  }

  /**
   * Side-effect-free read of the knowledge repository. Never constructs.
   * @returns The cached `KnowledgeRepository`, or `undefined`.
   */
  peekKnowledgeRepository(): KnowledgeRepository | undefined {
    return this._knowledgeRepository;
  }

  /**
   * Side-effect-free read of the skill publisher. Never constructs.
   * @returns The cached `SkillPublisher`, or `undefined`.
   */
  peekSkillPublisher(): SkillPublisher | undefined {
    return this._skillPublisher;
  }
}
