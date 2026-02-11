/**
 * CLI Output Formatters
 *
 * Format data for JSON, table, or CSV output.
 *
 * @module cli/formatters
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type {
  Entity,
  Relation,
  PathResult,
  CentralityResult,
  ConnectedComponentsResult,
  ValidationReport,
} from '../types/types.js';

export type OutputFormat = 'json' | 'table' | 'csv';

/**
 * Get terminal width, with fallback for non-TTY.
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Format entities for output.
 */
export function formatEntities(
  entities: Entity[],
  format: OutputFormat
): string {
  if (entities.length === 0) {
    return format === 'json' ? '[]' : 'No entities found.';
  }

  switch (format) {
    case 'json':
      return JSON.stringify(entities, null, 2);

    case 'table': {
      const table = new Table({
        head: [chalk.cyan('Name'), chalk.cyan('Type'), chalk.cyan('Observations'), chalk.cyan('Tags')],
        colWidths: calculateColWidths(getTerminalWidth(), [0.25, 0.15, 0.4, 0.2]),
        wordWrap: true,
      });

      for (const entity of entities) {
        table.push([
          entity.name,
          entity.entityType,
          (entity.observations || []).slice(0, 3).join('; ') +
            (entity.observations && entity.observations.length > 3 ? '...' : ''),
          (entity.tags || []).join(', '),
        ]);
      }

      return table.toString();
    }

    case 'csv': {
      const header = 'name,entityType,observations,tags';
      const rows = entities.map(e => [
        escapeCSV(e.name),
        escapeCSV(e.entityType),
        escapeCSV((e.observations || []).join('; ')),
        escapeCSV((e.tags || []).join(', ')),
      ].join(','));
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format relations for output.
 */
export function formatRelations(
  relations: Relation[],
  format: OutputFormat
): string {
  if (relations.length === 0) {
    return format === 'json' ? '[]' : 'No relations found.';
  }

  switch (format) {
    case 'json':
      return JSON.stringify(relations, null, 2);

    case 'table': {
      const table = new Table({
        head: [chalk.cyan('From'), chalk.cyan('Relation'), chalk.cyan('To')],
        colWidths: calculateColWidths(getTerminalWidth(), [0.35, 0.3, 0.35]),
      });

      for (const rel of relations) {
        table.push([rel.from, rel.relationType, rel.to]);
      }

      return table.toString();
    }

    case 'csv': {
      const header = 'from,relationType,to';
      const rows = relations.map(r => [
        escapeCSV(r.from),
        escapeCSV(r.relationType),
        escapeCSV(r.to),
      ].join(','));
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format search results for output.
 */
export function formatSearchResults(
  results: Array<{ entity: Entity; score?: number }>,
  format: OutputFormat
): string {
  if (results.length === 0) {
    return format === 'json' ? '[]' : 'No results found.';
  }

  switch (format) {
    case 'json':
      return JSON.stringify(results, null, 2);

    case 'table': {
      const table = new Table({
        head: [chalk.cyan('Name'), chalk.cyan('Type'), chalk.cyan('Score'), chalk.cyan('Observations')],
        colWidths: calculateColWidths(getTerminalWidth(), [0.25, 0.15, 0.1, 0.5]),
        wordWrap: true,
      });

      for (const result of results) {
        table.push([
          result.entity.name,
          result.entity.entityType,
          result.score !== undefined ? result.score.toFixed(3) : '-',
          (result.entity.observations || []).slice(0, 2).join('; ') +
            (result.entity.observations && result.entity.observations.length > 2 ? '...' : ''),
        ]);
      }

      return table.toString();
    }

    case 'csv': {
      const header = 'name,entityType,score,observations';
      const rows = results.map(r => [
        escapeCSV(r.entity.name),
        escapeCSV(r.entity.entityType),
        r.score !== undefined ? r.score.toFixed(3) : '',
        escapeCSV((r.entity.observations || []).join('; ')),
      ].join(','));
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format a single entity for detailed output.
 */
export function formatEntityDetail(
  entity: Entity | null,
  format: OutputFormat
): string {
  if (!entity) {
    return format === 'json' ? 'null' : 'Entity not found.';
  }

  switch (format) {
    case 'json':
      return JSON.stringify(entity, null, 2);

    case 'table': {
      const lines = [
        `${chalk.bold('Name:')} ${entity.name}`,
        `${chalk.bold('Type:')} ${entity.entityType}`,
        `${chalk.bold('Importance:')} ${entity.importance ?? 'N/A'}`,
        `${chalk.bold('Tags:')} ${(entity.tags || []).join(', ') || 'None'}`,
        `${chalk.bold('Parent:')} ${entity.parentId || 'None'}`,
        `${chalk.bold('Created:')} ${entity.createdAt || 'N/A'}`,
        `${chalk.bold('Modified:')} ${entity.lastModified || 'N/A'}`,
        '',
        chalk.bold('Observations:'),
        ...(entity.observations || []).map((o, i) => `  ${i + 1}. ${o}`),
      ];
      return lines.join('\n');
    }

    case 'csv': {
      const header = 'field,value';
      const rows = [
        `name,${escapeCSV(entity.name)}`,
        `entityType,${escapeCSV(entity.entityType)}`,
        `importance,${entity.importance ?? ''}`,
        `tags,${escapeCSV((entity.tags || []).join('; '))}`,
        `parentId,${escapeCSV(entity.parentId || '')}`,
        `observations,${escapeCSV((entity.observations || []).join('; '))}`,
      ];
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format a success message.
 */
export function formatSuccess(message: string): string {
  return chalk.green('✓') + ' ' + message;
}

/**
 * Format an error message.
 */
export function formatError(message: string): string {
  return chalk.red('✗') + ' ' + message;
}

/**
 * Format a shortest path result.
 */
export function formatPath(
  result: PathResult,
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify({
        path: result.path,
        length: result.length,
        relations: result.relations,
      }, null, 2);

    case 'table': {
      const lines = [
        `${chalk.bold('Path:')} ${result.path.join(' -> ')}`,
        `${chalk.bold('Length:')} ${result.length} hop(s)`,
        '',
        chalk.bold('Relations:'),
        ...result.relations.map(r => `  ${r.from} --[${r.relationType}]--> ${r.to}`),
      ];
      return lines.join('\n');
    }

    case 'csv': {
      const header = 'step,from,relationType,to';
      const rows = result.relations.map((r, i) =>
        `${i + 1},${escapeCSV(r.from)},${escapeCSV(r.relationType)},${escapeCSV(r.to)}`
      );
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format centrality results.
 */
export function formatCentrality(
  result: CentralityResult,
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify({
        algorithm: result.algorithm,
        topEntities: result.topEntities,
      }, null, 2);

    case 'table': {
      const table = new Table({
        head: [chalk.cyan('#'), chalk.cyan('Entity'), chalk.cyan('Score')],
        colWidths: calculateColWidths(getTerminalWidth(), [0.1, 0.6, 0.3]),
      });
      result.topEntities.forEach((e, i) => {
        table.push([String(i + 1), e.name, e.score.toFixed(4)]);
      });
      return `${chalk.bold(`Centrality (${result.algorithm}):`)}` + '\n' + table.toString();
    }

    case 'csv': {
      const header = 'rank,entity,score';
      const rows = result.topEntities.map((e, i) =>
        `${i + 1},${escapeCSV(e.name)},${e.score.toFixed(4)}`
      );
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format connected components result.
 */
export function formatComponents(
  result: ConnectedComponentsResult,
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2);

    case 'table': {
      const lines = [
        `${chalk.bold('Components:')} ${result.count}`,
        `${chalk.bold('Largest:')} ${result.largestComponentSize} entities`,
        '',
      ];
      result.components.forEach((comp, i) => {
        lines.push(`  ${chalk.cyan(`Component ${i + 1}`)} (${comp.length}): ${comp.slice(0, 10).join(', ')}${comp.length > 10 ? '...' : ''}`);
      });
      return lines.join('\n');
    }

    case 'csv': {
      const header = 'component,size,entities';
      const rows = result.components.map((comp, i) =>
        `${i + 1},${comp.length},${escapeCSV(comp.join('; '))}`
      );
      return [header, ...rows].join('\n');
    }
  }
}

/**
 * Format validation report.
 */
export function formatValidation(
  result: ValidationReport,
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2);

    case 'csv': {
      const header = 'severity,type,message';
      const rows: string[] = [];
      for (const issue of result.issues) {
        rows.push(`error,${escapeCSV(issue.type)},${escapeCSV(issue.message)}`);
      }
      for (const w of result.warnings) {
        rows.push(`warning,${escapeCSV(w.type)},${escapeCSV(w.message)}`);
      }
      return [header, ...rows].join('\n');
    }

    case 'table': {
      const lines: string[] = [];
      const status = result.isValid ? chalk.green('VALID') : chalk.red('INVALID');
      lines.push(`Graph validation: ${status}`);
      lines.push(`  Errors: ${result.summary.totalErrors}`);
      lines.push(`  Warnings: ${result.summary.totalWarnings}`);
      lines.push(`  Orphaned relations: ${result.summary.orphanedRelationsCount}`);
      lines.push(`  Isolated entities: ${result.summary.entitiesWithoutRelationsCount}`);

      if (result.issues.length > 0) {
        lines.push('', chalk.red('Issues:'));
        for (const issue of result.issues) {
          lines.push(`  [${issue.type}] ${issue.message}`);
        }
      }
      if (result.warnings.length > 0) {
        lines.push('', chalk.yellow('Warnings:'));
        for (const w of result.warnings) {
          lines.push(`  [${w.type}] ${w.message}`);
        }
      }
      return lines.join('\n');
    }
  }
}

function calculateColWidths(totalWidth: number, ratios: number[]): number[] {
  const padding = 4; // Account for table borders
  const available = totalWidth - padding;
  return ratios.map(r => Math.max(10, Math.floor(available * r)));
}

export function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
