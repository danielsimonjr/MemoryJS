/**
 * CLI Output Formatters
 *
 * Format data for JSON, table, or CSV output.
 *
 * @module cli/formatters
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type { Entity, Relation } from '../types/types.js';

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

function calculateColWidths(totalWidth: number, ratios: number[]): number[] {
  const padding = 4; // Account for table borders
  const available = totalWidth - padding;
  return ratios.map(r => Math.max(10, Math.floor(available * r)));
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
